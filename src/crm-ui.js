import { uid, dateKey, addDays } from './domain.js';
import {
  SERVICES, LEAD_STATUSES, PROJECT_STATUSES, DEFAULT_STAGES,
  saveClient, saveLead, saveProject, convertLead, scheduleLeadAction, archiveEntity,
} from './crm-domain.js';

/** CRM screens. All writes go through the host's atomic, durable mutate callback. */
export function createCrmUI({ getState, mutate, render, toast, esc, icon, openTask, newTask, openDialog, closeDialog }) {
  let section = 'projects', layout = 'list', selectedProject = '', selectedClient = '';
  let projectFilters = { query: '', client: '', service: '', stage: '', deadline: '', view: 'active' };
  let clientFilters = { query: '', view: 'active' };
  let leadFilters = { query: '', status: '', service: '', view: 'active' };
  let busy = false, projectFiltersOpen = false, leadFiltersOpen = false;
  const state = () => getState();
  const clients = () => state().clients || [];
  const leads = () => state().leads || [];
  const projects = () => state().projects || [];
  const findClient = id => clients().find(item => item.id === id);
  const findLead = id => leads().find(item => item.id === id);
  const findProject = id => projects().find(item => item.id === id);
  const label = (items, id, fallback = 'Не указано') => items.find(item => item.id === id)?.title || fallback;
  const leadStatuses = () => LEAD_STATUSES;
  const dateLabel = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Без даты';
  const stageOf = project => project.stages?.find(stage => stage.id === project.stageId)?.title || project.stage || 'Этап не указан';
  const options = (items, selected, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ''}${items.map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}`;
  const button = (text, action, id = '', primary = false) => `<button type="button" class="btn ${primary ? 'primary' : ''}" data-crm-action="${action}" ${id ? `data-crm-id="${esc(id)}"` : ''}>${text}</button>`;
  const textButton = (text, action, id = '') => `<button type="button" class="text-link" data-crm-action="${action}" ${id ? `data-crm-id="${esc(id)}"` : ''}>${text}</button>`;
  const pill = (text, extra = '') => `<span class="crm-pill ${extra}">${esc(text)}</span>`;
  const empty = (title, copy, action = '') => `<div class="crm-empty"><span class="crm-empty-icon">${icon('projects')}</span><h2>${title}</h2><p>${copy}</p>${action}</div>`;
  const requiredNote = '<p class="crm-form-note">* Обязательное поле. Остальное можно заполнить позже.</p>';
  const contactKeys = [['phone', 'Телефон', 'tel'], ['email', 'Почта', 'email'], ['messenger', 'Мессенджер', 'text'], ['website', 'Сайт', 'url']];
  const contactsHtml = person => {
    const values = contactKeys.filter(([key]) => person?.[key]);
    return values.length ? `<dl class="crm-contacts">${values.map(([key, title]) => `<div><dt>${title}</dt><dd>${esc(person[key])}</dd></div>`).join('')}</dl>` : '<p class="crm-muted">Контакты пока не добавлены</p>';
  };
  const field = (title, name, value = '', type = 'text', extra = '') => `<label class="field ${extra.includes('data-full') ? 'full' : ''}"><span>${title}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const contactFields = (person = {}, prefix = '') => contactKeys.map(([key, title, type]) => field(title, prefix + key, person[key] || '', type, 'maxlength="300"')).join('');
  const statusSelect = (items, value, name = 'status') => `<label class="field"><span>Состояние</span><select name="${name}">${options(items, value)}</select></label>`;
  const serviceSelect = value => `<label class="field"><span>Услуга *</span><select name="service" required>${options(SERVICES, value || SERVICES[0].id)}</select></label>`;
  const formValue = (form, name) => String(new FormData(form).get(name) || '').trim();
  const contactData = (form, prefix = '') => Object.fromEntries(contactKeys.map(([key]) => [key, formValue(form, prefix + key)]));
  const normalizePhone = value => String(value || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
  function duplicates(person, except = '') {
    const email = String(person.email || '').trim().toLowerCase(), phone = normalizePhone(person.phone);
    return clients().filter(client => client.id !== except && ((email && String(client.email || '').trim().toLowerCase() === email) || (phone && normalizePhone(client.phone) === phone)));
  }
  function duplicateBox(prefix = '') {
    return `<div class="crm-duplicates full" data-crm-duplicates data-crm-prefix="${prefix}" hidden><strong>Похоже, клиент уже есть</strong><div data-crm-duplicate-list></div><label class="crm-check"><input type="checkbox" name="duplicateConfirmed"><span>Создать отдельную запись с совпадающими контактами</span></label></div>`;
  }
  function showError(error, form = document.querySelector('#crm-form')) {
    const target = form?.querySelector('[data-crm-error]');
    if (target) {
      target.textContent = error.message || String(error);
      target.hidden = false;
    } else toast(error.message || String(error));
  }
  function dialog(title, body, footer, mode, id = '') {
    openDialog(`<div class="dialog-head"><h2 id="editor-title">${title}</h2><button type="button" class="icon-button" data-crm-action="close" aria-label="Закрыть форму">×</button></div><form id="crm-form" class="editor-form" data-crm-mode="${mode}" data-crm-id="${esc(id)}" novalidate><div class="dialog-body">${body}</div><div class="dialog-footer"><div class="error" role="alert" data-crm-error hidden></div><div class="dialog-actions">${footer}</div></div></form>`);
    const bodyElement = document.querySelector('#crm-form .dialog-body');
    if (bodyElement) bodyElement.scrollTop = 0;
  }
  const cancelAndSave = (save = 'Сохранить') => `${button('Отмена', 'close')}<button class="btn primary" type="submit">${save}</button>`;
  const archiveButton = (kind, item) => item?.id ? `<button type="button" class="btn crm-archive" data-crm-action="archive" data-crm-kind="${kind}" data-crm-id="${esc(item.id)}">${item.archived ? 'Из архива' : 'В архив'}</button>` : '';
  const filterSelect = (title, scope, key, items, value, emptyTitle) => `<label class="field"><span>${title}</span><select data-crm-filter="${scope}" data-crm-key="${key}">${options(items, value, emptyTitle)}</select></label>`;
  const filterInput = (title, scope, value, placeholder) => `<label class="field crm-search"><span>${title}</span><input type="search" data-crm-filter="${scope}" data-crm-key="query" value="${esc(value)}" placeholder="${placeholder}" aria-label="${title}"></label>`;
  const archiveStates = [{ id: 'active', title: 'В работе' }, { id: 'completed', title: 'Завершённые' }, { id: 'all', title: 'Все без архива' }, { id: 'archived', title: 'Архив' }];

  function projectList() {
    const f = projectFilters, today = dateKey();
    return projects().filter(project => {
      const isCompleted = project.status === 'completed';
      if (f.view === 'archived' ? !project.archived : project.archived) return false;
      if (f.view === 'active' && isCompleted || f.view === 'completed' && !isCompleted) return false;
      if (f.client && project.clientId !== f.client || f.service && project.service !== f.service || f.stage && stageOf(project) !== f.stage) return false;
      if (f.deadline === 'overdue' && (!project.deadline || project.deadline >= today || isCompleted)) return false;
      if (f.deadline === 'week' && (!project.deadline || project.deadline < today || project.deadline > addDays(today, 7))) return false;
      if (f.deadline === 'none' && project.deadline) return false;
      const haystack = `${project.title} ${findClient(project.clientId)?.name || project.clientName || ''}`.toLowerCase();
      return haystack.includes(f.query.toLowerCase());
    }).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.title.localeCompare(b.title, 'ru'));
  }
  function projectCard(project, board = false) {
    const client = findClient(project.clientId), tasks = state().tasks.filter(task => task.projectId === project.id && !task.archived);
    const done = tasks.filter(task => task.done).length;
    const overdue = project.deadline && project.deadline < dateKey() && project.status !== 'completed';
    return `<article class="crm-project-card ${board ? 'on-board' : ''}"><div class="crm-record-heading"><div class="crm-record-main"><span class="crm-overline">${esc(label(SERVICES, project.service))}</span><button type="button" class="crm-title-button" data-crm-action="open-project" data-crm-id="${esc(project.id)}">${esc(project.title)}</button><span class="crm-muted">${esc(client?.name || project.clientName || 'Клиент не указан')}${client?.archived ? ' · клиент в архиве' : ''}</span></div><button type="button" class="icon-button" data-crm-action="edit-project" data-crm-id="${esc(project.id)}" aria-label="Редактировать проект ${esc(project.title)}">${icon('more')}</button></div><div class="crm-badges">${!board ? pill(stageOf(project)) : ''}${project.status !== 'active' ? pill(label(PROJECT_STATUSES, project.status), 'crm-state-pill') : ''}${project.archived ? pill('В архиве') : ''}</div><div class="crm-record-foot"><span class="${overdue ? 'overdue' : ''}">${icon('clock')}${project.deadline ? `${overdue ? 'Просрочено · ' : ''}${dateLabel(project.deadline)}` : 'Без срока'}</span><span>${done}/${tasks.length} задач</span></div>${project.returnDate ? `<div class="crm-return">Вернуться ${dateLabel(project.returnDate)}</div>` : ''}</article>`;
  }
  function projectsContent() {
    const visible = projectList();
    const stages = [...new Set([...DEFAULT_STAGES.map(stage => stage.title), ...projects().flatMap(project => (project.stages || []).map(stage => stage.title)), ...projects().map(stageOf)])];
    return `<div class="crm-view-toolbar"><div class="tabs crm-view-tabs" aria-label="Вид проектов">${[['list', 'Список'], ['board', 'Доска']].map(([id, title]) => `<button type="button" class="${layout === id ? 'active' : ''}" data-crm-action="layout" data-crm-id="${id}" aria-pressed="${layout === id}">${title}</button>`).join('')}</div><span class="crm-muted">${visible.length} ${visible.length === 1 ? 'проект' : 'проектов'}</span><button type="button" class="text-link crm-filter-toggle" data-crm-action="toggle-project-filters" aria-expanded="${projectFiltersOpen}">${projectFiltersOpen ? 'Скрыть' : 'Фильтры'}</button></div><div class="crm-filters crm-collapsible-filters ${projectFiltersOpen ? 'expanded' : ''}">${filterInput('Поиск', 'project', projectFilters.query, 'Название или клиент')}${filterSelect('Клиент', 'project', 'client', clients().map(client => ({ id: client.id, title: client.name })), projectFilters.client, 'Все клиенты')}${filterSelect('Услуга', 'project', 'service', SERVICES, projectFilters.service, 'Все услуги')}${filterSelect('Этап', 'project', 'stage', stages.map(title => ({ id: title, title })), projectFilters.stage, 'Все этапы')}${filterSelect('Срок', 'project', 'deadline', [{ id: 'overdue', title: 'Просрочено' }, { id: 'week', title: 'Ближайшие 7 дней' }, { id: 'none', title: 'Без срока' }], projectFilters.deadline, 'Любой срок')}${filterSelect('Показать', 'project', 'view', archiveStates, projectFilters.view)}<button type="button" class="text-link crm-reset" data-crm-action="reset-project-filters">Сбросить</button></div>${!visible.length ? empty(projects().length ? 'Проектов не найдено' : 'Первый проект начинается здесь', projects().length ? 'Попробуйте изменить фильтры или загляните в архив.' : 'Добавьте клиента, выберите услугу и проходите этапы в своём темпе.', projects().length ? '' : button(`${icon('plus')} Новый проект`, 'new-project', '', true)) : layout === 'board' ? `<div class="crm-board" role="region" aria-label="Доска этапов проектов" tabindex="0">${stages.filter(stage => !projectFilters.stage || stage === projectFilters.stage).map(stage => { const items = visible.filter(project => stageOf(project) === stage); return `<section class="crm-board-column"><div class="crm-board-heading"><h2>${esc(stage)}</h2><span>${items.length}</span></div>${items.length ? items.map(project => projectCard(project, true)).join('') : '<div class="crm-board-empty">Пока нет проектов</div>'}</section>`; }).join('')}</div>` : `<div class="crm-project-grid">${visible.map(project => projectCard(project)).join('')}</div>`}`;
  }
  function clientContent() {
    const visible = clients().filter(client => (clientFilters.view === 'archived' ? client.archived : !client.archived) && `${client.name} ${client.email || ''} ${client.phone || ''}`.toLowerCase().includes(clientFilters.query.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return `<div class="crm-filters crm-simple-filters">${filterInput('Поиск клиентов', 'client', clientFilters.query, 'Имя, почта или телефон')}${filterSelect('Показать', 'client', 'view', [{ id: 'active', title: 'Клиенты' }, { id: 'archived', title: 'Архив' }], clientFilters.view)}</div>${visible.length ? `<div class="crm-client-grid">${visible.map(client => { const related = projects().filter(project => project.clientId === client.id); return `<article class="crm-client-card"><div class="crm-record-heading"><div class="crm-client-initial" aria-hidden="true">${esc(client.name.slice(0, 1).toUpperCase())}</div><div class="crm-record-main"><button class="crm-title-button" type="button" data-crm-action="open-client" data-crm-id="${esc(client.id)}">${esc(client.name)}</button><span class="crm-muted">${related.length} проектов${client.archived ? ' · в архиве' : ''}</span></div><button class="icon-button" type="button" data-crm-action="edit-client" data-crm-id="${esc(client.id)}" aria-label="Редактировать клиента ${esc(client.name)}">${icon('more')}</button></div>${contactsHtml(client)}${textButton('Открыть клиента →', 'open-client', client.id)}</article>`; }).join('')}</div>` : empty(clients().length ? 'Клиентов не найдено' : 'Контакты в одном месте', clients().length ? 'Измените поиск или выберите другой список.' : 'Один клиент может быть связан с несколькими проектами.', button(`${icon('plus')} Новый клиент`, 'new-client', '', true))}`;
  }
  function renderProjects() {
    if (selectedProject) {
      const project = findProject(selectedProject);
      if (project) return projectDetail(project);
      selectedProject = '';
    }
    if (selectedClient) {
      const client = findClient(selectedClient);
      if (client) return clientDetail(client);
      selectedClient = '';
    }
    return `<section class="crm-page"><div class="page-head"><div><div class="eyebrow">Работа с заказами</div><h1>Клиенты и проекты</h1><p>Контакты, этапы и ближайшие обязательства.</p></div>${button(`${icon('plus')} ${section === 'clients' ? 'Новый клиент' : 'Новый проект'}`, section === 'clients' ? 'new-client' : 'new-project', '', true)}</div><div class="tabs crm-section-tabs" aria-label="Клиенты и проекты"><button type="button" class="${section === 'projects' ? 'active' : ''}" data-crm-action="section" data-crm-id="projects" aria-pressed="${section === 'projects'}">Проекты <span>${projects().filter(project => !project.archived && project.status !== 'completed').length}</span></button><button type="button" class="${section === 'clients' ? 'active' : ''}" data-crm-action="section" data-crm-id="clients" aria-pressed="${section === 'clients'}">Клиенты <span>${clients().filter(client => !client.archived).length}</span></button></div>${section === 'projects' ? projectsContent() : clientContent()}</section>`;
  }
  function projectDetail(project) {
    const client = findClient(project.clientId), lead = findLead(project.leadId);
    const tasks = state().tasks.filter(task => task.projectId === project.id && !task.archived);
    const currentIndex = (project.stages || []).findIndex(stage => stage.id === project.stageId);
    return `<section class="crm-page"><div class="crm-back">${textButton('← Все проекты', 'back-projects')}</div><div class="page-head"><div><div class="eyebrow">${esc(label(SERVICES, project.service))}</div><h1>${esc(project.title)}</h1><div class="crm-badges">${pill(label(PROJECT_STATUSES, project.status))}${project.archived ? pill('В архиве') : ''}</div></div>${button('Редактировать', 'edit-project', project.id)}</div><div class="crm-detail-grid"><div class="crm-detail-main"><section class="card crm-detail-card"><div class="card-head"><h2>Ход проекта</h2>${textButton('Настроить этапы', 'edit-project', project.id)}</div><div class="crm-stage-summary"><span class="crm-muted">Текущий этап</span><strong>${esc(stageOf(project))}</strong><span class="crm-muted">${project.stages?.length ? `${Math.max(1, currentIndex + 1)} из ${project.stages.length}` : 'Сохранённый этап'}</span></div><ol class="crm-stage-track">${(project.stages || []).map((stage, index) => `<li class="${index === currentIndex ? 'current' : index < currentIndex ? 'past' : ''}"><button type="button" data-crm-action="set-stage" data-crm-id="${esc(project.id)}" data-crm-stage="${esc(stage.id)}" ${index === currentIndex ? 'aria-current="step"' : ''}><span>${index < currentIndex ? '✓' : index + 1}</span>${esc(stage.title)}</button></li>`).join('')}</ol><p class="note">Этап можно изменить вручную. Состояния «Правки» и «Отложено» сохраняют текущий этап.</p></section><section class="card crm-detail-card"><div class="card-head"><div><h2>Задачи проекта</h2><small>${tasks.filter(task => task.done).length} из ${tasks.length} выполнено</small></div>${textButton('＋ Добавить', 'new-task', project.id)}</div>${tasks.length ? `<div class="crm-linked-tasks">${tasks.map(task => `<button class="crm-linked-task ${task.done ? 'done' : ''}" type="button" data-crm-action="open-task" data-crm-id="${esc(task.id)}"><span class="crm-task-mark">${task.done ? '✓' : ''}</span><span><strong>${esc(task.title)}</strong><small>${task.deadline ? 'Срок ' + dateLabel(task.deadline) : 'Без дедлайна'}${task.plannedDate ? ' · План ' + dateLabel(task.plannedDate) : ''}</small></span><span aria-hidden="true">→</span></button>`).join('')}</div>` : '<p class="crm-muted">Добавьте ближайшее действие. Связанная задача появится в общем списке и в плане дня.</p>'}</section><section class="card crm-detail-card"><div class="card-head"><h2>Связанные разделы</h2><span class="crm-muted">Следующие этапы</span></div><div class="crm-related-links">${[['calculator', 'Смета', 'Расчёт стоимости пока не подключён'], ['money', 'Оплаты', 'Учёт фактических поступлений появится позже'], ['materials', 'Материалы', 'КП, брифы и документы появятся позже'], ['design', 'Референсы', 'Связанная библиотека пока не подключена']].map(([route, title, copy]) => `<a href="#${route}" class="crm-related-link"><span><strong>${title}</strong><small>${copy}</small></span>${icon('arrow')}</a>`).join('')}</div></section></div><aside class="crm-detail-side"><section class="card crm-detail-card"><div class="card-head"><h2>Клиент</h2>${client ? textButton('Открыть →', 'open-client', client.id) : ''}</div><h3>${esc(client?.name || project.clientName || 'Не указан')}</h3>${client?.archived ? '<p class="note">Клиент в архиве. Связь с проектом сохранена.</p>' : ''}${contactsHtml(client)}</section><section class="card crm-detail-card"><h2>Сроки и состояние</h2><dl class="crm-facts"><div><dt>Дедлайн</dt><dd class="${project.deadline && project.deadline < dateKey() && project.status !== 'completed' ? 'overdue' : ''}">${project.deadline ? dateLabel(project.deadline) : 'Не задан'}</dd></div><div><dt>Состояние</dt><dd>${esc(label(PROJECT_STATUSES, project.status))}</dd></div><div><dt>Дата возврата</dt><dd>${project.returnDate ? dateLabel(project.returnDate) : 'Не задана'}</dd></div></dl>${lead ? textButton('Исходный лид →', 'open-lead', lead.id) : ''}</section></aside></div></section>`;
  }
  function clientDetail(client) {
    const related = projects().filter(project => project.clientId === client.id);
    return `<section class="crm-page"><div class="crm-back">${textButton('← Все клиенты', 'back-clients')}</div><div class="page-head"><div><div class="eyebrow">Карточка клиента</div><h1>${esc(client.name)}</h1>${client.archived ? '<p>В архиве · проекты и контакты сохранены</p>' : ''}</div>${button('Редактировать', 'edit-client', client.id)}</div><div class="crm-detail-grid"><section><div class="crm-subhead"><h2>Проекты клиента <span class="crm-muted">${related.length}</span></h2>${button(`${icon('plus')} Новый проект`, 'new-project-client', client.id)}</div>${related.length ? `<div class="crm-project-grid crm-client-projects">${related.map(project => projectCard(project)).join('')}</div>` : empty('Пока без проектов', 'Создайте проект для этого клиента. Контакты вводить заново не придётся.')}</section><aside><section class="card crm-detail-card"><h2>Контакты</h2>${contactsHtml(client)}</section></aside></div></section>`;
  }

  function renderLeads() {
    const f = leadFilters;
    const visible = leads().filter(lead => (f.view === 'archived' ? lead.archived : !lead.archived) && (!f.status || lead.status === f.status) && (!f.service || lead.service === f.service) && `${lead.name} ${lead.company || ''} ${lead.contacts?.email || ''}`.toLowerCase().includes(f.query.toLowerCase())).sort((a, b) => (a.nextActionDate || '9999').localeCompare(b.nextActionDate || '9999') || a.name.localeCompare(b.name, 'ru'));
    const due = leads().filter(lead => !lead.archived && lead.status !== 'converted' && lead.nextActionDate && lead.nextActionDate <= dateKey()).length;
    return `<section class="crm-page"><div class="page-head"><div><div class="eyebrow">Следующий заказ</div><h1>Поиск клиентов</h1><p>Своя база потенциальных заказчиков и следующих действий.</p></div>${button(`${icon('plus')} Новый лид`, 'new-lead', '', true)}</div><div class="crm-lead-summary"><span>${leads().filter(lead => !lead.archived && lead.status !== 'converted').length} лидов в работе</span><span>${due} действий на сегодня и раньше</span></div><div class="crm-mobile-filter-bar"><button type="button" class="text-link crm-filter-toggle" data-crm-action="toggle-lead-filters" aria-expanded="${leadFiltersOpen}">${leadFiltersOpen ? 'Скрыть фильтры' : 'Фильтры'}</button></div><div class="crm-filters crm-lead-filters crm-collapsible-filters ${leadFiltersOpen ? 'expanded' : ''}">${filterInput('Поиск по имени и компании', 'lead', f.query, 'Имя или компания')}${filterSelect('Состояние', 'lead', 'status', leadStatuses(), f.status, 'Все состояния')}${filterSelect('Услуга', 'lead', 'service', SERVICES, f.service, 'Все услуги')}${filterSelect('Показать', 'lead', 'view', [{ id: 'active', title: 'Без архива' }, { id: 'archived', title: 'Архив' }], f.view)}<button type="button" class="text-link crm-reset" data-crm-action="reset-lead-filters">Сбросить</button></div><div class="crm-list-caption"><span>${visible.length} записей · сначала ближайшее действие</span></div>${visible.length ? `<div class="crm-lead-list">${visible.map(lead => { const linkedProject = findProject(lead.projectId), task = state().tasks.find(item => item.id === lead.taskId), late = lead.status !== 'converted' && lead.nextActionDate && lead.nextActionDate < dateKey(); return `<article class="crm-lead-card"><div class="crm-record-heading"><div class="crm-lead-avatar" aria-hidden="true">${esc(lead.name.slice(0, 1).toUpperCase())}</div><div class="crm-record-main"><button type="button" class="crm-title-button" data-crm-action="open-lead" data-crm-id="${esc(lead.id)}">${esc(lead.name)}</button><span class="crm-muted">${esc(lead.company || lead.contacts?.email || lead.contacts?.phone || 'Контакты не указаны')}</span></div>${pill(label(leadStatuses(), lead.status))}</div><div class="crm-lead-service">${esc(label(SERVICES, lead.service, 'Услуга не выбрана'))}</div><div class="crm-lead-next"><span class="crm-muted">Следующее действие</span><strong class="${late ? 'overdue' : ''}">${lead.nextActionDate ? dateLabel(lead.nextActionDate) : 'Не запланировано'}</strong>${task ? textButton(`${task.done ? '✓ ' : ''}${esc(task.title)}`, 'open-task', task.id) : ''}</div><div class="crm-lead-actions">${linkedProject ? button('Открыть проект →', 'open-project', linkedProject.id) : `${button('Создать проект', 'convert', lead.id)}${textButton('Запланировать', 'schedule', lead.id)}`}</div></article>`; }).join('')}</div>` : empty(leads().length ? 'Лидов не найдено' : 'Новый заказ начинается с контакта', leads().length ? 'Попробуйте изменить поиск или фильтры.' : 'Сохраните имя, известные контакты и запланируйте следующий шаг.', leads().length ? '' : button(`${icon('plus')} Добавить лида`, 'new-lead', '', true))}<p class="crm-bottom-note">Контакты добавляются вручную. Договорённость и создание проекта не считаются поступлением денег.</p></section>`;
  }

  function clientEditor(id = '') {
    const client = findClient(id) || { name: '' };
    dialog(id ? 'Клиент' : 'Новый клиент', `${requiredNote}<div class="form-grid">${field('Имя или название *', 'name', client.name, 'text', 'required maxlength="300" data-full autofocus')}${contactFields(client)}${duplicateBox()}</div>${id ? '<p class="note">Изменение контактов не меняет связанные проекты. Архивирование сохраняет все связи.</p>' : ''}`, `${archiveButton('client', client)}${cancelAndSave()}`, 'client', id);
    updateDuplicateWarning();
  }
  function leadEditor(id = '') {
    const lead = findLead(id) || { name: '', company: '', contacts: {}, service: '', status: 'new', source: '', nextActionDate: '' };
    const linkedProject = findProject(lead.projectId), task = state().tasks.find(item => item.id === lead.taskId);
    dialog(id ? 'Потенциальный клиент' : 'Новый лид', `${requiredNote}<div class="form-grid">${field('Имя или название *', 'name', lead.name, 'text', 'required maxlength="300" data-full autofocus')}${field('Компания', 'company', lead.company, 'text', 'maxlength="300" data-full')}${contactFields(lead.contacts)}${field('Ссылка на источник', 'source', lead.source, 'url', 'maxlength="1000" data-full')}${serviceSelect(lead.service)}${statusSelect(linkedProject ? leadStatuses() : leadStatuses().filter(item => item.id !== 'converted'), lead.status)}${field('Дата следующего действия', 'nextActionDate', lead.nextActionDate, 'date', 'data-full')}<p class="note full">${task && !task.done && !task.archived ? 'Дата в карточке не переносит связанную задачу. Для изменения задачи нажмите «Запланировать задачу».' : 'Дата сохраняется у лида. Чтобы добавить действие в задачи и на Главную, нажмите «Запланировать задачу» после сохранения.'}</p>${task ? `<div class="crm-inline-panel full"><span class="crm-muted">Связанная задача</span>${textButton(`${task.done ? '✓ ' : ''}${esc(task.title)} →`, 'open-task', task.id)}</div>` : ''}${linkedProject ? `<div class="crm-inline-panel full"><span class="crm-muted">Лид преобразован</span>${textButton(`${esc(linkedProject.title)} →`, 'open-project', linkedProject.id)}</div>` : ''}</div>`, `${archiveButton('lead', lead)}${id && !linkedProject ? button('Создать проект', 'convert', id) : ''}${id ? button('Запланировать задачу', 'schedule', id) : ''}${cancelAndSave()}`, 'lead', id);
  }
  function clientPicker(clientId = '', prefix = 'client_') {
    const available = clients().filter(client => !client.archived || client.id === clientId);
    const selected = clientId || (available.length ? '' : '__new');
    return `<label class="field full"><span>Клиент *</span><select name="clientId" data-crm-client-picker required><option value="">Выберите клиента</option>${available.map(client => `<option value="${esc(client.id)}" ${client.id === selected ? 'selected' : ''}>${esc(client.name)}${client.archived ? ' · в архиве' : ''}</option>`).join('')}<option value="__new" ${selected === '__new' ? 'selected' : ''}>＋ Новый клиент</option></select></label><div class="crm-new-client full" data-crm-new-client ${selected === '__new' ? '' : 'hidden'}><div class="form-grid">${field('Имя или название клиента *', prefix + 'name', '', 'text', 'maxlength="300" data-full')}${contactFields({}, prefix)}${duplicateBox(prefix)}</div></div>`;
  }
  function stagesEditor(stages, stageId) {
    return `<label class="field full"><span>Текущий этап *</span><select name="stageId" data-crm-stage-select>${options(stages, stageId || stages[0]?.id)}</select></label><details class="crm-stage-editor full"><summary>Настроить последовательность <span>Названия, порядок и пропуск этапов</span></summary><p class="note">Все услуги начинают с десяти этапов. Изменения применяются только к этому проекту. Для пропуска этапа удалите его из последовательности; текущий этап сначала переключите.</p><div data-crm-stage-list>${stages.map((stage, index) => stageRow(stage, index)).join('')}</div>${textButton('＋ Добавить этап', 'add-stage')}</details>`;
  }
  function stageRow(stage, index) {
    return `<div class="crm-stage-row" data-crm-stage-row="${esc(stage.id)}"><span class="crm-stage-number">${index + 1}</span><input type="text" value="${esc(stage.title)}" data-crm-stage-name maxlength="160" aria-label="Название этапа ${index + 1}"><button class="icon-button" type="button" data-crm-action="stage-up" aria-label="Переместить этап вверх">↑</button><button class="icon-button" type="button" data-crm-action="stage-down" aria-label="Переместить этап вниз">↓</button><button class="icon-button" type="button" data-crm-action="stage-remove" aria-label="Удалить этап">×</button></div>`;
  }
  function projectEditor(id = '', clientId = '') {
    const project = structuredClone(findProject(id) || { title: '', clientId, service: 'landing', stages: DEFAULT_STAGES.map(stage => ({ ...stage })), stageId: DEFAULT_STAGES[0].id, status: 'active', deadline: '', returnDate: '' });
    // Older stage-one projects keep their actual stage when explicitly edited.
    if (!project.stages?.length) {
      project.stages = DEFAULT_STAGES.map(stage => ({ ...stage }));
      let current = project.stages.find(stage => stage.title === project.stage);
      if (project.stage && !current) {
        current = { id: uid(), title: project.stage };
        project.stages.push(current);
      }
      project.stageId = current?.id || project.stages[0].id;
    }
    dialog(id ? 'Проект' : 'Новый проект', `${requiredNote}<div class="form-grid">${field('Название проекта *', 'title', project.title, 'text', 'required maxlength="500" data-full autofocus')}${clientPicker(project.clientId)}${serviceSelect(project.service)}${statusSelect(PROJECT_STATUSES, project.status)}${field('Дедлайн · обещанный срок', 'deadline', project.deadline, 'date')}${field('Дата возврата', 'returnDate', project.returnDate, 'date')}${stagesEditor(project.stages, project.stageId)}</div>`, `${archiveButton('project', project)}${cancelAndSave()}`, 'project', id);
    refreshStageOptions();
  }
  function convertEditor(leadId) {
    const lead = findLead(leadId);
    if (!lead) return;
    if (lead.projectId && findProject(lead.projectId)) { openProject(lead.projectId); return; }
    const matches = duplicates(lead.contacts);
    const suggestedStage = lead.status === 'agreement' ? 'proposal' : lead.status === 'discussion' ? 'brief' : 'contact';
    dialog('Создать проект из лида', `<p class="crm-form-note">Проверьте данные перед созданием. Исходный лид сохранится со ссылкой на проект.</p>${matches.length ? `<div class="crm-match-callout"><strong>Найдено совпадение по почте или телефону</strong><p>Выберите существующего клиента или явно подтвердите создание отдельного.</p><div>${matches.map(client => button(esc(client.name), 'choose-client', client.id)).join('')}</div></div>` : ''}<div class="form-grid"><label class="field full"><span>Клиент *</span><select name="clientId" data-crm-client-picker><option value="__new">Создать нового клиента</option>${clients().filter(client => !client.archived || matches.some(match => match.id === client.id)).map(client => `<option value="${esc(client.id)}">${esc(client.name)}${client.archived ? ' · в архиве' : ''}</option>`).join('')}</select></label><div class="crm-new-client full" data-crm-new-client><div class="form-grid">${field('Имя или название клиента *', 'client_name', lead.company || lead.name, 'text', 'required maxlength="300" data-full')}${contactFields(lead.contacts, 'client_')}${duplicateBox('client_')}</div></div><p class="note full" data-crm-existing-note hidden>Проект будет связан с выбранным клиентом. Его текущие контакты и другие проекты сохранятся.</p>${field('Название проекта *', 'title', `${lead.company || lead.name} · ${label(SERVICES, lead.service, 'Новый проект')}`, 'text', 'required maxlength="500" data-full')}${serviceSelect(lead.service)}${statusSelect(PROJECT_STATUSES, 'active')}${field('Дедлайн', 'deadline', '', 'date')}${field('Дата возврата', 'returnDate', '', 'date')}${stagesEditor(DEFAULT_STAGES.map(stage => ({ ...stage })), suggestedStage)}</div>`, cancelAndSave('Создать проект'), 'convert', leadId);
    updateDuplicateWarning();
    refreshStageOptions();
  }
  function scheduleEditor(leadId) {
    const lead = findLead(leadId);
    if (!lead) return;
    const existing = state().tasks.find(task => task.id === lead.taskId && !task.done && !task.archived);
    dialog(existing ? 'Следующее действие по лиду' : 'Запланировать задачу', `<p class="crm-form-note">${existing ? 'Изменится связанная задача. Повторное сохранение не создаст дубль.' : 'Действие появится в задачах и на Главной на выбранную дату.'}</p><div class="crm-inline-panel"><span class="crm-muted">Лид</span><strong>${esc(lead.name)}</strong></div><div class="form-grid">${field('Что сделать *', 'title', existing?.title || `Связаться: ${lead.name}`, 'text', 'required maxlength="500" data-full autofocus')}${field('Дата планирования *', 'date', lead.nextActionDate || existing?.plannedDate || dateKey(), 'date', 'required data-full')}${field('Начало · необязательно', 'start', existing?.start || '', 'time')}${field('Окончание · необязательно', 'end', existing?.end || '', 'time')}</div>`, cancelAndSave(existing ? 'Обновить задачу' : 'Создать задачу'), 'schedule', leadId);
  }
  function openProject(id) {
    closeDialog();
    selectedProject = id; selectedClient = ''; section = 'projects';
    if (location.hash !== '#projects') location.hash = '#projects';
    render();
  }
  function openClient(id) {
    closeDialog();
    selectedClient = id; selectedProject = ''; section = 'clients';
    if (location.hash !== '#projects') location.hash = '#projects';
    render();
  }
  function openLead(id) { leadEditor(id); }
  function readStages(form) {
    return [...form.querySelectorAll('[data-crm-stage-row]')].map(row => ({ id: row.dataset.crmStageRow, title: row.querySelector('[data-crm-stage-name]').value.trim() }));
  }
  function refreshStageOptions() {
    const form = document.querySelector('#crm-form'), select = form?.querySelector('[data-crm-stage-select]');
    if (!select) return;
    const current = select.value, stages = readStages(form);
    select.innerHTML = options(stages.map(stage => ({ ...stage, title: stage.title || 'Без названия' })), current);
    form.querySelectorAll('[data-crm-stage-row]').forEach((row, index, rows) => {
      row.querySelector('.crm-stage-number').textContent = index + 1;
      row.querySelector('[data-crm-stage-name]').setAttribute('aria-label', `Название этапа ${index + 1}`);
      row.querySelector('[data-crm-action="stage-up"]').disabled = index === 0;
      row.querySelector('[data-crm-action="stage-down"]').disabled = index === rows.length - 1;
      row.querySelector('[data-crm-action="stage-remove"]').disabled = rows.length === 1 || row.dataset.crmStageRow === select.value;
      row.querySelector('[data-crm-action="stage-remove"]').title = row.dataset.crmStageRow === select.value ? 'Сначала выберите другой текущий этап' : 'Удалить этап';
    });
  }
  function updateDuplicateWarning() {
    const form = document.querySelector('#crm-form'), box = form?.querySelector('[data-crm-duplicates]');
    if (!box) return;
    const person = contactData(form, box.dataset.crmPrefix);
    const matches = duplicates(person, form.dataset.crmMode === 'client' ? form.dataset.crmId : '');
    box.hidden = !matches.length;
    box.dataset.requiresDuplicate = matches.length ? 'true' : 'false';
    box.querySelector('[data-crm-duplicate-list]').innerHTML = matches.map(client => `<p>${esc(client.name)}${client.archived ? ' · в архиве' : ''}</p>`).join('');
  }
  function validateDuplicateChoice(form) {
    const box = form.querySelector('[data-crm-duplicates]');
    const isNew = !form.querySelector('[data-crm-client-picker]') || formValue(form, 'clientId') === '__new';
    if (isNew && box?.dataset.requiresDuplicate === 'true' && !form.elements.duplicateConfirmed?.checked) throw Error('Уже есть клиент с такой почтой или телефоном. Выберите его либо подтвердите создание отдельной записи.');
  }
  function updateClientPicker(form) {
    const isNew = formValue(form, 'clientId') === '__new';
    form.querySelector('[data-crm-new-client]').hidden = !isNew;
    const note = form.querySelector('[data-crm-existing-note]');
    if (note) note.hidden = isNew;
    updateDuplicateWarning();
  }
  function leadInput(form) {
    const id = form.dataset.crmId;
    return { ...(findLead(id) || {}), id: id || uid(), name: formValue(form, 'name'), company: formValue(form, 'company'), contacts: contactData(form), source: formValue(form, 'source'), service: formValue(form, 'service'), status: formValue(form, 'status'), nextActionDate: formValue(form, 'nextActionDate') };
  }
  function projectInput(form) {
    return { title: formValue(form, 'title'), service: formValue(form, 'service'), status: formValue(form, 'status'), deadline: formValue(form, 'deadline'), returnDate: formValue(form, 'returnDate'), stageId: formValue(form, 'stageId'), stages: readStages(form) };
  }
  async function handleSubmit(event) {
    const form = event.target;
    if (form.id !== 'crm-form') return false;
    event.preventDefault();
    if (busy) return true;
    const mode = form.dataset.crmMode, id = form.dataset.crmId, submit = form.querySelector('[type="submit"]');
    let savedId = '';
    try {
      form.querySelector('[data-crm-error]').hidden = true;
      updateDuplicateWarning();
      validateDuplicateChoice(form);
      busy = true;
      if (submit) submit.disabled = true;
      const ok = await mutate(next => {
        if (mode === 'client') {
          const saved = saveClient(next, { ...(findClient(id) || {}), id: id || uid(), name: formValue(form, 'name'), ...contactData(form) });
          savedId = saved.id;
        } else if (mode === 'lead') {
          const saved = saveLead(next, leadInput(form));
          savedId = saved.id;
        } else if (mode === 'project') {
          let clientId = formValue(form, 'clientId');
          if (clientId === '__new') clientId = saveClient(next, { name: formValue(form, 'client_name'), ...contactData(form, 'client_') }).id;
          const saved = saveProject(next, { ...(findProject(id) || {}), id: id || uid(), ...projectInput(form), clientId });
          savedId = saved.id;
        } else if (mode === 'convert') {
          const clientId = formValue(form, 'clientId');
          const choice = clientId === '__new' ? { client: { name: formValue(form, 'client_name'), ...contactData(form, 'client_') } } : { clientId };
          const saved = convertLead(next, id, { ...choice, project: projectInput(form) });
          savedId = saved.id;
        } else if (mode === 'schedule') {
          const saved = scheduleLeadAction(next, id, { title: formValue(form, 'title'), date: formValue(form, 'date'), start: formValue(form, 'start'), end: formValue(form, 'end') });
          savedId = saved.id;
        }
      });
      if (ok) {
        closeDialog();
        if (mode === 'convert') { openProject(savedId); toast('Клиент и проект связаны с исходным лидом'); }
        else if (mode === 'schedule') toast('Действие сохранено в задачах и плане дня');
        else toast(`${mode === 'client' ? 'Клиент' : mode === 'lead' ? 'Лид' : 'Проект'} сохранён на этом устройстве`);
      }
    } catch (error) { showError(error, form); }
    finally { busy = false; if (submit) submit.disabled = false; }
    return true;
  }
  async function handleClick(event) {
    const el = event.target.closest('[data-crm-action]');
    if (!el) return false;
    event.preventDefault();
    const action = el.dataset.crmAction, id = el.dataset.crmId;
    const form = el.closest('#crm-form');
    if (busy) return true;
    try {
      if (action === 'close') closeDialog();
      if (action === 'section') { section = id; selectedProject = ''; selectedClient = ''; render(); }
      if (action === 'layout') { layout = id; render(); }
      if (action === 'toggle-project-filters') { projectFiltersOpen = !projectFiltersOpen; render(); }
      if (action === 'toggle-lead-filters') { leadFiltersOpen = !leadFiltersOpen; render(); }
      if (action === 'new-client') clientEditor();
      if (action === 'edit-client') clientEditor(id);
      if (action === 'open-client') openClient(id);
      if (action === 'new-project') projectEditor();
      if (action === 'new-project-client') projectEditor('', id);
      if (action === 'edit-project') projectEditor(id);
      if (action === 'open-project') openProject(id);
      if (action === 'new-lead') leadEditor();
      if (action === 'open-lead') leadEditor(id);
      if (['convert', 'schedule'].includes(action)) {
        if (form?.dataset.crmMode === 'lead') {
          busy = true;
          const saved = await mutate(next => saveLead(next, leadInput(form)));
          busy = false;
          if (!saved) return true;
        }
        if (action === 'convert') convertEditor(id);
        else scheduleEditor(id);
      }
      if (action === 'back-projects') { selectedProject = ''; selectedClient = ''; section = 'projects'; render(); }
      if (action === 'back-clients') { selectedProject = ''; selectedClient = ''; section = 'clients'; render(); }
      if (action === 'open-task') { closeDialog(); openTask(id); }
      if (action === 'new-task') { closeDialog(); newTask({ projectId: id }); }
      if (action === 'reset-project-filters') { projectFilters = { query: '', client: '', service: '', stage: '', deadline: '', view: 'active' }; render(); }
      if (action === 'reset-lead-filters') { leadFilters = { query: '', status: '', service: '', view: 'active' }; render(); }
      if (action === 'choose-client') { form.elements.clientId.value = id; updateClientPicker(form); }
      if (action === 'archive') {
        const kind = el.dataset.crmKind, record = kind === 'client' ? findClient(id) : kind === 'project' ? findProject(id) : findLead(id);
        if (!record) return true;
        if (kind === 'client' && !record.archived && projects().some(project => project.clientId === id) && !confirm('Переместить клиента в архив? Его проекты, задачи и все связи сохранятся.')) return true;
        busy = true;
        const ok = await mutate(next => archiveEntity(next, kind, id, !record.archived));
        if (ok) { closeDialog(); toast(record.archived ? 'Запись возвращена из архива' : 'Запись в архиве. Все связи сохранены.'); }
      }
      if (action === 'set-stage') {
        const project = findProject(id);
        busy = true;
        if (await mutate(next => saveProject(next, { ...project, stageId: el.dataset.crmStage }))) toast('Текущий этап обновлён');
      }
      if (action === 'add-stage') {
        const list = form.querySelector('[data-crm-stage-list]');
        list.insertAdjacentHTML('beforeend', stageRow({ id: uid(), title: 'Новый этап' }, list.children.length));
        refreshStageOptions();
        list.lastElementChild.querySelector('input').focus();
      }
      if (['stage-up', 'stage-down', 'stage-remove'].includes(action)) {
        const row = el.closest('[data-crm-stage-row]'), list = row.parentElement;
        if (action === 'stage-up' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
        if (action === 'stage-down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
        if (action === 'stage-remove') {
          if (row.dataset.crmStageRow === formValue(form, 'stageId')) throw Error('Чтобы удалить текущий этап, сначала выберите другой.');
          row.remove();
        }
        refreshStageOptions();
      }
    } catch (error) { showError(error, form); }
    finally { busy = false; }
    return true;
  }
  function applyFilter(input) {
    const source = input.dataset.crmFilter, key = input.dataset.crmKey;
    const target = source === 'project' ? projectFilters : source === 'client' ? clientFilters : leadFilters;
    target[key] = input.value;
    const cursor = input.selectionStart;
    render();
    if (input.type === 'search') {
      const replacement = document.querySelector(`[data-crm-filter="${source}"][data-crm-key="${key}"]`);
      replacement?.focus({ preventScroll: true });
      if (cursor !== null) replacement?.setSelectionRange(cursor, cursor);
    }
  }
  function handleChange(event) {
    const input = event.target;
    if (input.matches('[data-crm-filter]')) {
      // Search is handled by input; DOM replacement can synchronously emit change
      // on blur. Never re-enter render while removing that input.
      if (input.type !== 'search' && input.isConnected) applyFilter(input);
      return true;
    }
    if (!input.closest('#crm-form')) return false;
    if (input.matches('[data-crm-client-picker]')) updateClientPicker(input.closest('form'));
    if (input.matches('[data-crm-stage-select]')) refreshStageOptions();
    return true;
  }
  function handleInput(event) {
    const input = event.target;
    if (input.matches('input[data-crm-filter]')) { applyFilter(input); return true; }
    if (!input.closest('#crm-form')) return false;
    if (input.matches('[data-crm-stage-name]')) refreshStageOptions();
    if (/^(client_)?(email|phone)$/.test(input.name)) updateDuplicateWarning();
    return true;
  }
  return { renderProjects, renderLeads, handleClick, handleChange, handleInput, handleSubmit, openProject, openClient, openLead };
}
