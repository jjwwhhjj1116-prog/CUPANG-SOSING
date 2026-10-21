import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadFixture,companies,json} from './helpers/image-download-ui.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
async function fixture(company){
 const f=await downloadFixture(company);try{
  const get=f.api.bindings.FILES.get;f.api.bindings.FILES.get=async(key,options)=>{const object=await get(key,options),bytes=f.api.objects.get(key);if(!object||!bytes)return object;const start=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.length:start+options.range.length;return {...object,body:new Response(bytes.slice(start,end)).body};};
  const endpoint=f.base+'/product-labels',view=await json(await f.api.route(endpoint)),selected=view.rows.find(row=>row.optionId),other=view.rows.filter(row=>row.optionId)[1];
  const common={productName:'공통 제품명',manufacturer:'직접 확인한 제조원',importer:company.companyName,countryOfOrigin:'',netContents:'공통 내용량',material:'공통 재질',productType:'검토 유형',precautions:'공통 주의사항',usageStandard:'검토 기준'};
  const specific={material:'선택 옵션 원료',netContents:'',precautions:'선택 옵션 주의사항'},otherSpecific={productName:'다른 옵션 품명',material:'',usageStandard:''};
  await json(await f.api.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   ...Object.entries(common).map(([fieldKey,value])=>({optionId:null,fieldKey,value})),...Object.entries(specific).map(([fieldKey,value])=>({optionId:selected.optionId,fieldKey,value})),...Object.entries(otherSpecific).map(([fieldKey,value])=>({optionId:other.optionId,fieldKey,value})),
  ]}}));
  const calls=[],plans=[],request=async(url,init={})=>{calls.push({url,method:init.method??'GET',init});return url==='/api/files'?f.api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):f.request(url,init);};
  const options={cache:new Map(),shouldStop:()=>false,onProgress:()=>{},fetcher:request,render:async(plan,optionId)=>{plans.push({plan:plain(plan),optionId});return{blob:new Blob([png,JSON.stringify(plan)],{type:'image/png'}),width:800,height:900};}};
  return {...f,endpoint,selected,other,common,specific,otherSpecific,calls,plans,options,request};
 }catch(error){f.api.close();throw error;}
}
for(const company of companies)test(`selected-product batch uses saved stage-six nine rows and explicit SKU blanks (${company.companyCode})`,async()=>{
 const f=await fixture(company);try{
  const run=f.api.load('app/product-label-batch.ts').runProductNineLabels,source=f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,optionSource=f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload,oldBytes=new Map([...f.api.objects].map(([key,bytes])=>[key,bytes.slice()]));
  const expected=await json(await f.api.route(f.endpoint));const result=await run(f.product.id,f.options);assert.equal(result.completed,6);
  assert.equal(f.plans.length,6);for(const rendered of f.plans){const row=expected.rows.find(row=>row.optionId===rendered.optionId);assert.equal(rendered.plan.format,'product-label');assert.deepEqual(rendered.plan.rows,plain(f.api.load('app/product-label.ts').productLabelDefinitions(expected).map(field=>[field.label,row.values[field.key]]).filter(([,value])=>value!=='')));assert.equal(Object.keys(row.values).length,9);assert.ok(rendered.plan.rows.every(([,value])=>value!==''));}
  assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,source);assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload,optionSource);for(const [key,bytes]of oldBytes)assert.deepEqual(f.api.objects.get(key),bytes);
  const exported=await f.exportQuote(),plan=JSON.parse(new TextDecoder().decode(exported.archive.get('supplier-hub-upload-plan.json')));for(const [index,row]of expected.rows.filter(row=>row.included).entries()){
   const images=plan.labelImages.filter(image=>image.references.some(ref=>ref.optionId===row.optionId));assert.equal(images.length,2,'keep the original manual label plus the correct nine-row PNG');
   const generated=images.find(image=>f.api.objects.get(image.key)?.length>png.length+10);assert.ok(generated);assert.deepEqual(exported.archive.get(generated.archivePath),f.api.objects.get(generated.key));
   assert.equal(exported.cells(index)[exported.fields.indexOf('labelImages')],images.map(image=>image.filename).join('\n'));
  }
 }finally{f.api.close();}
});

