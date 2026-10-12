import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, saveTask, revenue, recommendation, toggleTask} from '../src/domain.js';
import {SERVICES, DEFAULT_STAGES, LEAD_STATUSES, PROJECT_STATUSES, saveClient, saveLead, saveProject, archiveEntity, convertLead, findClientDuplicates, scheduleLeadAction} from '../src/crm-domain.js';
import {LocalRepository, STORAGE_KEY, PRE_CRM_BACKUP_KEY, upgradeSnapshot} from '../src/store.js';

const setup = () => {
  const state = emptyState();
  const client = saveClient(state, {name: 'Эля', phone: '+7 (999) 123-45-67', email: 'ela@example.com'});
  return {state, client};
};
const newLead = (state, extra = {}) => saveLead(state, {name: 'Компания', contacts: {email: 'company@example.com', phone: '+7 (911) 123-45-67'}, service: 'landing', source: 'https://example.com', ...extra});
const newProject = (state, client, extra = {}) => saveProject(state, {title: 'Сайт компании', clientId: client.id, service: 'landing', ...extra});
const memoryStorage = () => {const map = new Map();return {getItem:key=>map.get(key) ?? null,setItem:(key,value)=>map.set(key,value),map};};
const legacyState = () => {const state = emptyState();delete state.clients;delete state.leads;return state;};
const unchangedAfter = (state, fn, pattern) => {const before=structuredClone(state);assert.throws(fn,pattern);assert.deepEqual(state,before);};

test('CRM starter choices exactly match approved services and ten-stage sequence', () => {
  assert.deepEqual(SERVICES.map(item=>item.id), ['landing','multipage','shop','design']);
  assert.deepEqual(DEFAULT_STAGES.map(stage=>stage.title), ['Первый контакт','Бриф','КП','Анализ','Прототип','Мудборд','Дизайн-концепции','Дизайн-макет','Верстка','Завершен']);
  assert.equal(new Set(DEFAULT_STAGES.map(stage=>stage.id)).size,10);
  assert.ok(LEAD_STATUSES.some(item=>item.id==='agreement'));
  assert.deepEqual(PROJECT_STATUSES.map(item=>item.id),['active','refused','postponed','no-response','revisions','completed']);
});

test('client saves trim fields, retain identity and history, and do not alias inputs', () => {
  const {state,client}=setup(),id=client.id,createdAt=client.createdAt;
  state.clients[0].unknown={retained:true};
  const project=newProject(state,client), input={id,name:' Новое имя ',email:'updated@example.com'};
  const saved=saveClient(state,input);input.name='caller mutation';
  assert.equal(saved.name,'Новое имя');assert.equal(saved.id,id);assert.equal(saved.createdAt,createdAt);assert.equal(saved.phone,client.phone);
  assert.equal(saved.revision,2);assert.ok(saved.updatedAt);assert.deepEqual(saved.unknown,{retained:true});assert.equal(state.projects.find(item=>item.id===project.id).clientName,saved.name);assert.equal(state.projects.find(item=>item.id===project.id).revision,2);
});

test('one client supports several independent projects without duplicate contacts', () => {
  const {state,client}=setup();newProject(state,client);newProject(state,client,{title:'Магазин',service:'shop'});
  assert.equal(state.clients.length,1);assert.equal(state.projects.length,2);assert.ok(state.projects.every(project=>project.clientId===client.id));
  state.projects[0].stages[0].title='Личный этап';assert.equal(state.projects[1].stages[0].title,'Первый контакт');assert.equal(DEFAULT_STAGES[0].title,'Первый контакт');
});

test('duplicate candidates use normalized email or phone including archived clients, never names', () => {
  const {state,client}=setup();saveClient(state,{name:client.name,email:'other@example.com'});
  assert.deepEqual(findClientDuplicates(state,{email:'  ELA@EXAMPLE.COM '}).map(item=>item.id),[client.id]);
  assert.deepEqual(findClientDuplicates(state,{contacts:{phone:'8 999 1234567'}}).map(item=>item.id),[client.id]);
  assert.equal(findClientDuplicates(state,{name:client.name}).length,0);assert.equal(findClientDuplicates(state,{email:client.email,id:client.id}).length,0);
  archiveEntity(state,'client',client.id);assert.equal(findClientDuplicates(state,{phone:client.phone})[0].archived,true);
});

