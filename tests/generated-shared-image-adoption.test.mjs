import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';

const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
function png(h,color=0){
 const crc32=h.load('app/exports/zip.ts').crc32,chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,color,0,0,255,color,0,0,255,0,color,0,0,255,color,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(company,{batch=false}={}){
 const h=mobileIntakeHarness(company);
 try{
  const readObject=h.bindings.FILES.get;h.bindings.FILES.get=async key=>{const object=await readObject(key);return object?{...object,body:new Response(await object.arrayBuffer()).body}:null;};
  const headers=['categoryId','mainImage','additionalImages','detailImages','labelImages'],workbook=quotationWorkbook(headers),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',workbook)).toString('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  h.context.category=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'SYNTHETIC shared image proof',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:{name:'synthetic-shared.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:false}))},'cat');
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,keys=JSON.parse(product.image_keys),options=(await json(await h.route(base+'/options'))).options;
  const source=options.rows.find(row=>row.imageKey).imageKey,source2=keys.find(key=>key!==source),rest=keys.filter(key=>key!==source&&key!==source2);
  for(const key of [source,source2])h.objects.set(key,h.objects.get(key).slice(0,-1));
  let content=(await json(await h.route(base+'/content'))).content;
  content.assets.main.value=[source];content.assets.additional.value=[rest[0],source2,rest[1]];content.assets.detailTop.value=[source];content.assets.detail.value=[rest[2],source,source2,rest[3]];content.assets.detailBottom.value=[rest[4]];content.assets.label.value=[source];content.assets.size.value=[rest[5]];
  // A pre-existing shared layout is valid legacy state; production APIs preserve
  // it during unrelated manual edits. Only this isolated fixture DB is seeded.
  h.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));
  content=(await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{detail:{description:'직접 수정한 상세 설명',altText:'수동 대체 텍스트'},label:{material:'수동 재질',precautions:'수동 주의사항'}}}}))).content;
  const image=h.load('app/automation/image-edit.ts'),store=h.load('db/image-jobs.ts'),route=h.load('app/api/products/[id]/image-generation/route.ts'),settings=(await json(await route.GET(new Request('https://app.test'+base+'/image-generation'),{params:Promise.resolve({id:product.id})}))).settings,jobs=[];
  for(const [index,key] of (batch?[source,source2]:[source]).entries()){
   const current=h.sqlite.prepare('SELECT * FROM products').get(),review=await image.prepareImageReview({sourceKey:key,prompt:'SYNTHETIC reviewed translation',purpose:'translate',size:'1024x1024',quality:'low'},await image.imageMetadata(h.objects.get(key)),'gpt-image-1.5',settings),job={id:crypto.randomUUID(),productId:product.id,productVersion:current.updated_at,contentRevision:content.revision,status:'prepared',review,result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
   assert.equal((await store.createImageJob('owner',job,current.image_keys,'fixture-'+index,'SYNTHETIC-'+index)).conflict,false);assert.equal((await store.approveImageJob('owner',product.id,job.id,review.fingerprint,new Date().toISOString())).status,'approved');
   const claimed=await store.claimImageJob('owner',product.id,job.id,review.fingerprint,'FIXTURE-CLAIM',new Date().toISOString());assert.equal(claimed.status,'running');
   const bytes=png(h,index+10),metadata=await image.imageMetadata(bytes),outputKey=`owner/ai-${job.id}.png`;
   await h.bindings.FILES.put(outputKey,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{imageJobId:job.id,provenance:'generated',sha256:metadata.sha256}});
   jobs.push(await store.finishImageSuccess('owner',claimed,'FIXTURE-CLAIM',{...metadata,storageKey:outputKey,model:review.model,purpose:review.purpose,generatedAt:new Date().toISOString(),providerRequestId:null,usage:null,attached:false,assignedRole:false,provenance:'generated',reviewRequired:true}));assert.equal(jobs.at(-1).result.attached,true);
  }
  const currentKeys=JSON.parse(h.sqlite.prepare('SELECT image_keys FROM products').get().image_keys),patch=h.load('app/image-role-adoption.ts').generatedImagesRolePatch(content,jobs,currentKeys),body={expectedRevision:content.revision,patch,reviewedImageJobIds:jobs.map(job=>job.id)};
  const snapshot=()=>({product:h.sqlite.prepare('SELECT * FROM products').get(),content:h.sqlite.prepare('SELECT * FROM product_content').get(),options:h.sqlite.prepare('SELECT * FROM product_options').get(),objects:[...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes)])});
  return{h,base,source,source2,content,options,jobs,currentKeys,body,snapshot};
 }catch(error){h.close();throw error;}
}

