import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

// Reuse the real component fixture declarations, without registering its tests.
const fixtureUrl=new URL('./seo-workspace-generator.test.mjs',import.meta.url);
let fixture=fs.readFileSync(fixtureUrl,'utf8').split('\ntest(')[0];
const parsed=ts.createSourceFile('fixture.mjs',fixture,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
fixture=parsed.statements.filter(statement=>!ts.isImportDeclaration(statement)).map(statement=>statement.getFullText(parsed)).join('');
fixture=fixture.replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href))
 .replace('registrationBrand=brand,','registrationBrand=brand,onProcessingChange,')
 .replace("onSaved(){throw Error('Unexpected product save');}})","onSaved(){throw Error('Unexpected product save');},onProcessingChange})")
 .replace('setRegistrationBrand(value){registrationBrand=value;}','setRegistrationBrand(value){registrationBrand=value;},setCallback(value){onProcessingChange=value;},setPending(value){pending=value;}');
const context={fs,vm,ts,assert,URL,Response,AbortController,structuredClone,TextEncoder,crypto:globalThis.crypto,setImmediate};
vm.runInNewContext(fixture+'\nglobalThis.fixtureApi={ui,deferred,nodes,text};',context);
const {ui,deferred,nodes,text}=context.fixtureApi;
const body=h=>nodes(h.render()).find(node=>node.props?.className==='seo-generation-body');
const progress=h=>nodes(h.render()).filter(node=>node.props?.['data-seo-processing']);
const nextVersion='2026-10-10T00:00:01.000Z';
const actualChildTraces=[];

for(const preparedAi of [false,true])test(`${preparedAi?'AI':'Google'} fresh manual generation requires the live trimmed target before persistence, helper or request`,async()=>{
 const events=[],h=ui({preparedAi,onProcessingChange:(busy,operation)=>events.push({busy,operation})});try{
  await h.idle();assert.equal(events.length,0,'initial five source GETs are not generation processing');
  const label=preparedAi?'AI로 자동 생성':'한국어 초안 자동 작성',oldClick=h.button(label).props.onClick;
  for(const value of ['', ' \t\n  ']){
   h.input('SEO 타겟 키워드').props.onChange({target:{value}});await h.idle();
   assert.equal(h.input('SEO 타겟 키워드').props.value,value,'blank is retained, not silently repaired');assert.equal(h.input('SEO 타겟 키워드').props['aria-required'],'true');
   assert.equal(h.button(label).props.disabled,true);oldClick();await h.idle();
   assert.equal(h.creates.length,0);assert.equal(h.runs.length,0);assert.equal(h.storage.size,0);assert.equal(h.calls.length,5);assert.equal(events.length,0);
  }
  h.input('SEO 타겟 키워드').props.onChange({target:{value:'  검토한 면장갑  '}});await h.idle();assert.equal(h.button(label).props.disabled,false);
  oldClick();await h.idle();assert.equal(h.creates.length,1);assert.equal(h.creates[0].memo.keywords,'  검토한 면장갑  ');assert.equal(h.runs.length,1);
  assert.deepEqual(events.map(event=>event.busy),[true,false]);assert.strictEqual(events[0].operation,events[1].operation);
 }finally{h.close();}
});

test('generation publishes synchronous processing before helper/persistence and hides only its mounted body until completion',async()=>{
 const waiting=deferred(),events=[];let h;h=ui({pending:waiting,onProcessingChange:(busy,operation)=>{
  events.push({busy,operation,creates:h.creates.length,runs:h.runs.length,stored:h.storage.size});
 }});try{
  await h.idle();assert.equal(body(h).props.hidden,false);h.button('한국어 초안 자동 작성').props.onClick();
  assert.equal(events.length,1);assert.equal(events[0].busy,true);assert.equal(events[0].creates,0);assert.equal(events[0].runs,0);assert.equal(events[0].stored,0);
  assert.equal(h.runs.length,1);assert.equal(body(h).props.hidden,true);assert.equal(body(h).props.inert,true);assert.equal(progress(h).length,1);
  assert.ok(h.input('SEO 상품 특징'),'hidden form remains mounted');waiting.resolve();await h.idle();
  assert.deepEqual(events.map(event=>event.busy),[true,false]);assert.strictEqual(events[0].operation,events[1].operation);assert.equal(body(h).props.hidden,false);assert.equal(progress(h).length,0);
 }finally{waiting.resolve();h.close();}
});

test('callback replacement releases the old receiver and republishes the same owned operation without restarting',async()=>{
 const waiting=deferred(),events=[],old=(busy,operation)=>events.push({receiver:'old',busy,operation}),next=(busy,operation)=>events.push({receiver:'new',busy,operation});
 const h=ui({pending:waiting,onProcessingChange:old});try{
  await h.idle();h.button('한국어 초안 자동 작성').props.onClick();const operation=events[0].operation;h.setCallback(next);h.render(false);
  assert.deepEqual(events.map(({receiver,busy})=>[receiver,busy]),[['old',true],['old',false],['new',true]]);assert.ok(events.every(event=>event.operation===operation));assert.equal(h.runs.length,1);
  waiting.resolve();await h.idle();assert.deepEqual(events.map(({receiver,busy})=>[receiver,busy]),[['old',true],['old',false],['new',true],['new',false]]);assert.equal(events.at(-1).operation,operation);
 }finally{waiting.resolve();h.close();}
});

