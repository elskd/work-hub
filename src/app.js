import { createCrmUI } from "./crm-ui.js";
import {
  uid,
  dateKey,
  addDays,
  emptyState,
  validateTask,
  toggleTask,
  recommendation,
  revenue,
  overlaps,
  saveTask as persistTask,
} from "./domain.js";
import { LocalRepository, STORAGE_KEY } from "./store.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const paths = {
  home: "M3 10 12 3l9 7v10H15v-7H9v7H3Z",
  tasks: "M8 6h13M8 12h13M8 18h13M2 5l1 1 2-2M2 11l1 1 2-2M2 17l1 1 2-2",
  projects: "M3 7h7l2 2h9v11H3ZM3 7V4h7l2 3",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  money: "M7 21V3h6a5 5 0 0 1 0 10H4m0 4h11",
  content: "M5 3h10l4 4v14H5ZM9 11h6M9 15h6",
  design: "m12 3 9 9-9 9-9-9Z",
  materials: "M4 3h16v18H4ZM8 7h8M8 11h8",
  calculator: "M5 3h14v18H5ZM8 7h8M8 11h1m6 0h1m-8 5h1m6 0h1",
  assistant: "M4 4h16v13H9l-5 4ZM8 9h8M8 13h5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  more: "M4 12h1m6 0h1m6 0h1",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 2",
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n] || paths.design}"/></svg>`;
const names = {
  home: "Главная",
  tasks: "Задачи",
  projects: "Клиенты и проекты",
  search: "Поиск клиентов",
  money: "Деньги",
  content: "Контент",
  design: "Дизайн",
  materials: "Материалы и шаблоны",
  calculator: "Калькулятор",
  assistant: "Помощник",
  settings: "Настройки",
};
const later = {
  money: "Проектные поступления, ожидаемые оплаты, расходы, налоги и долги.",
  content: "Идеи, черновики, этапы и календарь ручных публикаций.",
  design: "Изображения, ссылки, категории и библиотека визуальных референсов.",
  materials: "Рабочие материалы, шаблоны, заполнение КП и брифа, экспорт PDF.",
  calculator: "Редактируемый прайс и сохранённые сметы без выдуманных ставок.",
  assistant:
    "ИИ пока не подключён. Подсказка на Главной работает по прозрачным правилам, без ИИ.",
};
let repository,
  state = emptyState(),
  fatal = "",
  saving = false,
  day = dateKey(),
  month = day.slice(0, 7),
  view = "open",
  query = "",
  priority = "",
  project = "",
  deadline = "",
  editId = null,
  filtersOpen = false;
const route = () =>
  names[location.hash.slice(1)] ? location.hash.slice(1) : "home";
const navLink = (id, compact = false) =>
  `<a class="nav-link ${route() === id ? "active" : ""}" href="#${id}" ${route() === id ? 'aria-current="page"' : ""}>${icon(id)}<span>${names[id]}</span>${later[id] && !compact ? "<small>Позже</small>" : ""}</a>`;
function nav() {
  $("#desktop-nav").innerHTML =
    '<div class="nav-label">Рабочий день</div>' +
    ["home", "tasks", "projects", "search", "money", "content"]
      .map((x) => navLink(x))
      .join("") +
    '<div class="nav-label">Инструменты</div>' +
    navLink("design") +
    '<div class="subnav">' +
    ["materials", "calculator"].map((x) => navLink(x, true)).join("") +
    "</div>" +
    navLink("assistant") +
    navLink("settings");
  $("#mobile-nav").innerHTML =
    ["home", "tasks", "projects"]
      .map(
        (x) =>
          `<a href="#${x}" class="${route() === x ? "active" : ""}" ${route() === x ? 'aria-current="page"' : ""}>${icon(x)}${x === "projects" ? "Проекты" : names[x]}</a>`,
      )
      .join("") +
    `<button data-action="more" class="${!["home", "tasks", "projects"].includes(route()) ? "active" : ""}">${icon("more")}Ещё</button>`;
  $("#more-nav").innerHTML = Object.keys(names)
    .map((x) => navLink(x))
    .join("");
  $("#crumb").textContent = names[route()];
}
function toast(m) {
  $("#toast").textContent = m;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 4000);
}
function theme() {
  const mode = state.settings.theme;
  document.documentElement.dataset.theme =
    mode === "system"
      ? matchMedia("(prefers-color-scheme:dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.dataset.accent = state.settings.accent;
}
async function mutate(fn) {
  if (saving) return false;
  if (fatal) throw Error(fatal);
  saving = true;
  try {
    const next = structuredClone(state);
    fn(next);
    state = await repository.save(next);
    render();
    return true;
  } finally {
    saving = false;
  }
}
const dateLabel = (s) =>
    s
      ? new Date(s + "T12:00:00").toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "short",
        })
      : "Без срока",
  money = (n) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n) +
    " ₽",
  taskProject = (t) => state.projects.find((p) => p.id === t.projectId),
  pLabels = { high: "Высокий", normal: "Обычный", low: "Низкий" };
