import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {cropApiFixture,cropOptionFixture,cropQuotationFixture,cropLabelFixture,pngBytes,plain} from './helpers/free-image-crop.mjs';
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}],sha=value=>createHash('sha256').update(Buffer.from(value)).digest('hex');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const crop={x:1,y:0,width:2,height:1,sourceWidth:3,sourceHeight:2};
const form=(source,rect=crop,bytes=pngBytes(2,1))=>{const body=new FormData();body.set('action','apply');body.set('source',JSON.stringify(source));body.set('file',new File([bytes],'cropped.png',{type:'image/png'}));if(rect!==undefined)body.set('crop',JSON.stringify(rect));return body;};

test('cropped common-role PNG is dimension-verified, replaces only its selected source and replays once',async()=>{
 const h=cropApiFixture();try{await h.prepare();const source=await h.source(),original=h.objects.get(h.key).bytes.slice(),before=await h.content(),prices=h.product();
  const reply=await json(await h.request('POST',form(source)));assert.deepEqual(reply.crop,crop);assert.equal(h.writes.length,1);assert.deepEqual(h.objects.get(h.key).bytes,original);assert.deepEqual(plain((await h.content()).assets.detail.value),['owner/first.png',reply.key,'owner/last.png']);assert.equal(h.product().supplier_hub_status,'미전송');
  assert.equal((await h.content()).seo.title.value,before.seo.title.value);assert.equal((await h.content()).label.material.value,before.label.material.value);for(const key of ['source_price_cny','supply_price','sale_price','msrp'])assert.equal(h.product()[key],prices[key]);
  const stored=h.objects.get(reply.key);assert.equal(stored.customMetadata.freeImageCropSha256,sha(JSON.stringify(crop)));assert.equal(stored.customMetadata.imageWidth,'2');assert.equal(stored.customMetadata.imageHeight,'1');assert.equal(new DataView(stored.bytes.buffer,stored.bytes.byteOffset).getUint32(16),2);assert.equal(new DataView(stored.bytes.buffer,stored.bytes.byteOffset).getUint32(20),1);
  const replay=await json(await h.request('POST',form(source)));assert.equal(replay.replayed,true);assert.equal(replay.key,reply.key);assert.deepEqual(replay.crop,crop);assert.equal(h.writes.length,1);assert.equal(h.deletions.length,0);assert.equal(h.translations.length,0);
  const noCrop=form(source);noCrop.delete('crop');await json(await h.request('POST',noCrop),400);assert.equal(h.writes.length,1);
 }finally{h.close();}
});

test('cropped visible orientation may match the raw source or its existing rotated decode, never arbitrary dimensions',async()=>{
 const h=cropApiFixture();try{await h.prepare();const source=await h.source(),rotated={x:0,y:1,width:2,height:1,sourceWidth:2,sourceHeight:3};const reply=await json(await h.request('POST',form(source,rotated)));assert.deepEqual(reply.crop,rotated);assert.equal(h.writes.length,1);assert.equal(h.deletions.length,0);}finally{h.close();}
});

test('invalid rectangle, forged orientation, mismatched PNG and duplicate crop fields stop before any R2 or DB mutation',async()=>{
 const h=cropApiFixture();try{await h.prepare();const source=await h.source(),before=JSON.stringify({product:h.product(),content:await h.content()}),originals=new Map([...h.objects].map(([key,value])=>[key,value.bytes.slice()]));
  for(const value of [null,[],{...crop,x:-1},{...crop,y:0.1},{...crop,width:0},{...crop,width:4},{...crop,sourceWidth:4},{...crop,extra:true}])await json(await h.request('POST',form(source,value)),400);
  for(const bytes of [pngBytes(1,2),pngBytes(3,2),pngBytes(2,2)])await json(await h.request('POST',form(source,crop,bytes)),400);
  const duplicate=form(source);duplicate.append('crop',JSON.stringify(crop));await json(await h.request('POST',duplicate),400);const invalid=form(source);invalid.set('crop','broken json');await json(await h.request('POST',invalid),400);
  assert.equal(JSON.stringify({product:h.product(),content:await h.content()}),before);for(const[key,bytes]of originals)assert.deepEqual(h.objects.get(key).bytes,bytes);assert.equal(h.writes.length,0);assert.equal(h.deletions.length,0);assert.equal(h.translations.length,0);
 }finally{h.close();}
});

test('cropped stored-output metadata and actual PNG cannot be downgraded or forged on a deterministic replay',async()=>{
 for(const variant of ['cropHash','dimensions','bytes']){const h=cropApiFixture();try{await h.prepare();const source=await h.source(),reply=await json(await h.request('POST',form(source))),object=h.objects.get(reply.key),before=h.product().updated_at;
  if(variant==='cropHash')delete object.customMetadata.freeImageCropSha256;else if(variant==='dimensions')object.customMetadata.imageWidth='3';else object.bytes=pngBytes(3,2);
  await json(await h.request('POST',form(source)),409);assert.equal(h.product().updated_at,before);assert.equal(h.writes.length,1);assert.equal(h.deletions.length,0);
 }finally{h.close();}}
});

