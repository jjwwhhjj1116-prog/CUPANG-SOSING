import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,statuses=[200])=>{assert.ok(statuses.includes(response.status),response.status+': '+await response.clone().text());return response.json();};
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const file=new URL('./product-label-pipeline.test.mjs',import.meta.url),ast=ts.createSourceFile(file.pathname,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const code=ast.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='fixture').getText(ast);
const fixture=vm.runInNewContext(code+'\nfixture',{assert,mobileIntakeHarness,quotationWorkbook,webcrypto,companies,json,Uint8Array,Response,Request,File,FormData,Blob,Buffer,URL,Date,JSON});
async function setup(company=companies[0],intercept){
 const f=await fixture(company),model=f.api.load('app/product-options.ts');
 const options=await json(await f.api.route(f.base+'/options')),rows=model.optionInputs(options.options);rows.at(-1).included=false;
 await json(await f.api.route(f.base+'/options',{method:'PATCH',body:{expectedProductVersion:options.productVersion,expectedRevision:options.options.revision,rows}}));
 let labels=await f.read();labels=await json(await f.save(labels,[{optionId:f.selected.optionId,fieldKey:'productName',value:'검토한 동일 라벨'},
  {optionId:f.selected.optionId,fieldKey:'material',value:''},{optionId:f.other.optionId,fieldKey:'productName',value:'다른 옵션의 기존 수동 라벨'}]));
 const quote=await f.readQuotation(),old=quote.imageKeys[0];await f.saveQuotation(quote,[{optionId:f.selected.optionId,fieldKey:'labelImages',value:old},{optionId:f.other.optionId,fieldKey:'labelImages',value:old}]);
 labels=await f.read();const client=f.api.load('app/product-label-all-options-client.ts'),attempt=client.prepareAllProductLabelSave({productId:f.product.id,endpoint:f.endpoint,quotationEndpoint:f.quotationEndpoint,sourceOptionId:f.selected.optionId,view:labels});
 let renders=0,valid=true;const cache=new Map(),calls=[];
 const request=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:typeof init.body==='string'?JSON.parse(init.body):undefined});return intercept?intercept(url,init,f,()=>f.request(url,init),attempt):f.request(url,init);};
 const run=()=>client.completeAllProductLabelSave(attempt,{cache,assertCurrent(){assert.equal(valid,true,'same live operation incarnation');},async render(){renders++;return{blob:new Blob([png],{type:'image/png'}),width:800,height:548};}},request);
 return{f,labels,client,attempt,calls,cache,run,get renders(){return renders;},current(value){valid=value;},close(){f.api.close();}};
}
const patches=h=>h.calls.filter(row=>row.method==='PATCH'&&row.url.includes('/product-labels'));
const files=h=>h.calls.filter(row=>row.method==='POST'&&row.url==='/api/files');
const allPuts=h=>h.calls.filter(row=>row.method==='PUT'&&row.url.includes('/quotation-fields')&&row.body.changes.some(change=>change.optionId!==null&&change.value===null));