const empty = (title, description, action = "") =>
    `<div class="empty"><span class="empty-symbol">${icon("tasks")}</span><h3>${title}</h3><p>${description}</p>${action}</div>`,
  addButton = (label = "Новая задача") =>
    `<button class="btn primary" data-action="new">${icon("plus")}${label}</button>`;
function taskRow(t) {
  return `<div class="task-row ${t.done ? "done" : ""}"><label class="check-label"><input type="checkbox" data-toggle="${esc(t.id)}" ${t.done ? "checked" : ""} aria-label="${t.done ? "Вернуть в работу" : "Выполнить"}: ${esc(t.title)}"></label><div class="task-body"><button class="task-title" data-edit="${esc(t.id)}">${esc(t.title)}</button><div class="task-meta"><span>${pLabels[t.priority]} приоритет</span>${t.deadline ? `<span class="${!t.done && t.deadline < dateKey() ? "overdue" : ""}">${!t.done && t.deadline < dateKey() ? "Просрочено · " : ""}Срок ${dateLabel(t.deadline)}</span>` : ""}${t.plannedDate ? `<span>План ${dateLabel(t.plannedDate)}${t.start ? " · " + t.start + "–" + t.end : ""}</span>` : ""}${taskProject(t) ? `<a href="#projects" data-project-id="${esc(t.projectId)}">${esc(taskProject(t).title)}</a>` : ""}${t.repeat?.frequency !== "none" ? "<span>↻ Повторяется</span>" : ""}</div>${t.subtasks.length ? `<div class="subtasks-preview">${t.subtasks.filter((s) => s.done).length} из ${t.subtasks.length} подзадач</div>` : ""}</div><button class="icon-button" data-edit="${esc(t.id)}" aria-label="Редактировать: ${esc(t.title)}">${icon("more")}</button></div>`;
}
const card = (title, body, extra = "", subtitle = "") =>
  `<section class="card" data-section="${{ "Задачи на день": "today", Просроченные: "overdue", "Ближайшие дедлайны": "deadlines", "Активные проекты": "projects", "План по времени": "timeline", "Цель месяца": "goal" }[title] || "other"}"><div class="card-head"><div><h2>${title}</h2>${subtitle ? `<small>${subtitle}</small>` : ""}</div>${extra}</div>${body}</section>`;
