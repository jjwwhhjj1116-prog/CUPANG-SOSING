import test from 'node:test';
import assert from 'node:assert/strict';
import {optionPriceTableUI,priceTableCompanies,priceTableNodes as nodes,priceTableText as text} from './helpers/option-price-table-ui.mjs';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),change=(h,label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const alerts=h=>nodes(h.render()).filter(node=>node.props?.role==='alert').map(text).join(' ');
const policy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'};
const canonical=['supplyPrice','salePrice','msrp'],paths={supplyPrice:'purchasePrice',salePrice:'coupangSalePrice',msrp:'msrp'};
const fields=[...canonical.map(id=>({id,section:'product',label:id,type:'number',required:false,visibility:'common'})),...canonical.map(input=>({id:'wire-'+input,section:'product',label:input,type:'number',required:false,visibility:'common',numericText:true,hubInput:input,hubWire:{path:['productPage','commonAttributes',paths[input]]}})),{id:'independent-osrp',section:'product',type:'number',numericText:true,hubInput:'msrp',hubWire:{path:['productPage','commonAttributes','osrp']}}];
const {recalculateStageTwoOptionCost}=load('app/stage-two-option-recalculation.ts'),{emptyOptionInput}=load('app/product-options.ts');
test('cost recalculation replaces only the included row supply/sale wires and preserves policy, facts and MSRP/OSRP input authority',()=>{
 const row={...emptyOptionInput('a'),included:true,originalName:'原文',supplierSku:'actual-fixture-id',unitCostCny:2.99,stock:null,minimumOrderQuantity:null,packagedWeightG:25,packagingConfirmed:true};
 const view={resolved:{schema:{fields},rows:[{optionId:'a',included:true}]}},edits=[{optionId:'a',fieldKey:'supplyPrice',value:'10000'},{optionId:'a',fieldKey:'wire-supplyPrice',value:'10000'},{optionId:'a',fieldKey:'salePrice',value:'16000'},{optionId:'a',fieldKey:'wire-salePrice',value:'16000'},...['msrp','wire-msrp','independent-osrp'].map(fieldKey=>({optionId:'a',fieldKey,value:''})),{optionId:'b',fieldKey:'salePrice',value:'20000'},{optionId:null,fieldKey:'salePrice',value:'25000'}];
 const before=JSON.stringify({row,view,edits,policy}),plan=recalculateStageTwoOptionCost(row,5.99,policy,view,edits);
 assert.equal(plan.row.unitCostCny,5.99);assert.deepEqual(plain(plan.changes.filter(edit=>edit.optionId==='a'&&edit.fieldKey.includes('supplyPrice')).map(edit=>edit.value)),['5100','5100']);assert.deepEqual(plain(plan.changes.filter(edit=>edit.optionId==='a'&&edit.fieldKey.includes('salePrice')).map(edit=>edit.value)),['8500','8500']);
 assert.deepEqual(plain(plan.changes.filter(edit=>['msrp','wire-msrp','independent-osrp'].includes(edit.fieldKey)||edit.optionId!=='a')),plain(edits.filter(edit=>['msrp','wire-msrp','independent-osrp'].includes(edit.fieldKey)||edit.optionId!=='a')));
 for(const key of ['originalName','supplierSku','stock','minimumOrderQuantity','packagedWeightG','packagingConfirmed'])assert.equal(plan.row[key],row[key]);assert.equal(JSON.stringify({row,view,edits,policy}),before);
 assert.equal(recalculateStageTwoOptionCost(row,2.99,policy,view,edits),null);assert.equal(recalculateStageTwoOptionCost({...row,included:false},5.99,policy,view,edits),null);
 for(const invalid of [null,0,-1,NaN,Infinity])assert.throws(()=>recalculateStageTwoOptionCost(row,invalid,policy,view,edits));assert.throws(()=>recalculateStageTwoOptionCost(row,5.99,policy,{resolved:{schema:{fields},rows:[]}},edits));
});
test('cost-driven bundle recommendation uses the final reviewed quantity and never confirms older packaging or invents stock/MOQ',()=>{
 const row={...emptyOptionInput('a'),included:true,originalName:'原文',unitCostCny:2.99,stock:null,minimumOrderQuantity:null,packagedWeightG:25,packagingConfirmed:true},view={resolved:{schema:{fields},rows:[{optionId:'a',included:true}]}};
 const bundle={...policy,bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000},plan=recalculateStageTwoOptionCost(row,0.36,bundle,view,[]);
 assert.equal(plan.row.unitsPerPack,21);assert.equal(plan.row.packagingConfirmed,false);assert.equal(plan.row.stock,null);assert.equal(plan.row.minimumOrderQuantity,null);assert.equal(plan.row.packagedWeightG,25);
 const expected=load('app/pricing.ts').calculatePrice(0.36,{...bundle,recalculationMode:'couplus-stage-two-v1',arithmeticMode:'couplus-number-v1'},21);assert.equal(plan.changes.find(edit=>edit.fieldKey==='supplyPrice').value,String(expected.supplyPrice));assert.equal(plan.changes.find(edit=>edit.fieldKey==='salePrice').value,String(expected.salePrice));
});

for(const company of priceTableCompanies){
 test(`${company.code}: cost change updates this row immediately, saves once into Stage7 and retains explicit MSRP, other rows/categories and source facts`,async()=>{
  const h=await optionPriceTableUI(company,{count:6,integrated:true});try{
   const owner=h.product.owner_id,schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),profile=await h.load('db/category-profiles.ts').createCategoryProfile(owner,{name:'LOCAL COST CHANGE',categoryId:'80719',categoryPath:schema.categoryPath,template:null,mappings:[]},'local-cost-change');
   h.selectProfile(profile.id);await h.settle();const path='/api/products/'+h.product.id+'/quotation-fields?profileId='+profile.id;
   const seeded={schemaVersion:1,productId:h.product.id,revision:1,overrides:{common:{brand:'legacy protected'},options:{}},categoryOverrides:{'category:80719':{common:{brand:'current protected'},options:{'price-002':{supplyPrice:'11000',salePrice:'19000',msrp:'27000'},'price-003':{msrp:''},'price-006':{supplyPrice:'8888',salePrice:'15555',msrp:'23000'}}},'category:81221':{common:{brand:'other category'},options:{'price-001':{salePrice:'12345',msrp:'30000'}}}},updatedAt:h.product.updated_at};
   h.sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(h.product.id,owner,1,JSON.stringify(seeded),seeded.updatedAt);h.button('저장 가격 다시 조회').props.onClick();await h.settle();
   const beforeRows=plain((await h.rows()).rows),protectedBefore=h.protectedSnapshot(),savedPolicy=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload);
   change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');change(h,'가격 옵션 4 권장소비자가','17000');h.node('가격 옵션 5 권장소비자가 복원').props.onClick();
   for(let i=1;i<=5;i++){change(h,`가격 옵션 ${i} 개당 원가`,'5.99');assert.equal(h.node(`가격 옵션 ${i} 공급가`).props.value,'5100');assert.equal(h.node(`가격 옵션 ${i} 판매가`).props.value,'8500');}
   assert.equal(h.node('가격 옵션 1 권장소비자가').props.value,'11050');assert.equal(h.node('가격 옵션 2 권장소비자가').props.value,'27000');assert.equal(h.node('가격 옵션 3 권장소비자가').props.value,'');assert.equal(h.node('가격 옵션 4 권장소비자가').props.value,'17000');assert.equal(h.node('가격 옵션 6 판매가').props.value,'15555');assert.equal(h.writes.length,0);
   h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.writes.length,1);assert.equal(h.writes[0].kind,'stage-two-pricing');assert.equal(h.writes[0].recalculate,false);assert.deepEqual(h.writes[0].policy,savedPolicy);
   const final=await json(await h.request(path)),state=await h.load('db/quotation-fields.ts').readQuotationFields(owner,h.product.id),savedRows=(await h.rows()).rows;
   for(let i=1;i<=5;i++){const id='price-00'+i,row=final.resolved.rows.find(value=>value.optionId===id);assert.equal(row.fields.supplyPrice.value,'5100');assert.equal(row.fields.salePrice.value,'8500');assert.equal(savedRows[i-1].unitCostCny,5.99);for(const key of ['originalName','supplierSku','stock','minimumOrderQuantity','unitsPerPack','packagedWeightG'])assert.equal(savedRows[i-1][key],beforeRows[i-1][key]);}
   const values=id=>final.resolved.rows.find(row=>row.optionId===id).fields;
   assert.equal(values('price-001').msrp.value,'11050');assert.equal(values('price-002').msrp.value,'27000');assert.equal(values('price-003').msrp.value,'');assert.equal(values('price-004').msrp.value,'17000');assert.equal(values('price-005').msrp.value,'11050');
   assert.deepEqual(plain(state.overrides),seeded.overrides);assert.deepEqual(plain(state.categoryOverrides['category:81221']),seeded.categoryOverrides['category:81221']);assert.deepEqual(plain(state.categoryOverrides['category:80719'].options['price-006']),seeded.categoryOverrides['category:80719'].options['price-006']);assert.deepEqual(plain(savedRows[5]),beforeRows[5]);assert.equal(h.protectedSnapshot(),protectedBefore);
   h.button('저장 가격 다시 조회').props.onClick();await h.settle();assert.equal(h.node('가격 옵션 1 판매가').props.value,'8500');assert.equal(h.node('가격 옵션 3 권장소비자가').props.value,'');assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);
  }finally{h.close();}
 });
 test(`${company.code}: identical/invalid cost, explicit price cancellation and later manual prices retain their exact authority without hidden writes`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');const cost=h.node('가격 옵션 1 개당 원가').props.value;change(h,'가격 옵션 1 개당 원가',String(cost));assert.equal(h.node('가격 옵션 1 공급가').props.value,'10000');assert.equal(h.node('가격 옵션 1 판매가').props.value,'16000');
   change(h,'가격 옵션 1 개당 원가','5.99');assert.equal(h.node('가격 옵션 1 판매가').props.value,'8500');change(h,'가격 옵션 1 개당 원가',String(cost));assert.equal(h.node('가격 옵션 1 판매가').props.value,'6750','returning to the original cost is another explicit row recalculation, not restoration of its old manual price');change(h,'가격 옵션 1 개당 원가','5.99');change(h,'가격 옵션 1 개당 원가','');await h.settle();assert.match(alerts(h),/원가/);assert.equal(h.node('가격 옵션 1 개당 원가').props.value,'');assert.equal(h.node('가격 옵션 1 판매가').props.value,'8500');h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,0);
   change(h,'가격 옵션 1 개당 원가','5.99');h.button('입력 취소·저장 가격 다시 조회').props.onClick();await h.settle();assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99,'price cancellation does not silently discard the separate source-cost draft');assert.notEqual(h.node('가격 옵션 1 판매가').props.value,'16000');assert.equal(h.writes.length,0);assert.equal((await h.rows()).rows[0].unitCostCny,cost);
   change(h,'가격 옵션 1 공급가','11000');change(h,'가격 옵션 1 판매가','19000');change(h,'가격 옵션 1 개당 원가','5.99');h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.writes.length,1);const final=await json(await h.request('/api/products/'+h.product.id+'/quotation-fields'));assert.equal(final.resolved.rows.find(row=>row.optionId==='price-001').fields.salePrice.value,'19000');
  }finally{h.close();}
 });
 test(`${company.code}: cost-derived draft survives a lost save ACK and is recovered by GET without another POST`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   let lost=true;h.controls.response=async(url,init,response)=>{if(lost&&init.method==='POST'&&url.includes('/stage-two-pricing')&&response.ok){lost=false;return Response.json({error:'synthetic lost ACK'},{status:503});}return response;};
   change(h,'가격 옵션 1 개당 원가','5.99');const save=h.button('옵션 가격 저장하기').props.onClick;save();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.saved,0);assert.equal(h.node('가격 옵션 1 공급가').props.value,'5100');assert.equal(h.node('가격 옵션 1 공급가').props.disabled,true);save();await h.settle();assert.equal(h.writes.length,1);
   h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal(h.node('가격 옵션 1 판매가').props.value,'8500');assert.equal((await h.rows()).rows[0].unitCostCny,5.99);
  }finally{h.close();}
 });
 test(`${company.code}: retained cost callbacks respect current source locks and never revive through a profile A/B/A cycle`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   const old=h.node('가격 옵션 1 개당 원가').props.onChange,before=h.node('가격 옵션 1 개당 원가').props.value;
   for(const state of [{policy:true},{policy:false,files:true},{files:false,allowed:false}]){h.locks(state);old({target:{value:'5.99',valueAsNumber:5.99}});assert.equal(h.node('가격 옵션 1 개당 원가').props.value,before);}
   h.locks({policy:false,files:false,allowed:true});change(h,'가격 옵션 1 개당 원가','5.99');const active=h.node('가격 옵션 1 개당 원가').props.onChange;
   h.selectProfile('missing');await h.settle();h.selectProfile(undefined);await h.settle();old({target:{value:'8.99',valueAsNumber:8.99}});active({target:{value:'9.99',valueAsNumber:9.99}});assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);assert.equal(h.node('가격 옵션 1 판매가').props.value,'8500');assert.equal(h.writes.length,0);
  }finally{h.close();}
 });
}