test('crop scope also includes the exact selected option images and changes no other raw option facts',async()=>{
 const f=await cropOptionFixture();try{const source=await f.source(),before=plain(await f.options()),content=plain(await f.content()),originals=new Map([...f.h.objects].map(([key,value])=>[key,value.slice()])),selected=['option-001','option-000'];let writes=0;const put=f.h.bindings.FILES.put;f.h.bindings.FILES.put=async(...args)=>{writes++;return put(...args);};
  const body=f.form(source,selected);body.set('crop',JSON.stringify(crop));body.set('file',new File([pngBytes(2,1)],'cropped.png',{type:'image/png'}));const saved=await json(await f.request('POST',body)),after=plain(await f.options());assert.deepEqual(saved.crop,crop);assert.deepEqual(saved.optionImageIds,[...selected].sort());assert.equal(after.revision,before.revision+1);assert.equal(writes,1);
  for(const row of after.rows){const previous=before.rows.find(old=>old.id===row.id);assert.deepEqual(row,selected.includes(row.id)?{...previous,imageKey:saved.key,provenance:{...previous.provenance,imageKey:'manual'},updatedAt:saved.productVersion}:previous);}
  const updated=plain(await f.content());assert.deepEqual(updated.assets.main.value,[saved.key]);for(const role of ['additional','detailTop','detail','detailBottom','label','size'])assert.deepEqual(updated.assets[role],content.assets[role]);assert.deepEqual(updated.seo,content.seo);assert.deepEqual(updated.label,content.label);for(const[key,bytes]of originals)assert.deepEqual(f.h.objects.get(key),bytes);
  const metadata=await f.h.bindings.FILES.head(saved.key);assert.equal(metadata.customMetadata.freeImageCropSha256,sha(JSON.stringify(crop)));assert.equal(metadata.customMetadata.freeImageOptionIdsSha256,sha(JSON.stringify([...selected].sort())));const replay=await json(await f.request('POST',body));assert.equal(replay.replayed,true);assert.deepEqual(replay.crop,crop);assert.equal(writes,1);assert.equal((await f.options()).revision,after.revision);assert.equal(f.product().supplier_hub_status,'미전송');assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});

for(const company of companies)for(const input of ['mainImage','additionalImages','detailImages','labelImages'])test(`cropped PNG survives lost acknowledgement and changes only the chosen final slot and linked workbook (${company.code}; ${input})`,async()=>{
 const f=input==='labelImages'?await cropLabelFixture(company):await cropQuotationFixture(company);try{
  const source=(await json(await f.source(input))).source,before=await f.read(),raw=f.sourceRows(),originals=new Map([...f.h.objects].map(([key,value])=>[key,value.slice()])),client=f.h.load('app/free-image-translation-client.ts'),output=new Blob([pngBytes(2,1)],{type:'image/png'}),rendered={source,crop,output,width:2,height:1},route=f.h.load('app/api/products/[id]/image-text/route.ts'),context={params:Promise.resolve({id:f.id})};
  let writes=0;const put=f.h.bindings.FILES.put;f.h.bindings.FILES.put=async(...args)=>{writes++;return put(...args);};
  const transport=async(_url,init)=>route.POST(new Request('https://app.test'+f.base+'/image-text',init),context);
  await assert.rejects(client.applyFreeImageTranslation(rendered,new AbortController().signal,async(url,init)=>{const response=await transport(url,init);assert.equal(response.status,200,await response.clone().text());throw Error('local committed crop acknowledgement lost');}),error=>error.uncertain===true);
  const recovered=await client.recoverFreeImageTranslation(rendered,new AbortController().signal,transport);assert.equal(recovered.applied,true);assert.equal(recovered.replayed,true);assert.deepEqual(plain(recovered.crop),crop);assert.equal(writes,1);assert.equal(f.sourceRows(),raw);
  const after=await f.read(),selected=after.resolved.rows.find(row=>row.optionId===f.selected),target=f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(after.resolved.schema.fields,input),expected=input==='mainImage'?recovered.key:[f.keys[2],recovered.key,f.keys[3]].join('\n');
  for(const fieldKey of target.linked){assert.equal(selected.fields[fieldKey].value,expected);assert.equal(after.overrides.options[f.selected][fieldKey],expected);}
  const beforeOther=before.resolved.rows.filter(row=>row.optionId!==f.selected),afterOther=after.resolved.rows.filter(row=>row.optionId!==f.selected);assert.deepEqual(plain(afterOther),plain(beforeOther));for(const key of Object.keys(before.overrides.options[f.selected]))if(!target.linked.includes(key))assert.equal(after.overrides.options[f.selected][key],before.overrides.options[f.selected][key]);
  for(const[key,bytes]of originals)assert.deepEqual(f.h.objects.get(key),bytes);assert.equal(f.product().supplier_hub_status,'미전송');assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);
  const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}})),exported=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());const reader=f.h.load('app/xlsx-template.ts'),archive=await reader.readXlsxArchive(await exported.arrayBuffer()),document=JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))),plan=JSON.parse(new TextDecoder().decode(archive.get('supplier-hub-upload-plan.json'))),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename))),rowIndex=document.rows.findIndex(row=>row.optionId===f.selected);
  const row=reader.xlsxHeaders(book,f.profile.template.sheetName,rowIndex+2),column=f.profile.template.headers.indexOf(input);assert.equal(row[column],expected.split('\n').map(key=>document.uploadFilenames[key]).join('\n'));assert.ok([...archive.keys()].some(key=>key.endsWith(document.uploadFilenames[recovered.key])));
  const changed={...rendered,crop:{...crop,x:0}};await assert.rejects(client.recoverFreeImageTranslation(changed,new AbortController().signal,transport),error=>error.uncertain===true);assert.equal(writes,1);assert.equal(f.sourceRows(),raw);
 }finally{f.close();}
});
