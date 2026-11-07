import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaPath} from './helpers/hub-schema.mjs';
import {quotationTitleLoader} from './helpers/quotation-seo-title-ui.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const wire=(schema,key)=>schema.fields.find(field=>!field.hubWire?.name&&JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','commonAttributes',key]));
async function fixture(change=()=>{}){
 const h=mobileIntakeHarness(),snap=hubSchemaSnapshot(),raw=JSON.parse(snap.schemaString);
 const price=title=>({type:['string','null'],title});
 raw.properties.productPage.properties.commonAttributes={type:'object',properties:{purchasePrice:price('공급가'),coupangSalePrice:price('판매가'),msrp:price('권장소비자가격'),osrp:price('공식 판매처 가격')}};
 change(raw.properties.productPage.properties.commonAttributes);
 Object.assign(snap,{inputBindings:'couplus-paths-v1',draftInitialization:'couplus-required-v1',schemaString:JSON.stringify(raw)});
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 가격 양식',categoryId:snap.categoryId,categoryPath:schemaPath,hubSchema:snap,template:null,mappings:[]});
 h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
 const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
 const read=()=>h.route(base+'/quotation-fields').then(json);
 const write=async changes=>{const view=await read();return json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));};
 const priceSave=async()=>{
  const before=await json(await h.route(base+'/stage-two-pricing'));
  const request={expectedProductVersion:before.product.updated_at,expectedOptionRevision:before.options.options.revision,expectedQuotationRevision:before.quotation.revision,expectedInputFingerprint:before.quotation.inputFingerprint,
   ...(before.options.pricing.rocketMarginGate===undefined?{}:{expectedRocketMarginGate:before.options.pricing.rocketMarginGate}),policy:{...before.options.pricing.policy,msrpMultiple:1.6},rows:h.load('app/product-options.ts').optionInputs(before.options.options),changes:[],recalculate:true};
  const saved=await json(await h.route(base+'/stage-two-pricing',{method:'POST',body:request}));
  h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,saved);
  const after=await read();assert.deepEqual(after,saved.quotation);return after;
 };
 return{h,base,read,write,priceSave,close:()=>h.close()};
}
const row=(view,id)=>view.resolved.rows.find(row=>row.optionId===id);
const cell=(view,id,key)=>row(view,id).fields[key];

test('independent optional OSRP remains absent through actual priceSave and readback while primary prices calculate by SKU',async()=>{
 const f=await fixture();try{
  const content=await json(await f.h.route(f.base+'/content'));
  await json(await f.h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{seo:{title:'합성 가격 상품'}}}}));
  const options=await json(await f.h.route(f.base+'/options')),rows=f.h.load('app/product-options.ts').optionInputs(options.options);
  for(const [index,input] of rows.entries()){input.unitCostCny=index+3;input.unitsPerPack=index+1;}
  await json(await f.h.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  const before=await f.read(),osrp=wire(before.resolved.schema,'osrp'),after=await f.priceSave();
  const stored=await json(await f.h.route(f.base+'/options')),calculated=f.h.load('app/product-options.ts').calculateOptionPrices(stored.options.rows,stored.pricing.policy);
  assert.equal(osrp.hubInput,'msrp');assert.equal(osrp.required,false);
  assert.notEqual(cell(after,null,'msrp').value,cell(before,null,'msrp').value);
  for(const view of [before,after])for(const resolved of view.resolved.rows){assert.equal(resolved.fields[osrp.id].value,'');assert.equal(resolved.fields[osrp.id].source,'empty');}
  for(const input of stored.options.rows){
   const resolved=row(after,input.id);assert.equal(input.supplierSku,options.options.rows.find(old=>old.id===input.id).supplierSku);
   for(const key of ['supplyPrice','salePrice','msrp']){const expected=String(calculated.find(price=>price.optionId===input.id).calculation[key]);assert.equal(resolved.fields[key].value,expected);assert.equal(resolved.fields[wire(after.resolved.schema,{supplyPrice:'purchasePrice',salePrice:'coupangSalePrice',msrp:'msrp'}[key]).id].value,expected);}
  }
  assert.deepEqual(after.overrides,{common:{},options:{}});assert.ok(!f.h.network.includes('supplier.coupang.com'));
 }finally{f.close();}
});

