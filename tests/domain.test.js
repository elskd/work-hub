import test from 'node:test';import assert from 'node:assert/strict';
import {emptyState,addDays,nextDate,toggleTask,validateTask,revenue,recommendation,saveTask,overlaps} from '../src/domain.js';
import {LocalRepository,STORAGE_KEY} from '../src/store.js';
const task=(extra={})=>({id:'one',title:'Тест',description:'',priority:'normal',plannedDate:'2026-01-31',deadline:'2026-02-02',start:'',end:'',projectId:'',repeat:{frequency:'monthly',interval:1,anchorDay:31,weekdays:[]},subtasks:[],done:false,...extra});
test('month end clamps and restores anchor, leap year',()=>{assert.equal(nextDate('2026-01-31',task().repeat),'2026-02-28');assert.equal(nextDate('2026-02-28',task().repeat),'2026-03-31');assert.equal(nextDate('2028-01-31',task().repeat),'2028-02-29')});
test('weekly days and interval',()=>{const r={frequency:'weekly',interval:2,weekdays:[1,3]};assert.equal(nextDate('2026-10-12',r),'2026-10-14');assert.equal(nextDate('2026-10-14',r),'2026-10-26')});
test('completion, reopen, complete never duplicates next occurrence',()=>{const s=emptyState();saveTask(s,task());toggleTask(s,'one');assert.equal(s.tasks.length,2);assert.equal(s.tasks[1].plannedDate,'2026-02-28');toggleTask(s,'one');toggleTask(s,'one');assert.equal(s.tasks.length,2)});
test('one occurrence edit preserves future title, future edit updates series',()=>{const s=emptyState();saveTask(s,task());saveTask(s,task({title:'Только раз'}),'one');toggleTask(s,'one');assert.equal(s.tasks[1].title,'Тест');saveTask(s,{...s.tasks[0],title:'Вся серия'},'future');assert.equal(s.tasks[1].title,'Вся серия')});
test('time validation and independent planning',()=>{assert.throws(()=>validateTask(task({title:' '})));assert.throws(()=>validateTask(task({start:'12:00',end:'11:00'})));assert.throws(()=>validateTask(task({repeat:{frequency:'daily',interval:0}})));const t=task({plannedDate:'2026-05-01'});validateTask(t);assert.equal(t.deadline,'2026-02-02');assert.equal(overlaps([task({id:'two',start:'10:00',end:'12:00'})],task({start:'11:00',end:'13:00'})).length,1)});
test('revenue uses received project payments by receipt month once',()=>{const s=emptyState();s.projects=[{id:'p'}];s.payments=[{projectId:'p',status:'received',receivedDate:'2026-10-01',amountKopecks:6000000},{projectId:'p',status:'received',receivedDate:'2026-10-10',amountKopecks:9000000},{projectId:'p',status:'expected',receivedDate:'2026-10-10',amountKopecks:500000},{projectId:'p',status:'received',receivedDate:'2026-09-10',amountKopecks:100000}];assert.equal(revenue(s,'2026-10'),150000)});
test('recommendation puts overdue obligations first',()=>{const s=emptyState();s.tasks=[task({id:'future',deadline:'2026-12-01',priority:'high'}),task({id:'late',deadline:'2026-10-01',priority:'low'})];assert.equal(recommendation(s,'2026-10-12').task.id,'late')});
test('repository survives reload, blocks stale writes and preserves corrupt bytes',async()=>{let raw=null;const storage={getItem:()=>raw,setItem:(_,v)=>raw=v};const a=new LocalRepository(storage),s=await a.load();s.tasks.push(task());await a.save(s);const b=new LocalRepository(storage);const loaded=await b.load();assert.equal(loaded.tasks.length,1);await b.save(loaded);await assert.rejects(()=>a.save(s),/другой вкладке/);raw='{bad';await assert.rejects(()=>new LocalRepository(storage).load(),/повреждены/);assert.equal(raw,'{bad')});
test('failed persistence does not acknowledge data',async()=>{const r=new LocalRepository({getItem:()=>null,setItem:()=>{throw Error('quota')}});await r.load();await assert.rejects(()=>r.save(emptyState()),/Не удалось сохранить/)});

test('daily intervals cross leap days and years without changing a deadline',()=>{
 assert.equal(nextDate('2028-02-28',{frequency:'daily',interval:2}),'2028-03-01');
 assert.equal(nextDate('2026-12-31',{frequency:'daily',interval:1}),'2027-01-01');
 const s=emptyState();saveTask(s,task());const edited={...s.tasks[0],plannedDate:'2026-02-04'};saveTask(s,edited);assert.equal(s.tasks[0].deadline,'2026-02-02');
});