test('hiding and reopening a stage releases the old generation lease and its late finally cannot unlock a newer resume',async()=>{
 const first=deferred(),second=deferred(),events=[],h=ui({pending:first,onProcessingChange:(busy,operation)=>events.push({busy,operation})});try{
  await h.idle();h.button('한국어 초안 자동 작성').props.onClick();const old=events[0].operation;
  h.setActive(false);h.render(false);assert.equal(h.runs[0].controls.signal.aborted,true);assert.deepEqual(events.map(event=>event.busy),[true,false]);assert.equal(events[1].operation,old);
  h.setPending(second);h.setActive(true);await h.idle();h.button('같은 초안 요청 확인').props.onClick();const current=events[2].operation;
  assert.notStrictEqual(current,old);assert.equal(h.runs.length,2);assert.equal(h.creates.length,1,'resume retains one durable operation');assert.equal(body(h).props.hidden,true);
  first.resolve();await h.idle();assert.equal(events.length,3,'stale finally cannot release the current lease');assert.equal(body(h).props.hidden,true);
  second.resolve();await h.idle();assert.equal(events.length,4);assert.equal(events[3].operation,current);assert.equal(events[3].busy,false);assert.equal(body(h).props.hidden,false);
 }finally{first.resolve();second.resolve();h.close();}
});

test('source clock replacement and unmount each release their current lease exactly once without late writes',async()=>{
 for(const mode of ['clock','unmount']){
  const waiting=deferred(),events=[],h=ui({pending:waiting,onProcessingChange:(busy,operation)=>events.push({busy,operation})});
  await h.idle();h.button('한국어 초안 자동 작성').props.onClick();
  if(mode==='clock'){h.setVersion(nextVersion);h.render(false);}else h.close();
  assert.deepEqual(events.map(event=>event.busy),[true,false]);assert.strictEqual(events[0].operation,events[1].operation);assert.equal(h.runs[0].controls.signal.aborted,true);
  waiting.resolve();if(mode==='clock'){await h.idle();assert.equal(body(h).props.hidden,false);h.close();}else await new Promise(resolve=>setImmediate(resolve));
  assert.equal(events.length,2);assert.equal(h.lateWrites,0);
 }
});

test('legacy durable blank memo can resume or read status without becoming a fresh blank generation',async()=>{
 let first=ui();let proof;try{await first.idle();first.button('한국어 초안 자동 작성').props.onClick();await first.idle();proof=JSON.parse(first.storage.get('yoofam-seo-workspace:p'));proof.memo.keywords=' \t ';}finally{first.close();}
 for(const readOnly of [true,false]){
  const events=[],h=ui({storageValue:JSON.stringify(proof),onProcessingChange:(busy,operation)=>events.push({busy,operation})});try{
   await h.idle();assert.equal(h.input('SEO 타겟 키워드').props.value,' \t ');assert.equal(h.button('같은 초안 요청 확인').props.disabled,false);
   h.button(readOnly?'초안 상태 조회':'같은 초안 요청 확인').props.onClick();await h.idle();
   assert.equal(h.creates.length,0,'existing execution receipt is never replaced');assert.equal(h.storage.size,1);assert.equal(h.runs.length,readOnly?0:1);
   assert.deepEqual(events.map(event=>event.busy),readOnly?[]:[true,false]);assert.equal(body(h).props.hidden,false);
   assert.match(text(h.render()),/작성된 초안/);
  }finally{h.close();}
 }
});

test('composition processing keeps its child mounted and a source clock replacement retires its token and callbacks',async()=>{
 const events=[],h=ui({onProcessingChange:(busy,operation)=>events.push({busy,operation})});try{
  await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();const generation=events[0].operation,old=h.integrated().props.onBusyChange;
  old(true);assert.equal(events.length,3);const composition=events[2].operation;assert.notStrictEqual(composition,generation);
  assert.equal(body(h).props.hidden,true);assert.strictEqual(h.integrated().props.onBusyChange,old,'hidden child is retained with its callback');assert.equal(h.integrated().props.disabled,false,'processing does not disable itself');
  old(true);assert.equal(events.length,3,'duplicate busy publication does not create another operation');old(false);await h.idle();assert.equal(events[3].operation,composition);assert.equal(body(h).props.hidden,false);
  old(true);const latest=events[4].operation;assert.equal(body(h).props.hidden,true);
  h.setVersion(nextVersion);h.render(false);assert.equal(events[5].operation,latest);assert.equal(events[5].busy,false);old(false);old(true);await h.idle();assert.equal(events.length,6);assert.equal(body(h).props.hidden,false);
 }finally{h.close();}
});

