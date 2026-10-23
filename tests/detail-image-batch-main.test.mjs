import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {schemaCompanies} from './helpers/hub-schema.mjs';

// Reuse the existing actual API/SQLite batch fixture without registering its
// suite twice. Add one exact MAIN wire to this local synthetic schema only.
// OCR/render and supplier/Google responses remain inert fixtures, not services.
const fixtureUrl=new URL('./detail-image-batch.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8');
const ast=ts.createSourceFile('detail-image-batch.test.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),declarations=[];
for(const statement of ast.statements){
 if(ts.isImportDeclaration(statement)){const specifier=statement.moduleSpecifier.text,absolute=specifier.startsWith('.')?new URL(specifier,fixtureUrl).href:import.meta.resolve(specifier);declarations.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast),JSON.stringify(absolute)));}
 else if(ts.isVariableStatement(statement)||ts.isFunctionDeclaration(statement))declarations.push(statement.getText(ast));else break;
}
const addWire='live.schemaString = JSON.stringify(raw);';assert.equal(declarations.join('\n').split(addWire).length,2);
const fixtureSource=declarations.join('\n').replace(addWire,"raw.properties.imagePage.properties.images.properties.mainImage={type:'string',title:'대표 이미지'}; "+addWire);
const {fixture,png}=await import('data:text/javascript,'+encodeURIComponent(fixtureSource+'\nexport {fixture,png};'));
const plain=value=>JSON.parse(JSON.stringify(value)),signal=()=>new AbortController().signal;
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const uploads=f=>f.calls.filter(call=>call.init.body instanceof FormData).length;
const retained=f=>JSON.stringify([f.product(),f.sourceRows(),f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(),[...f.h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')])]);
async function mainFixture(company){
 const f=await fixture(company);try{
  let content=(await json(await f.h.route(f.base+'/content'))).content;
  await json(await f.h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{detailTop:[f.order[0]],detail:[f.order[1]],detailBottom:[f.order[2]]}}}}));
  const options=await json(await f.h.route(f.base+'/options')),rows=f.h.load('app/product-options.ts').optionInputs(options.options);rows.at(-1).included=false;
  await json(await f.h.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  let view=await f.read();const target=f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields,'mainImage'),additional=f.h.load('app/quotation-image-targets.ts').optionImageTargets(view.resolved.schema.fields).additionalImages;
  assert.ok(target.fields.some(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['imagePage','images','mainImage'])),'main selection uses the exact current schema wire');
  const changes=[...target.linked.map(fieldKey=>({optionId:f.selected,fieldKey,value:f.order[0]})),...target.linked.map(fieldKey=>({optionId:f.other,fieldKey,value:''})),...additional.linked.map(fieldKey=>({optionId:f.selected,fieldKey,value:f.order[0]}))];
  view=await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  assert.ok(view.protectedDetailImageKeys.includes(f.order[0]),'same stored file is protected as a detail banner, but its main role remains translatable');
  f.view=view;f.mainInput={...f.input,stage:'main',view};f.mainTarget=target;return f;
 }catch(error){f.close();throw error;}
}
const prepare=(f,extra={})=>f.model.prepareDetailImageBatch(f.mainInput,signal(),()=>{},{...f.deps,...extra});

