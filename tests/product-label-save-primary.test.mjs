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

const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
// PNG pixels and dimensions are a rendering-boundary fixture. These cases run
// real component/helper/API/upload/reference logic, not the canvas renderer.
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const json=async(response,statuses=[200])=>{assert.ok(statuses.includes(response.status),response.status+': '+await response.clone().text());return response.json();};
function declarations(file){const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){if(ts.isImportDeclaration(statement))continue;if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;parts.push(statement.getText(ast));}return parts.join('\n').replaceAll('import.meta.url',JSON.stringify(file.href));}
const editorFile=new URL('./product-label-editor.test.mjs',import.meta.url);
const helpers=declarations(editorFile).replace('{exports,Error,AbortController','{exports,crypto:webcrypto,JSON,Date,setTimeout,clearTimeout,Error,AbortController')
 .replace('select(id){optionId=id;render();}','select(id){optionId=id;render();},profile(id){profileId=id;render();}');
const {editor,fixture:labelFixture,deferred,text}=vm.runInNewContext(helpers+'\n({editor,fixture,deferred,text})',
 {assert,fs,vm,path,ts,createRequire,webcrypto,Response,Blob,JSON,URL,Date,AbortController,structuredClone,TextEncoder,setImmediate,setTimeout,clearTimeout});
const pipelineFile=new URL('./product-label-pipeline.test.mjs',import.meta.url),pipelineSource=fs.readFileSync(pipelineFile,'utf8');
const pipelineAst=ts.createSourceFile(pipelineFile.pathname,pipelineSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fixtureCode=pipelineAst.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='fixture').getText(pipelineAst);
const apiFixture=vm.runInNewContext(fixtureCode+'\nfixture',{assert,mobileIntakeHarness,quotationWorkbook,webcrypto,companies,json,Uint8Array,Response,Request,File,FormData,Blob,Buffer,URL,Date,JSON});
async function setup(company=companies[0],intercept){
 const f=await apiFixture(company),view=await f.read();let h;
 const request=async(url,init={})=>intercept?intercept(url,init,f,()=>f.request(url,init)):f.request(url,init);
 h=editor(request,{productId:f.product.id,optionId:f.selected.optionId,profileId:f.profile.id,version:view.productVersion,
  renderer:async()=>({blob:new Blob([png],{type:'image/png'}),width:800,height:548}),
  attach:(input,scoped)=>f.api.load('app/product-label-attachment.ts').attachProductLabel(input,scoped)});
 await h.idle();return{f,h,view,close(){h.close();f.api.close();}};
}
const labelPuts=h=>h.calls.filter(call=>call.init?.method==='PUT'&&call.url.includes('/product-labels'));
const filePosts=h=>h.calls.filter(call=>call.init?.method==='POST'&&call.url==='/api/files');
async function waitForRender(h){const deadline=Date.now()+10000;while(!h.plans.length){assert.ok(Date.now()<deadline,'primary save must reach render within ten seconds');h.render();await new Promise(resolve=>setImmediate(resolve));}}

for(const company of companies)test(`one explicit reviewed save writes text, renders, uploads and connects the exact PNG only to selected quotation (${company.companyCode})`,async()=>{
 const {f,h,view,close}=await setup(company);try{
  const protectedSource=f.snapshots(),other=plain(view.rows.filter(row=>row.optionId!==f.selected.optionId)),quoteBefore=await f.readQuotation();
  h.edit('선택 옵션 제품명','검토한 표시사항 상품');h.edit('선택 옵션 내용량','2개');h.edit('선택 옵션 원료명 및 성분명(재질)','');
  const click=h.button('정보 저장하기').props.onClick;click();click();await h.idle();
  assert.equal(labelPuts(h).length,1);assert.equal(filePosts(h).length,1);assert.equal(h.plans.length,1);assert.equal(h.attachments.length,1);assert.equal(h.saved,1);
  assert.match(text(h.render()),/PNG를 저장하고 견적서에 연결했습니다/);assert.equal(h.render().props['data-workspace-dirty'],false);
  const saved=await f.read(),quote=await f.readQuotation(),key=quote.resolved.rows.find(row=>row.optionId===f.selected.optionId).fields.labelImages.value;
  assert.equal(saved.rows.find(row=>row.optionId===f.selected.optionId).values.material,'');assert.equal(saved.rows.find(row=>row.optionId===f.selected.optionId).values.netContents,'2개');
  assert.deepEqual(plain(saved.rows.filter(row=>row.optionId!==f.selected.optionId)),other);assert.deepEqual(plain(quote.overrides.common),plain(quoteBefore.overrides.common));
  assert.deepEqual(plain(quote.overrides.options[f.other.optionId]),plain(quoteBefore.overrides.options[f.other.optionId]));
  assert.match(key,/^owner\/quotation-label-[a-f0-9]{64}\.png$/);assert.deepEqual(f.api.objects.get(key),png);assert.deepEqual(f.snapshots(),protectedSource);
  const preview=await json(await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));assert.ok(preview.rows[0][f.fields.indexOf('labelImages')].endsWith('.png'));
  assert.equal(h.calls.some(call=>call.url.includes('/product-label-draft')),false,'save never requests another AI draft');
 }finally{close();}
});

test('unchanged reviewed defaults can be saved explicitly with zero text PUT and no writes on mount',async()=>{
 const {f,h,view,close}=await setup();try{
  assert.equal(h.calls.some(call=>call.init?.method&&call.init.method!=='GET'),false);assert.equal(h.button('정보 저장하기').props.disabled,false);
  await h.click('정보 저장하기');assert.equal(labelPuts(h).length,0);assert.equal(filePosts(h).length,1);assert.equal(h.saved,1);assert.equal((await f.read()).revision,view.revision);
  assert.match((await f.readQuotation()).resolved.rows.find(row=>row.optionId===f.selected.optionId).fields.labelImages.value,/quotation-label-/);
 }finally{close();}
});

