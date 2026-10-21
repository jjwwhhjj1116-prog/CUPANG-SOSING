import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];

// Reuse actual component/API harness declarations without importing their test
// registrations. The four production components communicate through their real
// callback props; only layout rendering and provider output are controlled.
function declarations(file,expose){
 const url=new URL('./'+file,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
  if(!ts.isVariableStatement(statement)&&!ts.isFunctionDeclaration(statement)&&!ts.isClassDeclaration(statement)&&!ts.isExpressionStatement(statement))break;
  parts.push(statement.getText(ast));
 }
 return vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(url.href))+'\n({'+expose+'})',
  {assert,fs,vm,ts,createRequire,deflateSync,mobileIntakeHarness,hubSchemaSnapshot,schemaCompanies,schemaPath,quotationWorkbook,readPackageZip,nodes,
   URL,URLSearchParams,Blob,File,FormData,Response,Request,Headers,AbortController,DOMException,TextEncoder,TextDecoder,Uint8Array,DataView,Buffer,Date,JSON,structuredClone,crypto,console,setTimeout,clearTimeout,setImmediate});
}
const main=declarations('option-main-image-editor.test.mjs','fixture,editor,plain,text');
const image=declarations('image-generation-panel-requests.test.mjs','harness,nodes,text,settle,prepare,roles,options,execute,refresh,deferred');
const detail=declarations('detail-image-edit-dialog-integration.test.mjs','dashboard');
const all=image.nodes;
const button=(ui,label)=>all(ui.render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||image.text(node)===label));
const input=(ui,kind,value)=>all(ui.render()).find(node=>node.type===kind&&(value===undefined||node.props.value===value));
const paid=d=>nodes(d.render()).find(node=>node.type?.name==='@/app/components/image-generation-panel:default').props;

for(const company of schemaCompanies)test(`selected final main image travels through real card, options wrapper, dashboard and AI panel into one explicit local prepared job (${company.code})`,async()=>{
 const f=await main.fixture(company),d=detail.dashboard();let o,p;
 try{
  const before=await f.read(),tables=()=>JSON.stringify(['products','product_content','product_options','product_price_policy','product_quotation_fields'].flatMap(table=>f.backend.sqlite.prepare('SELECT * FROM '+table).all())),baseline=tables(),network=[...f.backend.network];
  for(const key of before.imageKeys)f.backend.objects.set(key,f.backend.objects.get(key).slice(0,-1));
  f.backend.bindings.OPENAI_API_KEY='TEST-ONLY-NOT-A-REAL-KEY';f.backend.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';
  const api=f.backend.load('app/api/products/[id]/image-generation/route.ts'),context={params:Promise.resolve({id:f.product.id})},endpoint='/api/products/'+f.product.id+'/image-generation';
  const read=()=>api.GET(new Request('https://app.test'+endpoint),context);
  d.render({workspaceOwnerId:'owner',product:{...f.product,owner_id:'owner'},tab:'대표 이미지',focusedOptionId:f.id,preferredProfileId:f.profile.id});
  const paidProps=()=>paid(d),card=()=>d.child('ProductOptionsEditor').props;
  const posts=[];
  p=image.harness(async(url,init)=>{assert.equal(url,endpoint);const body=JSON.parse(init.body);posts.push(body);assert.equal(body.action,'prepare','provider execution is forbidden in this fixture');return api.POST(new Request('https://app.test'+endpoint,{...init}),context);},
   {initialPending:read(),initialProps:{...paidProps(),productId:f.product.id,version:f.product.updated_at,imageKeys:before.imageKeys}});
  await p.idle();d.render();
  input(p,'textarea').props.onChange({target:{value:'직접 입력한 배경 보존 요청'}});input(p,'select','1024x1024').props.onChange({target:{value:'1536x1024'}});input(p,'select','low').props.onChange({target:{value:'high'}});
  o=main.editor(f,{wrapper:true,onProcess:(...args)=>card().onProcess(...args)});await o.idle();
  await o.click('최종 대표이미지 AI 처리');d.render();p.update(paidProps());await p.idle();
  const handed=paidProps().processingTarget;assert.equal(handed.sourceKey,f.key);assert.notEqual(handed.sourceKey,f.source);assert.equal(handed.quotationTarget.optionId,f.id);assert.equal(handed.quotationTarget.profileId,f.profile.id);assert.equal(handed.quotationTarget.value,f.key);assert.equal(paidProps().processingTargetActive,true);
  assert.equal(input(p,'select',f.key).props.disabled,true);assert.equal(input(p,'select','cleanup').props.disabled,true);assert.equal(input(p,'textarea').props.value,'직접 입력한 배경 보존 요청');assert.ok(input(p,'select','1536x1024'));assert.ok(input(p,'select','high'));
  assert.equal(button(p,image.roles),undefined);assert.equal(button(p,image.options),undefined);assert.equal(button(p,'검토한 결과 0개를 원본 위치에 함께 적용 · 무료'),undefined);assert.equal(posts.length,0);assert.equal(tables(),baseline);assert.equal(d.requests,0);
  p.click(image.prepare)();await p.idle();assert.equal(posts.length,1);assert.deepEqual({sourceKey:posts[0].sourceKey,purpose:posts[0].purpose,prompt:posts[0].prompt,size:posts[0].size,quality:posts[0].quality},
   {sourceKey:f.key,purpose:'cleanup',prompt:'직접 입력한 배경 보존 요청',size:'1536x1024',quality:'high'});
  const jobs=f.backend.sqlite.prepare('SELECT * FROM image_jobs').all();assert.equal(jobs.length,1);const saved=jobs[0],review=JSON.parse(saved.review);assert.equal(saved.status,'prepared');assert.equal(review.sourceKey,f.key);assert.equal(review.purpose,'cleanup');assert.equal(saved.result,null);
  assert.equal(tables(),baseline,'preparing a review cannot change any product, source, price or quotation');assert.deepEqual(f.backend.network,network);
 }finally{o?.close();p?.close();d.close();f.close();}
});

