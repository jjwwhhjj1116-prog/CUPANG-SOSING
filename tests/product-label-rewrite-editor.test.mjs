import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

const fixtureUrl=new URL('./product-label-editor.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8');
const ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){if(ts.isImportDeclaration(statement))continue;if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;parts.push(statement.getText(ast));}
let helpers=parts.join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
for(const[before,after]of [
 ['renderer,attach}={}','renderer,attach,disabled=false,active=true}={}'],
 ['JSON.stringify(slots[i].deps)!==JSON.stringify(deps)','deps===undefined||slots[i].deps===undefined||slots[i].deps.length!==deps.length||deps.some((dep,index)=>!Object.is(dep,slots[i].deps[index]))'],
 ['{exports,Error,AbortController','{exports,window:browserWindow,crypto:webcrypto,Error,AbortController'],
 ['URL:localURL,fetch:request','URL:Object.assign(class extends URL {},localURL),fetch:request'],
 ['version,profileId,refreshToken,onSaved()','version,profileId,refreshToken,disabled,active,onSaved()'],
 ['get saved(){return saved;}','setDisabled(value){disabled=value;render();},setActive(value){active=value;render();},get saved(){return saved;}'],
]){assert.ok(helpers.includes(before),before);helpers=helpers.replace(before,after);}
const plain=value=>JSON.parse(JSON.stringify(value)),cases=[],confirmations=[];
let confirmAllowed=true;
const browserWindow={confirm(message){confirmations.push(message);return confirmAllowed;}};
const {editor,fixture,nodes,text}=vm.runInNewContext(helpers+'\n({editor,fixture,nodes,text})',{assert,fs,vm,path,ts,createRequire,webcrypto,browserWindow,Response,Blob,JSON,URL,Date,AbortController,structuredClone,TextEncoder,setImmediate,setTimeout,clearTimeout});
const hash=value=>createHash('sha256').update(value).digest('hex');
const files=['app/product-label-rewrite.ts','app/components/product-label-editor.tsx','app/product-label.ts','tests/product-label-rewrite-editor.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,hash(fs.readFileSync(new URL('../'+file,import.meta.url)))])),frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step711-rewrite-ui-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases,boundary:'Actual primary component and rewrite client callbacks; synthetic API/PNG/hook scheduler/window confirmation. No pointer/pixel or external acceptance claim.',externalRequests:0,browserActions:0,realProductWrites:0,supplierHubWrites:0},null,2)+'\n');});
function setup(intercept,options){
 const f=fixture(),before=plain(f.view),posts=[];
 function reply(url,init){
  if(init?.method==='POST'){
   const body=JSON.parse(init.body);posts.push(body);
   if(body.expectedRevision!==f.view.revision||body.expectedInputFingerprint!==f.view.inputFingerprint)return Response.json({error:'동시 수정'},{status:409});
   f.view.revision++;f.view.renderEpoch=(f.view.renderEpoch??0)+1;f.view.productVersion=new Date(Date.parse(f.view.productVersion)+1).toISOString();f.view.updatedAt=f.view.productVersion;
   f.view.inputFingerprint=hash(JSON.stringify([f.view.revision,f.view.renderEpoch]));f.view.quotationInputFingerprint=hash(f.view.productVersion);
   return Response.json(f.view);
  }
  return f.reply(url,init);
 }
 confirmAllowed=true;confirmations.length=0;
 const h=editor((url,init)=>intercept?intercept(url,init,reply,f):reply(url,init),options);
 return{f,h,before,posts,reply};
}
const child=h=>nodes(h.render()).find(node=>typeof node.type==='function'&&node.type.name==='ProductLabelReferenceEditor');
const waitFor=async(check,h)=>{const deadline=Date.now()+10000;while(!check()){assert.ok(Date.now()<deadline);h.render();await new Promise(done=>setImmediate(done));}};

test('cancelled rewrite preserves saved data and local PNG without sending a write',async()=>{
 const{f,h,before,posts}=setup();try{
  await h.idle();await h.click('저장한 표시사항 PNG 미리보기');const originalUrl=h.urls[0],count=h.calls.length;confirmAllowed=false;
  await h.click('표시사항 재작성');assert.equal(confirmations.length,1);assert.match(confirmations[0],/공통과 모든 옵션/);assert.deepEqual(plain(f.view),before);assert.equal(posts.length,0);assert.equal(h.calls.length,count);assert.equal(nodes(h.render()).find(node=>node.type==='a').props.href,originalUrl);assert.equal(h.saved,0);
  cases.push({name:'confirmation cancel',writes:0,previewPreserved:true,valuesPreserved:true});
 }finally{h.close();}
});

test('confirmed rewrite preserves all fields, changes generation once and renders a new PNG for the same text',async()=>{
 const{f,h,before,posts}=setup();try{
  await h.idle();await h.click('저장한 표시사항 PNG 미리보기');const plan=plain(h.plans[0]);
  await h.click('표시사항 재작성');assert.equal(posts.length,1);assert.deepEqual(Object.keys(posts[0]).sort(),['expectedInputFingerprint','expectedRevision']);assert.equal(f.view.renderEpoch,1);assert.equal(f.view.revision,before.revision+1);
  for(const key of ['overrides','rows','imageKeys','contentRevision','optionRevision','quotationRevision','categoryContext'])assert.deepEqual(plain(f.view[key]),before[key],key);
  assert.equal(h.saved,1);assert.equal(nodes(h.render()).some(node=>node.type==='a'),false);assert.equal(h.attachments.length,0);assert.match(text(h.render()),/再|재작성 준비를 마쳤습니다/);
  await h.click('저장한 표시사항 PNG 미리보기');assert.equal(h.plans.length,2,'old in-memory recipe is not reused after rewrite');assert.deepEqual(h.plans[1],plan);assert.equal(h.calls.some(call=>call.url==='/api/files'),false);
  cases.push({name:'explicit rewrite',epoch:1,onePost:true,allValuesAndReferencesPreserved:true,newRenderSameText:true,automaticAttachment:false});
 }finally{h.close();}
});

test('lost committed acknowledgement is read back without a duplicate POST',async()=>{
 let lost=true;const{f,h,posts}=setup((url,init,reply)=>{const response=reply(url,init);if(init?.method==='POST'&&lost){lost=false;throw Error('합성 응답 유실');}return response;});try{
  await h.idle();await h.click('표시사항 재작성');assert.equal(f.view.renderEpoch,1);assert.equal(posts.length,1);assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.button('재작성 결과 확인'),undefined);
  cases.push({name:'lost committed ACK',postCount:1,readOnlyRecovery:true});
 }finally{h.close();}
});