for(const failure of ['upload','quotation'])test(`partial ${failure} failure preserves saved text, stays incomplete, and explicit primary retry reuses saved recipe`,async()=>{
 let fail=true;const {f,h,close}=await setup(companies[0],async(url,init,fixture,send)=>{
  if(fail&&(failure==='upload'?url==='/api/files'&&init.method==='POST':url.includes('/quotation-fields')&&init.method==='PUT')){fail=false;return Response.json({error:'local '+failure+' unavailable'},{status:503});}return send();
 });try{
  h.edit('선택 옵션 내용량','검토한 3개');await h.click('정보 저장하기');
  assert.equal((await f.read()).rows.find(row=>row.optionId===f.selected.optionId).values.netContents,'검토한 3개');assert.equal(labelPuts(h).length,1);
  assert.match(text(h.render()),/PNG·견적 연결은 완료되지 않았습니다/);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.button('정보 저장하기').props.disabled,false);
  assert.equal(h.input('선택 옵션 내용량').props.value,'검토한 3개');assert.equal(h.plans.length,1);await h.click('정보 저장하기');
  assert.equal(labelPuts(h).length,1);assert.equal(h.plans.length,1,'same saved plan reuses rendered bytes');assert.equal(h.render().props['data-workspace-dirty'],false);
  assert.match((await f.readQuotation()).resolved.rows.find(row=>row.optionId===f.selected.optionId).fields.labelImages.value,/quotation-label-/);
  if(failure==='quotation')assert.equal(filePosts(h).length,1,'known uploaded recipe is not uploaded again');
 }finally{close();}
});

test('committed text and upload ACK losses recover by exact GET with one text write and one file POST',async()=>{
 let textLost=true,uploadLost=true;const {f,h,close}=await setup(companies[1],async(url,init,fixture,send)=>{const response=await send();
  if(textLost&&url.includes('/product-labels')&&init.method==='PUT'){textLost=false;throw Error('local text ACK lost');}
  if(uploadLost&&url==='/api/files'&&init.method==='POST'){uploadLost=false;throw Error('local upload ACK lost');}return response;
 });try{h.edit('선택 옵션 내용량','4개');await h.click('정보 저장하기');assert.equal(labelPuts(h).length,1);assert.equal(filePosts(h).length,1);assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);
  assert.match((await f.readQuotation()).resolved.rows.find(row=>row.optionId===f.selected.optionId).fields.labelImages.value,/quotation-label-/);
 }finally{close();}
});

test('manual preview and attachment can finish a failed primary save and clear its incomplete state',async()=>{
 let fail=true;const {f,h,close}=await setup(companies[0],async(url,init,fixture,send)=>{
  if(fail&&url.includes('/quotation-fields')&&init.method==='PUT'){fail=false;return Response.json({error:'local quote failure'},{status:503});}return send();
 });try{
  h.edit('선택 옵션 내용량','6개');await h.click('정보 저장하기');assert.equal(h.render().props['data-workspace-dirty'],true);
  await h.click('저장한 표시사항 PNG 미리보기');await h.click('PNG 업로드·견적에 연결');
  assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(labelPuts(h).length,1);assert.equal(filePosts(h).length,1);assert.equal(h.plans.length,1);
  assert.match((await f.readQuotation()).resolved.rows.find(row=>row.optionId===f.selected.optionId).fields.labelImages.value,/quotation-label-/);
 }finally{close();}
});

test('parent callbacks wait until rendering and quote attachment have completed',async()=>{
 const f=labelFixture(),pending=deferred();let attached=0;const h=editor((url,init)=>f.reply(url,init),{renderer:()=>pending.promise,attach:async input=>{attached++;return{view:input.renderedView,key:input.renderedView.imageKeys[0]};}});
 try{await h.idle();h.edit('선택 옵션 내용량','5개');h.button('정보 저장하기').props.onClick();await waitForRender(h);
  assert.equal(h.saved,0);assert.equal(f.view.overrides.options.red.netContents,'5개');assert.equal(attached,0);
  pending.resolve({blob:new Blob([png],{type:'image/png'}),width:800,height:548});await h.idle();assert.equal(h.saved,1);assert.equal(attached,1);
 }finally{h.close();}
});

for(const change of ['source','option','profile','unmount'])test(`late rendered reply after ${change} change never uploads, attaches or publishes an old callback`,async()=>{
 const f=labelFixture(),pending=deferred();let attached=0;const h=editor((url,init)=>f.reply(url,init),{renderer:()=>pending.promise,attach:async()=>{attached++;throw Error('stale attachment must not execute');}});
 try{await h.idle();h.edit('선택 옵션 내용량','남아 있는 저장 텍스트');h.button('정보 저장하기').props.onClick();await waitForRender(h);
  if(change==='source')h.source(f.source());else if(change==='option')h.select('blue');else if(change==='profile')h.profile('different-profile');else h.close();
  pending.resolve({blob:new Blob([png],{type:'image/png'}),width:800,height:548});for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));if(change!=='unmount')await h.idle();
  assert.equal(attached,0);assert.equal(h.saved,0);assert.equal(labelPuts(h).length,1);assert.equal(f.view.overrides.options.red.netContents,'남아 있는 저장 텍스트');assert.equal(h.lateWrites,0);
 }finally{h.close();}
});
