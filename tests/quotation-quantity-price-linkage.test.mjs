import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';
import {hubSchemaSnapshot,schemaCompanies} from './helpers/hub-schema.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const prices=['supplyPrice','salePrice','msrp'];
const sourceWarning=cell=>cell.reviewMessages.filter(message=>message.startsWith('자동 계산 가격은 2단계 옵션의 판매 구성 수량'));
async function json(response){assert.equal(response.status,200,await response.clone().text());return response.json();}
async function fixture(company,{liveQuantity=false}={}){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  Object.assign(h.context.settings,{bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000});
  if(liveQuantity){
   const snapshot={...hubSchemaSnapshot(company,'80719'),categoryPath:[...h.context.category.categoryPath]},raw=JSON.parse(snapshot.schemaString);
   raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push({contains:{type:'object',properties:{name:{type:'string',enum:['수량'],requirement:'필수'},value:{type:'string'}}}});snapshot.schemaString=JSON.stringify(raw);h.context.category.hubSchema=snapshot;
  }
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,before=await json(await h.route(base+'/quotation-fields')),fields=before.resolved.schema.fields.map(field=>field.id),bytes=new Uint8Array(quotationWorkbook(fields)),sha256=createHash('sha256').update(bytes).digest('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,bytes);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{...h.context.category,name:'합성 판매 수량·가격 검토',template:{name:'synthetic-quantity.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  const endpoint=base+'/quotation-fields?profileId=cat',read=()=>h.route(endpoint).then(json),view=await read(),included=view.resolved.rows.filter(row=>row.included&&row.optionId),selected=included[0].optionId,other=included[1].optionId;
  const save=(view,changes)=>h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  const source=()=>JSON.stringify(Object.fromEntries(['product_content','product_options','product_price_policy','collection_context','collection_results'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));
  const request=(path,init={})=>h.route(path,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});
  return{h,product,base,endpoint,fields,view,selected,other,read,save,source,request};
 }catch(error){h.close();throw error;}
}
const row=(view,id)=>view.resolved.rows.find(row=>row.optionId===id);
const change=(fieldKey,value,optionId)=>({fieldKey,value,optionId});
function editorCells(load){
 const exports={},file='app/components/quotation-fields-editor.tsx';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,TextEncoder,URLSearchParams,structuredClone,AbortController,require(name){if(name.endsWith('.css')||name.startsWith('@/app/components/'))return{};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});
 return exports.resolveQuotationEditorCell;
}

