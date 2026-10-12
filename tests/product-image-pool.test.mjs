import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { schemaCompanies, hubSchemaSnapshot, schemaPath } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, expected=200) => {assert.equal(response.status,expected,await response.clone().text());return response.json();};
function png(color) {
 const chunk=(name,data)=>{const body=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([len,body,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(3);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;const rows=Buffer.alloc(26,color);rows[0]=rows[13]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(company,size=49){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const live={...hubSchemaSnapshot(company),inputBindings:'couplus-paths-v1'},raw=JSON.parse(live.schemaString);
  live.metadata={...live.metadata,scopeType:'Retail_Categorized_Single'};
  raw.properties.imagePage.properties.images={type:'object',properties:{additionalImage:{type:'string',title:'추가 이미지'}}};
  raw.properties.imagePage.properties.details={type:'object',properties:{detailedImage:{type:'string',title:'상세 이미지'},htmlProductDetailContent:{type:'string',title:'HTML 상세 내용'}}};live.schemaString=JSON.stringify(raw);
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema(live.categoryId,schemaPath,live),headers=schema.fields.map(field=>field.id),workbook=quotationWorkbook(headers),sha256=createHash('sha256').update(workbook).digest('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'bounded pool fixture',categoryId:live.categoryId,categoryPath:schemaPath,hubSchema:live,template:{name:'pool.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=()=>h.sqlite.prepare('SELECT * FROM products').get(),id=product().id,base='/api/products/'+id,context={params:Promise.resolve({id})};const keys=JSON.parse(product().image_keys);while(keys.length<size)keys.push(`owner/source-${keys.length}.png`);keys.forEach((key,i)=>h.objects.set(key,new Uint8Array(png(i))));
  const get=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const object=await get(key,options);if(!object)return null;const bytes=new Uint8Array(h.objects.get(key));return{...object,body:new Response(options?.range?bytes.slice(options.range.offset??0,(options.range.offset??0)+options.range.length):bytes).body,arrayBuffer:async()=>bytes.slice().buffer};};
  const patch=async(imageKeys)=>h.load('app/api/products/[id]/route.ts').PATCH(new Request('https://app.test'+base,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:product().updated_at,image_keys:JSON.stringify(imageKeys)})}),context);
  await json(await patch(keys));const qurl=base+'/quotation-fields?profileId='+profile.id,read=()=>h.route(qurl).then(json);let view=await read();const optionId=view.resolved.rows.find(row=>row.optionId).optionId;
  await json(await h.route(qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId,fieldKey:'detailImages',value:keys.slice(0,2).join('\n')},{optionId,fieldKey:'detailHtml',value:'<p>수동 검토 HTML 보존</p>'}]}}));
  const image=h.load('app/api/products/[id]/image-text/route.ts'),source=async(index)=>{const current=await read(),fieldKey=h.load('app/quotation-image-targets.ts').optionImageTargets(current.resolved.schema.fields).detailImages.primary;const params=new URLSearchParams({sourceKey:keys[index],role:'detail',target:'quotation',profileId:profile.id,optionId,fieldKey,slotIndex:String(index)});return(await json(await image.GET(new Request('https://app.test'+base+'/image-text?'+params),context))).source;};
  const apply=async(input,color)=>{const form=new FormData();form.set('action','apply');form.set('source',JSON.stringify(input));form.set('file',new File([png(color)],'translated.png',{type:'image/png'}));return image.POST(new Request('https://app.test'+base+'/image-text',{method:'POST',body:form}),context);};
  const retained=()=>JSON.stringify(Object.fromEntries(['product_options','product_price_policy','collection_context','collection_products','collection_results'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));
  return{h,id,base,context,keys,profile,headers,product,patch,qurl,read,optionId,source,apply,retained,close:()=>h.close()};
 }catch(error){h.close();throw error;}
}
for(const company of schemaCompanies){
 test(`49 originals plus two translated PNGs and reviewed label remain usable in final quotation and ZIP (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const raw=f.retained(),originals=new Map(f.keys.map(key=>[key,Buffer.from(f.h.objects.get(key))])),before=await f.read();
   const outputs=[];for(const index of [0,1])outputs.push((await json(await f.apply(await f.source(index),100+index))).key);
   assert.equal(JSON.parse(f.product().image_keys).length,51);
   const form=new FormData();form.set('file',new File([png(120)],'reviewed-label.png',{type:'image/png'}));const uploaded=await json(await f.h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:form})),201);
   const content=await f.h.load('db/product-content.ts').readProductContent('owner',f.id);
   await json(await f.h.route(f.base+'/attachments',{method:'POST',body:{key:uploaded.key,role:'label',expectedVersion:f.product().updated_at,expectedContentRevision:content.revision}}));
   let view=await f.read();await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:f.optionId,fieldKey:'labelImages',value:uploaded.key}]}}));view=await f.read();
   assert.equal(view.imageKeys.length,52);assert.deepEqual(plain(view.imageKeys.slice(0,49)),f.keys);assert.equal(f.retained(),raw);
   assert.equal(view.resolved.rows.find(row=>row.optionId===f.optionId).fields.detailHtml.value,'<p>수동 검토 HTML 보존</p>');
   for(const [key,bytes]of originals)assert.deepEqual(Buffer.from(f.h.objects.get(key)),bytes);
   assert.ok(f.h.load('app/quotation-main-image.ts').verifyMainImageView(view));const labels=await json(await f.h.route(f.base+'/product-labels?profileId='+f.profile.id));f.h.load('app/product-label.ts').verifyProductLabelsView(labels,f.optionId,f.profile.id);
   const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));const exported=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
   const reader=f.h.load('app/xlsx-template.ts'),archive=await reader.readXlsxArchive(await exported.arrayBuffer()),document=JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))),plan=JSON.parse(new TextDecoder().decode(archive.get('supplier-hub-upload-plan.json'))),index=document.rows.findIndex(row=>row.optionId===f.optionId),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename))),cells=reader.xlsxHeaders(sheet,'견적서',index+2);
   assert.equal(cells[f.headers.indexOf('detailImages')],outputs.map(key=>document.uploadFilenames[key]).join('\n'));assert.equal(cells[f.headers.indexOf('labelImages')],document.uploadFilenames[uploaded.key]);assert.equal(cells[f.headers.indexOf('detailHtml')],before.resolved.rows.find(row=>row.optionId===f.optionId).fields.detailHtml.value);
   for(const [key,color]of [[outputs[0],100],[outputs[1],101],[uploaded.key,120]]){const row=[...plan.productImages,...plan.labelImages].find(item=>item.key===key);assert.ok(row);assert.deepEqual(Buffer.from(archive.get(row.archivePath)),png(color));}
   assert.equal(f.product().supplier_hub_status,'미전송');assert.ok(!f.h.network.includes('supplier.coupang.com'));
  }finally{f.close();}
 });
 test(`150 stored files are accepted, but the 151st and role/schema overflow reject without writes (${company.code})`,async()=>{
  const f=await fixture(company,150);try{
   const snapshot=plain(f.product()),raw=f.retained(),objects=[...f.h.objects.keys()];assert.equal((await f.read()).imageKeys.length,150);
   assert.equal((await f.patch([...f.keys,'owner/overflow.png'])).status,400);assert.deepEqual(plain(f.product()),snapshot);
   const source=await f.source(0),beforeObjects=[...f.h.objects.keys()];assert.equal((await f.apply(source,180)).status,400);assert.deepEqual([...f.h.objects.keys()],beforeObjects);assert.deepEqual(plain(f.product()),snapshot);
   f.h.bindings.OPENAI_API_KEY='SYNTHETIC-NOT-A-REAL-KEY';f.h.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';
   const paid=await f.h.route(f.base+'/image-generation',{method:'POST',body:{action:'prepare',expectedVersion:f.product().updated_at,sourceKey:f.keys[0],prompt:'보이는 문구를 번역',purpose:'translate',size:'1024x1024',quality:'low',idempotencyKey:'pool-capacity-fixture'}});assert.equal(paid.status,400,await paid.clone().text());assert.equal((await paid.json()).code,'IMAGE_LIMIT');assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) AS n FROM image_jobs').get().n,0);
   const content=await f.h.load('db/product-content.ts').readProductContent('owner',f.id);f.h.objects.set('owner/extra-label.png',new Uint8Array(png(190)));
   assert.equal((await f.h.route(f.base+'/attachments',{method:'POST',body:{key:'owner/extra-label.png',role:'label',expectedVersion:f.product().updated_at,expectedContentRevision:content.revision}})).status,400);assert.deepEqual(plain(f.product()),snapshot);assert.equal(f.retained(),raw);
   const model=f.h.load('app/product-content.ts');assert.equal(model.validateContentInput({expectedRevision:content.revision,patch:{assets:{detail:f.keys.slice(0,30)}}},f.keys,'owner').patch.assets.detail.length,30);assert.throws(()=>model.validateContentInput({expectedRevision:content.revision,patch:{assets:{detail:f.keys.slice(0,31)}}},f.keys,'owner'),/상세 이미지 개수/);
   const view=await f.read(),target=f.h.load('app/quotation-image-targets.ts').optionImageTargets(view.resolved.schema.fields).additionalImages;assert.equal(target.primaryField.maxItems,30);
   assert.throws(()=>f.h.load('app/quotation-image-targets.ts').optionImageChanges(view,f.optionId,{additionalImages:f.keys.slice(0,31).join('\n')}),/이미지/);
   // A stricter captured role rule remains authoritative independently of the
   // saved library capacity. This is a synthetic5 rule, not a live Hub claim.
   const five=plain(view);for(const field of f.h.load('app/quotation-image-targets.ts').optionImageTargets(five.resolved.schema.fields).additionalImages.fields)field.maxItems=5;
   assert.ok(f.h.load('app/quotation-image-targets.ts').optionImageChanges(five,f.optionId,{additionalImages:f.keys.slice(0,5).join('\n')}));assert.throws(()=>f.h.load('app/quotation-image-targets.ts').optionImageChanges(five,f.optionId,{additionalImages:f.keys.slice(0,6).join('\n')}),/이미지/);
   assert.equal(objects.length+1,f.h.objects.size);
  }finally{f.close();}
 });
}
