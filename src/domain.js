export const uid = () => globalThis.crypto.randomUUID();
export const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parse = value => new Date(`${value}T00:00:00Z`);
const calendarKey = date => `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const isDate = value => typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && calendarKey(parse(value)) === value;
const isTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const repeating = repeat => !!repeat && repeat.frequency !== 'none';
const noRepeat = () => ({frequency: 'none', interval: 1, weekdays: []});
const daysBetween = (a, b) => (parse(a) - parse(b)) / 86400000;

export function addDays(value, amount) {
  if (!isDate(value) || !Number.isInteger(amount)) throw Error('Проверьте дату.');
  const date = parse(value);
  date.setUTCDate(date.getUTCDate() + amount);
  const result = calendarKey(date);
  if (!isDate(result)) throw Error('Дата выходит за поддерживаемый диапазон.');
  return result;
}

export const emptyState = () => ({schema: 1, revision: 0, tasks: [], projects: [], payments: [], settings: {theme: 'light', accent: 'black', goal: 150000}});

function validateRepeat(repeat, plannedDate) {
  if (!repeat || !['none', 'daily', 'weekly', 'monthly'].includes(repeat.frequency)) throw Error('Выберите правило повторения.');
  if (!repeating(repeat)) return;
  if (!isDate(plannedDate)) throw Error('Для повторения укажите дату планирования.');
  if (!Number.isInteger(repeat.interval) || repeat.interval < 1 || repeat.interval > 365) throw Error('Интервал повторения — целое число от 1 до 365.');
  if (repeat.weekdays !== undefined && (!Array.isArray(repeat.weekdays) || repeat.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) throw Error('Проверьте дни недели для повторения.');
  if (repeat.frequency === 'monthly' && repeat.anchorDay !== undefined && (!Number.isInteger(repeat.anchorDay) || repeat.anchorDay < 1 || repeat.anchorDay > 31)) throw Error('Число месяца для повторения — от 1 до 31.');
}

export function validateTask(task) {
  if (typeof task?.title !== 'string' || !task.title.trim()) throw Error('Введите название задачи.');
  if (task.title.length > 500) throw Error('Название должно содержать не больше 500 символов.');
  if (task.description !== undefined && (typeof task.description !== 'string' || task.description.length > 10000)) throw Error('Описание должно содержать не больше 10 000 символов.');
  if (task.priority !== undefined && !['low', 'normal', 'high'].includes(task.priority)) throw Error('Выберите приоритет задачи.');
  for (const key of ['deadline', 'plannedDate']) if (task[key] !== undefined && (typeof task[key] !== 'string' || (task[key] && !isDate(task[key])))) throw Error('Проверьте дату.');
  for (const key of ['start', 'end']) if (task[key] !== undefined && typeof task[key] !== 'string') throw Error('Проверьте время.');
  if ((task.start || task.end) && (!task.plannedDate || !task.start || !task.end)) throw Error('Для интервала укажите дату, начало и окончание.');
  if ((task.start && !isTime(task.start)) || (task.end && !isTime(task.end))) throw Error('Проверьте время.');
  if (task.start && task.end <= task.start) throw Error('Окончание должно быть позже начала.');
  if (task.repeat !== undefined) validateRepeat(task.repeat, task.plannedDate);
  if (task.subtasks !== undefined) {
    if (!Array.isArray(task.subtasks) || task.subtasks.some(subtask => typeof subtask?.title !== 'string' || !subtask.title.trim() || subtask.title.length > 500)) throw Error('Проверьте названия подзадач.');
    const ids = task.subtasks.map(subtask => subtask.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw Error('Подзадачи должны иметь разные идентификаторы.');
  }
  return task;
}

function normalizedRepeat(repeat, plannedDate) {
  const result = structuredClone(repeat || noRepeat());
  result.weekdays = [...new Set(result.weekdays || [])];
  if (result.frequency === 'monthly' && !result.anchorDay) result.anchorDay = Number(plannedDate.slice(-2));
  return result;
}

export function nextDate(value, repeat) {
  validateRepeat(repeat, value);
  if (!repeating(repeat)) throw Error('Для следующего экземпляра нужно повторение.');
  const date = parse(value), interval = repeat.interval;
  if (repeat.frequency === 'daily') return addDays(value, interval);
  if (repeat.frequency === 'monthly') {
    const anchor = repeat.anchorDay || date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + interval);
    const last = new Date(date);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(anchor, last.getUTCDate()));
    const result = calendarKey(date);
    if (!isDate(result)) throw Error('Дата выходит за поддерживаемый диапазон.');
    return result;
  }
  const weekdays = repeat.weekdays?.length ? repeat.weekdays : [date.getUTCDay()];
  const monday = addDays(value, -((date.getUTCDay() + 6) % 7));
  for (let offset = 1; offset <= 7 * interval + 7; offset++) {
    const candidate = addDays(value, offset), weeks = Math.floor(daysBetween(candidate, monday) / 7);
    if (weeks % interval === 0 && weekdays.includes(parse(candidate).getUTCDay())) return candidate;
  }
  throw Error('Не удалось определить следующее повторение.');
}

// Each occurrence retains its unmodified series dates. Moving just that occurrence
// must not shift later occurrences, their deadlines, or their monthly anchor.
function template(task) {
  return {
    title: task.title, description: task.description || '', priority: task.priority || 'normal',
    projectId: task.projectId || '', plannedDate: task.plannedDate || '', deadline: task.deadline || '',
    start: task.start || '', end: task.end || '', repeat: normalizedRepeat(task.repeat, task.plannedDate || ''),
    subtasks: (task.subtasks || []).map(subtask => ({...subtask, seriesSubtaskId: subtask.seriesSubtaskId || subtask.id, done: false}))
  };
}

const futureTemplate = task => template({...task, ...task.futureTemplate});

function ensureSeries(state, task) {
  if (task.seriesId && Number.isInteger(task.seriesIndex)) return;
  const chain = [task], seen = new Set([task.id]);
  let current = task;
  while (current.previousId) {
    const previous = state.tasks.find(candidate => candidate.id === current.previousId);
    if (!previous || seen.has(previous.id)) break;
    seen.add(previous.id);
    chain.push(previous);
    current = previous;
    if (current.seriesId && Number.isInteger(current.seriesIndex)) break;
  }
  const seriesId = current.seriesId || current.id;
  let index = Number.isInteger(current.seriesIndex) ? current.seriesIndex : 0;
  for (const occurrence of chain.reverse()) {
    occurrence.seriesId = seriesId;
    occurrence.seriesIndex = index++;
  }
}

function freshSubtasks(subtasks) {
  return subtasks.map(subtask => ({...subtask, id: uid(), done: false}));
}

export function toggleTask(state, id) {
  const task = state.tasks.find(task => task.id === id);
  if (!task) return;
  ensureSeries(state, task);
  const updatedAt = new Date().toISOString();
  if (task.done) {
    Object.assign(task, {done: false, updatedAt, completedAt: null});
    return;
  }
  const future = futureTemplate(task);
  let next;
  // A dangling nextId is an intentional deletion tombstone. Re-completing the
  // parent must never resurrect a deleted occurrence.
  if (repeating(future.repeat) && !task.nextId) {
    const existing = state.tasks.find(candidate => candidate.previousId === task.id || (candidate.seriesId === task.seriesId && candidate.seriesIndex === task.seriesIndex + 1));
    if (existing) task.nextId = existing.id;
    else {
      const plannedDate = nextDate(future.plannedDate, future.repeat);
      const delta = daysBetween(plannedDate, future.plannedDate);
      next = {
        ...structuredClone(task), ...future, id: uid(), done: false, archived: false, completedAt: null,
        nextId: null, previousId: task.id, seriesIndex: task.seriesIndex + 1, plannedDate,
        deadline: future.deadline ? addDays(future.deadline, delta) : '',
        createdAt: updatedAt, updatedAt, subtasks: freshSubtasks(future.subtasks)
      };
      next.futureTemplate = template(next);
      validateTask(next);
    }
  }
  Object.assign(task, {done: true, updatedAt, completedAt: updatedAt});
  if (next) {
    task.nextId = next.id;
    state.tasks.push(next);
  }
}

function updateFutureSubtasks(existing, source) {
  return source.map(subtask => {
    const key = subtask.seriesSubtaskId || subtask.id;
    const old = existing.find(candidate => (candidate.seriesSubtaskId || candidate.id) === key);
    return {...subtask, id: old?.id || uid(), done: old?.done || false};
  });
}

export function saveTask(state, incoming, scope = 'one') {
  if (!['one', 'future'].includes(scope)) throw Error('Выберите область изменения.');
  const old = state.tasks.find(task => task.id === incoming.id);
  const task = {description: '', priority: 'normal', projectId: '', plannedDate: '', deadline: '', start: '', end: '', done: false, archived: false, subtasks: [], repeat: noRepeat(), ...old, ...structuredClone(incoming)};
  task.id ||= uid();
  validateTask(task);
  task.repeat = normalizedRepeat(task.repeat, task.plannedDate);
  task.subtasks = task.subtasks.map(subtask => {
    const previous = old?.subtasks.find(candidate => candidate.id === subtask.id);
    const id = subtask.id || uid();
    return {...subtask, id, seriesSubtaskId: previous?.seriesSubtaskId || subtask.seriesSubtaskId || id};
  });
  validateTask(task);
  if (task.projectId && !state.projects.some(project => project.id === task.projectId)) throw Error('Выбранный проект больше не существует. Выберите другой проект или «Без проекта».');
  if (!old) {
    task.seriesId = task.id;
    task.seriesIndex = 0;
    task.futureTemplate = template(task);
    state.tasks.push(task);
    return;
  }
  ensureSeries(state, old);
  for (const key of ['previousId', 'nextId', 'seriesId', 'seriesIndex']) task[key] = old[key];
  const previousTemplate = futureTemplate(old);
  // A standalone task becoming recurring must acquire its first series template.
  const startsSeries = !repeating(previousTemplate.repeat) && !repeating(old.repeat) && repeating(task.repeat);
  task.futureTemplate = scope === 'future' || startsSeries ? template(task) : previousTemplate;
  state.tasks[state.tasks.indexOf(old)] = task;
  if (scope !== 'future') return;
  state.tasks.forEach(occurrence => ensureSeries(state, occurrence));
  const following = state.tasks.filter(occurrence => occurrence.seriesId === task.seriesId && occurrence.seriesIndex > task.seriesIndex).sort((a, b) => a.seriesIndex - b.seriesIndex);
  let previous = task;
  for (const occurrence of following) {
    if (!occurrence.done) {
      const fields = template(task);
      let plannedDate = occurrence.plannedDate, deadline = occurrence.deadline;
      if (repeating(task.repeat)) {
        // Account for deliberately deleted positions in the series without
        // bringing those positions back or pulling later work into their dates.
        let source = futureTemplate(previous);
        for (let index = previous.seriesIndex; index < occurrence.seriesIndex; index++) {
          const next = nextDate(source.plannedDate, task.repeat), delta = daysBetween(next, source.plannedDate);
          source = {...source, plannedDate: next, deadline: source.deadline ? addDays(source.deadline, delta) : ''};
        }
        plannedDate = source.plannedDate;
        deadline = task.deadline ? addDays(task.deadline, daysBetween(plannedDate, task.plannedDate)) : '';
      }
      const subtasks = updateFutureSubtasks(occurrence.subtasks, fields.subtasks);
      Object.assign(occurrence, fields, {plannedDate, deadline, subtasks, updatedAt: task.updatedAt});
      occurrence.futureTemplate = template(occurrence);
    }
    previous = occurrence;
  }
}

export function recommendation(state, today = dateKey()) {
  const open = state.tasks.filter(task => !task.done && !task.archived);
  const rank = task => task.deadline && task.deadline < today ? 0 : task.deadline && task.deadline <= addDays(today, 7) && task.priority === 'high' ? 1 : task.plannedDate && task.plannedDate <= today ? 2 : 3;
  const priorities = {high: 0, normal: 1, low: 2};
  open.sort((a, b) => rank(a) - rank(b) || (priorities[a.priority] ?? 1) - (priorities[b.priority] ?? 1) || (a.deadline || '9999').localeCompare(b.deadline || '9999') || (a.start || '99').localeCompare(b.start || '99'));
  const task = open[0];
  if (!task) {
    const projects = state.projects.filter(project => !project.archived && !['completed', 'cancelled'].includes(project.status));
    projects.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    const project = projects[0];
    if (project) return {task: null, project, reason: project.deadline && project.deadline < today ? 'Срок активного проекта уже прошёл. Откройте проект и определите ближайшее действие.' : 'Для активного проекта пока нет открытых задач. Выберите ближайшее действие по проекту.'};
  }
  return task ? {task, reason: ['Обещанный срок уже прошёл. Лучше начать с этого обязательства.', 'Высокий приоритет и дедлайн в ближайшие 7 дней.', 'Задача уже включена в план дня.', 'Самая приоритетная из оставшихся задач.'][rank(task)]} : {task: null, reason: 'Добавьте первую задачу или выберите одно небольшое действие на сегодня.'};
}

export function revenue(state, month) {
  const projects = new Set(state.projects.map(project => project.id)), seen = new Set();
  let kopecks = 0;
  for (const payment of state.payments) {
    if (payment.status !== 'received' || !payment.projectId || !projects.has(payment.projectId) || !isDate(payment.receivedDate) || payment.receivedDate.slice(0, 7) !== month || !Number.isSafeInteger(payment.amountKopecks) || payment.amountKopecks < 0) continue;
    if (payment.id && seen.has(payment.id)) continue;
    if (payment.id) seen.add(payment.id);
    kopecks += payment.amountKopecks;
  }
  return kopecks / 100;
}

export const overlaps = (tasks, task) => !task.plannedDate || !isTime(task.start) || !isTime(task.end) || task.end <= task.start ? [] : tasks.filter(candidate => candidate.id !== task.id && !candidate.done && !candidate.archived && candidate.plannedDate === task.plannedDate && isTime(candidate.start) && isTime(candidate.end) && candidate.start < task.end && task.start < candidate.end);
