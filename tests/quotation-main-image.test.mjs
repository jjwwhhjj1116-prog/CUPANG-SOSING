import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function fixture(company){const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
 const snapshot={...hubSchemaSnapshot(company),inputBindings:'couplus-paths-v1'},raw=JSON.parse(snapshot.schemaString);raw.properties.imagePage.properties.images={type:'object',properties:{mainImage:{type:'string',title:'대표 이미지',requirement:'필수'}}};snapshot.schemaString=JSON.stringify(raw);
 const schema=h.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,schemaPath,snapshot),fields=schema.fields.map(field=>field.id),workbook=new Uint8Array(quotationWorkbook(fields)),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'최종 대표이미지 시험',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template:{name:'synthetic-main-image.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))});
 h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/quotation-fields?profileId='+profile.id;
 const read=()=>h.route(endpoint).then(json);let before=await read();const selected=before.resolved.rows.find(row=>row.optionId).optionId,other=before.resolved.rows.filter(row=>row.optionId)[1].optionId,calls=[];
 // Recorded intake leaves source imageKey unassigned. Establish a deliberate
 // source B via the real options API before testing a distinct final q image A.
 const options=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);rows.find(row=>row.id===selected).imageKey=before.imageKeys[0];
 await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));before=await read();Object.assign(product,h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id));
 const request=async(url,init={})=>{calls.push({url,method:init.method??'GET'});return h.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});};
 const source=()=>JSON.stringify(Object.fromEntries(['product_content','product_options','product_price_policy'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' WHERE product_id=?').get(product.id)])));
 return {h,product,base,profile,fields,endpoint,read,before,selected,other,calls,request,source};
}catch(error){h.close();throw error;}}
for(const company of schemaCompanies)test(`final main-image override and explicit blank update exact saved SKU cells and workbook while source options stay unchanged (${company.code})`,async()=>{
 const f=await fixture(company);try{
  const helper=f.h.load('app/quotation-main-image.ts'),sourceOption=f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.product.id),sourceKey=JSON.parse(sourceOption.payload).rows.find(row=>row.id===f.selected).imageKey;
  const [a,c,common]=f.before.imageKeys.filter(key=>key!==sourceKey);assert.ok(c);assert.deepEqual(plain(helper.verifyMainImageView(f.before).primaryField.hubWire.path),['imagePage','images','mainImage']);
  const setup=f.h.load('app/quotation-schema.ts').validateQuotationChanges([{optionId:null,fieldKey:'mainImage',value:common},{optionId:f.selected,fieldKey:'mainImage',value:a},{optionId:f.other,fieldKey:'searchTags',value:'다른 옵션 직접 수정'}],{schema:f.before.resolved.schema,optionIds:f.before.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),ownedImageKeys:f.before.imageKeys,overrides:f.before.overrides});
  await json(await f.h.route(f.endpoint,{method:'PUT',body:{expectedRevision:f.before.revision,expectedInputFingerprint:f.before.inputFingerprint,changes:setup}}));const before=await f.read(),source=f.source(),overrides=plain(before.overrides),files=[...f.h.objects.keys()];
  assert.equal(helper.mainImageValue(before,f.selected),a);assert.notEqual(sourceKey,a);const saved=await helper.saveMainImageView(f.endpoint,before,f.selected,c,f.request);assert.equal(helper.mainImageValue(saved,f.selected),c);assert.deepEqual(plain(saved.overrides.common),overrides.common);assert.deepEqual(plain(saved.overrides.options[f.other]),overrides.options[f.other]);assert.equal(f.source(),source);assert.deepEqual([...f.h.objects.keys()],files);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}})),response=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());
  const zip=readPackageZip(new Uint8Array(await response.arrayBuffer())),document=JSON.parse(new TextDecoder().decode(zip.get('quotation-fields.json'))),plan=JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json'))),bytes=zip.get(plan.quotation.file.filename),reader=f.h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
  assert.equal(reader.xlsxHeaders(sheet,'견적서',2)[f.fields.indexOf('mainImage')],document.uploadFilenames[c]);assert.equal(document.rows.find(row=>row.optionId===f.selected).fields.mainImage.value,c);
  const blank=await helper.saveMainImageView(f.endpoint,saved,f.selected,'',f.request);assert.equal(helper.mainImageValue(blank,f.selected),'');assert.notEqual(JSON.parse(sourceOption.payload).rows.find(row=>row.id===f.selected).imageKey,null);
  const restored=await helper.saveMainImageView(f.endpoint,blank,f.selected,null,f.request);assert.equal(helper.mainImageValue(restored,f.selected),common);assert.equal(Object.hasOwn(restored.overrides.options,f.selected),false);assert.equal(f.source(),source);
 }finally{f.h.close();}
});

