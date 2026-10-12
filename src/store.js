import {emptyState, validateTask} from './domain.js';
import {validateClient, validateLead, validateProject} from './crm-domain.js';
export const STORAGE_KEY = 'workhub.stage1.v1';
export const PRE_CRM_BACKUP_KEY = `${STORAGE_KEY}.before-crm`;
const conflict = () => Error('Данные изменились в другой вкладке. Закройте форму и обновите страницу перед повтором.');
const malformed = () => Error('Формат локальных данных не поддерживается. Данные не изменены.');
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);

function validateSnapshot(state) {
  if (!object(state) || state.schema !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.tasks) || !Array.isArray(state.projects) || !Array.isArray(state.payments) || !object(state.settings)) throw malformed();
  if (!['light', 'dark', 'system'].includes(state.settings.theme) || !['black', 'wine', 'green'].includes(state.settings.accent) || !Number.isInteger(state.settings.goal) || state.settings.goal < 1 || state.settings.goal > 1e9) throw malformed();
  for (const key of ['clients', 'leads']) if (state[key] !== undefined && !Array.isArray(state[key])) throw malformed();
  for (const collection of [state.tasks, state.projects, state.payments, state.clients || [], state.leads || []]) {
    const ids = new Set();
    for (const record of collection) {
      if (!object(record) || typeof record.id !== 'string' || !record.id || ids.has(record.id)) throw malformed();
      ids.add(record.id);
    }
  }
  const validSubtasks = subtasks => Array.isArray(subtasks) && subtasks.every(subtask => object(subtask) && typeof subtask.id === 'string' && !!subtask.id && typeof subtask.done === 'boolean');
  for (const task of state.tasks) {
    if (!validSubtasks(task.subtasks) || !object(task.repeat) || typeof task.done !== 'boolean' || (task.archived !== undefined && typeof task.archived !== 'boolean') || typeof task.description !== 'string' || typeof task.projectId !== 'string' || !['low', 'normal', 'high'].includes(task.priority)) throw malformed();
    if (task.futureTemplate !== undefined && (!object(task.futureTemplate) || !validSubtasks(task.futureTemplate.subtasks))) throw malformed();
    try {
      validateTask(task);
      if (task.futureTemplate) validateTask({...task, ...task.futureTemplate});
    } catch { throw malformed(); }
  }
  try {
    for (const client of state.clients || []) validateClient(client);
    for (const lead of state.leads || []) validateLead(lead);
    for (const project of state.projects) {
      if (project.stages !== undefined || project.stageId !== undefined) validateProject(project);
    }
  } catch { throw malformed(); }
  return state;
}

// Add only absent collections. Do not reinterpret legacy project stages,
// invent clients from display names, or discard fields unknown to this build.
export function upgradeSnapshot(snapshot) {
  const state = validateSnapshot(structuredClone(snapshot));
  if (state.clients === undefined) state.clients = [];
  if (state.leads === undefined) state.leads = [];
  return state;
}

// Replace this adapter with a server repository in the synchronization stage.
// Web Locks serialize the check/write transaction across cooperating tabs.
// Callers adopt only acknowledged snapshots; a conflict never overwrites data.
export class LocalRepository {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.raw = null;
    this.ready = false;
    this.revision = null;
    this.needsBackup = false;
    this.locks = globalThis.navigator?.locks;
    this.browserStorage = typeof window !== 'undefined' && storage === globalThis.localStorage;
  }

  async load() {
    this.ready = false;
    this.needsBackup = false;
    let raw;
    try { raw = this.storage.getItem(STORAGE_KEY); }
    catch { throw Error('Не удалось прочитать локальные данные. Проверьте доступ к хранилищу браузера.'); }
    let state = emptyState();
    if (raw !== null) {
      try { state = JSON.parse(raw); }
      catch { throw Error('Сохранённые данные повреждены. Они не перезаписаны. Сохраните резервную копию перед восстановлением.'); }
      validateSnapshot(state);
      this.needsBackup = state.clients === undefined || state.leads === undefined;
      state = upgradeSnapshot(state);
    }
    this.raw = raw;
    this.revision = state.revision;
    this.ready = true;
    return state;
  }

  async save(state) {
    if (!this.ready) throw Error('Не удалось загрузить данные. Сохранение заблокировано, чтобы не потерять прежние записи.');
    const expectedRaw = this.raw, expectedRevision = this.revision;
    const next = upgradeSnapshot(state);
    if (next.revision !== expectedRevision) throw conflict();
    if (next.revision === Number.MAX_SAFE_INTEGER) throw malformed();
    next.revision++;
    const raw = JSON.stringify(next);
    const write = () => {
      let current;
      try { current = this.storage.getItem(STORAGE_KEY); }
      catch { throw Error('Не удалось прочитать локальные данные перед сохранением. Введённые данные остаются в форме.'); }
      if (current !== expectedRaw) throw conflict();
      // Preserve the first pre-CRM snapshot under its own key. An existing
      // backup is never overwritten. If storage cannot acknowledge a backup,
      // do not touch the primary snapshot; the original remains retryable.
      if (this.needsBackup && expectedRaw !== null) {
        try {
          if (this.storage.getItem(PRE_CRM_BACKUP_KEY) === null) {
            this.storage.setItem(PRE_CRM_BACKUP_KEY, expectedRaw);
            if (this.storage.getItem(PRE_CRM_BACKUP_KEY) !== expectedRaw) throw Error('Копия не подтверждена');
          }
        } catch { throw Error('Не удалось сохранить резервную копию перед обновлением: хранилище недоступно или заполнено. Исходные данные не изменены. Экспортируйте данные и освободите место.'); }
      }
      try {
        this.storage.setItem(STORAGE_KEY, raw);
        if (this.storage.getItem(STORAGE_KEY) !== raw) throw Error('Запись не подтверждена');
      } catch { throw Error('Не удалось сохранить: хранилище недоступно или заполнено. Введённые данные остаются в форме.'); }
      this.needsBackup = false;
      this.raw = raw;
      this.revision = next.revision;
      return next;
    };
    if (this.locks?.request) return this.locks.request(STORAGE_KEY, {mode: 'exclusive'}, async () => write());
    // An in-memory adapter can be used in non-browser tests. Browser writes
    // require a real cross-tab lock instead of a misleading best-effort lease.
    if (this.browserStorage) throw Error('Для безопасного сохранения откройте WorkHub по HTTPS в современном браузере. Этот браузер не поддерживает защиту от одновременной записи.');
    return write();
  }
}
