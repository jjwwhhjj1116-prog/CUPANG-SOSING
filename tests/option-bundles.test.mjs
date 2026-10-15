import test from 'node:test';
import assert from 'node:assert/strict';
import { optionPriceTableUI, priceTableCompanies } from './helpers/option-price-table-ui.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
for(const company of priceTableCompanies){
 test(`bundle clones append, retain source facts and keep unknown stock unknown (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3});try{
   const tools=h.load('app/option-bundles.ts'),base=await h.rows(),before=JSON.stringify(base);
   base.rows[2].packagedWeightG=450;base.rows[2].packagingUnitsPerPack=1;base.rows[2].stock=29;
   const savedBefore=JSON.stringify(base),additions=[{sourceOptionId:'price-003',optionId:'bundle-3'},{sourceOptionId:'price-002',optionId:'bundle-2'}];
   const next=tools.applyBundleAddRows(base,additions,3,'2026-10-15T00:00:00.000Z');
   assert.deepEqual(plain(next.rows.slice(0,3)),plain(base.rows));assert.deepEqual(plain(next.rows.map(r=>r.id)),['price-001','price-002','price-003','bundle-3','bundle-2']);
   assert.equal(next.rows[3].stock,9);assert.equal(next.rows[4].stock,null);assert.equal(next.rows[3].translatedName,'합성 옵션 3 (3개묶음)');
   assert.equal(next.rows[3].supplierSku,'');assert.equal(next.rows[3].unitCostCny,base.rows[2].unitCostCny);assert.equal(next.rows[3].originalName,base.rows[2].originalName);
   assert.equal(next.rows[3].packagedWeightG,450);assert.equal(next.rows[3].packagingUnitsPerPack,1);assert.equal(next.rows[3].provenance.originalName,base.rows[2].provenance.originalName);
   assert.deepEqual(plain(next.bundleSources),{'bundle-3':{sourceOptionId:'price-003',quantity:3},'bundle-2':{sourceOptionId:'price-002',quantity:3}});
   assert.equal(JSON.stringify(base),savedBefore);assert.equal((await h.rows()).rows[2].packagedWeightG,null);assert.ok(before);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`nested bundle numbers survive source removal and later quantity edits without allocating during reads (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3});try{
   const tools=h.load('app/option-bundles.ts'),model=h.load('app/product-options.ts'),db=h.load('db/product-options.ts'),owner=h.product.owner_id,product=await h.load('db/queries.ts').findProduct(owner,h.product.id);
   const base=await h.rows(),initial=await db.readOptionRegistrationNumbers(owner,product,base);
   const first=tools.applyBundleAddRows(base,[{sourceOptionId:'price-001',optionId:'bundle-first'}],3,'2026-10-15T00:00:00.000Z');
   assert.ok(await db.saveProductOptions(owner,first,base.revision,h.product.updated_at));
   const second=tools.applyBundleAddRows(first,[{sourceOptionId:'bundle-first',optionId:'bundle-second'}],2,'2026-10-15T00:00:01.000Z');
   assert.ok(await db.saveProductOptions(owner,second,first.revision,first.updatedAt));
   assert.equal(second.rows.at(-1).unitsPerPack,2);assert.equal(second.rows.at(-1).translatedName,'합성 옵션 1 (2개묶음)');
   const retained=model.optionInputs(second).filter(r=>!['price-001','bundle-first'].includes(r.id)).map(r=>r.id==='bundle-second'?{...r,unitsPerPack:5}:r);
   const final=model.applyOptionRows(second,retained,'2026-10-15T00:00:02.000Z');assert.ok(await db.saveProductOptions(owner,final,second.revision,second.updatedAt));
   const counterBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM product_registration_options ORDER BY option_id').all()),numbers=await db.readOptionRegistrationNumbers(owner,product,final);
   assert.equal(numbers['bundle-second'],initial['price-001']+'B3B2');assert.equal(numbers['price-001'],undefined);assert.equal(numbers['bundle-first'],undefined);
   assert.equal(final.bundleSources['bundle-second'].quantity,2);assert.equal(final.rows.at(-1).unitsPerPack,5);
   assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM product_registration_options ORDER BY option_id').all()),counterBefore);
   assert.equal(await db.readOptionRegistrationNumbers(owner,{id:product.id},final),undefined);
   assert.deepEqual(plain(await db.readOptionRegistrationNumbers('other-owner',product,final)),{});assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`bundle requests reject duplicate lifetime pairs, cycles, unknown sources and invalid bounds (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3});try{
   const tools=h.load('app/option-bundles.ts'),base=await h.rows(),addition=[{sourceOptionId:'price-001',optionId:'new'}],before=JSON.stringify(base);
   for(const quantity of [1,1.5,1000001,NaN])assert.throws(()=>tools.createBundleAddDraft(base,addition,quantity));
   for(const additions of [[],[{sourceOptionId:'missing',optionId:'new'}],[{sourceOptionId:'price-001',optionId:'price-002'}],[...addition,{sourceOptionId:'price-001',optionId:'other'}],[...addition,{sourceOptionId:'new',optionId:'other'}]])assert.throws(()=>tools.createBundleAddDraft(base,additions,2));
   for(const optionId of ['__proto__','prototype','constructor'])assert.throws(()=>tools.createBundleAddDraft(base,[{sourceOptionId:'price-001',optionId}],2));
   const historical={...base,bundleSources:{removed:{sourceOptionId:'price-001',quantity:2}}};assert.throws(()=>tools.createBundleAddDraft(historical,addition,2),/이미 있습니다/);
   assert.throws(()=>tools.validatedBundleSources({...base,bundleSources:{a:{sourceOptionId:'b',quantity:2},b:{sourceOptionId:'a',quantity:2}}}),/순환/);
   assert.equal(JSON.stringify(base),before);
   const model=h.load('app/product-options.ts'),ordinary=model.applyOptionRows(base,model.optionInputs(base),'next');assert.equal(Object.hasOwn(ordinary,'bundleSources'),false);
   const legacy=plain(base);for(const r of legacy.rows){delete r.color;delete r.size;delete r.packagedWidthMm;delete r.packagedLengthMm;delete r.packagedHeightMm;}legacy.rows[0].packagedWeightG=100;delete legacy.rows[0].packagingUnitsPerPack;
   const originalBytes=JSON.stringify(legacy.rows),additive=tools.applyBundleAddRows(legacy,addition,3,'next');assert.equal(JSON.stringify(additive.rows.slice(0,legacy.rows.length)),originalBytes);assert.equal(additive.rows.at(-1).packagingUnitsPerPack,1);
   const blank={...base,rows:base.rows.map((r,i)=>i? r:{...r,translatedName:'',originalName:''})};assert.equal(tools.createBundleAddDraft(blank,addition,2).rows.at(-1).translatedName,'기본 옵션 (2개묶음)');
   assert.throws(()=>tools.createBundleAddDraft({...base,rows:base.rows.map((r,i)=>i?r:{...r,translatedName:'가'.repeat(500)})},addition,2),/500자/);
  }finally{h.close();}
 });
 test(`bundle quotation copies only owned manual fields, preserves blanks and clears labels while recalculating prices (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   const tools=h.load('app/option-bundles.ts'),schema=h.load('app/quotation-schema.ts'),view=await(await h.request(`/api/products/${h.product.id}/quotation-fields`)).json(),base=await h.rows();
   view.overrides={common:{brand:'공통 브랜드',labelImages:'common-label'},options:{'price-001':{brand:'',model:'원본 모델',title:'직접 제목',supplyPrice:'99999',salePrice:'199999',msrp:'299999',labelImages:'source-label',unrecognized:'drop'}}};
   const additions=[{sourceOptionId:'price-001',optionId:'new'}],draft=tools.applyBundleAddRows(base,additions,5,'2026-10-15T00:00:00.000Z'),before=JSON.stringify(view);
   const changes=tools.bundleQuotationChanges(view,additions,draft.rows,h.policy),overrides=schema.applyQuotationChanges(view.overrides,changes),child=overrides.options.new;
   assert.equal(child.brand,'');assert.equal(child.model,'원본 모델');assert.equal(child.title,'직접 제목');assert.equal(child.labelImages,'');assert.equal(child.unrecognized,undefined);
   assert.equal(child.supplyPrice,'8230');assert.equal(child.salePrice,'13720');assert.equal(child.msrp,'17840');
   assert.deepEqual(overrides.options['price-001'],view.overrides.options['price-001']);assert.deepEqual(overrides.common,view.overrides.common);assert.equal(JSON.stringify(view),before);
   const physical=view.resolved.schema.fields.find(field=>field.id==='packagedWeightG');view.overrides.options['price-001'].packagedWeightG='450';
   view.packagingBasis={version:1,common:{},options:{'price-001':{packagedWeightG:{value:'450',fieldSignature:JSON.stringify(physical),unitsPerPack:{'price-001':1}}}}};
   const recorded=JSON.stringify(view.packagingBasis),basis=tools.bundleQuotationPackagingBasis(view,additions);
   assert.equal(basis.options.new.packagedWeightG.unitsPerPack.new,1);assert.equal(basis.options.new.packagedWeightG.value,'450');assert.equal(JSON.stringify(view.packagingBasis),recorded);
   const pack=h.load('app/quotation-packaging-basis.ts');assert.match(pack.quotationPackagingBasisIssues(view.resolved.schema.fields,basis,schema.applyQuotationChanges(view.overrides,tools.bundleQuotationChanges(view,additions,draft.rows,h.policy)),'new',5,'packagedWeightG').join(' '),/1개입 기준/);
  }finally{h.close();}
 });
}

test('B display metadata accepts canonical bounded nesting only and retains parent/sparse-map checks',async()=>{
 const h=await optionPriceTableUI(priceTableCompanies[0],{count:3});try{
  const registry=h.load('app/product-registration.ts'),rows=[{id:'a'},{id:'b'}],parent='261015001001';
  for(const value of ['261015001001B2','261015001001B3B2','261015001001B1000000'])assert.equal(registry.validOptionRegistrationNumbers({a:value},rows,parent),true);
  for(const value of ['261015001000B2','261015001001B1','261015001001B02','261015001001B2.5','261015001001B1000001','261015001001B2x','261015001001B２','261015001001B2'.repeat(33),'261015002001B2'])assert.equal(registry.validOptionRegistrationNumbers({a:value},rows,parent),false);
  assert.equal(registry.validOptionRegistrationNumbers({a:'261015001001B2',b:'261015001001B2'},rows,parent),false);
  assert.equal(registry.validOptionRegistrationNumbers({missing:'261015001001B2'},rows,parent),false);assert.equal(registry.validOptionRegistrationNumbers(undefined,rows),true);
 }finally{h.close();}
});