test('manual common, option, deliberate blanks and isolated resets retain real precedence across priceSave',async()=>{
 const f=await fixture();try{
  let view=await f.read();const key=wire(view.resolved.schema,'osrp').id,[a,b]=view.resolved.rows.filter(row=>row.optionId).map(row=>row.optionId);
  await f.write([{fieldKey:key,optionId:null,value:'15000'},{fieldKey:key,optionId:a,value:'18000'},{fieldKey:key,optionId:b,value:''}]);
  view=await f.priceSave();
  assert.equal(cell(view,null,key).value,'15000');assert.equal(cell(view,a,key).value,'18000');assert.equal(cell(view,a,key).source,'manual-option');assert.equal(cell(view,b,key).value,'');assert.equal(cell(view,b,key).source,'manual-option');
  const otherOverrides=JSON.stringify(view.overrides.options[b]);
  view=await f.write([{fieldKey:key,optionId:a,value:null}]);assert.equal(cell(view,a,key).value,'15000');assert.equal(cell(view,a,key).source,'manual-common');assert.equal(JSON.stringify(view.overrides.options[b]),otherOverrides);
  view=await f.write([{fieldKey:key,optionId:null,value:''}]);assert.equal(cell(view,a,key).value,'');assert.equal(cell(view,a,key).source,'manual-common');
  view=await f.write([{fieldKey:key,optionId:null,value:null}]);assert.equal(cell(view,a,key).source,'empty');assert.equal(cell(view,b,key).source,'manual-option');
 }finally{f.close();}
});

for(const mode of ['schema-default','draft-default','required','osrp-only'])test(`OSRP ${mode} preserves existing automatic/default behavior and source hint`,async()=>{
 const f=await fixture(group=>{if(mode==='schema-default')group.properties.osrp.default='14000';if(mode==='required')group.required=['osrp'];if(mode==='osrp-only')delete group.properties.msrp;});try{
  if(mode==='draft-default'){
   // Synthetic compiled metadata exercises the existing draft-default layer;
   // optional scalar captures do not normally initialize this property.
   const compiler=f.h.load('app/supplier-hub-schema.ts'),compile=compiler.compileHubQuotationSchema;
   compiler.compileHubQuotationSchema=(...args)=>{const compiled=compile(...args),field=wire({fields:compiled.fields},'osrp');field.draftDefault='14500';field.schemaDefault='14000';return compiled;};
  }
  let view=await f.read();const field=wire(view.resolved.schema,'osrp'),links=f.h.load('app/quotation-input-links.ts');
  if(mode==='schema-default'||mode==='draft-default'){
   const expected=mode==='schema-default'?'14000':'14500',source=mode==='schema-default'?'schema':'couplus-default';
   for(const resolved of view.resolved.rows){assert.equal(resolved.fields[field.id].value,expected);assert.equal(resolved.fields[field.id].source,source);}
   const id=view.resolved.rows.find(row=>row.optionId).optionId;
   view=await f.write([{fieldKey:field.id,optionId:id,value:''}]);assert.equal(cell(view,id,field.id).source,'manual-option');
   view=await f.write([{fieldKey:field.id,optionId:id,value:null}]);assert.equal(cell(view,id,field.id).value,expected);
  }else{
   for(const resolved of view.resolved.rows){assert.equal(resolved.fields[field.id].value,resolved.fields.msrp.value);assert.ok(['product','pricing'].includes(resolved.fields[field.id].source));}
   assert.match(links.quotationInputLink(field,view.resolved.schema.fields),/2단계/);
  }
 }finally{f.close();}
});

test('only a supported unique exact optional OSRP with primary MSRP receives the schema-aware hint',async()=>{
 const f=await fixture();try{
  const view=await f.read(),fields=view.resolved.schema.fields,osrp=wire(view.resolved.schema,'osrp'),msrp=wire(view.resolved.schema,'msrp');
  const targets=f.h.load('app/quotation-price-targets.ts'),links=f.h.load('app/quotation-input-links.ts');
  assert.equal(targets.quotationIndependentOptionalOsrp(fields).id,osrp.id);
  const replace=patch=>fields.map(field=>field.id===osrp.id?{...field,...patch}:field);
  const unsupported=[replace({required:true}),replace({readOnly:true}),replace({hubInput:undefined}),replace({numericText:undefined,type:'text'}),replace({hubWire:{path:['productPage','other','osrp']}}),replace({hubWire:{...osrp.hubWire,name:'osrp'}}),fields.filter(field=>field.id!==msrp.id),[...fields,{...msrp,id:'duplicate-msrp'}],[...fields,{...osrp,id:'duplicate-osrp'}],fields.map(field=>field.id===msrp.id?{...field,hubInput:undefined}:field)];
  for(const candidate of unsupported)assert.equal(targets.quotationIndependentOptionalOsrp(candidate),undefined);
  assert.throws(()=>targets.quotationPriceTargets(unsupported[7]),/연결/);
  assert.match(links.quotationInputLink(osrp),/2단계/);
  const load=quotationTitleLoader(),Component=load('app/components/category-quotation-preview.tsx').CategoryQuotationPreview;
  const html=renderToStaticMarkup(createElement(Component,{schema:view.resolved.schema}));
  const osrpRow=html.slice(html.indexOf('<th scope="row">공식 판매처 가격'),html.indexOf('</tr>',html.indexOf('<th scope="row">공식 판매처 가격')));
  assert.match(osrpRow,/실제 판매가격 직접 입력/);assert.doesNotMatch(osrpRow,/2단계 옵션 권장소비자/);
 }finally{f.close();}
});