for(const company of schemaCompanies)test(`main batch applies one current mapped slot to exact XLSX/ZIP without touching HTML/options/source (${company.code})`,async()=>{
 const f=await mainFixture(company);try{
  const before=retained(f),sourceRows=f.sourceRows(),oldOverrides=plain(f.view.overrides),oldRows=plain(f.view.resolved.rows),sourceBytes=new Map([...f.h.objects].map(([key,bytes])=>[key,Buffer.from(bytes)]));
  let batch=await prepare(f);assert.equal(retained(f),before);assert.deepEqual(plain(batch.items.map(item=>[item.slotIndex,item.sourceKey,item.status])),[[0,f.order[0],'ready']]);assert.equal(batch.items[0].rendered.source.role,'main');assert.equal(batch.items[0].rendered.source.quotationTarget.input,'mainImage');assert.equal(batch.items[0].rendered.source.quotationTarget.slotIndex,0);assert.deepEqual(f.google,['中文']);assert.equal(uploads(f),0);
  batch=await f.model.applyDetailBatchResult(batch,0,signal(),()=>{},f.deps);assert.equal(batch.items[0].status,'applied');assert.equal(uploads(f),1);const key=batch.items[0].appliedKey,current=await f.read();
  for(const row of current.resolved.rows){const old=oldRows.find(value=>value.optionId===row.optionId);assert.equal(row.included,old.included);for(const [id,cell]of Object.entries(row.fields)){if(row.optionId===f.selected&&f.mainTarget.linked.includes(id)){assert.equal(cell.value,key);assert.equal(cell.source,'manual-option');}else if(row.optionId===f.selected&&id==='detailImages'){const message='대표 이미지가 상세 이미지에도 포함되어 있습니다. Supplier Hub 반려 가능성이 있으므로 구성을 확인해주세요.';assert.ok(old.fields[id].issues.includes(message));assert.deepEqual(cell,{...old.fields[id],issues:old.fields[id].issues.filter(issue=>issue!==message)});}else assert.deepEqual(cell,old.fields[id],id);}}
  assert.equal(current.resolved.rows.find(row=>row.optionId===f.other).fields.mainImage.value,'');assert.equal(current.resolved.rows.find(row=>row.optionId===f.selected).fields.detailHtml.value,'<p>보존할 수동 HTML</p>');
  const final=plain(current.overrides);for(const field of f.mainTarget.linked){delete final.options[f.selected][field];delete oldOverrides.options[f.selected][field];}assert.deepEqual(final,oldOverrides);assert.equal(f.sourceRows(),sourceRows);for(const [key,bytes]of sourceBytes)assert.deepEqual(Buffer.from(f.h.objects.get(key)),bytes);
  const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}})),response=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());
  const reader=f.h.load('app/xlsx-template.ts'),archive=await reader.readXlsxArchive(await response.arrayBuffer()),document=JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json'))),plan=JSON.parse(new TextDecoder().decode(archive.get('supplier-hub-upload-plan.json'))),rowIndex=document.rows.findIndex(row=>row.optionId===f.selected),image=plan.productImages.find(file=>file.key===key),filename=document.uploadFilenames[key];
  assert.ok(image);assert.equal(image.filename,filename);assert.equal(image.archivePath.split('/').at(-1),filename);assert.deepEqual(Buffer.from(archive.get(image.archivePath)),png(90));
  const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(plan.quotation.file.filename))),cell=reader.xlsxHeaders(sheet,'견적서',rowIndex+2)[f.profile.template.headers.indexOf(f.mainTarget.primary)];assert.equal(cell,filename);assert.equal(f.product().supplier_hub_status,'미전송');
 }finally{f.close();}
});

for(const company of schemaCompanies)test(`main ACK loss retains one exact PNG and read-only recovery cannot retarget its role (${company.code})`,async()=>{
 const f=await mainFixture(company);try{
  let batch=await prepare(f),writes=0;const route=f.h.load('app/api/products/[id]/image-text/route.ts');f.intercept(async(url,init)=>{if(init.body instanceof FormData){writes++;await route.POST(new Request('https://app.test'+url,init),{params:Promise.resolve({id:f.id})});throw Error('fixture main committed ACK lost');}});
  await assert.rejects(f.model.applyDetailBatchResult(batch,0,signal(),value=>{batch=value;},f.deps),/저장 응답을 확인하지 못했습니다/);assert.equal(batch.items[0].status,'uncertain');assert.equal(writes,1);assert.ok(batch.items[0].attempt.image.output);await assert.rejects(f.model.applyDetailBatchResult(batch,0,signal(),()=>{},f.deps));assert.equal(writes,1);
  f.intercept(null);const after=retained(f);await assert.rejects(f.model.recoverDetailBatchResult({...batch,stage:'additional'},signal(),()=>{},f.deps));assert.equal(retained(f),after);
  f.intercept(async(url,init)=>{if(url===f.qurl&&!(init.method&&init.method!=='GET')){const value=await json(await f.h.route(f.qurl));value.resolved.rows.find(row=>row.optionId===f.selected).fields.salePrice.value='999999';return Response.json(value);}});await assert.rejects(f.model.recoverDetailBatchResult(batch,signal(),()=>{},f.deps));assert.equal(retained(f),after,'unrelated changed cells cannot be accepted as duplicate-warning recomputation');f.intercept(null);
  batch=await f.model.recoverDetailBatchResult(batch,signal(),()=>{},f.deps);assert.equal(batch.items[0].status,'applied');assert.equal(writes,1);assert.equal(retained(f),after);await assert.rejects(f.model.applyDetailBatchResult(batch,0,signal(),()=>{},f.deps));
 }finally{f.close();}
});

