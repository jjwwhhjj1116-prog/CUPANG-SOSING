import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
function declarationPrefix(ast){const parts=[];for(const statement of ast.statements){if(ts.isImportDeclaration(statement))continue;if(ts.isForOfStatement(statement)||ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;parts.push(statement.getText(ast));}return parts.join('\n');}
const url=new URL('./seo-workspace-generator.test.mjs',import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(url.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let fixture=declarationPrefix(ast).replaceAll('import.meta.url',JSON.stringify(url.href));
for(const[before,after]of [
 ['registrationBrand=brand}={})','registrationBrand=brand,onBusyChange,onPendingChange,onApplyUncertainChange,onSaved}={})'],
 ["onSaved(){throw Error('Unexpected product save');}})","onSaved:()=>onSaved?.(),onBusyChange,onPendingChange,onApplyUncertainChange})"],
 ['slots[i]={deps,cleanup:before?.cleanup};','slots[i]={deps,cleanup:before?.cleanup,create:fn,layout:queue===layouts};'],
 ['get lateWrites(){return lateWrites;}','replay(){const committed=slots.filter(slot=>slot?.create);for(const layout of [true,false])for(const slot of committed.filter(slot=>slot.layout===layout))slot.cleanup?.();for(const layout of [true,false])for(const slot of committed.filter(slot=>slot.layout===layout))slot.cleanup=slot.create();},get lateWrites(){return lateWrites;}'],
]){assert.ok(fixture.includes(before),before);fixture=fixture.replace(before,after);}
const{ui,text,deferred}=vm.runInNewContext(fixture+'\n({ui,text,deferred})',{assert,fs,vm,ts,createRequire,URL,Response,Error,AbortController,structuredClone,TextEncoder,crypto:globalThis.crypto,setImmediate});
test('batch lifecycle reports initial reads, then explicit generation holds review without auto generation or storage writes',async()=>{
 const busy=[],pending=[],h=ui({onBusyChange:value=>busy.push(value),onPendingChange:value=>pending.push(value)});try{
  assert.equal(busy[0],true,'first committed layout protects the initial saved-source read');await h.idle();assert.equal(h.runs.length,0);assert.equal(busy.at(-1),false);assert.equal(pending.at(-1),false);
  h.button('한국어 초안 자동 작성').props.onClick();await h.idle();assert.equal(h.runs.length,1);assert.equal(pending.at(-1),true);assert.ok(h.integrated());assert.equal(h.calls.some(call=>call.init?.method==='PATCH'),false);
  h.button('새 초안 입력').props.onClick();await h.idle();assert.equal(pending.at(-1),false);assert.equal(h.runs.length,1,'discard/reset is not generation');
 }finally{h.close();}assert.equal(busy.at(-1),false);assert.equal(pending.at(-1),false);
});
test('unknown apply locks composition, old/new apply callbacks, reset and fresh generation until saved-state review',async()=>{
 const uncertain=[],h=ui({onApplyUncertainChange:value=>uncertain.push(value)});try{
  await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();const child=h.integrated().props,oldEdit=h.input('SEO 구성 상품명').props.onChange,before=h.input('SEO 구성 상품명').props.value;
  child.onUncertainChange(true);assert.equal(child.beforeApply(),false,'uncertainty is a synchronous ref guard');oldEdit({target:{value:'불확정 결과 우회 제목'}});await h.idle();assert.equal(h.input('SEO 구성 상품명').props.value,before);assert.equal(h.integrated().props.disabled,true);assert.equal(h.integrated().props.beforeApply(),false);assert.equal(h.button('새 초안 입력').props.disabled,true);
  h.button('한국어 초안 자동 작성').props.onClick();await h.idle();assert.equal(h.runs.length,1);assert.equal(uncertain.at(-1),true);assert.match(text(h.render()),/작성된 초안/);
 }finally{h.close();}
});
test('old integrated save callbacks cannot publish after owner/source retirement and completed manual replacements default off',async()=>{
 let saves=0;const h=ui({workspaceOwnerId:'owner',savedSeo:{title:{value:'직접 저장 제목',provenance:'manual'},keywords:{value:[],provenance:'manual'}},onSaved:()=>saves++});try{
  await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();const child=h.integrated().props;assert.equal(h.input('저장된 상품명 교체').props.checked,false);assert.equal(h.input('저장된 검색태그 교체').props.checked,false);
  h.setVersion('2026-10-10T00:00:01.000Z');h.render(false);child.onSaved();assert.equal(saves,0);h.setOwner('other-owner');h.render(false);child.onSaved();assert.equal(saves,0);
 }finally{h.close();}
});

// Reuse the real child fixture for transport ACK behavior. No API is replaced
// inside production code, and an unknown write is never automatically retried.
const childUrl=new URL('./translation-integrated-ui.test.mjs',import.meta.url),childSource=fs.readFileSync(childUrl,'utf8'),childAst=ts.createSourceFile(childUrl.pathname,childSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const oldDeps="JSON.stringify(previous.deps)!==JSON.stringify(deps)";
const childDeclarations=declarationPrefix(childAst);assert.ok(childDeclarations.includes(oldDeps));
// JSON-stringified dependencies collapse different callbacks to null. Keep
// the borrowed child's effect scheduling faithful when callbacks are added.
const declarations=childDeclarations.replace(oldDeps,"(!Array.isArray(deps)||!Array.isArray(previous.deps)||deps.length!==previous.deps.length||deps.some((value,i)=>!Object.is(value,previous.deps[i])))").replaceAll('import.meta.url',JSON.stringify(childUrl.href));
const childFixture=vm.runInNewContext(declarations+'\n({harness,settle,plan,nodes})',{assert,fs,vm,ts,createRequire,URL,Response,Error,AbortController,setImmediate});
test('actual integrated apply ACK loss publishes uncertainty and refuses retained or renewed apply attempts',async()=>{
 const events=[],h=childFixture.harness(async init=>{if(JSON.parse(init.body).action==='preview')return Response.json(childFixture.plan);throw Error('合成 ACK 유실');});try{
  h.render({onUncertainChange:value=>events.push(value)});h.click(0);await childFixture.settle();const old=childFixture.nodes(h.render()).filter(node=>node.type==='button')[1].props.onClick;old();await childFixture.settle();assert.deepEqual(events,[true]);assert.equal(h.saved,0);old();h.click(0);await childFixture.settle();const next=childFixture.nodes(h.render()).filter(node=>node.type==='button')[1];next?.props.onClick();await childFixture.settle();assert.equal(h.calls.filter(call=>JSON.parse(call.init.body).action==='apply').length,1);assert.equal(h.saved,0);
 }finally{h.close();}
});

test('the entire held five-GET preload remains busy before and after its microtask and aborts on deactivation',async()=>{
 const busy=[],gate=deferred(),h=ui({fetcher:()=>gate.promise,onBusyChange:value=>busy.push(value)});try{
  assert.equal(busy[0],true);await h.until(()=>h.calls.length===5);assert.equal(busy.at(-1),true);assert.equal(h.runs.length,0);assert.equal(h.creates.length,0);
  h.setActive(false);h.render();assert.ok(h.calls.every(call=>call.init.signal.aborted));gate.resolve(Response.json({}));await h.idle();assert.equal(busy.at(-1),false);assert.equal(h.lateWrites,0);assert.equal(h.runs.length,0);
 }finally{gate.resolve(Response.json({}));h.close();}
});

test('a failed read-only preload releases busy and an old error cannot unlock a new source-version preload',async()=>{
 const busy=[],h=ui({registrationError:true,onBusyChange:value=>busy.push(value)});try{
  assert.equal(busy[0],true);await h.idle();assert.match(text(h.render()),/로그인 회사와 수집 회사/);assert.equal(busy.at(-1),false,'a completed failed GET cannot keep parent navigation busy forever');
  h.setRegistrationError(false);h.setVersion('2026-10-10T00:00:01.000Z');h.render(false);assert.equal(busy.at(-1),true,'the old failed-read message cannot release a different version preload');
  await h.idle();assert.equal(busy.at(-1),false);assert.equal(h.runs.length,0);assert.equal(h.creates.length,0);
 }finally{h.close();}
});

test('one persisted generation survives StrictMode effect replay without a second create or provider run and stays pending for review',async()=>{
 const gate=deferred(),busy=[],pending=[],h=ui({pending:gate,onBusyChange:value=>busy.push(value),onPendingChange:value=>pending.push(value)});try{
  await h.idle();const start=h.button('한국어 초안 자동 작성').props.onClick;start();start();await h.until(()=>h.runs.length===1);h.render();
  assert.equal(h.creates.length,1);assert.equal(pending.at(-1),true);assert.equal(busy.at(-1),true);h.replay();assert.equal(h.runs[0].controls.signal.aborted,true);
  gate.resolve();await h.idle();assert.equal(h.runs.length,1);assert.equal(h.creates.length,1);assert.equal(pending.at(-1),true);assert.equal(h.lateWrites,0);
  h.button('초안 상태 조회').props.onClick();await h.idle();assert.ok(h.integrated());assert.equal(h.runs.length,1);assert.equal(h.creates.length,1);assert.equal(pending.at(-1),true);assert.equal(busy.at(-1),false);
 }finally{gate.resolve();h.close();}
});

test('same-version composition edits retire old saved, uncertain and apply callbacks while preserving the current proposal',async()=>{
 let saved=0;const uncertain=[],h=ui({workspaceOwnerId:'owner',onSaved:()=>saved++,onApplyUncertainChange:value=>uncertain.push(value)});try{
  await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();const old=h.integrated().props;
  h.input('SEO 구성 상품명').props.onChange({target:{value:'사용자가 확정할 새 구성 제목'}});await h.idle();const current=h.integrated().props;
  old.onSaved();old.onUncertainChange(true);assert.equal(old.beforeApply(),false);await h.idle();assert.equal(saved,0);assert.notEqual(uncertain.at(-1),true);assert.equal(h.input('SEO 구성 상품명').props.value,'사용자가 확정할 새 구성 제목');
  assert.equal(current.beforeApply(),true);current.onSaved();assert.equal(saved,1);assert.equal(h.runs.length,1);assert.equal(h.calls.some(call=>call.init?.method==='PATCH'),false);
 }finally{h.close();}
});

test('malformed successful apply acknowledgements and server errors remain uncertain and cannot be retried as new applies',async()=>{
 for(const response of [()=>Response.json({productId:'other',productVersion:'2026-09-25T01:00:01.000Z',contentRevision:1,optionRevision:2,applied:1}),()=>Response.json({error:'저장 처리 결과 확인 필요'},{status:503})]){
  const events=[],h=childFixture.harness(async init=>JSON.parse(init.body).action==='preview'?Response.json(childFixture.plan):response());try{
   h.render({onUncertainChange:value=>events.push(value)});h.click(0);await childFixture.settle();h.click(1);await childFixture.settle();assert.deepEqual(events,[true]);assert.equal(h.saved,0);
   h.click(0);await childFixture.settle();const apply=childFixture.nodes(h.render()).filter(node=>node.type==='button')[1];apply?.props.onClick();await childFixture.settle();assert.equal(h.calls.filter(call=>JSON.parse(call.init.body).action==='apply').length,1);assert.equal(h.saved,0);
  }finally{h.close();}
 }
});