test('contact validation rejects malformed data and unsafe URLs without mutations', () => {
  const {state,client}=setup();
  for (const input of [{name:''},{name:'a'.repeat(301)},{email:'ela@@example.com'},{phone:'letters'},{website:'javascript:alert(1)'},{website:'https://user:password@example.com'},{website:'//example.com'},{messenger:'data:text/html,test'},{name:'broken\nname'}]) {
    unchangedAfter(state,()=>saveClient(state,{id:client.id,...input}));
  }
  const safe=saveClient(state,{name:'Новый',messenger:'@telegram',website:'https://example.com/path?a=1'});assert.equal(safe.messenger,'@telegram');
});

test('lead saves preserve contact fields, creation timestamp and validate dates and links', () => {
  const state=emptyState(),lead=newLead(state);const original=structuredClone(lead);
  saveLead(state,{id:lead.id,name:'Другое имя',company:'Компания Эли',contacts:{messenger:'@ela'}});
  assert.equal(state.leads[0].contacts.email,original.contacts.email);assert.equal(state.leads[0].createdAt,original.createdAt);assert.equal(state.leads[0].revision,2);assert.equal(state.leads[0].company,'Компания Эли');
  for(const input of [{nextActionDate:'2026-02-29'},{nextActionDate:'0000-01-01'},{source:'file:///tmp/private'},{status:'unknown'},{service:'tilda'},{taskId:'missing'},{status:'converted'}]) unchangedAfter(state,()=>saveLead(state,{id:lead.id,...input}));
});

test('project stage rename, reorder, addition and skip preserve stable current stage identity', () => {
  const {state,client}=setup();const project=newProject(state,client,{stageId:'layout',status:'revisions'});const original=structuredClone(project);
  const stages=project.stages.filter(stage=>stage.id!=='analysis').map(stage=>({...stage,title:stage.id==='layout'?'Финальный макет':stage.title})).reverse();stages.splice(2,0,{title:'Дополнительный этап'});
  const saved=saveProject(state,{id:project.id,stages});stages[0].title='Caller';
  assert.equal(saved.stageId,'layout');assert.equal(saved.stage,'Финальный макет');assert.equal(saved.status,'revisions');assert.equal(saved.createdAt,original.createdAt);assert.equal(saved.revision,2);
  assert.equal(saved.stages.length,10);assert.ok(saved.stages.find(stage=>stage.title==='Дополнительный этап').id);
  saveProject(state,{id:project.id,stageId:'build'});assert.equal(state.projects[0].stageId,'build');assert.equal(state.projects[0].status,'revisions');
});

test('removing current stage needs an explicit valid replacement and is atomic', () => {
  const {state,client}=setup();const project=newProject(state,client,{stageId:'layout'});const stages=project.stages.filter(stage=>stage.id!=='layout');
  unchangedAfter(state,()=>saveProject(state,{id:project.id,stages}),/Текущий этап/);
  unchangedAfter(state,()=>saveProject(state,{id:project.id,stages,stageId:'missing'}),/этап/);
  saveProject(state,{id:project.id,stages,stageId:'build'});assert.equal(state.projects[0].stageId,'build');
});

test('project exceptional states preserve actual stage, dates and related data', () => {
  const {state,client}=setup();let project=newProject(state,client,{stageId:'layout',deadline:'2026-11-01'});project.estimate={version:3,amount:123};
  for(const status of ['refused','postponed','no-response','revisions']) {
    project=saveProject(state,{id:project.id,status,returnDate:'2026-12-01'});assert.equal(project.stageId,'layout');assert.equal(project.deadline,'2026-11-01');assert.deepEqual(project.estimate,{version:3,amount:123});
  }
  project=saveProject(state,{id:project.id,status:'completed'});assert.equal(project.stageId,'layout');assert.equal(project.status,'completed');
});

test('completed stage agrees with Home completion without tying money to status', () => {
  const {state,client}=setup();const project=newProject(state,client,{stageId:'completed'});
  assert.equal(project.status,'completed');assert.equal(recommendation(state).project,undefined);assert.equal(revenue(state,'2026-10'),0);assert.deepEqual(state.payments,[]);
});