test('retained card and dashboard handoffs cannot reopen after stage, focus, profile, version or owner ABA changes',async()=>{
 const f=await main.fixture(),d=detail.dashboard();let o;
 try{
  const product={...f.product,owner_id:'owner'},base={workspaceOwnerId:'owner',product,tab:'대표 이미지',focusedOptionId:f.id,preferredProfileId:f.profile.id};d.render(base);
  o=main.editor(f,{wrapper:true,onProcess:(...args)=>d.child('ProductOptionsEditor').props.onProcess(...args)});await o.idle();const oldCard=o.button('최종 대표이미지 AI 처리').props.onClick;
  o.props.imageView=false;await o.idle();o.props.imageView=true;await o.idle();oldCard();d.render();assert.equal(paid(d).processingTarget,undefined);
  await o.click('최종 대표이미지 AI 처리');d.render();const target=paid(d).processingTarget;assert.ok(target);
  for(const patch of [{tab:'추가 이미지'},{focusedOptionId:'other'},{preferredProfileId:'other-profile'},{product:{...product,updated_at:'2099-01-01T00:00:00.000Z'}},{workspaceOwnerId:'other'}]){
   const old=d.child('ProductOptionsEditor').props.onProcess;d.render(patch);d.render(base);old(f.key,'main',target.quotationTarget);d.render();assert.equal(paid(d).processingTarget,target);assert.equal(paid(d).processingTargetActive,false);
  }
  paid(d).onCloseProcessingTarget();d.render();assert.equal(paid(d).processingTarget,undefined);assert.equal(d.requests,0);assert.ok(f.calls.every(call=>call.method==='GET'));
 }finally{o?.close();d.close();f.close();}
});