test('weekly intervals honor selected weekdays, Sunday and year boundaries',()=>{
 assert.equal(nextDate('2026-10-18',{frequency:'weekly',interval:3,weekdays:[]}),'2026-11-08');
 const repeat={frequency:'weekly',interval:2,weekdays:[1,5]};
 assert.equal(nextDate('2026-12-31',repeat),'2027-01-01');
 assert.equal(nextDate('2027-01-01',repeat),'2027-01-11');
 assert.equal(nextDate('2026-10-12',{frequency:'weekly',interval:1,weekdays:[0]}),'2026-10-18');
});

test('all month-end anchors recover after short months and respect intervals',()=>{
 for(const anchorDay of [29,30,31]){const r={frequency:'monthly',interval:1,anchorDay};assert.equal(nextDate(`2026-01-${anchorDay}`,r),'2026-02-28');assert.equal(nextDate('2026-02-28',r),`2026-03-${anchorDay}`)}
 assert.equal(nextDate('2026-12-31',{frequency:'monthly',interval:2,anchorDay:31}),'2027-02-28');
 const s=emptyState();saveTask(s,task({repeat:{frequency:'monthly',interval:1}}));toggleTask(s,'one');toggleTask(s,s.tasks[1].id);assert.equal(s.tasks[2].plannedDate,'2026-03-31');
});

test('enabling repetition on an existing standalone task creates its series',()=>{
 const s=emptyState();saveTask(s,task({repeat:{frequency:'none',interval:1,weekdays:[]}}));saveTask(s,{...s.tasks[0],repeat:{frequency:'daily',interval:2,weekdays:[]}});toggleTask(s,'one');assert.equal(s.tasks.length,2);assert.equal(s.tasks[1].plannedDate,'2026-02-02');
});

test('one-occurrence edits preserve canonical dates, deadline, project and repeat',()=>{
 const s=emptyState();s.projects=[{id:'original'},{id:'other'}];saveTask(s,task({projectId:'original',start:'10:00',end:'11:00',subtasks:[{id:'sub',title:'Original step',done:false}]}));
 saveTask(s,{...s.tasks[0],title:'One-off title',projectId:'other',plannedDate:'2026-02-03',deadline:'2026-03-01',start:'14:00',end:'15:00',repeat:{frequency:'daily',interval:7,weekdays:[]},subtasks:[{id:'sub',title:'One-off step',done:true}]},'one');
 toggleTask(s,'one');const next=s.tasks[1];assert.equal(next.title,'Тест');assert.equal(next.projectId,'original');assert.equal(next.plannedDate,'2026-02-28');assert.equal(next.deadline,'2026-03-02');assert.equal(next.repeat.frequency,'monthly');assert.equal(next.start,'10:00');assert.equal(next.subtasks[0].title,'Original step');assert.equal(next.subtasks[0].done,false);
 toggleTask(s,next.id);assert.equal(s.tasks[2].plannedDate,'2026-03-31');assert.equal(s.tasks[2].deadline,'2026-04-02');
});

test('a single occurrence can lose its own schedule while its future series continues',()=>{
 const s=emptyState();saveTask(s,task());saveTask(s,{...s.tasks[0],plannedDate:'',deadline:'',repeat:{frequency:'none',interval:1,weekdays:[]}},'one');toggleTask(s,'one');assert.equal(s.tasks[1].plannedDate,'2026-02-28');assert.equal(s.tasks[1].deadline,'2026-03-02');
});

test('deleting a generated occurrence does not resurrect it on re-completion',()=>{
 const s=emptyState();saveTask(s,task());toggleTask(s,'one');const deleted=s.tasks[1].id;s.tasks=s.tasks.filter(t=>t.id!==deleted);toggleTask(s,'one');toggleTask(s,'one');assert.equal(s.tasks.length,1);assert.equal(s.tasks[0].nextId,deleted);
});

test('existing successors are reused when a next link was omitted',()=>{
 const s=emptyState();saveTask(s,task());toggleTask(s,'one');const next=s.tasks[1].id;s.tasks[0].nextId=null;toggleTask(s,'one');toggleTask(s,'one');assert.equal(s.tasks.length,2);assert.equal(s.tasks[0].nextId,next);
});