test('main-image helper binds canonical and exact path only, rejecting similar labels and keeping explicit blanks',async()=>{
 const f=await fixture(schemaCompanies[0]);try{
  const helper=f.h.load('app/quotation-main-image.ts'),view=plain(f.before),canonical=view.resolved.schema.fields.find(field=>field.id==='mainImage'),wire={...canonical,id:'exact-main-wire',hubInput:'mainImage',hubWire:{path:['imagePage','images','mainImage']}};delete canonical.hubWire;delete canonical.hubInput;view.resolved.schema.fields.push(wire);
  for(const row of view.resolved.rows)row.fields[wire.id]={...row.fields.mainImage,value:''};for(const row of view.automatic.rows)row.fields[wire.id]={...row.fields.mainImage};view.overrides.options[f.selected]={...view.overrides.options[f.selected],[wire.id]:''};
  assert.equal(helper.mainImageValue(view,f.selected),'');const changes=helper.mainImageChanges(view,f.selected,view.imageKeys[0]);assert.deepEqual(plain(changes.map(change=>change.fieldKey)),['mainImage','exact-main-wire']);
  wire.hubInput='detailImages';assert.throws(()=>helper.mainImageChanges(view,f.selected,view.imageKeys[0]),/원천 연결/);
 }finally{f.h.close();}
});

test('main-image lost ACK retries read-first, and stale CAS or malformed success never claims an unchanged image was saved',async()=>{
 const f=await fixture(schemaCompanies[0]);try{
  const helper=f.h.load('app/quotation-main-image.ts'),before=await f.read(),key=before.imageKeys.at(-1);let lost=true,unavailable=false;
  const request=async(url,init={})=>{if(unavailable&&init.method!=='PUT')return Response.json({error:'private read failure'},{status:503});const response=await f.request(url,init);if(lost&&init.method==='PUT'){lost=false;unavailable=true;throw Error('committed ACK lost');}return response;};
  await assert.rejects(helper.saveMainImageView(f.endpoint,before,f.selected,key,request),error=>error instanceof helper.MainImageSaveError&&error.uncertain);unavailable=false;const recovered=await helper.saveMainImageView(f.endpoint,before,f.selected,key,request);assert.equal(helper.mainImageValue(recovered,f.selected),key);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  await assert.rejects(helper.saveMainImageView(f.endpoint,recovered,f.selected,'',async(url,init={})=>init.method==='PUT'?Response.json(recovered):f.request(url,init)),/저장|응답|버전/);assert.equal(helper.mainImageValue(await f.read(),f.selected),key);
  const stale=await f.read();let raced=false;await assert.rejects(helper.saveMainImageView(f.endpoint,stale,f.selected,'',async(url,init={})=>{if(init.method==='PUT'&&!raced){raced=true;await json(await f.h.route(f.endpoint,{method:'PUT',body:{expectedRevision:stale.revision,expectedInputFingerprint:stale.inputFingerprint,changes:[{optionId:f.other,fieldKey:'searchTags',value:'동시 수정'}]}}));}return f.request(url,init);}),/바뀌|변경/);assert.equal(helper.mainImageValue(await f.read(),f.selected),key);
 }finally{f.h.close();}
});