for(const company of companies){
 test(`reviewed shared main/top/detail translation keeps originals, manual labels, option values and exact XLSX/ZIP order (${company.companyCode})`,async()=>{
  const f=await fixture(company),{h,base,jobs,content,body}=f;try{
   const before=f.snapshot(),next=(await json(await h.route(base+'/content',{method:'PATCH',body}))).content,output=jobs[0].result.storageKey;
   assert.equal(next.revision,content.revision+1);assert.deepEqual(next.assets.main.value,[output]);assert.deepEqual(next.assets.detailTop.value,[output]);assert.deepEqual(next.assets.detail.value,content.assets.detail.value.map(key=>key===f.source?output:key));
   for(const key of ['additional','detailBottom','label','size'])assert.deepEqual(next.assets[key],content.assets[key]);assert.deepEqual(next.label,content.label);assert.deepEqual(next.detail,content.detail);assert.deepEqual(next.seo,content.seo);assert.deepEqual(f.snapshot().options,before.options);assert.deepEqual(f.snapshot().objects,before.objects);
   assert.ok(f.currentKeys.includes(f.source));const original=Buffer.from(h.objects.get(f.source));
   // The separate reviewed option action keeps all manual names/prices/stock.
   const otherValues=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['imageKey','provenance','updatedAt'].includes(key)));
   await h.load('app/option-image-adoption.ts').adoptGeneratedOptionImage(next.productId,jobs[0],f.currentKeys,(url,init)=>h.route(url,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})}));
   const options=(await json(await h.route(base+'/options'))).options;assert.deepEqual(options.rows.map(otherValues),f.options.rows.map(otherValues));
   const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}})),exported=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
   const archive=readPackageZip(new Uint8Array(await exported.arrayBuffer())),fields=JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))),reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(preview.filename))),detail=h.load('app/product-content.ts').contentDetailImageKeys(next).map(key=>fields.uploadFilenames[key]).join('\n');
   for(let i=0;i<options.rows.length;i++){const row=reader.xlsxHeaders(sheet,'견적서',i+2);assert.equal(row[1],fields.uploadFilenames[options.rows[i].imageKey]);assert.equal(row[2],next.assets.additional.value.map(key=>fields.uploadFilenames[key]).join('\n'));assert.equal(row[3],detail);assert.equal(preview.rows[i][3],detail);}
   assert.equal(detail.split('\n').filter(name=>name===fields.uploadFilenames[output]).length,2);assert.deepEqual(Buffer.from(archive.get(fields.assets[output])),Buffer.from(h.objects.get(output)));assert.deepEqual(Buffer.from(archive.get(fields.assets[f.source])),original);assert.deepEqual(Buffer.from(h.objects.get(f.source)),original);
   assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.equal(h.network.some(host=>['api.openai.com','supplier.coupang.com'].includes(host)),false);
  }finally{h.close();}
 });
 test(`only complete owner-proven lineage may inherit existing shared positions; every refusal preserves data (${company.companyCode})`,async()=>{
  const f=await fixture(company),{h,base,body,jobs}=f;try{
   const before=f.snapshot(),reject=async(candidate=body)=>{await json(await h.route(base+'/content',{method:'PATCH',body:candidate}),400);assert.deepEqual(f.snapshot(),before);};
   await reject({expectedRevision:body.expectedRevision,patch:body.patch});await reject({...body,reviewedImageJobIds:[crypto.randomUUID()]});await reject({...body,reviewedImageJobIds:[jobs[0].id,jobs[0].id]});await reject({...body,patch:{assets:{main:body.patch.assets.main}}});await reject({...body,patch:{...body.patch,seo:{title:'다른 내용'}}});await reject({...body,patch:{assets:{...body.patch.assets,label:body.patch.assets.main}}});
   const row=h.sqlite.prepare('SELECT * FROM image_jobs WHERE id=?').get(jobs[0].id);
   for(const [column,value] of [['owner_id','foreign'],['product_id','other-product'],['content_revision',body.expectedRevision+1],['status','running']]){
    // Disable FK only for this deliberately foreign job identity, then restore.
    h.sqlite.exec('PRAGMA foreign_keys=OFF');h.sqlite.prepare(`UPDATE image_jobs SET ${column}=? WHERE id=?`).run(value,row.id);h.sqlite.exec('PRAGMA foreign_keys=ON');await reject();h.sqlite.exec('PRAGMA foreign_keys=OFF');h.sqlite.prepare(`UPDATE image_jobs SET ${column}=? WHERE id=?`).run(row[column],row.id);h.sqlite.exec('PRAGMA foreign_keys=ON');
   }
   for(const key of [f.source,jobs[0].result.storageKey]){const original=h.objects.get(key);h.objects.set(key,png(h,70));const altered=f.snapshot();await json(await h.route(base+'/content',{method:'PATCH',body}),400);assert.deepEqual(f.snapshot(),altered);h.objects.set(key,original);}
   const read=h.bindings.FILES.get;h.bindings.FILES.get=async key=>{const object=await read(key);return key===jobs[0].result.storageKey?{...object,customMetadata:{...object.customMetadata,imageJobId:crypto.randomUUID()}}:object;};await reject();h.bindings.FILES.get=read;
   await json(await h.route(base+'/content',{method:'PATCH',body}));
  }finally{h.close();}
 });
 test(`two reviewed shared results use one revision, preserve every slot and cannot be replayed (${company.companyCode})`,async()=>{
  const f=await fixture(company,{batch:true}),{h,base,body,content,jobs}=f;try{
   const before=f.snapshot(),next=(await json(await h.route(base+'/content',{method:'PATCH',body}))).content;assert.equal(next.revision,content.revision+1);const replacements=new Map(jobs.map(job=>[job.review.sourceKey,job.result.storageKey]));
   for(const role of ['main','additional','detailTop','detail','detailBottom'])assert.deepEqual(next.assets[role].value,content.assets[role].value.map(key=>replacements.get(key)??key));assert.deepEqual(next.assets.label,content.assets.label);assert.deepEqual(next.assets.size,content.assets.size);assert.deepEqual(f.snapshot().options,before.options);assert.deepEqual(f.snapshot().objects,before.objects);
   const committed=f.snapshot();await json(await h.route(base+'/content',{method:'PATCH',body}),409);assert.deepEqual(f.snapshot(),committed);
  }finally{h.close();}
 });
 test(`concurrent manual edits win the final content CAS after lineage reads without changing originals or options (${company.companyCode})`,async()=>{
  const f=await fixture(company),{h,base,body}=f;try{
   const read=h.bindings.FILES.head;let once=false;
   h.bindings.FILES.head=async key=>{if(!once){once=true;h.bindings.FILES.head=read;await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:body.expectedRevision,patch:{detail:{description:'동시 저장한 수동 상세'}}}}));}return read(key);};
   const before=f.snapshot();await json(await h.route(base+'/content',{method:'PATCH',body}),409);const current=(await json(await h.route(base+'/content'))).content;assert.equal(current.detail.description.value,'동시 저장한 수동 상세');assert.equal(current.assets.main.value[0],f.source);assert.deepEqual(f.snapshot().objects,before.objects);assert.deepEqual(f.snapshot().options,before.options);
  }finally{h.close();}
 });
}