for(const company of schemaCompanies)test(`main OCR or translation failure never uploads or marks the original applied (${company.code})`,async()=>{
 const f=await mainFixture(company);try{
  const before=retained(f);let rendered=0;let batch=await prepare(f,{recognize:async()=>[],render:async()=>{rendered++;throw Error('must not render');}});assert.equal(batch.items[0].status,'failed');assert.match(batch.items[0].message,/문구/);assert.equal(rendered,0);assert.equal(retained(f),before);assert.equal(uploads(f),0);
  f.intercept(async(_url,init)=>typeof init.body==='string'&&JSON.parse(init.body).action==='translate'?Response.json({error:'fixture translation unavailable'},{status:503}):undefined);
  batch=await prepare(f);assert.equal(batch.items[0].status,'failed');assert.match(batch.items[0].message,/translation unavailable/);assert.equal(retained(f),before);assert.equal(uploads(f),0);await assert.rejects(f.model.applyDetailBatchResult(batch,0,signal(),()=>{},f.deps));
 }finally{f.close();}
});

for(const company of schemaCompanies)test(`prepared main and additional results cannot swap roles even for the same option/key/slot (${company.code})`,async()=>{
 const f=await mainFixture(company);try{
  const main=await prepare(f),additional=await f.model.prepareDetailImageBatch({...f.mainInput,stage:'additional'},signal(),()=>{},f.deps),before=retained(f);
  assert.equal(main.items[0].sourceKey,additional.items[0].sourceKey);assert.equal(main.items[0].rendered.source.role,'main');assert.equal(additional.items[0].rendered.source.role,'additional');
  await assert.rejects(f.model.applyDetailBatchResult({...main,stage:'additional'},0,signal(),()=>{},f.deps));await assert.rejects(f.model.applyDetailBatchResult({...additional,stage:'main'},0,signal(),()=>{},f.deps));assert.equal(uploads(f),0);assert.equal(retained(f),before);
 }finally{f.close();}
});

for(const company of schemaCompanies)test(`main enforces one editable slot and refuses a stale or different-profile save before upload (${company.code})`,async()=>{
 const f=await mainFixture(company);try{
  const malformed=plain(f.view);for(const field of f.mainTarget.linked)malformed.resolved.rows.find(row=>row.optionId===f.selected).fields[field].value=f.order.slice(0,2).join('\n');for(const field of malformed.resolved.schema.fields.filter(field=>f.mainTarget.linked.includes(field.id)))field.maxItems=30;
  assert.throws(()=>f.model.detailBatchSelection(malformed,f.selected,f.profile.id,'main'));
  const readonly=plain(f.view);readonly.resolved.schema.fields.find(field=>field.id===f.mainTarget.primary).readOnly=true;assert.throws(()=>f.model.detailBatchSelection(readonly,f.selected,f.profile.id,'main'));
  const batch=await prepare(f);const view=await f.read();await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'searchTags',optionId:f.selected,value:'동시 수동 수정'}]}}));const changed=retained(f);
  await assert.rejects(f.model.applyDetailBatchResult(batch,0,signal(),()=>{},f.deps));await assert.rejects(f.model.readDetailBatchView({...f.mainInput,profileId:'other-profile'},signal(),f.deps.fetcher));assert.equal(uploads(f),0);assert.equal(retained(f),changed);
 }finally{f.close();}
});

