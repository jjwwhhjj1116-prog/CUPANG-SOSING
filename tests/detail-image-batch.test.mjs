import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
function png(color = 200) {
 const chunk = (name, data) => { const joined = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
  for (const byte of joined) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const size = Buffer.alloc(4), check = Buffer.alloc(4); size.writeUInt32BE(data.length); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([size, joined, check]); };
 const header = Buffer.alloc(13); header.writeUInt32BE(3, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
 const rows = Buffer.alloc(26, color); rows[0] = 0; rows[13] = 0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture(company, { stage = 'detail', poolSize } = {}) {
 const google = [], h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name, translationFetcher: async url => {
  google.push(new URL(url).searchParams.get('q')); return Response.json([[['번역 문구', '中文']]]);
 } });
 try {
  const live = { ...hubSchemaSnapshot(company), inputBindings: 'couplus-paths-v1' }, raw = JSON.parse(live.schemaString);
  raw.properties.imagePage.properties.details = { type:'object', properties:{ detailedImage:{type:'string',title:'상세 이미지'}, htmlProductDetailContent:{type:'string',title:'HTML 상세 내용'} } };
  raw.properties.imagePage.properties.images = {type:'object',properties:{additionalImage:{type:'string',title:'추가 이미지'}}};
  live.schemaString = JSON.stringify(raw);
  const fields = h.load('app/quotation-schema.ts').getQuotationSchema(live.categoryId, schemaPath, live).fields.map(field => field.id);
  const workbook = quotationWorkbook(fields), hash = sha(workbook), storageKey = h.load('db/category-templates.ts').templateKey('owner', hash, 'xlsx'); h.objects.set(storageKey, workbook);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name:'일괄 상세 번역 시험',categoryId:live.categoryId,categoryPath:schemaPath,hubSchema:live,
   template:{name:'synthetic-detail-batch.xlsx',format:'xlsx',sha256:hash,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false})) }, 'cat');
  h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job'); await h.intake();
  const product = () => h.sqlite.prepare('SELECT * FROM products').get(), id = product().id, base = '/api/products/'+id, qurl = base+'/quotation-fields?profileId='+profile.id;
  const keys = JSON.parse(product().image_keys);
  if (poolSize) { while(keys.length<poolSize)keys.push(`owner/fixture-source-${keys.length}.png`);h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(keys),id); }
  keys.forEach((key,index) => h.objects.set(key, new Uint8Array(png(index))));
  const get = h.bindings.FILES.get; h.bindings.FILES.get = async (key, options) => { const object = await get(key,options); if (!object) return null;
   const bytes = new Uint8Array(h.objects.get(key)); return {...object,body:new Response(bytes).body,arrayBuffer:async()=>bytes.slice().buffer}; };
  const read = () => h.route(qurl).then(json); let view = await read();
  const selected = view.resolved.rows.find(row=>row.optionId).optionId, other = view.resolved.rows.filter(row=>row.optionId)[1].optionId;
  const inputName=stage==='additional'?'additionalImages':'detailImages',target = h.load('app/quotation-image-targets.ts').optionImageTargets(view.resolved.schema.fields)[inputName];
  const order = [keys[2], keys[0], keys[3]];
  await json(await h.route(qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   ...target.linked.map(fieldKey=>({optionId:selected,fieldKey,value:order.join('\n')})), {optionId:selected,fieldKey:'detailHtml',value:'<p>보존할 수동 HTML</p>'},
   {optionId:other,fieldKey:inputName,value:''},{optionId:selected,fieldKey:'searchTags',value:''}]}})); view = await read();
  const imageRoute = h.load('app/api/products/[id]/image-text/route.ts'), context = {params:Promise.resolve({id})}, calls = [];
  let intercept = null;
  const fetcher = async (url, init={}) => {
   calls.push({url,init}); if (intercept) { const response = await intercept(url,init); if (response !== undefined) return response; }
   if (url.includes('/image-text')) return imageRoute[init.method??'GET'](new Request('https://app.test'+url,init),context);
   return h.route(url,{method:init.method??'GET',body:init.body});
  };
  const deps = {fetcher,readSource:async(productId,version,key,role,signal,_fetch,target)=>{
   signal.throwIfAborted(); const params = new URLSearchParams({sourceKey:key,role,target:'quotation',profileId:target.profileId,optionId:target.optionId,fieldKey:target.fieldKey,slotIndex:String(target.slotIndex)});
   const {source} = await json(await fetcher(base+'/image-text?'+params,{signal})); assert.equal(source.productVersion,version); assert.equal(source.quotationTarget.value,target.value);
   return {source,blob:new Blob([h.objects.get(key)],{type:'image/png'}),canvas:{},width:source.width,height:source.height};
  },recognize:async(image,language)=>[{id:'line',text:language==='zh'?'中文':'English',confidence:95,selected:true,box:{x:0,y:0,width:3,height:2},translated:'',issue:null,translationProvenance:'empty',background:'#ffffff',foreground:'#000000',fontSize:1},
   {id:'foreign',text:language==='zh'?'English':'中文',confidence:99,selected:true,box:{x:0,y:0,width:3,height:2},translated:'',issue:null,translationProvenance:'empty',background:'#ffffff',foreground:'#000000',fontSize:1}],
   render:async(image,regions)=>{assert.equal(regions.find(row=>row.id==='foreign').selected,false,'other language remains original');return{source:image.source,output:new Blob([png(90+image.source.quotationTarget.slotIndex)],{type:'image/png'}),width:image.width,height:image.height};}};
  const model = h.load('app/detail-image-batch.ts'), input = {productId:id,optionId:selected,profileId:profile.id,stage,language:'zh',view};
  const sourceRows = () => JSON.stringify(Object.fromEntries(['product_content','product_options','product_price_policy','product_labels','collection_context','collection_products','collection_results'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));
  const prepare = (extra={}) => model.prepareDetailImageBatch(input,new AbortController().signal,()=>{},{...deps,...extra});
  return {h,model,input,view,keys,order,id,base,qurl,profile,selected,other,read,google,calls,deps,prepare,product,sourceRows,intercept(value){intercept=value;},close(){h.close();}};
 } catch(error) {h.close();throw error;}
}