test('future-series edits cross deleted positions without regenerating them',()=>{
 const s=emptyState();saveTask(s,task({repeat:{frequency:'daily',interval:1,weekdays:[]}}));toggleTask(s,'one');toggleTask(s,s.tasks[1].id);const deleted=s.tasks[1].id,last=s.tasks[2].id;s.tasks=s.tasks.filter(t=>t.id!==deleted);
 saveTask(s,{...s.tasks[0],title:'Updated series'},'future');const later=s.tasks.find(t=>t.id===last);assert.equal(later.title,'Updated series');assert.equal(later.plannedDate,'2026-02-02');assert.equal(s.tasks.length,2);assert.equal(s.tasks[0].nextId,deleted);
});

test('future-series edits preserve completed history but update later deadlines',()=>{
 const s=emptyState();saveTask(s,task());toggleTask(s,'one');toggleTask(s,s.tasks[1].id);const history=structuredClone(s.tasks[1]);saveTask(s,{...s.tasks[0],title:'Updated series',deadline:'2026-02-05'},'future');assert.deepEqual(s.tasks[1],history);assert.equal(s.tasks[2].title,'Updated series');assert.equal(s.tasks[2].deadline,'2026-04-05');
});

test('future-series subtasks retain future progress with unique instance IDs',()=>{
 const s=emptyState();saveTask(s,task({subtasks:[{id:'a',title:'First',done:false},{id:'b',title:'Second',done:false}]}));toggleTask(s,'one');const next=s.tasks[1];next.subtasks[0].done=true;const firstId=next.subtasks[0].id;assert.notEqual(firstId,'a');
 saveTask(s,{...s.tasks[0],subtasks:[{id:'a',title:'Renamed',done:false},{id:'c',title:'New',done:true}]},'future');assert.equal(next.subtasks[0].id,firstId);assert.equal(next.subtasks[0].done,true);assert.equal(next.subtasks[0].title,'Renamed');assert.equal(next.subtasks[1].done,false);assert.notEqual(next.subtasks[1].id,'c');assert.equal(next.subtasks.length,2);
 toggleTask(s,next.id);assert.ok(s.tasks[2].subtasks.every(sub=>!sub.done));assert.equal(new Set(s.tasks.flatMap(t=>t.subtasks.map(sub=>sub.id))).size,6);
});

test('future-series updates project associations and stops repeating when disabled',()=>{
 const s=emptyState();s.projects=[{id:'p'}];saveTask(s,task());toggleTask(s,'one');saveTask(s,{...s.tasks[0],projectId:'p',repeat:{frequency:'none',interval:1,weekdays:[]}},'future');assert.equal(s.tasks[1].projectId,'p');assert.equal(s.tasks[1].repeat.frequency,'none');toggleTask(s,s.tasks[1].id);assert.equal(s.tasks.length,2);
 assert.throws(()=>saveTask(s,task({id:'missing-project',projectId:'missing'})),/проект/);
});

test('saving a task does not alias caller objects or lose its successor link',()=>{
 const s=emptyState(),original=task();saveTask(s,original);original.title='Mutated caller';assert.equal(s.tasks[0].title,'Тест');toggleTask(s,'one');const nextId=s.tasks[0].nextId;saveTask(s,task({title:'Edited'}));assert.equal(s.tasks[0].nextId,nextId);assert.equal(s.tasks.length,2);
});

test('task validation rejects malformed dates, clocks, rules and subtasks',()=>{
 for(const bad of [{plannedDate:'2026-02-29'},{deadline:'2026-02-30'},{plannedDate:123},{start:'25:00',end:'26:00'},{start:'9:00',end:'10:00'},{start:'10:00',end:'10:00'},{plannedDate:'',start:'10:00',end:'11:00',repeat:{frequency:'none'}},{repeat:{frequency:'yearly',interval:1}},{repeat:{frequency:'daily',interval:1.5}},{repeat:{frequency:'daily',interval:366}},{repeat:{frequency:'weekly',interval:1,weekdays:[7]}},{repeat:{frequency:'monthly',interval:1,anchorDay:32}},{subtasks:[{id:'a',title:' '}]},{subtasks:[{id:'a',title:'One'},{id:'a',title:'Two'}]}])assert.throws(()=>validateTask(task(bad)),JSON.stringify(bad));
 assert.throws(()=>nextDate('2026-01-01',{frequency:'none',interval:1}));assert.throws(()=>nextDate('not-a-date',{frequency:'daily',interval:1}));
});