test('project validation rejects duplicate stages, missing clients, invalid services and dates', () => {
  const {state,client}=setup();newProject(state,client);
  for(const input of [{clientId:'missing'},{clientId:''},{service:'tilda'},{deadline:'2026-04-31'},{returnDate:'nope'},{stages:[]},{stages:[{id:'a',title:'A'},{id:'a',title:'B'}]},{stageId:'missing'},{status:'wrong'}]) unchangedAfter(state,()=>newProject(state,client,input));
});

test('legacy project editing keeps an existing display stage instead of resetting to contact', () => {
  const {state,client}=setup();state.projects.push({id:'legacy',title:'Старый',stage:'Особый процесс',status:'active',unknown:{amount:5}});
  const saved=saveProject(state,{id:'legacy',clientId:client.id,service:'design'});assert.equal(saved.stage,'Особый процесс');assert.equal(saved.stages.find(stage=>stage.id===saved.stageId).title,'Особый процесс');assert.deepEqual(saved.unknown,{amount:5});
});

test('conversion transfers known contacts/service, progress, backlinks and is idempotent', () => {
  const state=emptyState(),lead=newLead(state,{status:'agreement'});const task=scheduleLeadAction(state,lead.id,{title:'Проверить КП',date:'2026-10-20'});
  const project=convertLead(state,lead.id,{project:{title:'Согласованный сайт'}});const snapshot=structuredClone(state);
  assert.equal(state.clients.length,1);assert.equal(state.clients[0].email,lead.contacts.email);assert.equal(project.service,lead.service);assert.equal(project.stageId,'proposal');
  assert.equal(project.leadId,lead.id);assert.equal(state.leads[0].projectId,project.id);assert.equal(state.leads[0].clientId,project.clientId);assert.equal(state.leads[0].status,'converted');assert.equal(state.tasks[0].id,task.id);assert.equal(state.tasks[0].projectId,project.id);
  const repeat=convertLead(state,lead.id,{client:{name:'Ignored'},project:{title:'Ignored'}});assert.equal(repeat.id,project.id);assert.deepEqual(state,snapshot);
});

test('conversion uses explicitly selected client without changing their existing projects or contacts', () => {
  const {state,client}=setup();const existing=newProject(state,client),lead=newLead(state,{status:'discussion'}),oldProject=structuredClone(existing),oldClient=structuredClone(client);
  const result=convertLead(state,lead.id,{clientId:client.id,project:{title:'Другой проект',service:'design',stageId:'concepts'}});
  assert.equal(state.clients.length,1);assert.equal(state.projects.length,2);assert.deepEqual(state.projects.find(project=>project.id===existing.id),oldProject);assert.deepEqual(state.clients[0],oldClient);assert.equal(result.stageId,'concepts');assert.equal(result.service,'design');
});

test('duplicate conversion needs a deliberate existing/new client choice, never automatic merging', () => {
  const {state,client}=setup();const lead=newLead(state,{contacts:{email:client.email}});
  unchangedAfter(state,()=>convertLead(state,lead.id,{project:{title:'Проект'}}),/Выберите/);
  convertLead(state,lead.id,{client:{name:'Отдельная организация'},project:{title:'Проект'}});assert.equal(state.clients.length,2);assert.notEqual(state.leads[0].clientId,client.id);
});

test('conversion rolls back tentative client creation on any invalid project or choice', () => {
  const state=emptyState(),lead=newLead(state);
  for(const options of [{project:{title:''}},{project:{title:'Project',service:'tilda'}},{project:{title:'Project',stageId:'missing'}},{clientId:'missing',project:{title:'Project'}},{clientId:'x',client:{name:'Y'},project:{title:'Project'}},{client:{id:'existing'},project:{title:'Project'}},{project:{id:'existing',title:'Project'}}]) unchangedAfter(state,()=>convertLead(state,lead.id,options));
});

test('conversion retains missing-project backlinks and refuses to create duplicates after corruption', () => {
  const state=emptyState(),lead=newLead(state);lead.projectId='missing';unchangedAfter(state,()=>convertLead(state,lead.id,{project:{title:'New'}}),/Связанный проект/);
});