for (const company of schemaCompanies) {
 test(`English image batch keeps its language when its editable result is saved and reopened (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const now=new Date().toISOString(),email=company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com';
   f.h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at,reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner',email,'fixture-not-a-password',company.code==='A01526306'?'admin':'member','approved',company.code,company.name,now,now,null);
   f.input.language='en';const before=f.sourceRows();let renderCalls=0;
   let batch=await f.prepare({render:async(image,regions,signal,optionIds,crop,language)=>{
    renderCalls++;assert.equal(language,'en');assert.deepEqual(plain(optionIds),[]);assert.equal(crop,undefined);signal.throwIfAborted();
    const rendered=await f.deps.render(image,regions);
    return {...rendered,editDocument:f.h.load('app/free-image-edit-document.ts').validateFreeImageEditDocument({format:'free-image-edit-v1',width:image.width,height:image.height,sourceLanguage:language,regions},image.source)};
   }});
   assert.equal(renderCalls,3);assert.ok(batch.items.every(item=>item.status==='ready'&&item.rendered.editDocument.sourceLanguage==='en'));
   batch=await f.model.applyDetailBatchResult(batch,0,new AbortController().signal,()=>{},f.deps);
   const key=batch.items[0].appliedKey,target=batch.items[0].rendered.source.quotationTarget;
   const query=new URLSearchParams({sourceKey:key,role:'detail',target:'quotation',profileId:f.profile.id,optionId:f.selected,fieldKey:target.fieldKey,slotIndex:'0',editor:'saved'});
   const opened=await json(await f.h.load('app/api/products/[id]/image-text/route.ts').GET(new Request('https://app.test'+f.base+'/image-text?'+query),{params:Promise.resolve({id:f.id})}));
   assert.equal(opened.editDocument.sourceLanguage,'en');assert.equal(opened.editDocument.regions[0].text,'English');assert.equal(opened.editDocument.regions[0].translated,'번역 문구');
   assert.equal(opened.source.editorSource.resultKey,key);assert.equal(f.sourceRows(),before);assert.equal(f.product().supplier_hub_status,'미전송');
  }finally{f.close();}
 });
 test(`stage-four batch crosses the old 50-file boundary while preserving source/main/detail/manual values and exact XLSX/ZIP (${company.code})`,async()=>{
  const f=await fixture(company,{stage:'additional',poolSize:49});try{
   const before=f.sourceRows(),original=plain(f.product()),sourceBytes=new Map(f.keys.map(key=>[key,Buffer.from(f.h.objects.get(key))]));
   let batch=await f.prepare();assert.equal(f.model.detailBatchCapacity(batch.view),101);assert.ok(batch.items.every(row=>row.status==='ready'&&row.rendered.source.role==='additional'&&row.rendered.source.quotationTarget.input==='additionalImages'));
   const overrides=plain(batch.view.overrides),applied=[];for(const index of [0,2]){batch=await f.model.applyDetailBatchResult(batch,index,new AbortController().signal,()=>{},f.deps);applied.push(batch.items[index].appliedKey);}
   assert.equal(batch.view.imageKeys.length,51);assert.equal(f.model.detailBatchCapacity(batch.view),99);const target=f.h.load('app/quotation-image-targets.ts').optionImageTargets(batch.view.resolved.schema.fields).additionalImages;
   assert.equal(batch.view.resolved.rows.find(row=>row.optionId===f.selected).fields[target.primary].value,[applied[0],f.order[1],applied[1]].join('\n'));
   const final=plain(batch.view.overrides);for(const field of target.linked){delete final.options[f.selected][field];delete overrides.options[f.selected][field];}assert.deepEqual(final,overrides);
   assert.equal(f.sourceRows(),before);for(const [key,bytes]of sourceBytes)assert.deepEqual(Buffer.from(f.h.objects.get(key)),bytes);for(const field of Object.keys(original).filter(key=>!['image_keys','quote_status','updated_at'].includes(key)))assert.equal(f.product()[field],original[field]);
   const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}})),response=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());
   const reader=f.h.load('app/xlsx-template.ts'),archive=await reader.readXlsxArchive(await response.arrayBuffer()),document=JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))),plan=JSON.parse(new TextDecoder().decode(archive.get('supplier-hub-upload-plan.json'))),rowIndex=document.rows.findIndex(row=>row.optionId===f.selected);
   const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename))),cell=reader.xlsxHeaders(sheet,'견적서',rowIndex+2)[f.profile.template.headers.indexOf(target.primary)];
   assert.equal(cell,[applied[0],f.order[1],applied[1]].map(key=>document.uploadFilenames[key]).join('\n'));
   for(const [index,key]of [[0,applied[0]],[2,applied[1]]]){const image=plan.productImages.find(value=>value.key===key);assert.ok(image);assert.deepEqual(Buffer.from(archive.get(image.archivePath)),png(90+index));}
   assert.equal(f.product().supplier_hub_status,'미전송');
  }finally{f.close();}
 });
 test(`stage-four ACK loss recovers only the exact additional slot and preserves the pending original (${company.code})`,async()=>{
  const f=await fixture(company,{stage:'additional'});try{let batch=await f.prepare(),uploads=0;const route=f.h.load('app/api/products/[id]/image-text/route.ts');
   f.intercept(async(url,init)=>{if(init.body instanceof FormData){uploads++;await route.POST(new Request('https://app.test'+url,init),{params:Promise.resolve({id:f.id})});throw Error('fixture additional ACK lost');}});
   await assert.rejects(f.model.applyDetailBatchResult(batch,1,new AbortController().signal,value=>{batch=value;},f.deps));assert.equal(batch.items[1].status,'uncertain');assert.equal(uploads,1);
   await assert.rejects(f.model.applyDetailBatchResult(batch,0,new AbortController().signal,()=>{},f.deps));f.intercept(null);batch=await f.model.recoverDetailBatchResult(batch,new AbortController().signal,()=>{},f.deps);
   assert.equal(batch.items[1].status,'applied');assert.equal(uploads,1);assert.equal(batch.view.resolved.rows.find(row=>row.optionId===f.selected).fields.additionalImages.value,[f.order[0],batch.items[1].appliedKey,f.order[2]].join('\n'));assert.ok(batch.items[0].rendered);assert.ok(batch.items[2].rendered);
  }finally{f.close();}
 });
 test(`batch capacity150 and current schema item limits reject before OCR or upload without removing originals (${company.code})`,async()=>{
  const f=await fixture(company,{stage:'additional',poolSize:150});try{const snapshot=plain(f.product()),objects=[...f.h.objects.keys()];assert.equal(f.model.detailBatchCapacity(f.view),0);let ocr=0;
   await assert.rejects(f.prepare({recognize:async()=>{ocr++;return[];}}),/공간/);assert.equal(ocr,0);assert.equal(f.google.length,0);assert.deepEqual(plain(f.product()),snapshot);assert.deepEqual([...f.h.objects.keys()],objects);
   const limited=plain(f.view);for(const field of f.h.load('app/quotation-image-targets.ts').optionImageTargets(limited.resolved.schema.fields).additionalImages.fields)field.maxItems=2;
   assert.throws(()=>f.model.detailBatchSelection(limited,f.selected,f.profile.id,'additional'));assert.ok(!f.calls.some(row=>row.init.body instanceof FormData));
  }finally{f.close();}
  const final=await fixture(company,{stage:'additional',poolSize:149});try{let batch=await final.prepare();batch=await final.model.applyDetailBatchResult(batch,0,new AbortController().signal,()=>{},final.deps);assert.equal(batch.view.imageKeys.length,150);
   const objects=[...final.h.objects.keys()],source=final.sourceRows(),uploads=final.calls.filter(row=>row.init.body instanceof FormData).length;
   await assert.rejects(final.model.applyDetailBatchResult(batch,1,new AbortController().signal,()=>{},final.deps),/공간/);assert.equal(final.calls.filter(row=>row.init.body instanceof FormData).length,uploads);assert.deepEqual([...final.h.objects.keys()],objects);assert.equal(final.sourceRows(),source);
  }finally{final.close();}
 });
 test(`a prepared additional result cannot be retargeted to detail after its preceding self-commit (${company.code})`,async()=>{
  const f=await fixture(company,{stage:'additional'});try{let batch=await f.prepare();batch=await f.model.applyDetailBatchResult(batch,0,new AbortController().signal,()=>{},f.deps);const before=plain(f.product()),objects=[...f.h.objects.keys()],uploads=f.calls.filter(row=>row.init.body instanceof FormData).length;
   const view=await f.read();await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:f.selected,fieldKey:'detailImages',value:f.order.join('\n')}]}}));
   const retargeted={...batch,stage:'detail',view:await f.read()};await assert.rejects(f.model.applyDetailBatchResult(retargeted,1,new AbortController().signal,()=>{},f.deps));assert.equal(f.calls.filter(row=>row.init.body instanceof FormData).length,uploads);assert.deepEqual([...f.h.objects.keys()],objects);assert.equal(f.product().image_keys,before.image_keys);
  }finally{f.close();}
 });
 test(`English detail batch preserves Chinese pixels and applies only an explicitly reviewed result (${company.code})`,async()=>{
  const f=await fixture(company);try{const before=f.sourceRows();let batch=await f.model.prepareDetailImageBatch({...f.input,language:'en'},new AbortController().signal,()=>{},f.deps);
   assert.ok(batch.items.every(row=>row.status==='ready'));assert.ok(f.google.every(value=>value==='English'));assert.ok(batch.items.every(row=>row.texts.length===1&&row.texts[0].original==='English'));
   batch=await f.model.applyDetailBatchResult(batch,1,new AbortController().signal,()=>{},f.deps);const target=f.h.load('app/quotation-image-targets.ts').optionImageTargets(batch.view.resolved.schema.fields).detailImages;
   assert.equal(batch.view.resolved.rows.find(row=>row.optionId===f.selected).fields[target.primary].value,[f.order[0],batch.items[1].appliedKey,f.order[2]].join('\n'));assert.equal(f.sourceRows(),before);
  }finally{f.close();}
 });
 test(`detail batch prepares saved ordered slots through actual Google route without writes, then applies reviewed slots to exact XLSX/ZIP (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const before=f.sourceRows(), initialProduct=plain(f.product()), objects=[...f.h.objects.keys()];
   let batch=await f.prepare(); assert.deepEqual(plain(batch.items.map(row=>row.sourceKey)),f.order);assert.ok(batch.items.every(row=>row.status==='ready'));
   assert.equal(f.google.length,3);assert.ok(f.google.every(value=>value==='中文'));assert.equal(f.sourceRows(),before);assert.deepEqual(plain(f.product()),initialProduct);assert.deepEqual([...f.h.objects.keys()],objects);
   assert.ok(!f.calls.some(row=>row.init.body instanceof FormData));
   const old=plain(batch.view.overrides); const applied=[];
   for(const index of [0,2]) {batch=await f.model.applyDetailBatchResult(batch,index,new AbortController().signal,()=>{},f.deps);applied.push(batch.items[index].appliedKey);}
   assert.deepEqual(plain(batch.items.map(row=>row.status)),['applied','ready','applied']);const current=await f.read(), target=f.h.load('app/quotation-image-targets.ts').optionImageTargets(current.resolved.schema.fields).detailImages;
   assert.equal(current.resolved.rows.find(row=>row.optionId===f.selected).fields[target.primary].value,[applied[0],f.order[1],applied[1]].join('\n'));
   const final=plain(current.overrides);for(const fieldKey of target.linked){delete old.options[f.selected][fieldKey];delete final.options[f.selected][fieldKey];}assert.deepEqual(final,old);
   assert.equal(f.sourceRows(),before);for(const key of f.order)assert.deepEqual(Buffer.from(f.h.objects.get(key)),png(f.keys.indexOf(key)));
   const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));
   const exported=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
   const reader=f.h.load('app/xlsx-template.ts'),archive=await reader.readXlsxArchive(await exported.arrayBuffer()),document=JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))),plan=JSON.parse(new TextDecoder().decode(archive.get('supplier-hub-upload-plan.json')));
   const rowIndex=document.rows.findIndex(row=>row.optionId===f.selected), sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename)));
   const cell=reader.xlsxHeaders(sheet,'견적서',rowIndex+2)[f.profile.template.headers.indexOf(target.primary)];for(const key of applied)assert.ok(cell.includes(document.uploadFilenames[key]));
   for(const [index,key] of [[0,applied[0]],[2,applied[1]]]){const image=plan.productImages.find(row=>row.key===key);assert.ok(image);assert.deepEqual(Buffer.from(archive.get(image.archivePath)),png(90+index));}
   assert.equal(f.product().supplier_hub_status,'미전송');assert.ok(!f.h.network.some(host=>/supplier\.coupang|couplus/.test(host)));
  }finally{f.close();}
 });
 test(`individual unreadable and translation failures preserve originals and other prepared results (${company.code})`,async()=>{
  const f=await fixture(company);try{const before=f.sourceRows(),objects=[...f.h.objects.keys()];let active=0,max=0;
   const batch=await f.prepare({recognize:async(image,language,...args)=>{active++;max=Math.max(max,active);try{if(image.source.quotationTarget.slotIndex===1)throw Error('읽을 수 있는 문구를 찾지 못했습니다.');return f.deps.recognize(image,language,...args);}finally{active--;}}
   ,translate:async(source,language,regions,signal,fetcher)=>source.quotationTarget.slotIndex===2?{source,regions:regions.map(row=>({id:row.id,original:row.text,translated:null,issue:'Google 번역 HTTP 429'})),requests:1,stoppedHttpStatus:429,warnings:[]}:
   f.h.load('app/free-image-translation-client.ts').translateFreeImageRegions(source,language,regions,signal,fetcher)});
   assert.deepEqual(plain(batch.items.map(row=>row.status)),['ready','failed','failed']);assert.match(batch.items[1].message,/문구/);assert.match(batch.items[2].message,/429/);assert.equal(max,1);assert.equal(f.sourceRows(),before);assert.deepEqual([...f.h.objects.keys()],objects);
  }finally{f.close();}
 });
 test(`source order edits and approved-company changes block prepared batch before upload (${company.code})`,async()=>{
  for(const mode of ['order','company']){const f=await fixture(company);try{const batch=await f.prepare(), objects=[...f.h.objects.keys()];
   if(mode==='order'){const view=await f.read();await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:f.selected,fieldKey:'detailImages',value:[...f.order].reverse().join('\n')}]}}));}
   else f.h.setCompany(schemaCompanies.find(value=>value.code!==company.code));
   const product=plain(f.product());await assert.rejects(f.model.applyDetailBatchResult(batch,0,new AbortController().signal,()=>{},f.deps));assert.deepEqual(plain(f.product()),product);assert.deepEqual([...f.h.objects.keys()],objects);assert.ok(!f.calls.some(row=>row.init.body instanceof FormData));
  }finally{f.close();}}
 });
 test(`lost first save ACK stops without a second upload and read-only recovery confirms exact result (${company.code})`,async()=>{
  const f=await fixture(company);try{let batch=await f.prepare(),count=0;const route=f.h.load('app/api/products/[id]/image-text/route.ts');
   f.intercept(async(url,init)=>{if(init.body instanceof FormData){count++;await route.POST(new Request('https://app.test'+url,init),{params:Promise.resolve({id:f.id})});throw Error('fixture committed response lost');}});
   await assert.rejects(f.model.applyDetailBatchResult(batch,0,new AbortController().signal,value=>{batch=value;},f.deps));assert.equal(count,1);assert.equal(batch.items[0].status,'uncertain');assert.equal(batch.items[1].status,'ready');
   await assert.rejects(f.model.applyDetailBatchResult(batch,1,new AbortController().signal,()=>{},f.deps));assert.equal(count,1);const objects=[...f.h.objects.keys()];
   f.intercept(null);batch=await f.model.recoverDetailBatchResult(batch,new AbortController().signal,()=>{},f.deps);assert.equal(batch.items[0].status,'applied');assert.equal(count,1);assert.deepEqual([...f.h.objects.keys()],objects);
   await assert.rejects(f.model.applyDetailBatchResult(batch,0,new AbortController().signal,()=>{},f.deps));assert.equal(count,1);
   batch=await f.model.applyDetailBatchResult(batch,1,new AbortController().signal,()=>{},f.deps);assert.equal(batch.items[1].status,'applied');assert.equal(batch.items[2].status,'ready');
  }finally{f.close();}
 });
 test(`uncommitted ACK failure is only made ready after read-only recovery; cancellation retains exact retry PNG (${company.code})`,async()=>{
  const f=await fixture(company);try{let batch=await f.prepare();f.intercept(async(_url,init)=>{if(init.body instanceof FormData)throw Error('fixture no response before commit');});
   await assert.rejects(f.model.applyDetailBatchResult(batch,0,new AbortController().signal,value=>{batch=value;},f.deps));assert.equal(batch.items[0].status,'uncertain');
   f.intercept(null);const snapshot=plain(f.product()),objects=[...f.h.objects.keys()];batch=await f.model.recoverDetailBatchResult(batch,new AbortController().signal,()=>{},f.deps);assert.equal(batch.items[0].status,'ready');assert.deepEqual(plain(f.product()),snapshot);assert.deepEqual([...f.h.objects.keys()],objects);
   const controller=new AbortController();f.intercept(async(_url,init)=>{if(init.body instanceof FormData){controller.abort();throw Error('fixture cancellation');}});
   await assert.rejects(f.model.applyDetailBatchResult(batch,0,controller.signal,value=>{batch=value;},f.deps));assert.equal(batch.items[0].status,'uncertain');assert.ok(batch.items[0].attempt.image.output);assert.equal(batch.items[0].attempt.before.revision,batch.view.revision);
  }finally{f.close();}
 });
}