function home() {
  const rec = recommendation(state),
    todayTasks = state.tasks.filter(
      (t) => !t.archived && t.plannedDate === day,
    ),
    late = state.tasks.filter(
      (t) => !t.done && !t.archived && t.deadline && t.deadline < day,
    ),
    schedule = todayTasks
      .filter((t) => t.start)
      .sort((a, b) => a.start.localeCompare(b.start)),
    due = state.tasks
      .filter(
        (t) =>
          !t.done &&
          !t.archived &&
          t.deadline &&
          t.deadline >= day &&
          t.deadline <= addDays(day, 7),
      )
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    active = state.projects.filter(
      (p) => !["completed","refused","postponed","no-response"].includes(p.status) && !p.archived,
    ),
    projectDue = active.filter(
      (p) => p.deadline && p.deadline >= day && p.deadline <= addDays(day, 7),
    ),
    obligations = [
      ...due.map((t) => ({ type: "task", item: t })),
      ...projectDue.map((p) => ({ type: "project", item: p })),
    ].sort((a, b) => a.item.deadline.localeCompare(b.item.deadline)),
    income = revenue(state, month),
    goal = state.settings.goal,
    weekStart = addDays(day, -((new Date(day + "T12:00").getDay() + 6) % 7));
  return `<div class="page-head"><div><div class="eyebrow">Твой рабочий день</div><h1 style="margin-top:6px">Привет, Эля</h1><p>${new Date(day + "T12:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })} · всё важное рядом</p></div>${addButton()}</div><div class="week" aria-label="Выбрать день">${Array.from(
    { length: 7 },
    (_, i) => {
      const d = addDays(weekStart, i);
      return `<button data-day="${d}" class="${d === day ? "active" : ""}" aria-pressed="${d === day}" aria-label="${dateLabel(d)}"><span>${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i]}</span><b>${Number(d.slice(-2))}</b></button>`;
    },
  ).join(
    "",
  )}</div><div class="date-controls"><label class="field"><span>Другая дата</span><input type="date" id="home-date" value="${day}"></label><button class="text-link" data-action="today">Сегодня</button></div><div class="dashboard"><div class="column"><section class="card next-step"><div class="next-top"><span class="eyebrow">Следующий шаг · сегодня</span><span class="pill">Без ИИ</span></div><h2>${rec.task ? esc(rec.task.title) : rec.project ? esc(rec.project.title) : "Начнём с одного действия"}</h2><p>${rec.reason}</p>${rec.task ? `<button class="btn primary" data-edit="${rec.task.id}">Открыть задачу ${icon("arrow")}</button>` : rec.project ? `<a class="btn primary" href="#projects" data-project-id="${esc(rec.project.id)}">Открыть проект →</a>` : addButton("Добавить первую задачу")}</section>${card("Задачи на день", todayTasks.length ? todayTasks.map(taskRow).join("") : empty("Пока свободно", "Добавьте задачу и укажите дату планирования. Так она появится здесь."), '<a class="text-link" href="#tasks">Все задачи →</a>', `${todayTasks.filter((t) => t.done).length} из ${todayTasks.length} выполнено`)}${late.length ? card("Просроченные", late.map(taskRow).join(""), "", "Срок прошёл, задачи остаются в работе") : ""}${card("Ближайшие дедлайны", obligations.length ? obligations.map(({ type, item }) => (type === "task" ? taskRow(item) : `<div class="task-row"><div class="task-body"><a class="task-title" href="#projects" data-project-id="${esc(item.id)}">${esc(item.title)}</a><div class="task-meta">Проект · Срок ${dateLabel(item.deadline)}</div></div></div>`)).join("") : empty("Без срочных обязательств", "На ближайшие 7 дней дедлайнов нет."), '<a class="text-link" href="#tasks">Все →</a>')}${card("Активные проекты", active.length ? active.map((p) => `<div class="task-row"><div class="task-body"><a class="task-title" href="#projects" data-project-id="${esc(p.id)}">${esc(p.title)}</a><div class="task-meta">${esc(state.clients?.find(c=>c.id===p.clientId)?.name || p.clientName || "Клиент не указан")} · ${esc(p.stage || "Этап не указан")}</div><small>${p.deadline ? "Срок " + dateLabel(p.deadline) : "Ближайший срок не указан"}</small></div></div>`).join("") : empty("Проекты появятся здесь", "Добавьте первый проект: клиент, этапы, сроки и связанные задачи."), '<a class="text-link" href="#projects">Проекты →</a>')}</div><div class="column">${card("План по времени", schedule.length ? schedule.map((t) => `<div class="timeline-item"><time>${t.start}–${t.end}</time><div class="slot"><button data-edit="${t.id}">${esc(t.title)}</button><small>${t.done ? "✓ Выполнено" : esc(taskProject(t)?.title || "Без проекта")}</small></div></div>`).join("") + '<p class="note">Время вне указанных интервалов свободно. Рабочие часы пока не ограничены.</p>' : empty("День без расписания", "Укажите начало и окончание в задаче. Остальное время останется свободным."), icon("clock"), "Интервалы выбранного дня")}${card(
    "Цель месяца",
    `<div class="money-total">${money(income)} <span>из ${money(goal)}</span></div><div class="progress" role="progressbar" aria-label="Цель месяца" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(goal, income)}"><span style="width:${Math.min(100, (income / goal) * 100)}%"></span></div><div class="money-foot"><span>Осталось ${money(Math.max(0, goal - income))}</span><span>${Math.round((income / goal) * 100)}%</span></div><p class="note">Только фактически полученные проектные платежи. Учёт платежей появится в следующем этапе.</p><a class="text-link" href="#money">Перейти в деньги →</a>`,
    `<div class="month-picker"><label class="field"><span>Месяц</span><select id="income-month" aria-label="Месяц доходов">${["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"].map((name, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${Number(month.slice(5)) === i + 1 ? "selected" : ""}>${name}</option>`).join("")}</select></label><label class="field"><span>Год</span><select id="income-year" aria-label="Год доходов">${Array.from(
      { length: 21 },
      (_, i) => Number(month.slice(0, 4)) - 10 + i,
    )
      .map(
        (y) =>
          `<option ${y === Number(month.slice(0, 4)) ? "selected" : ""}>${y}</option>`,
      )
      .join("")}</select></label></div>`,
  )}<div class="card stage-note"><div class="eyebrow">Рабочее пространство</div><h2 style="margin-top:8px">Своё пространство для работы</h2><p class="note">Задачи, клиенты, проекты и поиск заказов в одном месте. Данные пока сохраняются только в этом браузере; синхронизация ещё не подключена.</p><a href="#settings" class="text-link">Настройки и резервная копия →</a></div></div></div>`;
}
function tasks() {
  let list = state.tasks.filter((t) =>
    view === "archived" ? t.archived : !t.archived,
  );
  list = list.filter((t) =>
    view === "completed"
      ? t.done
      : view === "archived" || view === "all"
        ? true
        : !t.done,
  );
  if (view === "today") list = list.filter((t) => t.plannedDate === dateKey());
  if (view === "upcoming") list = list.filter((t) => t.plannedDate > dateKey());
  if (view === "overdue")
    list = list.filter((t) => t.deadline && t.deadline < dateKey());
  list = list.filter(
    (t) =>
      (!query ||
        `${t.title} ${t.description}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!priority || t.priority === priority) &&
      (!project ||
        (project === "none" ? !t.projectId : t.projectId === project)) &&
      (!deadline || t.deadline === deadline),
  );
  return `<div class="page-head"><div><h1>Задачи</h1><p>Маленькие действия. Настоящий прогресс.</p></div>${addButton()}</div><section class="card"><div class="tabs" role="group" aria-label="Вид задач">${Object.entries(
    {
      open: "В работе",
      all: "Все",
      today: "Сегодня",
      upcoming: "Предстоящие",
      overdue: "Просроченные",
      completed: "Выполненные",
      archived: "Архив",
    },
  )
    .map(
      ([id, label]) =>
        `<button data-view="${id}" class="${view === id ? "active" : ""}" aria-pressed="${view === id}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="filter-toolbar"><button class="btn filter-toggle" data-action="toggle-filters" aria-expanded="${filtersOpen}" aria-controls="task-filters">Фильтры${priority || project || deadline ? " · активны" : ""}</button></div><div id="task-filters" class="filters ${filtersOpen ? "expanded" : ""}"><label class="field search-field"><span>Поиск</span><input id="task-search" type="search" placeholder="Найти задачу" value="${esc(query)}"></label><label class="field"><span>Приоритет</span><select id="priority-filter"><option value="">Все приоритеты</option>${Object.entries(
    pLabels,
  )
    .map(
      ([id, l]) =>
        `<option value="${id}" ${priority === id ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><label class="field"><span>Проект</span><select id="project-filter"><option value="">Все проекты</option><option value="none" ${project === "none" ? "selected" : ""}>Без проекта</option>${state.projects.map((p) => `<option value="${p.id}" ${project === p.id ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></label><label class="field"><span>Дедлайн</span><input id="deadline-filter" type="date" value="${deadline}"></label></div><div class="list-count">Найдено: ${list.length} <button class="text-link" data-action="reset-filters">Сбросить фильтры</button></div>${list.length ? list.map(taskRow).join("") : empty("Здесь пока нет задач", "Создайте новую задачу или измените фильтры.", addButton("Добавить задачу"))}</section>`;
}
function settings() {
  return `<div class="page-head"><div><h1>Настройки</h1><p>Интерфейс и данные рабочего пространства.</p></div></div><div class="settings-grid"><section class="card"><h2>Оформление</h2>${Object.entries(
    {
      theme: { light: "Светлая", dark: "Тёмная", system: "Как в системе" },
      accent: { black: "Чёрный", wine: "Бордовый", green: "Зелёный" },
    },
  )
    .map(
      ([key, options]) =>
        `<label class="field"><span>${key === "theme" ? "Тема" : "Акцент"}</span><select data-setting="${key}">${Object.entries(
          options,
        )
          .map(
            ([k, v]) =>
              `<option value="${k}" ${state.settings[key] === k ? "selected" : ""}>${v}</option>`,
          )
          .join("")}</select></label>`,
    )
    .join(
      "",
    )}<p class="note">В тёмной теме чёрный акцент становится светлым для читаемости.</p></section><section class="card"><h2>Данные на этом устройстве</h2><p class="note">Сохранение работает в этом браузере. Вход и серверная синхронизация ещё не подключены. Очистка данных браузера удалит локальные записи — сохраняйте резервную копию.</p><button class="btn" style="margin-top:20px" data-action="export">Скачать резервную копию</button><p class="note">JSON содержит задачи, настройки и связанные данные. Восстановление копии и серверное хранение появятся следующим этапом.</p></section><section class="card"><h2>Месячная цель</h2><form id="goal-form"><label class="field"><span>Полученные проектные платежи, ₽</span><input name="goal" type="number" min="1" max="1000000000" step="1" required value="${state.settings.goal}"></label><button class="btn" style="margin-top:16px">Сохранить цель</button></form></section><section class="card"><h2>Правила планирования</h2><p class="note">Даты и время относятся к часовому поясу: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}. Перенос плановой даты не меняет дедлайн.</p><p class="note">Следующее повторение создаётся при выполнении ровно один раз. Для 29–31 числа используется последний день короткого месяца; в следующем месяце исходное число восстанавливается.</p></section></div>`;
}
function placeholder() {
  const r = route();
  return `<div class="page-head"><div><h1>${names[r]}</h1><p>Раздел следующего этапа</p></div></div><section class="card placeholder"><span class="pill">${r === "assistant" ? "ИИ не подключён" : "В разработке"}</span><h2>${r === "assistant" ? "Помощник появится позже" : "Этот раздел ещё впереди"}</h2><p>${later[r]}</p><p class="note">Сейчас доступны Главная, задачи, настройка оформления и локальное сохранение. Этот экран не создаёт и не изменяет записи.</p>${
    ["design", "materials", "calculator"].includes(r)
      ? `<div class="placeholder-links">${["design", "materials", "calculator"]
          .filter((x) => x !== r)
          .map((x) => `<a class="btn" href="#${x}">${names[x]}</a>`)
          .join("")}</div>`
      : ""
  }<a class="text-link" href="#tasks">К задачам →</a></section>`;
}
function render() {
  nav();
  theme();
  $("#main").innerHTML =
    (fatal ? `<div class="error" role="alert">${esc(fatal)}</div>` : "") +
    (route() === "home"
      ? home()
      : route() === "tasks"
        ? tasks()
        : route() === "settings"
          ? settings()
          : route() === "projects"
            ? crm.renderProjects()
            : route() === "search"
              ? crm.renderLeads()
              : placeholder());
  document.title = `${names[route()]} · Work Hub`;
}
function subrow(s = { id: uid(), title: "", done: false }) {
  return `<div class="subtask-edit" data-sub-id="${s.id}"><input type="checkbox" aria-label="Подзадача выполнена" ${s.done ? "checked" : ""}><input type="text" aria-label="Название подзадачи" placeholder="Одно небольшое действие" maxlength="500" value="${esc(s.title)}"><button class="icon-button" type="button" data-remove-sub aria-label="Удалить подзадачу">×</button></div>`;
}
function editor(id = null, defaults = {}) {
  editId = id;
  const t = state.tasks.find((t) => t.id === id) || {
    title: "",
    description: "",
    projectId: "",
    priority: "normal",
    deadline: "",
    plannedDate: route() === "home" ? day : "",
    start: "",
    end: "",
    repeat: { frequency: "none", interval: 1, weekdays: [] },
    subtasks: [],
    ...defaults,
  };
  const field = (label, name, type = "text") =>
    `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(t[name])}"></label>`;
  $("#editor").innerHTML =
    `<div class="dialog-head"><h2 id="editor-title">${id ? "Задача" : "Новая задача"}</h2><button class="icon-button" data-close="editor" aria-label="Закрыть форму">×</button></div><form id="task-form" class="editor-form" novalidate><div class="dialog-body"><div class="form-grid"><label class="field full"><span>Название *</span><input name="title" required maxlength="500" placeholder="Что нужно сделать?" value="${esc(t.title)}" aria-describedby="title-error" autofocus><small id="title-error" class="field-error"></small></label><label class="field full"><span>Описание</span><textarea name="description" maxlength="10000">${esc(t.description)}</textarea></label><label class="field"><span>Приоритет</span><select name="priority">${Object.entries(
      pLabels,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${t.priority === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="field"><span>Проект</span><select name="projectId"><option value="">Без проекта</option>${state.projects.map((p) => `<option value="${p.id}" ${t.projectId === p.id ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select><small>Задача будет связана с выбранным проектом.</small></label>${field("Дедлайн · обещанный срок", "deadline", "date")}${field("Дата планирования", "plannedDate", "date")}${field("Начало", "start", "time")}${field("Окончание", "end", "time")}<div class="full"><p class="note" style="margin:0">План и дедлайн независимы. Пересечения интервалов разрешены с предупреждением.</p><p id="overlap-warning" class="warn" role="status"></p></div><label class="field"><span>Повторение</span><select name="frequency">${Object.entries(
      {
        none: "Не повторять",
        daily: "Каждый день",
        weekly: "Каждую неделю",
        monthly: "Каждый месяц",
      },
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${t.repeat.frequency === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="field"><span>Через сколько дней / недель / месяцев</span><input name="interval" type="number" min="1" max="365" value="${t.repeat.interval || 1}"></label><div class="field full"><span>Дни недели · только для еженедельного повтора</span><div class="weekdays">${[1, 2, 3, 4, 5, 6, 0].map((d, i) => `<label><input type="checkbox" name="weekday" value="${d}" ${t.repeat.weekdays?.includes(d) ? "checked" : ""}>${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i]}</label>`).join("")}</div><small>Без выбора — день планирования. Для 29–31 числа в коротком месяце — последний день.</small></div>${id && (t.repeat.frequency !== "none" || (t.futureTemplate?.repeat?.frequency && t.futureTemplate.repeat.frequency !== "none")) ? '<label class="field full"><span>Область изменения</span><select name="scope"><option value="one">Только этот экземпляр</option><option value="future">Этот и будущие невыполненные экземпляры</option></select></label>' : ""}<div class="full"><h3>Подзадачи</h3><div id="subtask-list" style="margin-top:12px">${t.subtasks.map(subrow).join("")}</div><button type="button" class="text-link" data-action="add-sub">＋ Добавить подзадачу</button></div></div></div><div class="dialog-footer"><div id="form-error" class="error" role="alert"></div><div class="dialog-actions">${id ? `<button type="button" class="btn danger" data-delete="${id}">Удалить</button><button type="button" class="btn" data-archive="${id}">${t.archived ? "Из архива" : "В архив"}</button>` : ""}<button type="button" class="btn" data-close="editor">Отмена</button><button class="btn primary" type="submit">Сохранить</button></div></div></form>`;
  if(!$("#editor").open)$("#editor").showModal();
  $("#editor").scrollTop = 0;
  $(".dialog-body").scrollTop = 0;
}
function close(id) {
  $("#" + id).close();
  if (id === "editor") {
    const target = editId
      ? document.querySelector(`[data-edit="${editId}"]`)
      : document.querySelector("[data-action=new]");
    (target || $("#main"))?.focus();
  }
}
function readForm() {
  const f = new FormData($("#task-form")),
    old = state.tasks.find((t) => t.id === editId);
  return {
    ...old,
    id: editId || uid(),
    title: f.get("title").trim(),
    description: f.get("description").trim(),
    priority: f.get("priority"),
    projectId: f.get("projectId"),
    deadline: f.get("deadline"),
    plannedDate: f.get("plannedDate"),
    start: f.get("start"),
    end: f.get("end"),
    done: old?.done || false,
    archived: old?.archived || false,
    repeat: {
      frequency: f.get("frequency"),
      interval: Number(f.get("interval")),
      weekdays: f.getAll("weekday").map(Number),
      anchorDay:
        old?.plannedDate === f.get("plannedDate")
          ? old?.repeat.anchorDay || Number(f.get("plannedDate").slice(-2))
          : Number(f.get("plannedDate").slice(-2)),
    },
    subtasks: [...document.querySelectorAll(".subtask-edit")]
      .map((el) => ({
        id: el.dataset.subId,
        title: el.querySelector("[type=text]").value.trim(),
        done: el.querySelector("[type=checkbox]").checked,
      }))
      .filter((s) => s.title),
    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
async function saveTask(e) {
  e.preventDefault();
  const b = $("#task-form [type=submit]");
  $("#title-error").textContent = "";
  for (const el of document.querySelectorAll("#task-form [aria-invalid]"))
    el.removeAttribute("aria-invalid");
  $("#form-error").textContent = "";
  try {
    const t = validateTask(readForm()),
      scope = new FormData($("#task-form")).get("scope");
    b.disabled = true;
    const ok = await mutate((s) => persistTask(s, t, scope || "one"));
    if (ok) {
      close("editor");
      toast("Задача сохранена на этом устройстве");
    }
  } catch (e) {
    $("#form-error").textContent = e.message;
    if (/название/i.test(e.message)) {
      const input = $('#task-form [name="title"]');
      input.setAttribute("aria-invalid", "true");
      $("#title-error").textContent = e.message;
      input.focus({ preventScroll: true });
      $(".dialog-body").scrollTop = 0;
    }
  } finally {
    b.disabled = false;
  }
}
async function complete(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (
    !task.done &&
    task.subtasks.some((s) => !s.done) &&
    !confirm("Есть незавершённые подзадачи. Всё равно завершить задачу?")
  ) {
    render();
    return;
  }
  try {
    if (await mutate((s) => toggleTask(s, id)))
      toast(
        task.done
          ? "Задача возвращена в работу"
          : "Выполнено" +
              (state.tasks.find((t) => t.id === id)?.nextId
                ? " · следующее повторение в плане"
                : ""),
      );
  } catch (e) {
    toast(e.message);
    render();
  }
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("button,a");
  if (!el) return;
  if (el.closest("#more-nav")) close("more");
  if(el.dataset.projectId){e.preventDefault();crm.openProject(el.dataset.projectId);return;}
  if (await crm.handleClick(e)) return;
  if (el.dataset.close) close(el.dataset.close);
  if (el.dataset.edit) editor(el.dataset.edit);
  if (el.dataset.day) {
    day = el.dataset.day;
    render();
  }
  if (el.dataset.view) {
    view = el.dataset.view;
    render();
  }
  if (el.hasAttribute("data-remove-sub")) el.closest(".subtask-edit").remove();
  const a = el.dataset.action;
  if (a === "toggle-filters") {
    filtersOpen = !filtersOpen;
    render();
  }
  if (a === "new") editor();
  if (a === "more") $("#more").showModal();
  if (a === "today") {
    day = dateKey();
    render();
  }
  if (a === "reset-filters") {
    query = priority = project = deadline = "";
    render();
  }
  if (a === "add-sub") {
    $("#subtask-list").insertAdjacentHTML("beforeend", subrow());
    $("#subtask-list").lastElementChild.querySelector("[type=text]").focus();
  }
  if (a === "export") {
    const raw = fatal
        ? localStorage.getItem(STORAGE_KEY)
        : JSON.stringify(state, null, 2),
      url = URL.createObjectURL(
        new Blob([raw || ""], { type: "application/json" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `work-hub-${dateKey()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (
    el.dataset.delete &&
    confirm(
      "Удалить эту задачу? Это действие нельзя отменить. Уже созданные повторения останутся.",
    )
  ) {
    try {
      if (
        await mutate((s) => {
          s.tasks = s.tasks.filter((t) => t.id !== el.dataset.delete);
        })
      ) {
        close("editor");
        toast("Задача удалена");
      }
    } catch (e) {
      $("#form-error").textContent = e.message;
    }
  }
  if (el.dataset.archive) {
    try {
      if (
        await mutate((s) => {
          const t = s.tasks.find((t) => t.id === el.dataset.archive);
          t.archived = !t.archived;
        })
      ) {
        close("editor");
        toast("Архив обновлён");
      }
    } catch (e) {
      $("#form-error").textContent = e.message;
    }
  }
});
document.addEventListener("change", async (e) => {
  if(await crm.handleChange(e))return;
  const el = e.target;
  if (el.dataset.toggle) complete(el.dataset.toggle);
  if (el.id === "home-date" && el.value) {
    day = el.value;
    render();
  }
  if (["income-month", "income-year"].includes(el.id) && el.value) {
    month = $("#income-year").value + "-" + $("#income-month").value;
    render();
  }
  if (el.id === "priority-filter") {
    priority = el.value;
    render();
  }
  if (el.id === "project-filter") {
    project = el.value;
    render();
  }
  if (el.id === "deadline-filter") {
    deadline = el.value;
    render();
  }
  if (el.dataset.setting)
    try {
      await mutate((s) => (s.settings[el.dataset.setting] = el.value));
    } catch (e) {
      toast(e.message);
      render();
    }
  if (el.closest("#task-form")) {
    const matches = overlaps(state.tasks, readForm());
    $("#overlap-warning").textContent = matches.length
      ? "Пересечение: " +
        matches.map((x) => x.title).join(", ") +
        ". Можно сохранить этот интервал."
      : "";
  }
});
document.addEventListener("input", (e) => {
  if(crm.handleInput(e))return;
  if (e.target.id === "task-search") {
    const pos = e.target.selectionStart;
    query = e.target.value;
    render();
    $("#task-search").focus();
    $("#task-search").setSelectionRange(pos, pos);
  }
});
document.addEventListener("submit", async (e) => {
  if(e.target.id==="crm-form"){e.preventDefault();await crm.handleSubmit(e);return;}
  if (e.target.id === "task-form") saveTask(e);
  if (e.target.id === "goal-form") {
    e.preventDefault();
    try {
      const goal = Number(new FormData(e.target).get("goal"));
      if (!Number.isInteger(goal) || goal < 1 || goal > 1e9)
        throw Error("Введите целую положительную цель.");
      if (await mutate((s) => (s.settings.goal = goal)))
        toast("Цель сохранена");
    } catch (e) {
      toast(e.message);
    }
  }
});
window.addEventListener("hashchange", () => {
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  render();
  window.scrollTo(0, 0);
  $("#main").focus();
});
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY)
    toast(
      "Данные изменены в другой вкладке. Обновите страницу перед редактированием.",
    );
});
matchMedia("(prefers-color-scheme:dark)").addEventListener("change", theme);
let crmReturnFocus=null;
const crm=createCrmUI({
  getState:()=>state,mutate,render,toast,esc,icon,
  openTask:id=>editor(id),
  newTask:defaults=>editor(null,defaults),
  openDialog:html=>{
    const dialog=$("#editor");
    if(!dialog.open)crmReturnFocus=document.activeElement;
    dialog.innerHTML=html;
    if(!dialog.open)dialog.showModal();
    dialog.scrollTop=0;
    const body=dialog.querySelector(".dialog-body");if(body)body.scrollTop=0;
  },
  closeDialog:()=>{ $("#editor").close(); (crmReturnFocus?.isConnected?crmReturnFocus:$("#main"))?.focus(); }
});
try {
  repository = new LocalRepository();
  state = await repository.load();
} catch (e) {
  fatal = e.message || "Локальное хранилище недоступно.";
}
render();