test('overlap warnings ignore adjacent, complete, archived and other-day tasks',()=>{
 const current=task({start:'10:00',end:'11:00'});const rows=[task({id:'before',start:'09:00',end:'10:00'}),task({id:'after',start:'11:00',end:'12:00'}),task({id:'done',start:'10:00',end:'11:00',done:true}),task({id:'archived',start:'10:00',end:'11:00',archived:true}),task({id:'other-day',start:'10:00',end:'11:00',plannedDate:'2026-02-01'}),task({id:'conflict',start:'10:30',end:'11:30'})];assert.deepEqual(overlaps(rows,current).map(t=>t.id),['conflict']);assert.deepEqual(overlaps(rows,{...current,end:''}),[]);
});

test('revenue ignores duplicates by payment identity and invalid receipt rows',()=>{
 const s=emptyState();s.projects=[{id:'p',archived:true}];const receipt={id:'advance',projectId:'p',status:'received',receivedDate:'2026-10-01',amountKopecks:6000000};s.payments=[receipt,{...receipt},{...receipt,id:'balance',amountKopecks:9000000},{...receipt,id:'expected',status:'expected'},{...receipt,id:'no-project',projectId:''},{...receipt,id:'unknown-project',projectId:'missing'},{...receipt,id:'invalid-date',receivedDate:'2026-10-99'},{...receipt,id:'fraction',amountKopecks:0.1},{...receipt,id:'negative',amountKopecks:-100},{...receipt,id:'string',amountKopecks:'100'},{...receipt,id:'prior',receivedDate:'2026-09-30'}];assert.equal(revenue(s,'2026-10'),150000);assert.equal(revenue(s,'2026-09'),60000);
});

test('separate equal receipts count separately and expenses do not replace revenue',()=>{
 const s=emptyState();s.projects=[{id:'p'}];s.payments=['a','b'].map(id=>({id,projectId:'p',status:'received',receivedDate:'2026-10-01',amountKopecks:12345}));s.expenses=[{amountKopecks:10000}];s.taxes=[{amountKopecks:10000}];assert.equal(revenue(s,'2026-10'),246.9);
});

test('recommendations ignore closed work and do not mutate task order',()=>{
 const s=emptyState();s.tasks=[task({id:'closed',done:true,deadline:'2020-01-01'}),task({id:'archived',archived:true,deadline:'2020-01-01'}),task({id:'today',deadline:'',plannedDate:'2026-10-12'}),task({id:'urgent',deadline:'2026-10-13',priority:'high'})];const ids=s.tasks.map(t=>t.id);assert.equal(recommendation(s,'2026-10-12').task.id,'urgent');assert.deepEqual(s.tasks.map(t=>t.id),ids);
});

test('recommendations fall back to a real active project when no tasks are open',()=>{
 const s=emptyState();s.projects=[{id:'closed',status:'completed',deadline:'2020-01-01'},{id:'archived',archived:true,deadline:'2020-01-01'},{id:'active',title:'Real project',deadline:'2026-10-10'}];const rec=recommendation(s,'2026-10-12');assert.equal(rec.task,null);assert.equal(rec.project.id,'active');assert.match(rec.reason,/Срок/);s.projects=[];assert.equal(recommendation(s).project,undefined);
});

const memoryStorage=()=>{let raw=null;return {getItem:()=>raw,setItem:(_,value)=>{raw=value}}};
const queuedLocks=()=>{let queue=Promise.resolve();return {request:(_name,_options,callback)=>{const result=queue.then(callback);queue=result.catch(()=>{});return result}}};

test('same repository rejects a stale caller snapshot after a successful write',async()=>{
 const storage=memoryStorage(),repository=new LocalRepository(storage),stale=await repository.load();const current=await repository.save(stale);assert.equal(stale.revision,0);assert.equal(current.revision,1);await assert.rejects(()=>repository.save(stale),/другой вкладке/);assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).revision,1);
});

test('concurrent tabs serialize check/write and exactly one stale snapshot succeeds',async()=>{
 const storage=memoryStorage(),locks=queuedLocks(),a=new LocalRepository(storage),b=new LocalRepository(storage);a.locks=b.locks=locks;const sa=await a.load(),sb=await b.load();saveTask(sa,task({id:'a'}));saveTask(sb,task({id:'b'}));const results=await Promise.allSettled([a.save(sa),b.save(sb)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/другой вкладке/);const persisted=JSON.parse(storage.getItem(STORAGE_KEY));assert.equal(persisted.tasks.length,1);assert.equal(persisted.revision,1);
});

test('concurrent saves in one repository also reject the second captured snapshot',async()=>{
 const storage=memoryStorage(),repository=new LocalRepository(storage);repository.locks=queuedLocks();const base=await repository.load(),a=structuredClone(base),b=structuredClone(base);a.settings.goal=100;b.settings.goal=200;const results=await Promise.allSettled([repository.save(a),repository.save(b)]);assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).settings.goal,100);
});

