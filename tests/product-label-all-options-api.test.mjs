import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeChartApiFixture,companies,json,plain,allTables,sha} from './helpers/supplier-hub-single-size-chart.mjs';

const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const structure=[{id:'productName',label:'확인한 제품명',required:true},{id:'material',label:'재질',required:false},{id:'custom_storage',label:'보관 방법',required:false}];
const draft={productName:'검토한 공통 제품명',material:'',custom_storage:'건조한 장소에 보관'};
function retained(f){
 const db=f.h.sqlite,product={...db.prepare('SELECT * FROM products WHERE id=?').get(f.id)};
 for(const key of ['updated_at','quote_status','image_keys'])delete product[key];
 return{product,content:db.prepare('SELECT * FROM product_content ORDER BY product_id').all(),options:db.prepare('SELECT * FROM product_options ORDER BY product_id').all(),
  settings:db.prepare('SELECT * FROM workspace_settings ORDER BY owner_id').all(),context:db.prepare('SELECT * FROM collection_context ORDER BY job_id').all(),profiles:db.prepare('SELECT * FROM category_profiles ORDER BY id').all()};
}
async function setup(company=companies[0]){
 const f=await sizeChartApiFixture(company),endpoint=f.base+'/product-labels'+f.query,quotationEndpoint=f.base+'/quotation-fields'+f.query;
 const read=()=>f.route(endpoint).then(json),readQuote=()=>f.route(quotationEndpoint).then(json),calls=[];
 const request=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body});
  if(url==='/api/files')return f.h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body}));
  return f.route(url,{method:init.method??'GET',...(init.body===undefined?{}:{body:init.body})});};
 const model=f.h.load('app/product-label.ts'),all=f.h.load('app/product-label-all-options.ts'),client=f.h.load('app/product-label-all-options-client.ts');
 const target=f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget((await readQuote()).resolved.schema.fields,'labelImages');
 await f.edit(target.linked.flatMap(fieldKey=>['synthetic-one','synthetic-excluded'].map(optionId=>({optionId,fieldKey,value:f.keys[6]}))));
 const prepare=async()=>client.prepareAllProductLabelSave({productId:f.id,endpoint,quotationEndpoint,sourceOptionId:'synthetic-one',view:await read(),draft,structure});
 const complete=(attempt,fetcher=request)=>{let renders=0;const cache=new Map(),input={cache,assertCurrent(){},render:async plan=>{renders++;assert.deepEqual(plain(plan.rows),[['확인한 제품명',draft.productName],['보관 방법',draft.custom_storage]]);return{blob:new Blob([png],{type:'image/png'}),width:800,height:240};}};return{input,get renders(){return renders;},run:()=>client.completeAllProductLabelSave(attempt,input,fetcher)};};
 return{...f,endpoint,quotationEndpoint,read,readQuote,calls,request,model,all,client,prepare,complete};
}

for(const company of companies)test(`reviewed all-option text and one PNG reach every quotation row, including excluded (${company.code})`,async()=>{
 const f=await setup(company);try{
  let view=await f.read();assert.ok(view.rows.some(row=>Object.values(row.sources).some(source=>!source.startsWith('manual-'))),'automatic provenance exercises plan projection');
  view=await json(await f.route(f.endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {optionId:null,fieldKey:'manufacturer',value:'보관할 제조사'}, {optionId:'synthetic-one',fieldKey:'manufacturer',value:'옵션 보관 제조사'},
   {optionId:'synthetic-one',fieldKey:'material',value:'이전 개별 재질'}, {optionId:'synthetic-excluded',fieldKey:'material',value:'제외 옵션 이전 재질'}]}}));
  const before=retained(f),oldFiles=new Map([...f.h.objects].map(([key,bytes])=>[key,sha(bytes)])),quoteBefore=await f.readQuote();
  const attempt=await f.prepare();assert.equal(attempt.plan.optionCount,3);assert.ok(attempt.plan.optionIds.includes('synthetic-excluded'));
  const operation=f.complete(attempt),result=await operation.run();assert.equal(operation.renders,1);
  assert.equal(f.calls.filter(call=>call.method==='PATCH').length,1);assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.method==='POST').length,1);
  const saved=await f.read(),quote=await f.readQuote(),target=f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(quote.resolved.schema.fields,'labelImages');
  for(const row of saved.rows){assert.deepEqual(plain(row.values),draft);assert.ok(Object.values(row.sources).every(value=>value==='manual-common'));}
  assert.equal(saved.rows.find(row=>row.optionId==='synthetic-excluded').included,false);
  assert.equal(saved.overrides.common.manufacturer,'보관할 제조사');assert.equal(saved.overrides.options['synthetic-one'].manufacturer,'옵션 보관 제조사');
  for(const row of quote.resolved.rows)for(const field of target.linked){assert.equal(row.fields[field].value,result.key);if(row.optionId!==null)assert.equal(Object.hasOwn(quote.overrides.options[row.optionId]??{},field),false);}
  for(const row of quote.resolved.rows){const old=quoteBefore.resolved.rows.find(value=>value.optionId===row.optionId);for(const[field,cell]of Object.entries(row.fields))if(!target.linked.includes(field))assert.deepEqual(cell,old.fields[field]);}
  assert.equal((await f.h.bindings.FILES.head(result.key)).customMetadata.productLabelOptionId,'');assert.deepEqual(f.h.objects.get(result.key),png);
  assert.deepEqual(retained(f),before);for(const[key,digest]of oldFiles)assert.equal(sha(f.h.objects.get(key)),digest);
  assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.id).supplier_hub_status,before.product.supplier_hub_status);
  const repeated=f.complete(await f.prepare());await repeated.run();assert.equal(repeated.renders,1,'a new explicit operation may render but must reuse its durable PNG upload');
  assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.method==='POST').length,1);
  const ready=await json(await f.route(f.base+'/supplier-hub-single-package'+f.query));assert.equal(ready.review.canPrepare,true,JSON.stringify(ready.review.issues));
 }finally{f.close();}
});

