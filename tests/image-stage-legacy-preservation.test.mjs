import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';

const modules=new Map(),plain=value=>JSON.parse(JSON.stringify(value));
function load(file){
 if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,structuredClone,require:name=>load(name.slice(2)+'.ts')});return exports;
}
const contentModel=load('app/product-content.ts'),stages=load('app/image-stage-save.ts'),now='2026-10-10T00:00:00.000Z';
const assets=content=>Object.fromEntries(Object.entries(content.assets).map(([role,field])=>[role,[...field.value]]));
function legacy(){
 const content=contentModel.emptyProductContent('product');
 content.assets.main={value:['owner/shared.png'],provenance:'collected',updatedAt:now};
 content.assets.detail={value:['owner/shared.png','owner/body.png'],provenance:'manual',updatedAt:now};
 content.assets.additional={value:['owner/additional.png'],provenance:'manual',updatedAt:now};
 return content;
}

test('description and reorder saves retain preexisting shared roles without claiming their files again',()=>{
 const content=legacy(),initial=assets(content),draft=structuredClone(initial),before=plain(content);draft.detail.reverse();
 assert.deepEqual(plain(stages.imageStagePatch(initial,initial,'detail')),{});
 const patch=stages.imageStagePatch(initial,draft,'detail');assert.deepEqual(plain(patch),{detail:['owner/body.png','owner/shared.png']});
 const saved=contentModel.applyContentPatch(content,{assets:patch,detail:{description:'직접 확인한 상세 설명'}},now);
 assert.deepEqual(plain(saved.assets.main),before.assets.main);assert.deepEqual(plain(saved.assets.additional),before.assets.additional);
 assert.deepEqual(plain(saved.assets.detail.value),draft.detail);assert.equal(saved.detail.description.provenance,'manual');assert.deepEqual(plain(content),before);
 const pending={...draft,additional:['owner/pending.png']},merged=stages.mergeSavedImageStage(initial,pending,assets(saved),'detail');
 assert.deepEqual(plain(merged.additional),['owner/pending.png']);assert.deepEqual(plain(merged.main),initial.main);
 const cleared=contentModel.applyContentPatch(saved,{detail:{description:''}},now);assert.equal(cleared.detail.description.value,'');assert.equal(cleared.detail.description.provenance,'manual');assert.deepEqual(plain(cleared.assets.main),before.assets.main);
});

test('new explicit stage claims still move a file and existing shared pairs may be reduced',()=>{
 const content=legacy(),initial=assets(content),draft=structuredClone(initial);draft.detail.push('owner/additional.png');draft.additional=[];
 const patch=stages.imageStagePatch(initial,draft,'detail');assert.deepEqual(plain(patch),{additional:[],detail:['owner/shared.png','owner/body.png','owner/additional.png']});
 const saved=contentModel.applyContentPatch(content,{assets:patch},now);assert.deepEqual(plain(saved.assets.main),plain(content.assets.main));assert.deepEqual(plain(saved.assets.additional.value),[]);
 const reduced=contentModel.applyContentPatch(saved,{assets:{detail:['owner/body.png','owner/additional.png']}},now);assert.deepEqual(plain(reduced.assets.main),plain(content.assets.main));
});

test('explicit main-to-size and detail-to-top moves claim a new individual role and remove saved outside assignments',()=>{
 for(const [from,to,stage] of [['main','size','main'],['detail','detailTop','detail']]){
  const content=legacy(),before=plain(content),initial=assets(content),draft=structuredClone(initial);
  for(const role of Object.keys(draft))draft[role]=draft[role].filter(key=>key!=='owner/shared.png');draft[to]=['owner/shared.png'];
  const patch=stages.imageStagePatch(initial,draft,stage),saved=contentModel.applyContentPatch(content,{assets:patch},now);
  assert.deepEqual(plain(saved.assets[to].value),['owner/shared.png']);assert.ok(!saved.assets[from].value.includes('owner/shared.png'));
  assert.deepEqual(plain(saved.assets.detail.value),['owner/body.png']);assert.deepEqual(plain(saved.assets.main.value),[]);
  assert.deepEqual(plain(saved.assets.additional),before.assets.additional);assert.deepEqual(plain(content),before);
  assert.equal(Object.values(saved.assets).filter(field=>field.value.includes('owner/shared.png')).length,1,'the explicitly moved file has only its reviewed role');
 }
});