const target=()=>({sourceKey:'owner/raw',sequence:1,productVersion:'v',quotationTarget:{kind:'quotation',profileId:'profile',optionId:'one',input:'mainImage',fieldKey:'mainImage',slotIndex:0,revision:2,inputFingerprint:'a'.repeat(64),optionRevision:1,value:'owner/raw'}});
test('a selected-image handoff during initial history loading completes without another GET or any POST',async()=>{
 const pending=image.deferred(),h=image.harness(()=>{throw Error('No extra requests allowed');},{initialPending:pending.promise});
 try{h.update({processingTarget:target(),processingTargetActive:true});pending.resolve(Response.json(h.view));await h.idle();assert.equal(h.initialCalls.length,1);assert.equal(h.initialCalls[0].init.signal.aborted,false);assert.equal(h.calls.length,0);assert.ok(h.click(image.prepare));assert.equal(input(h,'select','owner/raw').props.disabled,true);}
 finally{h.close();}
});
test('pinned mode preserves its source and manual request across invalidation; retained prepare and broad apply callbacks cannot write',async()=>{
 const pending=image.deferred(),h=image.harness(()=>pending.promise);
 try{await h.idle();const oldRoles=h.click(image.roles),oldOptions=h.click(image.options),oldPrepare=h.click(image.prepare);
  input(h,'textarea').props.onChange({target:{value:'보존할 직접 입력'}});h.update({processingTarget:target(),processingTargetActive:true});await image.settle();oldRoles();oldOptions();oldPrepare();await image.settle();assert.equal(h.calls.length,0);
  const currentPrepare=h.click(image.prepare);h.update({processingTargetActive:false});h.update({processingTargetActive:true});currentPrepare();await image.settle();assert.equal(h.calls.length,0,'active ABA cannot revive a captured callback');
  const action=h.click(image.prepare);action();assert.equal(h.calls.length,1);h.update({processingTargetActive:false});assert.equal(h.calls[0].init.signal.aborted,true);pending.resolve(Response.json({job:{...h.job,status:'prepared',result:null}}));await image.settle();assert.equal(h.changed,0);assert.equal(input(h,'textarea').props.value,'보존할 직접 입력');assert.equal(input(h,'select','owner/raw').props.disabled,true);assert.equal(button(h,image.prepare).props.disabled,true);assert.equal(button(h,image.roles),undefined);assert.equal(button(h,image.options),undefined);
 }finally{h.close();}
});
test('unconfigured provider disables both selected-source preparation and an already approved execution',async()=>{
 const pending=image.deferred(),h=image.harness(()=>{throw Error('No provider request allowed');},{status:'approved',initialPending:pending.promise,initialProps:{processingTarget:target()}});
 try{h.job.review.purpose='cleanup';h.view.configuration.configured=false;h.view.configuration.issues=['검수용 미연결'];pending.resolve(Response.json(h.view));await h.idle();assert.equal(button(h,image.prepare).props.disabled,true);assert.equal(button(h,image.execute).props.disabled,true);button(h,image.prepare).props.onClick();button(h,image.execute).props.onClick();await image.settle();assert.equal(h.calls.length,0);assert.match(image.text(h.render()),/검수용 미연결/);}
 finally{h.close();}
});
test('inactive selected-image scope can explicitly reread a running job without reopening any write or losing the manual request',async()=>{
 let closed=0;const h=image.harness(async(_url,init,data)=>{assert.equal(init?.method,undefined);return Response.json({...data.view,jobs:[{...data.job,status:'completed',result:{attached:true,storageKey:'owner/edited'}}]});},
  {status:'running',initialProps:{processingTarget:target(),onCloseProcessingTarget(){closed++;}}});
 try{await h.idle();input(h,'textarea').props.onChange({target:{value:'실행 결과 확인 중에도 보존'}});h.update({processingTargetActive:false});
  assert.equal(button(h,image.prepare).props.disabled,true);assert.equal(button(h,'선택 옵션 AI 처리 종료 · 공통 작업으로 돌아가기').props.disabled,true);
  h.click(image.refresh)();await h.idle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,undefined);assert.equal(button(h,image.prepare).props.disabled,true);assert.equal(button(h,image.roles),undefined);assert.equal(button(h,image.options),undefined);assert.equal(input(h,'textarea').props.value,'실행 결과 확인 중에도 보존');
  h.click('선택 옵션 AI 처리 종료 · 공통 작업으로 돌아가기')();assert.equal(closed,1);assert.equal(h.calls.some(call=>call.init.method==='POST'||call.init.method==='PATCH'),false);
 }finally{h.close();}
});