test('unknown rewrite result blocks primary and child edits until explicit read-only recovery',async()=>{
 let offline=false;const{f,h,posts}=setup((url,init,reply)=>{if(offline&&init?.method!=='POST')return Response.json({error:'합성 읽기 실패'},{status:503});const response=reply(url,init);if(init?.method==='POST'){offline=true;throw Error('합성 응답 유실');}return response;});try{
  await h.idle();const oldEdit=h.input('선택 옵션 제조원').props.onChange,oldGenerate=h.button('저장한 표시사항 PNG 미리보기').props.onClick;
  await h.click('표시사항 재작성');assert.equal(posts.length,1);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(child(h).props.disabled,true);assert.equal(h.button('표시사항 재작성').props.disabled,true);assert.equal(h.button('정보 저장하기').props.disabled,true);
  const count=h.calls.length;oldEdit({target:{value:'늦은 편집'}});oldGenerate();await h.idle();assert.equal(h.calls.length,count);assert.equal(h.input('선택 옵션 제조원').props.value,'원천 제조사');
  offline=false;await h.click('재작성 결과 확인');assert.equal(posts.length,1);assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(child(h).props.disabled,false);assert.equal(f.view.renderEpoch,1);
  cases.push({name:'uncertain result',primaryAndChildLocked:true,staleEditIgnored:true,recoveryPostCount:0});
 }finally{h.close();}
});