test('legacy sharing authorizes only the same file and role pairs, never within-role duplicates or new sharing',()=>{
 const content=legacy(),before=plain(content);
 for(const patch of [
  {assets:{detail:['owner/shared.png','owner/shared.png']}},
  {assets:{additional:['owner/shared.png']}},
  {assets:{detail:[],additional:['owner/shared.png']}},
  {assets:{additional:['owner/body.png']}},
  {assets:{detailTop:['owner/shared.png'],detail:['owner/body.png']}},
 ])assert.throws(()=>contentModel.applyContentPatch(content,patch,now),/한 역할/);
 assert.throws(()=>contentModel.applyContentPatch(contentModel.emptyProductContent('product'),{assets:{main:['owner/new.png'],detail:['owner/new.png']}},now),/한 역할/);
  const extra=legacy();extra.assets.oldSlot={value:['owner/old-slot.png'],provenance:'unverified',updatedAt:null};
  assert.throws(()=>contentModel.applyContentPatch(extra,{assets:{detail:['owner/shared.png','owner/old-slot.png']}},now),/한 역할/,'an old extra slot cannot authorize a new shared role pair');
 const full=legacy();full.assets.detail.value=Array.from({length:30},(_,index)=>`owner/detail-${index}.png`);full.assets.detail.value[0]='owner/shared.png';full.assets.additional.value=Array.from({length:20},(_,index)=>`owner/additional-${index}.png`);
 assert.throws(()=>contentModel.applyContentPatch(full,{detail:{description:'51 role occurrences'}},now),/최대 50개/);
 assert.deepEqual(plain(content),before);
});

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
async function fixture(company){
 const api=mobileIntakeHarness(company);
 try{
  const schema=api.load('app/quotation-schema.ts').getQuotationSchema('80719'),headers=schema.fields.map(field=>field.id),workbook=quotationWorkbook(headers),sha256=createHash('sha256').update(workbook).digest('hex');
  const storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,new Uint8Array(workbook));
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'legacy image role fixture',categoryId:'80719',categoryPath:schema.categoryPath,
   template:{name:'synthetic-legacy-images.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,keys=JSON.parse(product.image_keys),content=(await json(await api.route(base+'/content'))).content;
  // Simulate a persisted older record; no live product or remote media is used.
  content.assets.main={value:[keys[0]],provenance:'collected',updatedAt:content.updatedAt};content.assets.detail={value:[keys[0],keys[1]],provenance:'manual',updatedAt:content.updatedAt};
  api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),product.id);
  const read=async()=>(await json(await api.route(base+'/content'))).content;
  const save=async(before,patch)=>json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:before.revision,patch}}));
  return{api,product,base,keys,headers,content,read,save};
 }catch(error){api.close();throw error;}
}

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`${company.companyCode}: legacy detail reorder and description clear reach real API, quotation XLSX and ZIP without clearing main/manual HTML`,async()=>{
 const f=await fixture(company);try{
  const pool=f.api.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.product.id).image_keys,files=[...f.api.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]);
  let quote=await json(await f.api.route(f.base+'/quotation-fields')),included=quote.resolved.rows.filter(row=>row.optionId&&row.included),manual=included[0],blank=included[1],automatic=included[2];
  quote=await json(await f.api.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[
   {optionId:manual.optionId,fieldKey:'detailHtml',value:'<p>직접 작성한 개별 HTML</p>'},{optionId:blank.optionId,fieldKey:'detailImages',value:''},
  ]}}));
  const overrides=plain(quote.overrides),initial=assets(f.content),draft=structuredClone(initial);draft.detail.reverse();
  let saved=(await f.save(f.content,{assets:stages.imageStagePatch(initial,draft,'detail'),detail:{description:'직접 확인한 설명'}})).content;
  assert.deepEqual(plain(saved.assets.main),plain(f.content.assets.main));assert.deepEqual(plain(saved.assets.detail.value),[f.keys[1],f.keys[0]]);
  saved=(await f.save(saved,{detail:{description:''}})).content;assert.equal(saved.detail.description.value,'');assert.equal(saved.detail.description.provenance,'manual');
  quote=await json(await f.api.route(f.base+'/quotation-fields'));assert.deepEqual(plain(quote.overrides),overrides);
  const final=quote.resolved.rows.find(row=>row.optionId===automatic.optionId);assert.equal(final.fields.mainImage.value,f.keys[0]);assert.equal(final.fields.detailImages.value,[f.keys[1],f.keys[0]].join('\n'));
  assert.equal(quote.resolved.rows.find(row=>row.optionId===manual.optionId).fields.detailHtml.value,'<p>직접 작성한 개별 HTML</p>');assert.equal(quote.resolved.rows.find(row=>row.optionId===blank.optionId).fields.detailImages.value,'');
  const preview=await json(await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'preview'}})),response=await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());
  const zip=readPackageZip(new Uint8Array(await response.arrayBuffer())),document=JSON.parse(new TextDecoder().decode(zip.get('quotation-fields.json'))),plan=JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json'))),details=JSON.parse(new TextDecoder().decode(zip.get('quotation-detail-content.json')));
  const reader=f.api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(zip.get(plan.quotation.file.filename))),index=document.rows.findIndex(row=>row.optionId===automatic.optionId),cells=reader.xlsxHeaders(sheet,'견적서',index+2);
  assert.equal(cells[f.headers.indexOf('mainImage')],document.uploadFilenames[f.keys[0]]);assert.equal(cells[f.headers.indexOf('detailImages')],[f.keys[1],f.keys[0]].map(key=>document.uploadFilenames[key]).join('\n'));
  assert.deepEqual(details.rows.find(row=>row.optionId===automatic.optionId).images,[f.keys[1],f.keys[0]].map(key=>document.assets[key]));assert.equal(details.rows.find(row=>row.optionId===manual.optionId).html,'<p>직접 작성한 개별 HTML</p>');
  for(const key of [f.keys[0],f.keys[1]])assert.deepEqual(Buffer.from(zip.get(document.assets[key])),Buffer.from(f.api.objects.get(key)));
  assert.equal(f.api.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.product.id).image_keys,pool);assert.deepEqual([...f.api.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),files);
  const before=await f.read();for(const patch of [{assets:{additional:[f.keys[0]]}},{assets:{detail:[f.keys[0],f.keys[0]]}},{assets:{detail:[f.keys[2]],additional:[f.keys[2]]}},{assets:{detail:['another-owner/private.png']}}]){
   const rejected=await f.api.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:before.revision,patch}});assert.equal(rejected.status,400,await rejected.clone().text());assert.deepEqual(plain(await f.read()),plain(before));
  }
  f.api.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('another-member',f.product.id);
  const denied=await f.api.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:before.revision,patch:{detail:{description:'foreign-member write'}}}});assert.equal(denied.status,404);
  f.api.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('owner',f.product.id);assert.deepEqual(plain(await f.read()),plain(before));
  assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.product.id).supplier_hub_status,'미전송');assert.ok(!f.api.network.includes('supplier.coupang.com'));
 }finally{f.api.close();}
});