for(const company of schemaCompanies)test(`partial main draft keeps its review marker and exact editable regions through real save, lost ACK and reopen (${company.code})`,async()=>{
 const f=await mainFixture(company);try{
  const now=new Date().toISOString(),email=company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com';
  f.h.sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner',email,'fixture-not-a-password',company.code==='A01526306'?'admin':'member','approved',company.code,company.name,now,now,null);
  const original=Buffer.from(f.h.objects.get(f.order[0])),sourceRows=f.sourceRows();
  let batch=await prepare(f,{render:async(image,regions)=>{
   const rendered=await f.deps.render(image,regions),accepted={...regions[0],box:{x:0,y:0,width:3,height:1}},unresolved={...regions[0],id:'unresolved',text:'未确认',selected:false,translated:'',translationProvenance:'empty',issue:'영역 검증 실패: 원문에 없는 성능·주장.',box:{x:0,y:1,width:3,height:1}};
   return {...rendered,editDocument:f.h.load('app/free-image-edit-document.ts').validateFreeImageEditDocument({format:'free-image-edit-v1',width:image.width,height:image.height,sourceLanguage:'zh',regions:[accepted,unresolved]},image.source)};
  }});
  const review={status:'partial',acceptedRegions:1,unresolvedRegions:1,message:'검증된 문구만 저장한 미완료 초안입니다.'};batch.items[0].translationReview=review;
  const document=plain(batch.items[0].rendered.editDocument),route=f.h.load('app/api/products/[id]/image-text/route.ts');let writes=0;
  f.intercept(async(url,init)=>{if(init.body instanceof FormData){writes++;await route.POST(new Request('https://app.test'+url,init),{params:Promise.resolve({id:f.id})});throw Error('fixture partial draft ACK lost');}});
  await assert.rejects(f.model.applyDetailBatchResult(batch,0,signal(),value=>{batch=value;},f.deps));assert.equal(batch.items[0].status,'uncertain');assert.deepEqual(plain(batch.items[0].translationReview),review);assert.deepEqual(plain(batch.items[0].attempt.image.editDocument),document);assert.equal(writes,1);
  f.intercept(null);batch=await f.model.recoverDetailBatchResult(batch,signal(),()=>{},f.deps);assert.equal(batch.items[0].status,'applied');assert.deepEqual(plain(batch.items[0].translationReview),review);assert.equal(writes,1);
  const key=batch.items[0].appliedKey,target=batch.items[0].rendered.source.quotationTarget,query=new URLSearchParams({sourceKey:key,role:'main',target:'quotation',profileId:f.profile.id,optionId:f.selected,fieldKey:target.fieldKey,slotIndex:'0',editor:'saved'});
  const opened=await json(await route.GET(new Request('https://app.test'+f.base+'/image-text?'+query),{params:Promise.resolve({id:f.id})}));
  assert.deepEqual(opened.editDocument,document);assert.equal(opened.editDocument.regions[0].translated,'번역 문구');assert.equal(opened.editDocument.regions[1].text,'未确认');assert.equal(opened.editDocument.regions[1].selected,false);assert.equal(opened.editDocument.regions[1].translated,'');assert.match(opened.editDocument.regions[1].issue,/원문에 없는/);
  assert.equal(opened.source.sourceKey,f.order[0]);assert.equal(opened.source.editorSource.resultKey,key);assert.deepEqual(Buffer.from(f.h.objects.get(f.order[0])),original);assert.equal(f.sourceRows(),sourceRows);assert.equal(f.product().supplier_hub_status,'미전송');
  await assert.rejects(f.model.applyDetailBatchResult(batch,0,signal(),()=>{},f.deps));assert.equal(writes,1);
 }finally{f.close();}
});