for(const company of companies)test(`one reviewed label and one common PNG reach every option including excluded (${company.companyCode})`,async()=>{
 const h=await setup(company);try{
  const source=h.f.snapshots(),result=await h.run(),labels=await h.f.read(),quote=await h.f.readQuotation();
  assert.equal(patches(h).length,1);assert.equal(files(h).length,1);assert.equal(allPuts(h).length,1);assert.equal(h.renders,1);
  assert.ok(labels.rows.some(row=>row.optionId!==null&&!row.included));assert.ok(labels.rows.every(row=>row.values.productName==='검토한 동일 라벨'&&row.values.material===''));
  assert.ok(quote.resolved.rows.every(row=>row.fields.labelImages.value===result.key));assert.ok(quote.resolved.rows.every(row=>row.optionId===null||!Object.hasOwn(quote.overrides.options[row.optionId]??{},'labelImages')));
  assert.deepEqual(h.f.snapshots(),source);assert.equal(h.f.api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  const count=h.calls.length;await h.run();assert.ok(h.calls.length>count);assert.equal(patches(h).length,1);assert.equal(files(h).length,1);assert.equal(allPuts(h).length,1);assert.equal(h.renders,1);
 }finally{h.close();}
});

test('a committed all-text acknowledgement loss stops incomplete; explicit resume reads then continues without a second PATCH',async()=>{
 let lose=true;const h=await setup(companies[0],async(url,init,f,send)=>{const response=await send();if(lose&&url.includes('/product-labels')&&init.method==='PATCH'){lose=false;throw Error('synthetic text ACK lost');}return response;});
 try{await assert.rejects(h.run(),/text ACK lost/);assert.equal(h.attempt.textView,undefined);assert.equal(h.attempt.textRequested,true);assert.equal(files(h).length,0);
  const count=h.calls.length;const result=await h.run();assert.equal(h.calls[count].method,'GET');assert.ok(result.key);assert.equal(patches(h).length,1);assert.equal(files(h).length,1);assert.equal(h.renders,1);
 }finally{h.close();}
});

test('an uncommitted all-text failure is read before one explicit retry and never creates a PNG early',async()=>{
 let fail=true;const h=await setup(companies[0],async(url,init,f,send)=>{if(fail&&url.includes('/product-labels')&&init.method==='PATCH'){fail=false;return Response.json({error:'synthetic text unavailable'},{status:503});}return send();});
 try{await assert.rejects(h.run(),/text unavailable/);assert.equal(files(h).length,0);assert.equal(h.renders,0);const count=h.calls.length;
  await h.run();assert.equal(h.calls[count].method,'GET');assert.equal(patches(h).length,2);assert.equal(files(h).length,1);
 }finally{h.close();}
});

for(const mode of ['failed-upload','lost-upload-ack'])test(`common PNG phase preserves its exact recipe and does not repeat text or rendering after ${mode}`,async()=>{
 let fail=true;const h=await setup(companies[1],async(url,init,f,send)=>{
  if(fail&&url==='/api/files'&&init.method==='POST'){fail=false;if(mode==='failed-upload')return Response.json({error:'synthetic upload unavailable'},{status:503});const response=await send();assert.equal(response.status,200);throw Error('synthetic upload ACK lost');}return send();
 });try{
  if(mode==='failed-upload'){await assert.rejects(h.run(),/upload unavailable/);assert.ok(h.attempt.textView);assert.equal(h.renders,1);await h.run();}else await h.run();
  assert.equal(patches(h).length,1);assert.equal(h.renders,1);assert.equal(files(h).length,mode==='failed-upload'?2:1);assert.equal(allPuts(h).length,1);
  assert.equal([...h.f.api.objects.keys()].filter(key=>/^owner\/quotation-label-[a-f0-9]{64}\.png$/.test(key)).length,1);
 }finally{h.close();}
});

test('lost final all-reference PUT acknowledgement is confirmed by read-only resume with no repeated PUT or PNG',async()=>{
 let lose=true;const h=await setup(companies[0],async(url,init,f,send)=>{const response=await send();if(lose&&url.includes('/quotation-fields')&&init.method==='PUT'&&JSON.parse(init.body).changes.some(change=>change.optionId!==null&&change.value===null)){lose=false;throw Error('synthetic final ACK lost');}return response;});
 try{await assert.rejects(h.run(),/final ACK lost/);assert.ok(h.attempt.attachment);assert.equal(h.attempt.imageRequested,true);const count=h.calls.length;await h.run();
  assert.ok(h.calls.slice(count).every(call=>call.method==='GET'));assert.equal(allPuts(h).length,1);assert.equal(files(h).length,1);assert.equal(patches(h).length,1);assert.equal(h.renders,1);
 }finally{h.close();}
});

test('source incarnation loss after text dispatch prevents further phases; exact explicit recovery reuses the committed text',async()=>{
 let current=true;const h=await setup(companies[0],async(url,init,f,send)=>{const response=await send();if(current&&url.includes('/product-labels')&&init.method==='PATCH'){current=false;h.current(false);}return response;});
 try{await assert.rejects(h.run(),/same live operation incarnation/);assert.equal(files(h).length,0);h.current(true);await h.run();assert.equal(patches(h).length,1);assert.equal(files(h).length,1);
 }finally{h.close();}
});

test('a changed label after partial text save is never overwritten by a retained all-operation retry',async()=>{
 let fail=true;const h=await setup(companies[0],async(url,init,f,send)=>{if(fail&&url==='/api/files'&&init.method==='POST'){fail=false;return Response.json({error:'synthetic stop'},{status:503});}return send();});
 try{await assert.rejects(h.run(),/synthetic stop/);const view=await h.f.read();await json(await h.f.save(view,[{optionId:h.f.other.optionId,fieldKey:'material',value:'동시에 수정한 수동 값'}]));
  const before=await h.f.read(),count=h.calls.length;await assert.rejects(h.run(),/변경|바뀌/);assert.deepEqual(plain(await h.f.read()),plain(before));assert.ok(h.calls.slice(count).every(call=>call.method==='GET'));
 }finally{h.close();}
});