const writes=f=>f.calls.filter(call=>call.method!=='GET');
for(const company of companies){
 test(`only included options receive their nine-row PNG; excluded options and independent quote cells are preserved (${company.companyCode})`,async()=>{
  const f=await fixture(company);try{const helper=f.api.load('app/product-label-batch.ts'),options=await json(await f.api.route(f.base+'/options')),rows=plain(f.api.load('app/product-options.ts').optionInputs(options.options)),excluded=rows.at(-1);excluded.included=false;
   await json(await f.api.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
   let quote=await json(await f.api.route(f.base+'/quotation-fields'));await json(await f.api.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{optionId:null,fieldKey:'noticeMaterial',value:'공통 법적고시 재질'},{optionId:f.other.optionId,fieldKey:'noticeCountryOfOrigin',value:''}]}}));
   quote=await json(await f.api.route(f.base+'/quotation-fields'));const source=f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,originalExcluded=plain(quote.resolved.rows.find(row=>row.optionId===excluded.id)),oldOverrides=plain(quote.overrides);
   const result=await helper.runProductNineLabels(f.product.id,f.options);assert.equal(result.completed,5);assert.equal(f.plans.length,5);assert.ok(f.plans.every(item=>item.optionId!==excluded.id));assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,source);
   const saved=await json(await f.api.route(f.base+'/quotation-fields'));assert.deepEqual(saved.resolved.rows.find(row=>row.optionId===excluded.id),originalExcluded);assert.deepEqual(saved.overrides.common,oldOverrides.common);assert.equal(saved.overrides.options[f.other.optionId].noticeCountryOfOrigin,'');
  }finally{f.api.close();}
 });
 test(`stop/resume uses the original durable per-SKU nine-row bytes without duplicate upload (${company.companyCode})`,async()=>{
  const f=await fixture(company);try{const helper=f.api.load('app/product-label-batch.ts');let stop=false;
   f.options.shouldStop=()=>stop;f.options.onProgress=progress=>{if(progress.completed===1)stop=true;};
   const first=await helper.runProductNineLabels(f.product.id,f.options);assert.equal(first.completed,1);assert.equal(first.stopped,true);assert.equal(f.plans.length,1);const generated=[...f.api.objects].find(([,bytes])=>bytes.length>png.length+10&&bytes[0]===137),bytes=generated[1].slice();
   stop=false;f.options.onProgress=()=>{};const resumed=await helper.runProductNineLabels(f.product.id,f.options);assert.equal(resumed.completed,6);assert.equal(f.plans.length,6);assert.equal(writes(f).filter(call=>call.url==='/api/files').length,6);assert.deepEqual(f.api.objects.get(generated[0]),bytes);
   await helper.runProductNineLabels(f.product.id,f.options);assert.equal(f.plans.length,6);assert.equal(writes(f).filter(call=>call.url==='/api/files').length,6);
  }finally{f.api.close();}
 });
 test(`unresolved reference ACK stops all later SKUs, recovers only by GET and then resumes explicitly (${company.companyCode})`,async()=>{
  const f=await fixture(company);try{const helper=f.api.load('app/product-label-batch.ts');let fail=true,lost=false;
   f.options.fetcher=async(url,init={})=>{if(fail&&lost&&(init.method??'GET')==='GET'&&url===f.endpoint)throw Error('offline saved view');const response=await f.request(url,init);if(fail&&!lost&&url===f.base+'/quotation-fields'&&init.method==='PUT'){lost=true;throw Error('lost committed reference ACK');}return response;};
   const first=await helper.runProductNineLabels(f.product.id,f.options);assert.equal(first.completed,0);assert.equal(first.uncertain,true);assert.equal(f.plans.length,1);assert.equal(helper.productNineLabelBatchHeld(f.options.cache),true);const count=writes(f).length;
   fail=false;const status=await helper.recoverProductNineLabelBatch(f.product.id,f.options.cache,f.options.fetcher);assert.equal(status,'applied');assert.equal(writes(f).length,count,'read recovery performs no writes');assert.equal(helper.pendingProductNineLabelBatch(f.options.cache),null);
   const resumed=await helper.runProductNineLabels(f.product.id,f.options);assert.equal(resumed.completed,6);assert.equal(f.plans.length,6);assert.equal(writes(f).filter(call=>call.url==='/api/files').length,6);
  }finally{f.api.close();}
 });
 test(`a malformed successful ACK with exact attachment readback does not discard nine-row results (${company.companyCode})`,async()=>{
  const f=await fixture(company);try{const helper=f.api.load('app/product-label-batch.ts');let changed=false;
   f.options.fetcher=async(url,init={})=>{const response=await f.request(url,init);if(!changed&&url===f.base+'/quotation-fields'&&init.method==='PUT'){changed=true;return Response.json(null);}return response;};
   const result=await helper.runProductNineLabels(f.product.id,f.options);assert.equal(result.completed,6);assert.equal(result.uncertain,false);assert.equal(helper.pendingProductNineLabelBatch(f.options.cache),null);assert.equal(writes(f).filter(call=>call.url==='/api/files').length,6);
  }finally{f.api.close();}
 });
 test(`lost upload ACK retains its bytes and requires explicit pool/reference continuation (${company.companyCode})`,async()=>{
  const f=await fixture(company);try{const helper=f.api.load('app/product-label-batch.ts');let lost=false;
   f.options.fetcher=async(url,init={})=>{const response=await f.request(url,init);if(!lost&&url==='/api/files'&&init.method==='POST'){lost=true;throw Error('lost upload ACK');}return response;};
   const result=await helper.runProductNineLabels(f.product.id,f.options);assert.equal(result.uncertain,true);assert.equal(writes(f).length,1,'after upload uncertainty no pool/reference or next-SKU write');const existing=[...f.api.objects].filter(([key])=>key.includes('/quotation-label-'));assert.equal(existing.length,1);const bytes=existing[0][1].slice(),count=writes(f).length;
   assert.equal(await helper.recoverProductNineLabelBatch(f.product.id,f.options.cache,f.options.fetcher),'ready');assert.equal(writes(f).length,count);await helper.runProductNineLabels(f.product.id,f.options);assert.equal(f.plans.length,6);assert.equal(writes(f).filter(call=>call.url==='/api/files').length,6);assert.deepEqual(f.api.objects.get(existing[0][0]),bytes);
  }finally{f.api.close();}
 });
 test(`changed nine-row source clears an unresolved request by read-only confirmation without completion or byte deletion (${company.companyCode})`,async()=>{
  const f=await fixture(company);try{const helper=f.api.load('app/product-label-batch.ts');let fail=true,lost=false;
   f.options.fetcher=async(url,init={})=>{if(fail&&lost&&(init.method??'GET')==='GET'&&url===f.endpoint)throw Error('offline source');const response=await f.request(url,init);if(fail&&!lost&&url===f.base+'/quotation-fields'&&init.method==='PUT'){lost=true;throw Error('lost ACK');}return response;};
   assert.equal((await helper.runProductNineLabels(f.product.id,f.options)).uncertain,true);fail=false;const view=await json(await f.api.route(f.endpoint));await json(await f.api.route(f.endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:f.selected.optionId,fieldKey:'usageStandard',value:'나중에 직접 검토한 사용 기준'}]}}));
   const originalBytes=new Map([...f.api.objects].map(([key,value])=>[key,value.slice()])),count=writes(f).length;assert.equal(await helper.recoverProductNineLabelBatch(f.product.id,f.options.cache,f.options.fetcher),'changed');assert.equal(writes(f).length,count);assert.equal(helper.productNineLabelBatchHeld(f.options.cache),false);for(const [key,bytes]of originalBytes)assert.deepEqual(f.api.objects.get(key),bytes);
  }finally{f.api.close();}
 });
 test(`company change and explicit user stop release only the pending lock while preserving every uploaded object (${company.companyCode})`,async()=>{
  const f=await fixture(company);try{const helper=f.api.load('app/product-label-batch.ts');let lost=false;
   f.options.fetcher=async(url,init={})=>{const response=await f.request(url,init);if(!lost&&url==='/api/files'&&init.method==='POST'){lost=true;throw Error('lost upload');}return response;};
   assert.equal((await helper.runProductNineLabels(f.product.id,f.options)).uncertain,true);const beforeBytes=f.originals(),count=writes(f).length;
   helper.releaseProductNineLabelBatch(f.options.cache);assert.equal(helper.productNineLabelBatchHeld(f.options.cache),false);assert.equal(helper.pendingProductNineLabelBatch(f.options.cache),f.product.id);assert.equal(f.originals(),beforeBytes);
   const other=companies.find(value=>value.companyCode!==company.companyCode);f.api.setCompany({code:other.companyCode,name:other.companyName});assert.equal(await helper.recoverProductNineLabelBatch(f.product.id,f.options.cache,f.options.fetcher),'changed');assert.equal(writes(f).length,count);assert.equal(f.originals(),beforeBytes);assert.equal(helper.pendingProductNineLabelBatch(f.options.cache),null);
  }finally{f.api.close();}
 });
}