test('agreement, conversion, archiving and reopening never create or reinterpret money', () => {
  const {state,client}=setup();const project=newProject(state,client);state.payments=[{id:'real',projectId:project.id,status:'received',receivedDate:'2026-10-01',amountKopecks:10000}];state.expenses=[{id:'expense',amountKopecks:100}];
  const payments=structuredClone(state.payments),expenses=structuredClone(state.expenses),lead=newLead(state,{status:'agreement'});
  convertLead(state,lead.id,{clientId:client.id,project:{title:'New'}});archiveEntity(state,'client',client.id);archiveEntity(state,'project',project.id);archiveEntity(state,'project',project.id,false);
  assert.deepEqual(state.payments,payments);assert.deepEqual(state.expenses,expenses);assert.equal(revenue(state,'2026-10'),100);
});

test('archive and restore preserve every linked record and are repeatable', () => {
  const {state,client}=setup();const lead=newLead(state),project=convertLead(state,lead.id,{clientId:client.id,project:{title:'New'}});const task=scheduleLeadAction(state,lead.id,{date:'2026-10-20'});
  for(const [kind,id] of [['client',client.id],['lead',lead.id],['project',project.id]]) {archiveEntity(state,kind,id);const snapshot=structuredClone(state);archiveEntity(state,kind,id);assert.deepEqual(state,snapshot);archiveEntity(state,kind,id,false);}
  assert.equal(state.clients.length,1);assert.equal(state.leads.length,1);assert.equal(state.projects.length,1);assert.equal(state.tasks[0].id,task.id);assert.equal(state.leads[0].projectId,project.id);
});

test('next action creates one task, repeated planning updates it and keeps independent fields', () => {
  const state=emptyState(),lead=newLead(state);const first=scheduleLeadAction(state,lead.id,{title:'Звонок',date:'2026-10-20',start:'10:00',end:'11:00'});first.deadline='2026-11-01';first.priority='high';first.subtasks=[{id:'sub',title:'Шаг',done:true}];
  const next=scheduleLeadAction(state,lead.id,{title:'Уточнить бриф',date:'2026-10-21'});assert.equal(state.tasks.length,1);assert.equal(next.id,first.id);assert.equal(next.createdAt,first.createdAt);assert.equal(next.plannedDate,'2026-10-21');assert.equal(next.start,'');assert.equal(next.deadline,'2026-11-01');assert.equal(next.priority,'high');assert.equal(next.subtasks[0].done,true);assert.equal(state.leads[0].nextActionDate,next.plannedDate);
  assert.equal(recommendation(state,'2026-10-21').task.id,next.id);
});

test('planning a later action preserves completed and archived task history', () => {
  for (const closed of ['done','archived']) {
    const state=emptyState(),lead=newLead(state),first=scheduleLeadAction(state,lead.id,{date:'2026-10-20'});first[closed]=true;const history=structuredClone(first);
    const next=scheduleLeadAction(state,lead.id,{date:'2026-10-21'});assert.notEqual(next.id,first.id);assert.deepEqual(state.tasks.find(task=>task.id===first.id),history);assert.equal(next.done,false);assert.equal(next.archived,false);
    scheduleLeadAction(state,lead.id,{date:'2026-10-22'});assert.equal(state.tasks.length,2);
  }
});

test('next-action validation fails atomically and replacement of deleted task remains idempotent', () => {
  const state=emptyState(),lead=newLead(state);
  for(const input of [{date:''},{date:'2026-02-29'},{date:'2026-10-20',start:'10:00'},{date:'2026-10-20',start:'11:00',end:'10:00'},{date:'2026-10-20',title:' '}]) unchangedAfter(state,()=>scheduleLeadAction(state,lead.id,input));
  const task=scheduleLeadAction(state,lead.id,{date:'2026-10-20'});state.tasks=[];const replacement=scheduleLeadAction(state,lead.id,{date:'2026-10-20'});assert.notEqual(task.id,replacement.id);scheduleLeadAction(state,lead.id,{date:'2026-10-20'});assert.equal(state.tasks.length,1);
});