for(const company of schemaCompanies){
 test(`manual canonical quantity exposes the automatic pack-price source through API, UI, review and XLSX (${company.code})`,async()=>{
  const f=await fixture(company);let ui;try{
   const source=f.source(),before=row(f.view,f.selected);assert.equal(before.fields.quantity.value,'3');assert.equal(before.fields.supplyPrice.value,'7560');assert.equal(before.fields.salePrice.value,'12600');
   const view=await f.save(f.view,[change('quantity','1',f.selected)]),selected=row(view,f.selected);assert.equal(selected.fields.quantity.source,'manual-option');assert.equal(selected.fields.quantity.value,'1');
   for(const id of prices){const cell=selected.fields[id];assert.equal(cell.source,'pricing');assert.equal(cell.value,before.fields[id].value);assert.deepEqual(plain(cell.validationIssues),plain(before.fields[id].validationIssues));assert.equal(cell.needsReview,true);assert.equal(sourceWarning(cell).length,1);assert.match(sourceWarning(cell)[0],/3개입.*견적 수량을 1로 직접 수정/);assert.ok(cell.issues.includes(sourceWarning(cell)[0]));}
   assert.deepEqual(plain(selected.fields.quantity.validationIssues),plain(before.fields.quantity.validationIssues));assert.deepEqual(plain(row(view,f.other).fields),plain(row(f.view,f.other).fields));assert.equal(f.source(),source);
   const review=await json(await f.h.route(f.base+'/submission-review?profileId=cat')),warnings=review.issues.filter(issue=>issue.optionId===f.selected&&issue.message.includes('자동 계산 가격은 2단계'));
   assert.deepEqual(warnings.map(issue=>issue.fieldId).sort(),[...prices].sort());assert.ok(warnings.every(issue=>issue.kind==='review'),'a quantity source difference adds review evidence only');assert.equal(review.issues.filter(issue=>issue.optionId===f.selected&&issue.code==='MSRP_EVIDENCE_REVIEW').length,1,'MSRP retains its own evidence review alongside the quantity source warning');
   const resolve=editorCells(f.h.load),snapshot=JSON.stringify(view);
   for(const id of prices){
    assert.equal(sourceWarning(resolve(view,[],f.selected,id)).length,1);
    assert.equal(sourceWarning(resolve(view,[change('brand','입력 중인 다른 브랜드',f.selected)],f.selected,id)).length,1,'unrelated edits retain the unchanged saved price source review');
    assert.equal(sourceWarning(resolve(view,[change('quantity','3',f.selected)],f.selected,id)).length,0,'a pending own quantity change hides the prior saved source warning until a fresh save');
    assert.equal(sourceWarning(resolve(view,[change('quantity',null,f.selected)],f.selected,id)).length,0,'a pending quantity reset also invalidates its old saved warning');
    assert.equal(sourceWarning(resolve(view,[change('quantity','3',null)],f.selected,id)).length,0,'a pending common quantity change conservatively waits for the next saved review');
    assert.equal(sourceWarning(resolve(view,[change('quantity','1',f.other)],f.selected,id)).length,1,'another option quantity edit cannot hide this saved price source review');
    for(const value of [selected.fields[id].value,''])assert.equal(sourceWarning(resolve(view,[change(id,value,f.selected)],f.selected,id)).length,0,'manual price source or blank never inherits an automatic-price warning');
   }
   assert.equal(JSON.stringify(view),snapshot,'editor review resolution is read-only');
   ui=quotationLabelFormUI({productId:f.product.id,load:f.h.load,request:f.request,renderDocument:async()=>assert.fail('read-only price review never renders a label')});await ui.idle();ui.selectOption(f.selected);const tree=ui.render().tree;
   for(const id of prices){const card=nodes(tree).find(node=>node.key===id&&node.props?.className?.startsWith('quotation-field '));assert.ok(card,'visible saved '+id+' price input');assert.ok(text(card).includes('자동 계산 가격은 2단계 옵션의 판매 구성 수량 3개입'),'saved pack-source warning must be visible beside '+id);}
   assert.equal(f.source(),source);ui.close();ui=null;
   const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:'cat'}}));
   const download=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'download',profileId:'cat',fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());
   const reader=f.h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer())),cells=reader.xlsxHeaders(sheet,'견적서',2);
   assert.equal(cells[f.fields.indexOf('quantity')],'1');for(const id of prices)assert.equal(cells[f.fields.indexOf(id)],before.fields[id].value,'review never rewrites a price or changes its pack calculation');assert.equal(f.source(),source);assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.ok(!f.h.network.includes('supplier.coupang.com'));
  }finally{ui?.close();f.h.close();}
 });

 test(`matching/automatic quantities and manual prices or blanks retain their own values (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const source=f.source();let view=f.view;
   for(const value of ['3',null,'','1세트','0']){view=await f.save(view,[change('quantity',value,f.selected)]);assert.ok(prices.every(id=>sourceWarning(row(view,f.selected).fields[id]).length===0));}
   view=await f.save(view,[change('quantity','1e0',null),change('quantity',null,f.selected)]);assert.equal(row(view,f.selected).fields.quantity.source,'manual-common');assert.ok(prices.every(id=>sourceWarning(row(view,f.selected).fields[id]).length===1));
   view=await f.save(view,[change('quantity','3',f.selected)]);assert.ok(prices.every(id=>sourceWarning(row(view,f.selected).fields[id]).length===0));assert.ok(prices.every(id=>sourceWarning(row(view,f.other).fields[id]).length===1));
   view=await f.save(view,[change('quantity','1',f.selected),change('supplyPrice','12345',f.selected),change('salePrice','',f.selected),change('msrp','33333',null)]);
   const manual=row(view,f.selected);assert.equal(manual.fields.supplyPrice.value,'12345');assert.equal(manual.fields.salePrice.value,'');assert.equal(manual.fields.msrp.value,'33333');assert.ok(prices.every(id=>sourceWarning(manual.fields[id]).length===0));assert.equal(manual.fields.salePrice.source,'manual-option');assert.equal(manual.fields.msrp.source,'manual-common');
   view=await f.save(view,[change('supplyPrice',null,f.selected)]);const restored=row(view,f.selected);assert.equal(restored.fields.supplyPrice.source,'pricing');assert.equal(sourceWarning(restored.fields.supplyPrice).length,1);assert.equal(restored.fields.salePrice.value,'');assert.equal(restored.fields.msrp.value,'33333');assert.equal(sourceWarning(restored.fields.salePrice).length,0);assert.equal(sourceWarning(restored.fields.msrp).length,0);assert.equal(f.source(),source);
  }finally{f.h.close();}
 });
}

test('a named live quantity control is not treated as an independently verified selling-pack count',async()=>{
 const f=await fixture(schemaCompanies[0],{liveQuantity:true});try{
  const field=f.view.resolved.schema.fields.find(field=>field.hubWire?.name==='수량');assert.ok(field);const source=f.source(),view=await f.save(f.view,[change(field.id,'1',f.selected)]),selected=row(view,f.selected);assert.equal(selected.fields[field.id].value,'1');assert.equal(selected.fields[field.id].source,'manual-option');assert.ok(prices.every(id=>sourceWarning(selected.fields[id]).length===0));assert.equal(f.source(),source);
 }finally{f.h.close();}
});
