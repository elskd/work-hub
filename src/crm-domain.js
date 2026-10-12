import {saveTask, uid} from './domain.js';

const choices = entries => Object.freeze(entries.map(([id, title]) => Object.freeze({id, title})));
export const SERVICES = choices([
  ['landing', 'Лендинг'], ['multipage', 'Многостраничный сайт'],
  ['shop', 'Интернет-магазин'], ['design', 'Только дизайн']
]);
export const DEFAULT_STAGES = choices([
  ['contact', 'Первый контакт'], ['brief', 'Бриф'], ['proposal', 'КП'],
  ['analysis', 'Анализ'], ['prototype', 'Прототип'], ['moodboard', 'Мудборд'],
  ['concepts', 'Дизайн-концепции'], ['layout', 'Дизайн-макет'],
  ['build', 'Верстка'], ['completed', 'Завершен']
]);
export const LEAD_STATUSES = choices([
  ['new', 'Новый'], ['contact', 'Первый контакт'], ['discussion', 'Обсуждение'],
  ['agreement', 'Договоренность'], ['refused', 'Отказ'], ['postponed', 'Отложено'],
  ['no-response', 'Нет ответа'], ['converted', 'Создан проект']
]);
export const PROJECT_STATUSES = choices([
  ['active', 'В работе'], ['refused', 'Отказ'], ['postponed', 'Отложено'],
  ['no-response', 'Нет ответа'], ['revisions', 'Правки'], ['completed', 'Завершен']
]);

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const copy = value => structuredClone(value);
const now = () => new Date().toISOString();
const nextRevision = record => {
  const revision = record?.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) throw Error('Не удалось обновить версию записи.');
  return revision + 1;
};
const contactKeys = ['phone', 'email', 'messenger', 'website'];
const validChoice = (value, list) => list.some(item => item.id === value);
const put = (list, value) => {
  const index = list.findIndex(item => item.id === value.id);
  if (index < 0) list.push(value); else list[index] = value;
  return value;
};