test('recommendation ignores stopped projects and retains actionable revision work', () => {
  const {state,client}=setup();for(const status of ['refused','postponed','no-response','completed']) newProject(state,client,{status});assert.equal(recommendation(state).project,undefined);
  const project=newProject(state,client,{status:'revisions'});assert.equal(recommendation(state).project.id,project.id);
});

test('legacy schema1 upgrade is additive, immutable and never reinterprets historical records', () => {
  const old=legacyState();old.revision=7;old.unknown={nested:['preserve']};old.projects=[{id:'p',title:'Старый',stage:'Что-то особое',status:'paused',clientName:'Старое имя',amountKopecks:100}];old.payments=[{id:'paid',projectId:'p',amountKopecks:100,status:'received',receivedDate:'2026-10-01'}];
  saveTask(old,{id:'task',title:'История',done:true,projectId:'p'});const before=structuredClone(old),upgraded=upgradeSnapshot(old);
  assert.deepEqual(old,before);assert.deepEqual(upgraded,{...before,clients:[],leads:[]});upgraded.unknown.nested.push('caller');assert.deepEqual(old.unknown,before.unknown);
});

test('repository loads legacy snapshot without a write and backs up exact original bytes before save', async () => {
  const storage=memoryStorage(),old=legacyState();old.projects=[{id:'old',stage:'Custom',unknown:42}];const raw=JSON.stringify(old,null,2);storage.setItem(STORAGE_KEY,raw);
  const repository=new LocalRepository(storage),loaded=await repository.load();assert.equal(storage.map.size,1);assert.equal(storage.getItem(STORAGE_KEY),raw);assert.deepEqual(loaded.clients,[]);assert.deepEqual(loaded.leads,[]);
  saveClient(loaded,{name:'New'});const saved=await repository.save(loaded);assert.equal(storage.getItem(PRE_CRM_BACKUP_KEY),raw);assert.equal(saved.revision,1);assert.deepEqual(saved.projects,old.projects);
  saved.settings.goal=200000;await repository.save(saved);assert.equal(storage.getItem(PRE_CRM_BACKUP_KEY),raw);const reloaded=await new LocalRepository(storage).load();assert.equal(reloaded.clients[0].name,'New');
});

test('existing pre-CRM backup is retained rather than silently replaced', async () => {
  const storage=memoryStorage();storage.setItem(PRE_CRM_BACKUP_KEY,'original backup');storage.setItem(STORAGE_KEY,JSON.stringify(legacyState()));const repository=new LocalRepository(storage);await repository.save(await repository.load());assert.equal(storage.getItem(PRE_CRM_BACKUP_KEY),'original backup');
});

test('backup quota failure or unacknowledged backup blocks primary write and remains retryable', async () => {
  for(const mode of ['throw','drop']) {
    const storage=memoryStorage(),raw=JSON.stringify(legacyState());storage.setItem(STORAGE_KEY,raw);const write=storage.setItem;let fail=true;
    storage.setItem=(key,value)=>{if(key===PRE_CRM_BACKUP_KEY&&fail){if(mode==='throw')throw Error('quota');return;}write(key,value);};
    const repository=new LocalRepository(storage),loaded=await repository.load();await assert.rejects(()=>repository.save(loaded),/резервную копию/);assert.equal(storage.getItem(STORAGE_KEY),raw);assert.equal(repository.revision,0);fail=false;await repository.save(loaded);assert.equal(repository.revision,1);assert.equal(storage.getItem(PRE_CRM_BACKUP_KEY),raw);
  }
});

test('primary quota failure after backup keeps both original snapshot and backup', async () => {
  const storage=memoryStorage(),raw=JSON.stringify(legacyState());storage.setItem(STORAGE_KEY,raw);const write=storage.setItem;let fail=true;storage.setItem=(key,value)=>{if(key===STORAGE_KEY&&fail)throw Error('quota');write(key,value);};
  const repository=new LocalRepository(storage),state=await repository.load();await assert.rejects(()=>repository.save(state),/Не удалось сохранить/);assert.equal(storage.getItem(STORAGE_KEY),raw);assert.equal(storage.getItem(PRE_CRM_BACKUP_KEY),raw);assert.equal(repository.revision,0);fail=false;await repository.save(state);assert.equal(repository.revision,1);
});

