import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const companies=[{companyCode:'A01526306',companyName:'유앤채'}];
const json=async(response,statuses=[200])=>{assert.ok(statuses.includes(response.status),response.status+': '+await response.clone().text());return response.json();};
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const editorFile=new URL('./product-label-editor.test.mjs',import.meta.url),editorSource=fs.readFileSync(editorFile,'utf8');
const editorAst=ts.createSourceFile(editorFile.pathname,editorSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),declarations=[];
for(const statement of editorAst.statements){if(ts.isImportDeclaration(statement))continue;if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(editorAst)==='test')break;declarations.push(statement.getText(editorAst));}
let helpers=declarations.join('\n').replaceAll('import.meta.url',JSON.stringify(editorFile.href));
for(const[before,after]of[
 ['renderer,attach}={}','renderer,attach,disabled=false,active=true}={}'],
 ['JSON.stringify(slots[i].deps)!==JSON.stringify(deps)','deps===undefined||slots[i].deps===undefined||slots[i].deps.length!==deps.length||deps.some((dep,index)=>!Object.is(dep,slots[i].deps[index]))'],
 ['{exports,Error,AbortController','{exports,crypto:webcrypto,JSON,Date,setTimeout,clearTimeout,Error,AbortController'],
 ['URL:localURL','URL:class extends URL{static createObjectURL=localURL.createObjectURL;static revokeObjectURL=localURL.revokeObjectURL;}'],
 ['version,profileId,refreshToken,onSaved()','version,profileId,refreshToken,disabled,active,onSaved()'],
 ['get saved(){return saved;}','setDisabled(value){disabled=value;render();},setActive(value){active=value;render();},profile(value){profileId=value;render();},get saved(){return saved;}'],
]){assert.ok(helpers.includes(before),'found fixture adaptation '+before);helpers=helpers.replace(before,after);}
const{editor,nodes,text,deferred}=vm.runInNewContext(helpers+'\n({editor,nodes,text,deferred})',{assert,fs,vm,path,ts,createRequire,webcrypto,Response,Blob,JSON,URL,Date,AbortController,structuredClone,TextEncoder,setImmediate,setTimeout,clearTimeout});
const pipelineFile=new URL('./product-label-pipeline.test.mjs',import.meta.url),pipelineAst=ts.createSourceFile(pipelineFile.pathname,fs.readFileSync(pipelineFile,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fixtureCode=pipelineAst.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='fixture').getText(pipelineAst);
const apiFixture=vm.runInNewContext(fixtureCode+'\nfixture',{assert,mobileIntakeHarness,quotationWorkbook,webcrypto,companies,json,Uint8Array,Response,Request,File,FormData,Blob,Buffer,URL,Date,JSON});
async function setup(intercept){
 const f=await apiFixture(companies[0]),model=f.api.load('app/product-options.ts'),options=await json(await f.api.route(f.base+'/options')),rows=model.optionInputs(options.options);rows.at(-1).included=false;
 await json(await f.api.route(f.base+'/options',{method:'PATCH',body:{expectedProductVersion:options.productVersion,expectedRevision:options.options.revision,rows}}));
 let view=await f.read();await json(await f.save(view,[{optionId:f.selected.optionId,fieldKey:'productName',value:'현재 선택 수동 표시사항'},{optionId:f.selected.optionId,fieldKey:'material',value:''},{optionId:f.other.optionId,fieldKey:'productName',value:'다른 옵션 기존 수동 내용'}]));
 const quote=await f.readQuotation();await f.saveQuotation(quote,[{optionId:f.selected.optionId,fieldKey:'labelImages',value:quote.imageKeys[0]},{optionId:f.other.optionId,fieldKey:'labelImages',value:quote.imageKeys[0]}]);
 view=await f.read();let h;const request=(url,init={})=>intercept?intercept(url,init,f,()=>f.request(url,init),()=>h):f.request(url,init);
 h=editor(request,{productId:f.product.id,optionId:f.selected.optionId,profileId:f.profile.id,version:view.productVersion,
  renderer:async()=>({blob:new Blob([png],{type:'image/png'}),width:800,height:548}),attach:(input,scoped)=>f.api.load('app/product-label-attachment.ts').attachProductLabel(input,scoped)});
 await h.idle();return{f,h,view,close(){h.close();f.api.close();}};
}
const writes=h=>h.calls.filter(call=>call.init?.method&&call.init.method!=='GET');
const patches=h=>h.calls.filter(call=>call.init?.method==='PATCH'&&call.url.includes('/product-labels'));
const files=h=>h.calls.filter(call=>call.init?.method==='POST'&&call.url==='/api/files');
const allPuts=h=>h.calls.filter(call=>call.init?.method==='PUT'&&call.url.includes('/quotation-fields')&&JSON.parse(call.init.body).changes.some(change=>change.optionId!==null&&change.value===null));
const review=h=>nodes(h.render()).find(node=>node.props?.['aria-label']==='전체 옵션 동일 라벨 저장 검토');
async function waitFor(check,h){const deadline=Date.now()+10000;while(!check()){assert.ok(Date.now()<deadline,'editor reached expected phase');h.render();await new Promise(resolve=>setImmediate(resolve));}}

test('all-options review lists exact target count, overwritten manual and blank values; cancel keeps draft and performs no writes',async()=>{
 const{f,h,view,close}=await setup();try{
  const before=plain(await f.read());h.edit('선택 옵션 제품명','새로 검토한 공통 라벨');h.edit('선택 옵션 원료명 및 성분명(재질)','');
  const single=h.button('정보 저장하기').props.onClick,edit=h.input('선택 옵션 제품명').props.onChange,restore=h.button('기본값 복원').props.onClick;
  await h.click('전체 옵션에 동일 라벨 저장');assert.ok(review(h));assert.match(text(review(h)),new RegExp('전체 '+view.rows.filter(row=>row.optionId!==null).length+'개 옵션'));
  assert.match(text(review(h)),/다른 옵션 기존 수동 내용/);assert.match(text(review(h)),/직접 수정/);assert.match(text(review(h)),/\(공란\)/);assert.match(text(review(h)),/견적 제외/);
  assert.equal(writes(h).length,0);assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-dirty'],true);
  assert.ok(nodes(h.render()).some(node=>node.type==='fieldset'&&node.props.disabled));
  const references=nodes(h.render()).find(node=>typeof node.type==='function'&&node.type.name==='ProductLabelReferenceEditor');assert.equal(references.props.disabled,true);assert.equal(references.props.beforeSave(),false);
  single();restore();edit({target:{value:'늦은 단일 입력'}});await h.idle();assert.equal(writes(h).length,0);assert.equal(h.input('선택 옵션 제품명').props.value,'새로 검토한 공통 라벨');
  await h.click('전체 옵션 저장 검토 취소');assert.equal(review(h),undefined);assert.equal(writes(h).length,0);assert.equal(h.input('선택 옵션 제품명').props.value,'새로 검토한 공통 라벨');
  assert.deepEqual(plain(await f.read()),before);assert.equal(h.render().props['data-workspace-dirty'],true);
 }finally{close();}
});

test('cancelled review callback never confirms a later review even when scope and draft are unchanged',async()=>{
 const{h,close}=await setup();try{
  await h.click('전체 옵션에 동일 라벨 저장');const old=h.button('검토한 내용으로 전체 옵션 저장').props.onClick;
  await h.click('전체 옵션 저장 검토 취소');await h.click('전체 옵션에 동일 라벨 저장');old();await h.idle();assert.equal(writes(h).length,0);assert.ok(review(h));assert.equal(h.saved,0);
  await h.click('검토한 내용으로 전체 옵션 저장');assert.equal(h.saved,1);assert.equal(patches(h).length,1);
 }finally{close();}
});

test('explicit reviewed confirm saves one PNG and all text including excluded, then publishes one completion',async()=>{
 const{f,h,close}=await setup();try{
  const original=f.snapshots();h.edit('선택 옵션 제품명','전체 검토 제품 표시');h.edit('선택 옵션 내용량','3개');await h.click('전체 옵션에 동일 라벨 저장');
  const confirm=h.button('검토한 내용으로 전체 옵션 저장').props.onClick;confirm();confirm();await h.idle();assert.equal(h.saved,1,text(h.render()));
  assert.equal(patches(h).length,1);assert.equal(files(h).length,1);assert.equal(allPuts(h).length,1);assert.equal(h.plans.length,1);assert.equal(h.render().props['data-workspace-dirty'],false);
  assert.match(text(h.render()),/전체 .*개 옵션에 동일한 표시사항과 PNG 한 장을 저장/);assert.equal(review(h),undefined);
  const labels=await f.read(),quote=await f.readQuotation(),key=quote.resolved.rows[0].fields.labelImages.value;
  assert.ok(labels.rows.every(row=>row.values.productName==='전체 검토 제품 표시'&&row.values.netContents==='3개'&&row.values.material===''));
  assert.ok(labels.rows.some(row=>row.optionId!==null&&!row.included));assert.ok(quote.resolved.rows.every(row=>row.fields.labelImages.value===key));
  assert.ok(quote.resolved.rows.every(row=>row.optionId===null||!Object.hasOwn(quote.overrides.options[row.optionId]??{},'labelImages')));assert.deepEqual(f.snapshots(),original);
 }finally{close();}
});

test('lost final acknowledgement stays locked and incomplete; explicit read-first recovery never repeats PNG or final PUT',async()=>{
 let lose=true;const{f,h,close}=await setup(async(url,init,fixture,send)=>{const response=await send();if(lose&&init.method==='PUT'&&url.includes('/quotation-fields')&&JSON.parse(init.body).changes.some(change=>change.optionId!==null&&change.value===null)){lose=false;throw Error('synthetic final ACK lost');}return response;});
 try{
  const single=h.button('정보 저장하기').props.onClick,refresh=h.button('저장 표시사항 다시 조회').props.onClick,edit=h.input('선택 옵션 제품명').props.onChange;
  await h.click('전체 옵션에 동일 라벨 저장');await h.click('검토한 내용으로 전체 옵션 저장');assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-dirty'],true);
  assert.match(text(h.render()),/전체 PNG 연결 완료는 확인되지 않았습니다/);assert.ok(h.button('전체 옵션 저장 결과 확인·계속'));assert.ok(nodes(h.render()).some(node=>node.type==='fieldset'&&node.props.disabled));
  const before=plain(await f.read()),count=h.calls.length;single();refresh();edit({target:{value:'늦은 단일 입력'}});await h.idle();assert.equal(h.calls.length,count);assert.deepEqual(plain(await f.read()),before);
  await h.click('전체 옵션 저장 결과 확인·계속');assert.equal(h.saved,1);assert.ok(h.calls.slice(count).every(call=>!call.init?.method||call.init.method==='GET'));assert.equal(patches(h).length,1);assert.equal(files(h).length,1);assert.equal(allPuts(h).length,1);assert.equal(h.plans.length,1);assert.equal(h.render().props['data-workspace-dirty'],false);
 }finally{close();}
});

for(const mode of ['active','disabled','source','option','profile'])test(`old all-options confirm cannot survive ${mode} round-trip`,async()=>{
 const{f,h,view,close}=await setup();try{
  await h.click('전체 옵션에 동일 라벨 저장');const confirm=h.button('검토한 내용으로 전체 옵션 저장').props.onClick;
  if(mode==='active'){h.setActive(false);h.setActive(true);}
  if(mode==='disabled'){h.setDisabled(true);h.setDisabled(false);}
  if(mode==='source'){h.source(view.productVersion,'changed');h.source(view.productVersion,'0');}
  if(mode==='option'){h.select(f.other.optionId);h.select(f.selected.optionId);}
  if(mode==='profile'){h.profile('other-profile');h.profile(f.profile.id);}
  await h.idle();confirm();await h.idle();assert.equal(writes(h).length,0,mode);assert.equal(h.saved,0);assert.ok(h.button('검토한 내용으로 전체 옵션 저장').props.disabled,mode);
  await h.click('전체 옵션 저장 검토 취소');await h.click('전체 옵션에 동일 라벨 저장');assert.equal(h.button('검토한 내용으로 전체 옵션 저장').props.disabled,false);
 }finally{close();}
});

for(const mode of ['active','disabled','source'])test(`${mode} changes while all-text request is in flight: no upload or completion; explicit resume reuses committed text`,async()=>{
 const pending=deferred();let dispatched=false;const{h,view,close}=await setup(async(url,init,fixture,send)=>{const response=await send();if(init.method==='PATCH'&&url.includes('/product-labels')){dispatched=true;await pending.promise;}return response;});
 try{await h.click('전체 옵션에 동일 라벨 저장');h.button('검토한 내용으로 전체 옵션 저장').props.onClick();await waitFor(()=>dispatched,h);
  if(mode==='active'){h.setActive(false);h.setActive(true);}if(mode==='disabled'){h.setDisabled(true);h.setDisabled(false);}if(mode==='source'){h.source(view.productVersion,'in-flight');h.source(view.productVersion,'0');}
  pending.resolve();await h.idle();assert.equal(h.saved,0);assert.equal(files(h).length,0);assert.equal(patches(h).length,1);assert.equal(h.render().props['data-workspace-dirty'],true);
  await h.click('전체 옵션 저장 결과 확인·계속');assert.equal(h.saved,1);assert.equal(patches(h).length,1);assert.equal(files(h).length,1);assert.equal(h.plans.length,1);
 }finally{close();}
});