test('uncommitted unavailable result can be confirmed unchanged and retried only by a new explicit rewrite',async()=>{
 let fail=true,offline=false;const{f,h,posts}=setup((url,init,reply)=>{if(offline&&init?.method!=='POST')return Response.json({error:'합성 오프라인'},{status:503});if(init?.method==='POST'&&fail){offline=true;throw Error('요청 도달 실패');}return reply(url,init);});try{
  await h.idle();await h.click('표시사항 재작성');assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(posts.length,0);offline=false;
  await h.click('재작성 결과 확인');assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(posts.length,0);assert.equal(f.view.renderEpoch,undefined);assert.equal(h.saved,0);
  fail=false;await h.click('표시사항 재작성');assert.equal(posts.length,1);assert.equal(f.view.renderEpoch,1);assert.equal(h.saved,1);
  cases.push({name:'unchanged recovery',automaticRetry:false,explicitRetryPostCount:1});
 }finally{h.close();}
});

test('committed non-success server responses remain uncertain until a read confirms the result',async()=>{
 for(const status of [503,409]){
  let offline=false;const{h,posts}=setup((url,init,reply)=>{if(offline&&init?.method!=='POST')return Response.json({error:'결과 조회 장애'},{status:503});const response=reply(url,init);if(init?.method==='POST'){offline=true;return Response.json({error:'저장 후 조회 실패'},{status});}return response;});try{
   await h.idle();await h.click('표시사항 재작성');assert.equal(posts.length,1);assert.equal(h.render().props['data-workspace-dirty'],true);assert.ok(h.button('재작성 결과 확인'));assert.equal(child(h).props.disabled,true);
   offline=false;await h.click('재작성 결과 확인');assert.equal(posts.length,1);assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);
  }finally{h.close();}
 }
 cases.push({name:'committed non-success response',statuses:[503,409],uncertainUntilRead:true,duplicatePosts:0});
});

test('dirty fields, pending references and retained callbacks cannot initiate rewrite',async()=>{
 const{h,posts}=setup();try{
  await h.idle();const oldRewrite=h.button('표시사항 재작성').props.onClick;h.edit('선택 옵션 제조원','남겨둘 편집');oldRewrite();await h.idle();assert.equal(posts.length,0);assert.equal(confirmations.length,0);assert.equal(h.input('선택 옵션 제조원').props.value,'남겨둘 편집');
  await h.click('입력 취소·저장 표시사항 다시 조회');child(h).props.onEditingChange(true);await h.idle();h.button('표시사항 재작성').props.onClick();await h.idle();assert.equal(posts.length,0);assert.equal(confirmations.length,0);
  child(h).props.onEditingChange(false);await h.idle();h.setDisabled(true);oldRewrite();await h.idle();assert.equal(posts.length,0);h.setDisabled(false);h.setActive(false);oldRewrite();await h.idle();assert.equal(posts.length,0);
  cases.push({name:'live edit guards',writes:0,unsavedInputsPreserved:true,referenceDirtyAndHiddenLocked:true});
 }finally{h.close();}
});

test('duplicate rewrite clicks and option change abort late completion without updating another scope',async()=>{
 let release;const pending=new Promise(done=>{release=done;}),held=[];
 const{h,posts,reply}=setup((url,init,next)=>{if(init?.method==='POST'){held.push({url,init});return pending;}return next(url,init);});try{
  await h.idle();const rewrite=h.button('표시사항 재작성').props.onClick;rewrite();rewrite();await waitFor(()=>held.length===1,h);assert.equal(confirmations.length,1);assert.equal(held.length,1);
  h.select('blue');assert.equal(held[0].init.signal.aborted,true);await h.idle();release(reply(held[0].url,held[0].init));await h.idle();assert.equal(posts.length,1);assert.equal(h.saved,0);assert.equal(h.input('선택 옵션 제품명').props.value,'다른 옵션 제품명');
  cases.push({name:'concurrent and stale completion',oneRequest:true,abortedOldScope:true,noWrongScopeCompletion:true});
 }finally{h.close();}
});

test('unmount aborts pending rewrite without late state writes',async()=>{
 let release;const pending=new Promise(done=>{release=done;}),held=[];const{h,reply}=setup((url,init,next)=>{if(init?.method==='POST'){held.push({url,init});return pending;}return next(url,init);});
 await h.idle();h.button('표시사항 재작성').props.onClick();await waitFor(()=>held.length===1,h);h.close();assert.equal(held[0].init.signal.aborted,true);release(reply(held[0].url,held[0].init));await new Promise(done=>setImmediate(done));assert.equal(h.lateWrites,0);
 cases.push({name:'unmount',aborted:true,lateStateWrites:0});
});
