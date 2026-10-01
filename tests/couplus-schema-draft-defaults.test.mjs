import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];

test('all recorded category arrays receive Couplus draft defaults without replacing saved facts or explicit blanks',()=>{
 const h=mobileIntakeHarness();
 try{
  const model=h.load('app/quotation-schema.ts'),contentModel=h.load('app/product-content.ts'),optionModel=h.load('app/product-options.ts');
  const ids=[...new Set([...Object.keys(h.load('app/hub-product-schemas.ts').hubProductSchemas),'80719','81452','64497','103495','77442','81221'])];
  assert.equal(ids.length,28);
  const product={id:'p',title:'수집 상품',source_price_cny:3.6,supply_price:4200,sale_price:7000,msrp:9100,image_keys:'[]',pricing_policy:JSON.stringify(h.settings)};
  const options=optionModel.emptyProductOptions('p'),content=contentModel.emptyProductContent('p');
  const display=h.load('app/quotation-field-display.ts').quotationFieldDisplay;
  for(const categoryId of ids){
   const input={categoryId,product,options,content,settings:h.settings},before=JSON.stringify(input),resolved=model.resolveQuotationFields(input),row=resolved.rows[0];
   for(const field of resolved.schema.fields.filter(field=>field.section==='product'&&field.visibility!=='common')){
    const cell=row.fields[field.id];assert.equal(cell.source,'couplus-default',categoryId+':'+field.id);
    assert.equal(cell.value,field.visibility==='hidden'?'':'해당사항없음',categoryId+':'+field.id);
    assert.equal(display(field,cell),'해당사항없음');assert.ok(cell.needsReview);
    assert.equal(cell.validationIssues.length,0);
   }
   const emptyNotice=resolved.schema.fields.find(field=>field.section==='legal'&&field.id.endsWith('noticeReleaseDate'));
   if(emptyNotice){assert.equal(row.fields[emptyNotice.id].value,'해당사항없음');assert.equal(row.fields[emptyNotice.id].source,'couplus-default');}
   assert.equal(JSON.stringify(input),before);
   const hidden=resolved.schema.fields.find(field=>field.section==='product'&&field.visibility==='hidden');
   const changed=model.resolveQuotationFields({...input,overrides:{common:{[hidden.id]:'',color:'확인 색상'},options:{}}}).rows[0];
   assert.equal(changed.fields[hidden.id].source,'manual-common');assert.equal(display(hidden,changed.fields[hidden.id]),hidden.type==='select'?'해당사항없음':'[공란]');
   if(changed.fields.color)assert.equal(changed.fields.color.value,'확인 색상');
   for(const id of ['packagedWeightG','packagedDimensionsMm','mainImage','additionalImages','detailImages'])assert.equal(row.fields[id].value,'');
  }
  const unknown=model.resolveQuotationFields({categoryId:'unrecorded',product,options,content,settings:h.settings});
  assert.equal(unknown.schema.status,'unconfirmed');assert.ok(Object.values(unknown.rows[0].fields).every(cell=>cell.source!=='couplus-default'));
 }finally{h.close();}
});

for(const company of companies)test(`selected 81452 category + recorded 1688 URL → editable draft → saved quotation/export values (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 try{
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema('81452');
  h.context.category={...h.context.category,categoryId:schema.categoryId,categoryPath:schema.categoryPath,name:schema.categoryPath.at(-1)};
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  assert.match(await h.intake(),/상품 초안 저장됨/);
  const product=h.sqlite.prepare('SELECT * FROM products').get();
  const path='/api/products/'+product.id+'/quotation-fields';
  const response=await h.route(path);assert.equal(response.status,200);const view=await response.json();
  assert.equal(view.categoryContext.categoryId,'81452');assert.deepEqual(view.resolved.schema.categoryPath,Array.from(schema.categoryPath));
  assert.equal(view.resolved.rows.filter(row=>row.optionId!==null).length,6);
  const option=view.resolved.rows.find(row=>row.optionId!==null),hidden=schema.fields.find(field=>field.visibility==='hidden'&&field.type==='select');
  assert.equal(option.fields[hidden.id].source,'couplus-default');assert.equal(option.fields[hidden.id].value,'');
  assert.equal(option.fields.noticeReleaseDate.value,'해당사항없음');
  assert.ok(option.fields.noticeManufacturerImporter.value.includes(company.companyName));
  const changes=[{fieldKey:'title',optionId:null,value:'검토 후 수정 상품명'},{fieldKey:hidden.id,optionId:option.optionId,value:hidden.choices.find(choice=>choice.value!=='').value},{fieldKey:'noticeReleaseDate',optionId:option.optionId,value:'2026.09'},{fieldKey:'noticeComponents',optionId:option.optionId,value:''}];
  const saved=await h.route(path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}});
  assert.equal(saved.status,200,await saved.clone().text());
  const source=await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id);
  const resolved=h.load('app/quotation-schema.ts').resolveQuotationFields({...source,categoryId:'81452',overrides:source.state.overrides});
  const assets=JSON.parse(source.product.image_keys).map((key,index)=>({key,name:`assets/image-${index}.png`}));
  const exported=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,assets),row=exported.find(row=>row.skuId===source.options.rows.find(row=>row.id===option.optionId).supplierSku);
  assert.equal(row.title,'검토 후 수정 상품명');assert.equal(row[hidden.id],changes[1].value);assert.equal(row.noticeReleaseDate,'2026.09');assert.equal(row.noticeComponents,'');
  const untouched=exported.find(item=>item!==row);assert.equal(untouched[hidden.id],'');assert.equal(untouched.noticeReleaseDate,'해당사항없음');
  assert.equal(h.calls.some(path=>path.includes('/supplier-hub-receipt')),false);
 }finally{h.close();}
});