test('stale upgraded snapshot fails before creating a backup or overwriting other-tab data', async () => {
  const storage=memoryStorage(),raw=JSON.stringify(legacyState());storage.setItem(STORAGE_KEY,raw);const repository=new LocalRepository(storage),state=await repository.load();const changed=JSON.stringify({...legacyState(),revision:1});storage.setItem(STORAGE_KEY,changed);
  await assert.rejects(()=>repository.save(state),/другой вкладке/);assert.equal(storage.getItem(STORAGE_KEY),changed);assert.equal(storage.getItem(PRE_CRM_BACKUP_KEY),null);
});

test('malformed CRM snapshots are preserved and rejected rather than reset to empty arrays', async () => {
  for(const input of [{clients:null},{leads:{}},{clients:[{id:'x',name:''}]},{leads:[{id:'x',name:'X',status:'oops'}]},{clients:[{id:'x',name:'X',website:'javascript:alert(1)'}]},{projects:[{id:'p',stages:[],stageId:'missing'}]}]) {
    const storage=memoryStorage(),raw=JSON.stringify({...emptyState(),...input});storage.setItem(STORAGE_KEY,raw);const repository=new LocalRepository(storage);await assert.rejects(()=>repository.load(),/Формат/);await assert.rejects(()=>repository.save(emptyState()),/загрузить/);assert.equal(storage.getItem(STORAGE_KEY),raw);assert.equal(storage.map.size,1);
  }
});

test('persisting valid CRM records reloads all links and monetary history unchanged', async () => {
  const storage=memoryStorage(),repository=new LocalRepository(storage),state=await repository.load();const lead=newLead(state),project=convertLead(state,lead.id,{project:{title:'New'}});scheduleLeadAction(state,lead.id,{date:'2026-10-20'});state.payments=[{id:'real',projectId:project.id,status:'received',receivedDate:'2026-10-01',amountKopecks:32100}];
  const saved=await repository.save(state),loaded=await new LocalRepository(storage).load();assert.deepEqual(loaded,saved);assert.equal(revenue(loaded,'2026-10'),321);assert.equal(storage.getItem(PRE_CRM_BACKUP_KEY),null);
});


test('conversion keeps recurring next actions linked to the resulting project', () => {
  const state=emptyState(),lead=newLead(state);const task=scheduleLeadAction(state,lead.id,{date:'2026-10-20'});
  saveTask(state,{id:task.id,repeat:{frequency:'daily',interval:1,weekdays:[]}},'future');
  const project=convertLead(state,lead.id,{project:{title:'Новый сайт'}});toggleTask(state,task.id);
  assert.equal(state.tasks.length,2);assert.ok(state.tasks.every(item=>item.projectId===project.id));
  assert.equal(state.tasks[1].plannedDate,'2026-10-21');
});


test('malformed supplied field types report human validation errors without writes', () => {
  const {state,client}=setup();const lead=newLead(state);
  for(const input of [{name:null},{email:null},{phone:12},{messenger:[]},{website:{}}]) unchangedAfter(state,()=>saveClient(state,{id:client.id,...input}),/Проверьте/);
  for(const input of [{contacts:null},{company:42},{nextActionDate:false},{service:null}]) unchangedAfter(state,()=>saveLead(state,{id:lead.id,...input}),/Проверьте/);
  unchangedAfter(state,()=>newProject(state,client,{stageId:null}),/Проверьте/);
  unchangedAfter(state,()=>convertLead(state,lead.id,{project:{title:'New',stages:'broken'}}),/этапов/);
  unchangedAfter(state,()=>archiveEntity(state,'toString',client.id),/Выберите/);
});

test('editing a lead after its task was deleted preserves the historical link until rescheduled', () => {
  const state=emptyState(),lead=newLead(state),task=scheduleLeadAction(state,lead.id,{date:'2026-10-20'});state.tasks=[];
  const saved=saveLead(state,{id:lead.id,name:'Updated'});assert.equal(saved.taskId,task.id);
  const replacement=scheduleLeadAction(state,lead.id,{date:'2026-10-21'});assert.notEqual(replacement.id,task.id);assert.equal(state.tasks.length,1);
});