const childFixtureUrl=new URL('./translation-integrated-ui.test.mjs',import.meta.url),childSource=fs.readFileSync(childFixtureUrl,'utf8').split('\ntest(')[0];
const childParsed=ts.createSourceFile('child-fixture.mjs',childSource,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
const childContext={fs,vm,ts,URL,Response,AbortController,createRequire,Error,setImmediate};
vm.runInNewContext(childParsed.statements.filter(statement=>!ts.isImportDeclaration(statement)).map(statement=>statement.getFullText(childParsed)).join('')
 .replaceAll('import.meta.url',JSON.stringify(childFixtureUrl.href))+'\nglobalThis.fixtureApi={harness,settle};',childContext);
const {harness:childHarness,settle:childSettle}=childContext.fixtureApi;

for(const phase of ['preview','apply'])test(`actual integrated ${phase} stays locked across inactive/active navigation until its owned controller settles`,async()=>{
 const events=[],waiting=deferred(),h=ui({onProcessingChange:(busy,operation)=>events.push({busy,operation})});let child,saved=0;try{
  await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();
  const currentVersion=h.integrated().props.version,plan={productId:'p',productVersion:currentVersion,contentRevision:2,optionRevision:0,fingerprint:'a'.repeat(64),preview:[{name:'상품명',before:'',after:'검토한 면장갑'}],skipped:[]};
  const receipt={productId:'p',productVersion:nextVersion,contentRevision:3,optionRevision:1,applied:1};
  child=childHarness(init=>JSON.parse(init.body).action===phase?waiting.promise:Response.json(plan));
  const sync=()=>child.render({...h.integrated().props,onSaved:()=>saved++});sync();child.click(0);
  if(phase==='apply'){await childSettle();sync();child.click(1);}
  const live=child.calls.at(-1);assert.equal(JSON.parse(live.init.body).action,phase);assert.equal(live.init.signal.aborted,false);
  const operation=events.at(-1).operation;assert.equal(events.at(-1).busy,true);assert.equal(body(h).props.hidden,true);const count=events.length;
  h.setActive(false);h.render(false);sync();assert.equal(live.init.signal.aborted,false,'navigation cannot pretend an uncertain apply was cancelled');assert.equal(events.length,count);assert.equal(body(h).props.hidden,true);
  h.setActive(true);await h.idle();sync();assert.equal(body(h).props.hidden,true);assert.equal(events.length,count);assert.equal(live.init.signal.aborted,false);
  h.button('한국어 초안 자동 작성').props.onClick();assert.equal(h.runs.length,1,'live integrated request prevents another generation');
  waiting.resolve(Response.json(phase==='preview'?plan:receipt));await childSettle();await h.idle();sync();
  assert.equal(events.length,count+1);assert.equal(events.at(-1).busy,false);assert.strictEqual(events.at(-1).operation,operation);assert.equal(body(h).props.hidden,false);assert.equal(saved,phase==='apply'?1:0);
  assert.equal(child.late,0);assert.equal(h.lateWrites,0);
  actualChildTraces.push({phase,initialGeneration:1,integratedRequests:child.calls.length,requestActions:child.calls.map(call=>JSON.parse(call.init.body).action),
   sourceVersion:currentVersion,receiptVersion:phase==='apply'?nextVersion:null,activeNavigationRetainedLease:true,controllerAbortedDuringNavigation:false,
   pairedOperationRelease:true,savedCallbacks:saved,lateWrites:child.late+h.lateWrites});
 }finally{waiting.resolve(Response.json({}));child?.close();h.close();}
});

test('composition unmount releases the lease even when the child later reports completion',async()=>{
 const events=[],h=ui({onProcessingChange:(busy,operation)=>events.push({busy,operation})});await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();
 const child=h.integrated().props.onBusyChange;child(true);const operation=events.at(-1).operation;h.close();assert.equal(events.at(-1).busy,false);assert.equal(events.at(-1).operation,operation);
 const count=events.length;child(false);child(true);assert.equal(events.length,count);assert.equal(h.lateWrites,0);
});

after(()=>{
 const sourceHashes=Object.fromEntries(['app/components/seo-workspace-generator.tsx','app/components/translation-integrated-preview.tsx',
  'tests/seo-workspace-generator.test.mjs','tests/translation-integrated-ui.test.mjs','tests/seo-workspace-processing.test.mjs']
  .map(path=>[path,createHash('sha256').update(fs.readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]));
 fs.writeFileSync(new URL('../outputs/step713-seo-generator-proof.json',import.meta.url),JSON.stringify({step:713,sourceHashes,tests:11,
  cases:['Google live required target','AI live required target','synchronous generation lease and hidden mounted body','callback replacement',
   'generation inactive/active and late finally','source/unmount cleanup','legacy blank resume and readonly status',
   'composition source retirement','actual child preview navigation','actual child apply navigation','composition late unmount callbacks'],actualChildTraces,
  externalRequests:0,syntheticSourcesAndReceipts:true,actual1688CollectionVerified:false,actualSupplierHubReceiptVerified:false},null,2)+'\n');
});