test('all-text PATCH rejects missing, foreign, stale, invalid and all-empty inputs without any write',async()=>{
 const f=await setup();try{
  const view=await f.read(),plan=f.all.planAllProductLabels(view,'synthetic-one',draft,structure),base={action:'apply-all-text',sourceOptionId:'synthetic-one',expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,values:plan.values,structure};
  const send=body=>f.route(f.endpoint,{method:'PATCH',body}),before=allTables(f);
  for(const body of [{...base,sourceOptionId:'foreign-option'},{...base,values:{productName:'부분 입력'}},{...base,values:{...plan.values,manufacturer:'범위 밖'}},{...base,structure:[]},{...base,values:Object.fromEntries(structure.map(field=>[field.id,'']))},{...base,unexpected:true}]){
   assert.equal((await send(body)).status,400);assert.equal(allTables(f),before);
  }
  assert.equal((await send({...base,expectedRevision:view.revision+1})).status,409);assert.equal(allTables(f),before);
  assert.equal((await f.h.load('app/api/products/[id]/product-labels/route.ts').PATCH(new Request('https://app.test'+f.endpoint,{method:'PATCH',headers:{origin:'https://foreign.test','content-type':'application/json'},body:JSON.stringify(base)}),{params:Promise.resolve({id:f.id})})).status,400);assert.equal(allTables(f),before);
  await json(await send(base));const saved=allTables(f);assert.equal((await send(base)).status,409);assert.equal(allTables(f),saved);
 }finally{f.close();}
});

for(const phase of ['text','final-image'])test(`lost ${phase} acknowledgement resumes by readback without repeating a committed write or PNG`,async()=>{
 const f=await setup();try{
  const attempt=await f.prepare();let lost=false;
  const request=async(url,init={})=>{const response=await f.request(url,init),body=init.body&&typeof init.body==='string'?JSON.parse(init.body):null;
   if(!lost&&response.ok&&(phase==='text'?url===f.endpoint&&init.method==='PATCH':url===f.quotationEndpoint&&init.method==='PUT'&&body.changes.some(change=>change.optionId!==null))){lost=true;return Response.json({error:'synthetic acknowledgement lost'},{status:503});}return response;};
  const operation=f.complete(attempt,request);await assert.rejects(operation.run(),/acknowledgement lost/);assert.equal(lost,true);
  const result=await operation.run();assert.equal(result.key,attempt.attachment.key);assert.equal(operation.renders,1);
  assert.equal(f.calls.filter(call=>call.method==='PATCH').length,1);assert.equal(f.calls.filter(call=>call.url==='/api/files'&&call.method==='POST').length,1);
  assert.equal(f.calls.filter(call=>call.url===f.quotationEndpoint&&call.method==='PUT'&&JSON.parse(call.body).changes.some(change=>change.optionId!==null)).length,1);
 }finally{f.close();}
});

test('a different intervening label save stops an uncertain attempt without new image or quotation writes',async()=>{
 const f=await setup();try{
  const attempt=await f.prepare();const operation=f.complete(attempt,async(url,init={})=>{if(url===f.endpoint&&init.method==='PATCH'){const response=await f.request(url,init);assert.equal(response.status,200);return Response.json({error:'synthetic uncertain text'},{status:503});}return f.request(url,init);});
  await assert.rejects(operation.run(),/uncertain/);const current=await f.read();await json(await f.route(f.endpoint,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{optionId:'synthetic-two',fieldKey:'material',value:'다른 작업자의 별도 입력'}]}}));
  const before=allTables(f);await assert.rejects(operation.run(),/바뀌|변경/);assert.equal(allTables(f),before);assert.equal(operation.renders,0);assert.equal(f.calls.some(call=>call.method==='POST'),false);
 }finally{f.close();}
});

test('200 options and 39 fields use common inheritance, not an oversized per-option change request',async()=>{
 const f=await setup();try{
  const view=await f.read(),base=view.rows[1],fields=[...f.model.productLabelStructure(view),...Array.from({length:30},(_,i)=>({id:`custom_bulk${i}`,label:`추가 ${i}`,required:false}))];
  view.rows=[view.rows[0],...Array.from({length:200},(_,i)=>({...structuredClone(base),optionId:'bulk-'+i,included:i%2===0}))];
  const values=Object.fromEntries(fields.map((field,i)=>[field.id,`검토값 ${i}`])),plan=f.all.planAllProductLabels(view,'bulk-0',values,fields),overrides=f.all.applyAllProductLabelValues(view,plan.values,plan.structure);
  assert.equal(plan.optionCount,200);assert.equal(Object.keys(overrides.common).filter(key=>fields.some(field=>field.id===key)).length,39);assert.equal(Object.keys(overrides.options).length,0);
  assert.ok(new TextEncoder().encode(JSON.stringify({action:'apply-all-text',values:plan.values,structure:fields})).length<96*1024);
 }finally{f.close();}
});