test('selected detailed photos use the real stage planner and verified image CAS even when an unrelated main-image field is invalid',async()=>{
 const company=schemaCompanies[0],f=await fixture(company);
 try{
  const now=new Date().toISOString();f.h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at,reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner','jwhj1116@kakao.com','fixture-not-a-password','admin','approved',company.code,company.name,now,now,null);
  await f.h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...f.h.load('app/workspace-settings.ts').newWorkspaceSettings,...f.h.settings,translateImages:true}));
  const stored=f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id),options=JSON.parse(stored.payload);options.rows.forEach(row=>row.included=row.id===f.selected);f.h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),f.id);
  await json(await f.h.route(f.base+'/work-draft',{method:'POST',body:{expectedVersion:f.product().updated_at,roles:['detail']}}));
  let view=await f.read();const detail=f.h.load('app/quotation-image-targets.ts').optionImageTargets(view.resolved.schema.fields).detailImages,main=f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields,'mainImage');
  await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:detail.linked.map(fieldKey=>({optionId:f.selected,fieldKey,value:null}))}}));
  // Simulate a retained legacy quotation with two images in its one-image main
  // field. Only fixture SQLite is seeded; every subsequent read/save is real.
  const quotation=f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id),state=JSON.parse(quotation.payload),scope=f.h.load('app/quotation-scopes.ts').quotationScope(f.profile.categoryId);
  for(const field of main.linked)state.categoryOverrides[scope].options[f.selected][field]=f.keys.slice(0,2).join('\n');
  f.h.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(state),f.id);
  view=await f.read();assert.throws(()=>f.h.load('app/detail-image-batch.ts').detailBatchSelection(view,f.selected,f.profile.id,'main'));
  const selected=f.h.load('app/detail-image-batch.ts').detailBatchTranslationSlots(view,f.selected,f.profile.id,'detail');assert.ok(selected.slots.length>0,'actual collected source photos are connected');
  const imageRoute=f.h.load('app/api/products/[id]/image-text/route.ts'),settingsRoute=f.h.load('app/api/settings/route.ts'),events=[];
  const fetcher=async(url,init={})=>{if(url==='/api/settings')return settingsRoute.GET();if(url.includes('/image-text')){if(init.body instanceof FormData)events.push('cas-save');return imageRoute[init.method??'GET'](new Request('https://app.test'+url,init),{params:Promise.resolve({id:f.id})});}return f.h.route(url,{method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});};
  const before={source:f.sourceRows(),main:main.linked.map(key=>view.resolved.rows.find(row=>row.optionId===f.selected).fields[key]),detail:selected.keys.slice(),objects:new Map(f.h.objects)};
  const runner=f.h.load('app/batch-selected-image-work.ts'),result=await runner.processSelectedImageStage(f.id,'detail',{ownerId:'owner',signal:new AbortController().signal,fetcher,expectedProductVersion:view.productVersion},{
   readSource:async(productId,version,key,role,signal,_fetch,target)=>{const query=new URLSearchParams({sourceKey:key,role,target:'quotation',optionId:target.optionId,fieldKey:target.fieldKey,slotIndex:String(target.slotIndex)});if(target.profileId)query.set('profileId',target.profileId);const {source}=await json(await fetcher(f.base+'/image-text?'+query,{signal}));assert.equal(source.productVersion,version);return{source,blob:new Blob([f.h.objects.get(key)],{type:'image/png'}),canvas:{},width:source.width,height:source.height};},
   recognize:async()=>{events.push('ocr');return[{id:'line',text:'中文',confidence:95,selected:true,box:{x:0,y:0,width:3,height:2},translated:'',issue:null,translationProvenance:'empty',background:'#ffffff',foreground:'#000000',fontSize:1}];},
   translate:async(source,_language,regions)=>{events.push('translation');return{source,regions:regions.map(row=>({id:row.id,original:row.text,translated:'한국어',issue:null})),requests:1,warnings:[],stoppedHttpStatus:null};},
   render:async(image,regions)=>{events.push('render');assert.equal(regions[0].translated,'한국어');return{source:image.source,output:new Blob([png(90+image.source.quotationTarget.slotIndex)],{type:'image/png'}),width:image.width,height:image.height};},
  });
  assert.equal(result.status,'completed',JSON.stringify(result.messages));assert.equal(result.applied,selected.slots.length);assert.deepEqual(events,plain(selected.slots.flatMap(()=>['ocr','translation','render','cas-save'])));
  const after=await f.read(),row=after.resolved.rows.find(row=>row.optionId===f.selected);assert.deepEqual(main.linked.map(key=>row.fields[key]),before.main);assert.equal(f.sourceRows(),before.source);for(const [key,bytes]of before.objects)assert.deepEqual(f.h.objects.get(key),bytes);assert.equal(f.product().supplier_hub_status,'미전송');
  assert.ok(after.revision>view.revision);assert.ok(selected.keys.every(key=>f.h.objects.has(key)));assert.ok(f.h.load('app/detail-image-batch.ts').detailBatchSelection(after,f.selected,f.profile.id,'detail').keys.every(key=>key.startsWith('owner/free-image-')));
  const full=await f.h.load('app/batch-image-work.ts').planBatchImageWork([{id:f.id,title:'실제 저장'}],new AbortController().signal,fetcher);assert.equal(full.tasks.length,0,'default all-stage review still reports the unrelated main field error');
 }finally{f.close();}
});