test('a queued save captures its input instead of adopting later caller mutations',async()=>{
 const storage=memoryStorage(),repository=new LocalRepository(storage);repository.locks=queuedLocks();const state=await repository.load();state.settings.goal=200;const pending=repository.save(state);state.settings.goal=300;const saved=await pending;assert.equal(saved.settings.goal,200);assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).settings.goal,200);
});

test('invalid stored snapshots are preserved and cannot be overwritten after load fails',async()=>{
 for(const value of [null,[],{}, {...emptyState(),revision:-1},{...emptyState(),settings:{}},{...emptyState(),tasks:[{id:'broken'}]},{...emptyState(),tasks:[task(),task()]},{...emptyState(),tasks:[task({repeat:{frequency:'weekly',interval:1,weekdays:[9]}})]}]){
  const storage=memoryStorage(),raw=JSON.stringify(value);storage.setItem(STORAGE_KEY,raw);const repository=new LocalRepository(storage);await assert.rejects(()=>repository.load(),/Формат/);await assert.rejects(()=>repository.save(emptyState()),/загрузить/);assert.equal(storage.getItem(STORAGE_KEY),raw);
 }
});

test('empty stored bytes are corruption, not permission to replace with an empty state',async()=>{
 const storage=memoryStorage();storage.setItem(STORAGE_KEY,'');const repository=new LocalRepository(storage);await assert.rejects(()=>repository.load(),/повреждены/);await assert.rejects(()=>repository.save(emptyState()),/загрузить/);assert.equal(storage.getItem(STORAGE_KEY),'');
});

test('unavailable reads and unacknowledged writes never report success',async()=>{
 const inaccessible=new LocalRepository({getItem(){throw Error('blocked')},setItem(){assert.fail('must not write')}});await assert.rejects(()=>inaccessible.load(),/прочитать/);
 const dropped=new LocalRepository({getItem:()=>null,setItem:()=>{}});await dropped.load();await assert.rejects(()=>dropped.save(emptyState()),/Не удалось сохранить/);assert.equal(dropped.revision,0);
});

test('browser writes fail safely when cross-tab locks are unavailable',async()=>{
 const storage=memoryStorage(),repository=new LocalRepository(storage);repository.browserStorage=true;repository.locks=undefined;const state=await repository.load();await assert.rejects(()=>repository.save(state),/HTTPS/);assert.equal(storage.getItem(STORAGE_KEY),null);
});

test('lock failures do not fall back to an unsafe write',async()=>{
 const storage=memoryStorage(),repository=new LocalRepository(storage);repository.locks={request:async()=>{throw Error('lock denied')}};const state=await repository.load();await assert.rejects(()=>repository.save(state),/lock denied/);assert.equal(storage.getItem(STORAGE_KEY),null);
});

test('quota failures leave the snapshot retryable without acknowledging a revision',async()=>{
 let fail=true;const storage=memoryStorage(),write=storage.setItem;storage.setItem=(...args)=>{if(fail)throw Error('quota');write(...args)};const repository=new LocalRepository(storage),state=await repository.load();saveTask(state,task());await assert.rejects(()=>repository.save(state),/Не удалось сохранить/);assert.equal(repository.revision,0);fail=false;const saved=await repository.save(state);assert.equal(saved.revision,1);assert.equal(saved.tasks.length,1);
});


test('calendar arithmetic stays stable across DST transitions and leap-century rules',()=>{
 assert.equal(addDays('2026-03-08',1),'2026-03-09');assert.equal(addDays('2026-11-01',1),'2026-11-02');assert.equal(addDays('2011-12-29',1),'2011-12-30');assert.equal(addDays('1900-02-28',1),'1900-03-01');assert.equal(addDays('2000-02-28',1),'2000-02-29');
});

test('malformed stored subtask state is rejected before rendering',async()=>{
 const storage=memoryStorage(),state=emptyState();state.tasks=[task({subtasks:[{id:'sub',title:'Step',done:'false'}]})];const raw=JSON.stringify(state);storage.setItem(STORAGE_KEY,raw);await assert.rejects(()=>new LocalRepository(storage).load(),/Формат/);assert.equal(storage.getItem(STORAGE_KEY),raw);
});