function inputObject(input) {
  if (!object(input)) throw Error('Проверьте данные карточки.');
}
function optionalStrings(input, fields) {
  for (const key of fields) if (input[key] !== undefined && typeof input[key] !== 'string') throw Error('Проверьте текстовые поля карточки.');
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw Error(`Проверьте поле «${label}» (не больше ${max} символов).`);
  const trimmed = value.trim();
  if (required && !trimmed) throw Error(`Заполните поле «${label}».`);
  return trimmed;
}
function identifier(value, required = false) {
  return text(value, 'Идентификатор', 200, required);
}
function date(value, label) {
  if (typeof value !== 'string') throw Error(`Проверьте поле «${label}».`);
  if (!value) return '';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw Error(`Проверьте поле «${label}».`);
  return value;
}
function link(value, label) {
  const result = text(value, label, 2000);
  if (!result) return '';
  let url;
  try { url = new URL(result); } catch { throw Error(`В поле «${label}» нужна полная ссылка: https://…`); }
  if (!/^https?:\/\//i.test(result) || !['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error(`В поле «${label}» разрешены только ссылки http:// или https:// без паролей.`);
  return result;
}
function contacts(input = {}, old = {}, preserveUnknown = false) {
  inputObject(input);
  const result = preserveUnknown ? {...copy(old)} : {};
  for (const key of contactKeys) result[key] = own(input, key) ? input[key] : old[key] ?? '';
  result.phone = text(result.phone, 'Телефон', 100);
  if (result.phone && (!/\d/.test(result.phone) || !/^[+\d\s().\-/#x]+$/i.test(result.phone))) throw Error('Проверьте телефон: используйте цифры, пробелы, +, скобки или дефис.');
  result.email = text(result.email, 'Почта', 254);
  if (result.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email)) throw Error('Проверьте адрес электронной почты.');
  result.website = link(result.website, 'Сайт');
  result.messenger = text(result.messenger, 'Мессенджер', 2000);
  if (/^[a-z][a-z\d+.-]*:/i.test(result.messenger)) result.messenger = link(result.messenger, 'Мессенджер');
  return result;
}
function archived(value) {
  if (typeof value !== 'boolean') throw Error('Проверьте состояние архива.');
  return value;
}
function recordBase(input, old) {
  if (input.id !== undefined) identifier(input.id);
  return {...copy(old || {}), id: old?.id || input.id || uid(), createdAt: old?.createdAt || now(), updatedAt: now(), revision: nextRevision(old), archived: archived(input.archived ?? old?.archived ?? false)};
}
function assertRelation(state, kind, id, label) {
  identifier(id);
  if (id && !state[kind].some(item => item.id === id)) throw Error(`${label} больше не существует. Выберите другую запись.`);
}
function staged(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw Error('В проекте должно быть от 1 до 100 этапов.');
  const ids = new Set();
  return input.map(item => {
    inputObject(item);
    const id = item.id === undefined || item.id === '' ? uid() : identifier(item.id, true);
    if (ids.has(id)) throw Error('Этапы должны иметь разные идентификаторы.');
    ids.add(id);
    return {...copy(item), id, title: text(item.title, 'Название этапа', 200, true)};
  });
}

// These validators read only. Storage uses them for new CRM records while
// leaving historical, pre-CRM projects in their original representation.
export function validateClient(client) {
  inputObject(client);
  identifier(client.id, true);
  text(client.name, 'Имя или компания', 300, true);
  contacts(client);
  if (client.archived !== undefined) archived(client.archived);
  return client;
}
export function validateLead(lead) {
  inputObject(lead);
  identifier(lead.id, true);
  text(lead.name, 'Имя или компания', 300, true);
  text(lead.company ?? '', 'Компания', 300);
  optionalStrings(lead, ['company', 'source', 'service', 'nextActionDate', 'taskId', 'projectId', 'clientId']);
  contacts(lead.contacts);
  link(lead.source ?? '', 'Источник');
  if (lead.service && !validChoice(lead.service, SERVICES)) throw Error('Выберите услугу.');
  if (!validChoice(lead.status, LEAD_STATUSES)) throw Error('Выберите состояние лида.');
  date(lead.nextActionDate ?? '', 'Следующее действие');
  for (const key of ['taskId', 'projectId', 'clientId']) identifier(lead[key] ?? '');
  if (lead.archived !== undefined) archived(lead.archived);
  return lead;
}
export function validateProject(project) {
  inputObject(project);
  identifier(project.id, true);
  text(project.title, 'Название проекта', 500, true);
  identifier(project.clientId, true);
  if (!validChoice(project.service, SERVICES)) throw Error('Выберите услугу проекта.');
  const stages = staged(project.stages);
  if (project.stages.some(stage => !stage.id) || !stages.some(stage => stage.id === project.stageId)) throw Error('Выберите существующий текущий этап проекта.');
  if (!validChoice(project.status, PROJECT_STATUSES)) throw Error('Выберите состояние проекта.');
  date(project.deadline ?? '', 'Срок проекта');
  date(project.returnDate ?? '', 'Дата возврата');
  if (project.archived !== undefined) archived(project.archived);
  return project;
}

export function saveClient(state, input) {
  inputObject(input);
  optionalStrings(input, ['name']);
  const old = state.clients.find(client => client.id === input.id);
  const client = {...recordBase(input, old), name: text(input.name ?? old?.name ?? '', 'Имя или компания', 300, true), ...contacts(input, old)};
  validateClient(client);
  // IDs remain authoritative. Update the original Home display cache without
  // changing a linked project's actual progress or monetary data.
  const projects = state.projects.map(project => project.clientId === client.id && project.clientName !== client.name
    ? {...project, clientName: client.name, revision: nextRevision(project), updatedAt: now()} : project);
  put(state.clients, client);
  state.projects = projects;
  return client;
}
export function saveLead(state, input) {
  inputObject(input);
  optionalStrings(input, ['name', 'company', 'source', 'service', 'status', 'nextActionDate', 'taskId', 'projectId', 'clientId']);
  if (input.contacts !== undefined) inputObject(input.contacts);
  const old = state.leads.find(lead => lead.id === input.id);
  const lead = {
    ...recordBase(input, old), name: text(input.name ?? old?.name ?? '', 'Имя или компания', 300, true),
    company: text(input.company ?? old?.company ?? '', 'Компания', 300),
    contacts: contacts(input.contacts ?? {}, old?.contacts, true), source: link(input.source ?? old?.source ?? '', 'Источник'),
    service: input.service ?? old?.service ?? '', status: input.status ?? old?.status ?? 'new',
    nextActionDate: date(input.nextActionDate ?? old?.nextActionDate ?? '', 'Следующее действие'),
    taskId: old?.taskId || input.taskId || '', projectId: old?.projectId || input.projectId || '', clientId: old?.clientId || input.clientId || ''
  };
  validateLead(lead);
  // A task can be deliberately removed in the Tasks screen. Keep its link as
  // a historical tombstone until a new next action is explicitly scheduled.
  if (lead.taskId !== old?.taskId) assertRelation(state, 'tasks', lead.taskId, 'Связанная задача');
  assertRelation(state, 'projects', lead.projectId, 'Связанный проект');
  assertRelation(state, 'clients', lead.clientId, 'Связанный клиент');
  if (lead.status === 'converted' && !lead.projectId) throw Error('Сначала создайте проект из лида.');
  if (lead.projectId) lead.status = 'converted';
  return put(state.leads, lead);
}

export function saveProject(state, input) {
  inputObject(input);
  optionalStrings(input, ['title', 'clientId', 'service', 'stageId', 'status', 'deadline', 'returnDate']);
  const old = state.projects.find(project => project.id === input.id);
  let stages = staged(input.stages ?? old?.stages ?? DEFAULT_STAGES);
  let current = old?.stageId;
  // On explicit editing only, retain an older display-only stage. Load never
  // guesses what a stage or status meant in the previous version.
  if (!current && old?.stage) {
    current = stages.find(stage => stage.title === old.stage)?.id;
    if (!current && !own(input, 'stages')) {
      current = uid();
      stages.push({id: current, title: text(old.stage, 'Название этапа', 200, true)});
    }
  }
  const stageId = input.stageId ?? current ?? stages[0].id;
  if (current && !own(input, 'stageId') && !stages.some(stage => stage.id === current)) throw Error('Текущий этап удалён. Сначала выберите другой текущий этап.');
  let status = input.status ?? old?.status ?? 'active';
  if (stageId === 'completed' && status === 'active') status = 'completed';
  const project = {
    ...recordBase(input, old), title: text(input.title ?? old?.title ?? '', 'Название проекта', 500, true),
    clientId: input.clientId ?? old?.clientId ?? '', service: input.service ?? old?.service ?? '',
    stages, stageId, status, deadline: date(input.deadline ?? old?.deadline ?? '', 'Срок проекта'),
    returnDate: date(input.returnDate ?? old?.returnDate ?? '', 'Дата возврата')
  };
  validateProject(project);
  assertRelation(state, 'clients', project.clientId, 'Клиент');
  project.clientName = state.clients.find(client => client.id === project.clientId).name;
  project.stage = stages.find(stage => stage.id === stageId).title;
  return put(state.projects, project);
}

export function archiveEntity(state, kind, id, value = true) {
  if (!['client', 'lead', 'project'].includes(kind)) throw Error('Выберите клиента, лид или проект.');
  identifier(id, true);
  const collection = {client: 'clients', lead: 'leads', project: 'projects'}[kind];
  if (!collection) throw Error('Выберите клиента, лид или проект.');
  archived(value);
  const record = state[collection].find(item => item.id === id);
  if (!record) throw Error('Запись больше не существует.');
  if (!!record.archived !== value) Object.assign(record, {archived: value, updatedAt: now(), revision: nextRevision(record)});
  return record;
}

const emailIdentity = value => typeof value === 'string' ? value.trim().toLocaleLowerCase('en') : '';
const phoneIdentity = value => {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  // Russian domestic and international prefixes describe the same number.
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
};
export function findClientDuplicates(state, input = {}) {
  inputObject(input);
  const source = input.contacts || input;
  const email = emailIdentity(source.email), phone = phoneIdentity(source.phone);
  return state.clients.filter(client => client.id !== input.id && ((email && email === emailIdentity(client.email)) || (phone && phone === phoneIdentity(client.phone))));
}

export function convertLead(state, leadId, options = {}) {
  const original = state.leads.find(lead => lead.id === leadId);
  if (!original) throw Error('Лид больше не существует.');
  if (original.projectId) {
    const existing = state.projects.find(project => project.id === original.projectId);
    if (!existing) throw Error('Связанный проект не найден. Исходный лид сохранён; проверьте данные.');
    return existing;
  }
  inputObject(options);
  if (options.clientId && options.client) throw Error('Выберите существующего клиента или создание нового.');
  inputObject(options.project);
  if (options.project.id) throw Error('При преобразовании создаётся новый проект.');
  const draft = copy(state), lead = draft.leads.find(item => item.id === leadId);
  let client;
  if (options.clientId) {
    client = draft.clients.find(item => item.id === options.clientId);
    if (!client) throw Error('Выбранный клиент больше не существует.');
  } else {
    if (!options.client && findClientDuplicates(draft, lead.contacts).length) throw Error('Найден клиент с такой почтой или телефоном. Выберите существующего клиента или явно создайте нового.');
    if (options.client?.id) throw Error('Для существующего клиента используйте выбор клиента.');
    client = saveClient(draft, {name: lead.name, ...lead.contacts, ...options.client});
  }
  const progress = {agreement: 'proposal', discussion: 'brief'}[lead.status] || 'contact';
  const selectedStages = staged(options.project.stages ?? DEFAULT_STAGES);
  const stageId = options.project.stageId ?? (selectedStages.some(stage => stage.id === progress) ? progress : selectedStages[0]?.id);
  const project = saveProject(draft, {...options.project, clientId: client.id, service: options.project.service ?? lead.service, stages: selectedStages, stageId});
  project.leadId = lead.id;
  Object.assign(lead, {projectId: project.id, clientId: client.id, status: 'converted', convertedAt: now(), updatedAt: now(), revision: nextRevision(lead)});
  const task = draft.tasks.find(item => item.id === lead.taskId);
  if (task) {
    Object.assign(task, {projectId: project.id, leadId: lead.id, updatedAt: now(), revision: nextRevision(task)});
    if (task.futureTemplate) task.futureTemplate.projectId = project.id;
  }
  // Commit only after every validation succeeds. No payment, estimate or
  // financial field is synthesized by conversion.
  Object.assign(state, {clients: draft.clients, leads: draft.leads, projects: draft.projects, tasks: draft.tasks});
  return state.projects.find(item => item.id === project.id);
}

export function scheduleLeadAction(state, leadId, input) {
  inputObject(input);
  const original = state.leads.find(lead => lead.id === leadId);
  if (!original) throw Error('Лид больше не существует.');
  const plannedDate = date(input.date, 'Следующее действие');
  if (!plannedDate) throw Error('Укажите дату следующего действия.');
  const draft = copy(state), lead = draft.leads.find(item => item.id === leadId);
  const linked = draft.tasks.find(task => task.id === lead.taskId);
  const previous = linked && !linked.done && !linked.archived ? linked : undefined;
  if (linked?.leadId && linked.leadId !== lead.id) throw Error('Эта задача уже связана с другим лидом.');
  const taskId = previous?.id || uid(), stamp = now();
  saveTask(draft, {
    ...previous, id: taskId, title: text(input.title ?? previous?.title ?? `Связаться: ${lead.name}`, 'Название задачи', 500, true),
    plannedDate, start: input.start ?? '', end: input.end ?? '', projectId: lead.projectId || previous?.projectId || '',
    leadId: lead.id, createdAt: previous?.createdAt || stamp, updatedAt: stamp, revision: nextRevision(previous)
  });
  Object.assign(lead, {taskId, nextActionDate: plannedDate, updatedAt: stamp, revision: nextRevision(lead)});
  Object.assign(state, {tasks: draft.tasks, leads: draft.leads});
  return state.tasks.find(task => task.id === taskId);
}
