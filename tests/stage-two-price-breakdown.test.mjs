import test from 'node:test';
import assert from 'node:assert/strict';
import {optionPriceTableUI,priceTableCompanies,priceTableNodes as nodes,priceTableText as text} from './helpers/option-price-table-ui.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
const change=(h,label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
const parts=h=>nodes(h.render()).filter(node=>node.props?.['data-price-ratio']).map(node=>[node.props['data-price-ratio'],text(node)]);
const summary=h=>text(h.node('전체 옵션 가격 요약'));
for(const company of priceTableCompanies)test(`${company.code} full-width policy ratio follows the local policy while summary follows exact reviewed prices and one atomic save`,async()=>{
 const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
  const original=plain(await h.rows()),protectedBefore=h.protectedSnapshot();
  assert.deepEqual(parts(h),[['cost','10%'],['supply','50%'],['coupang','40%']]);
  const tree=nodes(h.render()),grid=tree.findIndex(node=>node.props?.['aria-label']==='옵션별 가격 정보'),ratio=tree.findIndex(node=>node.props?.['aria-label']==='가격 설정 비율'),sum=tree.findIndex(node=>node.props?.['aria-label']==='전체 옵션 가격 요약');
  assert.ok(grid<ratio&&ratio<sum);assert.equal(tree.filter(node=>node.props?.['aria-label']==='전체 옵션 가격 요약').length,1);
  change(h,'공급 마진율 (%)','55');await h.settle();assert.deepEqual(parts(h),[['cost','5%'],['supply','55%'],['coupang','40%']]);
  const beforeFilter=summary(h);change(h,'가격 옵션 검색','fixture-sku-1');await h.settle();assert.equal(summary(h),beforeFilter,'filter never narrows the full-option summary');
  change(h,'가격 옵션 1 공급가','5000');await h.settle();assert.notEqual(summary(h),beforeFilter);assert.deepEqual(parts(h),[['cost','5%'],['supply','55%'],['coupang','40%']],'manual prices must not rewrite the policy');
  assert.deepEqual(plain(await h.rows()),original);assert.equal(h.protectedSnapshot(),protectedBefore);assert.equal(h.writes.length,0,'all edits remain local until explicit save');
  h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,1,text(h.render()));assert.equal(h.writes[0].kind,'stage-two-pricing');assert.equal(h.writes[0].policy.supplyMargin,55);assert.equal(h.saved,1,text(h.render()));
  const body=await(await h.request('/api/products/'+h.product.id+'/stage-two-pricing')).json();assert.equal(body.options.pricing.policy.supplyMargin,55);
  const selected=body.quotation.resolved.rows.find(row=>row.optionId==='price-001');const fields=body.quotation.resolved.schema.fields.filter(field=>field.hubInput==='supplyPrice'||field.id==='supplyPrice');assert.ok(fields.some(field=>selected.fields[field.id]?.value==='5000'));
  assert.equal(h.node('가격 설정 비율').props['data-price-ratio-valid'],true);assert.deepEqual(parts(h),[['cost','5%'],['supply','55%'],['coupang','40%']]);
 }finally{h.close();}
});
test('an empty margin draft stays unknown instead of displaying a fabricated ratio or writing a correction',async()=>{
 const h=await optionPriceTableUI(priceTableCompanies[0],{count:2,integrated:true});try{
  const before=plain(await h.rows());change(h,'공급 마진율 (%)','');await h.settle();assert.equal(h.node('가격 설정 비율').props['data-price-ratio-valid'],false);assert.deepEqual(parts(h),[]);assert.match(text(h.node('가격 설정 비율')),/마진율을 확인/);
  assert.equal(h.button('가격 설정 저장하기').props.disabled,true);assert.equal(h.writes.length,0);assert.deepEqual(plain(await h.rows()),before);
  change(h,'공급 마진율 (%)','50');change(h,'가격 옵션 1 판매가','');change(h,'쿠팡 마진율 (%)','45');
  assert.equal(h.node('가격 옵션 1 판매가').props.value,'');
  assert.equal(h.node('가격 옵션 2 판매가').props.value,'8000');
 }finally{h.close();}
});

const amounts=(h,index)=>['공급가','판매가'].map(label=>Number(h.node(`가격 옵션 ${index} ${label}`).props.value));
async function savedPriceFixture(h,policy,costs){
 const path='/api/products/'+h.product.id+'/stage-two-pricing',current=await(await h.request(path)).json();
 const response=await h.request(path,{method:'POST',body:JSON.stringify({
  expectedProductVersion:current.product.updated_at,expectedOptionRevision:current.options.options.revision,
  expectedQuotationRevision:current.quotation.revision,expectedInputFingerprint:current.quotation.inputFingerprint,
  policy,rows:h.load('app/product-options.ts').optionInputs(current.options.options).map((row,index)=>({...row,unitCostCny:costs[index]})),changes:[],recalculate:false
 })});
 assert.equal(response.status,200,await response.clone().text());
 await h.reloadProduct();await h.settle();
 h.button('저장 가격 다시 조회').props.onClick();await h.settle();
 h.writes.length=0;
 return path;
}

test('fixed sourcing Coupang rate changes sale only, including all equal-cost rows, and persists to quotation',async()=>{
 const h=await optionPriceTableUI(priceTableCompanies[0],{count:6,integrated:true});try{
  const policy={...h.policy,exchangeRate:310,coupangMargin:45,useIntegratedRate:true,integratedRate:290,
   fixedSourcing:{version:1,referenceCny:4.8,salePrice:10500,supplyPrice:5775,purchaseCost:2738,sourceUnitsPerPack:1}};
  const path=await savedPriceFixture(h,policy,[5,4.8,4.8,4.8,4.8,4.8]);
  assert.deepEqual(amounts(h,1),[6020,10940]);
  assert.deepEqual(amounts(h,2),[5775,10500]);
  const guide=nodes(h.render()).find(node=>node.type==='details'&&text(node.props.children[0])==='고정 소싱가격 안내');
  assert.ok(guide);assert.equal(guide.props.open,undefined);
  change(h,'쿠팡 마진율 (%)','');change(h,'쿠팡 마진율 (%)','40');
  assert.deepEqual(amounts(h,1),[6020,10030]);
  assert.deepEqual(amounts(h,6),[5775,9630]);
  change(h,'쿠팡 마진율 (%)','45');
  assert.deepEqual(amounts(h,1),[6020,10940]);assert.deepEqual(amounts(h,6),[5775,10500]);
  change(h,'쿠팡 마진율 (%)','40');change(h,'가격 옵션 1 개당 원가','5.2');
  assert.deepEqual(amounts(h,1),[6260,10430]);assert.deepEqual(amounts(h,2),[5775,9630]);
  change(h,'가격 옵션 1 개당 원가','5');
  h.button('일괄 재계산').props.onClick();
  assert.deepEqual(Array.from({length:6},(_,index)=>amounts(h,index+1)),[[6020,10030],...Array.from({length:5},()=>[5775,9630])]);
  assert.equal(h.writes.length,0);
  h.button('가격 설정 저장하기').props.onClick();await h.settle();
  assert.equal(h.saved,1,text(h.render()));
  const saved=await(await h.request(path)).json();
  assert.equal(saved.options.pricing.policy.fixedSourcing.referenceCny,4.8);
  assert.equal(saved.options.pricing.policy.fixedSourcing.salePrice,10500);
  const values=saved.quotation.resolved.rows.filter(row=>row.optionId!==null).map(row=>[row.fields.supplyPrice.value,row.fields.salePrice.value]);
  assert.deepEqual(values,[['6020','10030'],...Array.from({length:5},()=>['5775','9630'])]);
 }finally{h.close();}
});

test('a margin-only edit preserves the ordinary price calculation basis until an independent full recalculation',async()=>{
 const h=await optionPriceTableUI(priceTableCompanies[0],{count:2,integrated:true});try{
  await savedPriceFixture(h,h.policy,[20,20]);
  assert.deepEqual(amounts(h,1),[14000,23330]);
  change(h,'쿠팡 마진율 (%)','45');
  assert.deepEqual(amounts(h,1),[14000,25450]);assert.deepEqual(amounts(h,2),[14000,25450]);
  h.button('일괄 재계산').props.onClick();assert.deepEqual(amounts(h,1),[14000,25450]);
  h.button('가격 설정 저장하기').props.onClick();await h.settle();
  assert.equal(h.saved,1,text(h.render()));assert.deepEqual(amounts(h,1),[14000,25450]);
  h.button('일괄 재계산').props.onClick();
  assert.deepEqual(amounts(h,1),[10000,18180]);assert.deepEqual(amounts(h,2),[10000,18180]);
  change(h,'적용 환율 (CNY → KRW)','400');
  assert.deepEqual(amounts(h,1),[11000,20000]);assert.deepEqual(amounts(h,2),[11000,20000]);
 }finally{h.close();}
});

test('an edited row copies its draft CNY to selected rows only and saves the reviewed prices once',async()=>{
 const h=await optionPriceTableUI(priceTableCompanies[0],{count:4,integrated:true});try{
  const initial=plain(await h.rows());
  h.node('가격 검색 결과 전체 선택').props.onChange({target:{checked:true}});
  h.node('가격 옵션 4 선택').props.onChange({target:{checked:false}});
  change(h,'가격 옵션 1 개당 원가','5');
  const sourceSupply=amounts(h,1)[0];
  change(h,'쿠팡 마진율 (%)','45');
  assert.deepEqual(amounts(h,1),[sourceSupply,8640]);
  change(h,'가격 옵션 검색','fixture-sku-1');
  const copy=h.button('가격 옵션 1 원가를 선택 옵션에 동일 적용');
  copy.props.onClick();
  change(h,'가격 옵션 검색','');
  assert.deepEqual(Array.from({length:4},(_,i)=>h.node(`가격 옵션 ${i+1} 개당 원가`).props.value),[5,5,5,3.99]);
  assert.deepEqual(amounts(h,1),amounts(h,2));assert.deepEqual(amounts(h,1),amounts(h,3));
  assert.equal(h.writes.length,0);assert.deepEqual(plain(await h.rows()),initial);
  h.button('옵션 가격 저장하기').props.onClick();await h.settle();
  assert.equal(h.saved,1,text(h.render()));assert.equal(h.writes.length,1);
  assert.deepEqual(Array.from((await h.rows()).rows,row=>row.unitCostCny),[5,5,5,3.99]);
 }finally{h.close();}
});

for(const [index,company]of priceTableCompanies.entries())test(`${company.code} live 0.28 CNY example uses the saved cost basis and either save button makes one exact atomic commit`,async()=>{
 const h=await optionPriceTableUI(company,{count:1,integrated:true});try{
  const before=h.protectedSnapshot();change(h,'적용 환율 (CNY → KRW)','310');change(h,'쿠팡 마진율 (%)','45');change(h,'가격 옵션 1 개당 원가','0.28');await h.settle();
  assert.equal(Number(h.node('가격 옵션 1 공급가').props.value),3090);assert.equal(Number(h.node('가격 옵션 1 판매가').props.value),5620,'general FX310 does not invent integrated fees');
  h.node('통합통관 환율 사용').props.onChange({target:{checked:true}});await h.settle();change(h,'통합통관 적용환율 (CNY → KRW)','300');await h.settle();
  assert.equal(Number(h.node('가격 옵션 1 공급가').props.value),3420);assert.equal(Number(h.node('가격 옵션 1 판매가').props.value),6220);assert.deepEqual(parts(h),[['cost','5%'],['supply','50%'],['coupang','45%']]);
  assert.match(summary(h),/평균 공급 마진: 2,998원/);assert.match(summary(h),/평균 쿠팡 마진: 2,800원/);assert.match(summary(h),/공급: 88%/);assert.match(summary(h),/쿠팡: 45%/);
  assert.equal(h.writes.length,0);assert.equal(h.protectedSnapshot(),before);
  h.button(index?'옵션 가격 저장하기':'가격 설정 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,1,text(h.render()));assert.equal(h.saved,1,text(h.render()));
  const receipt=await(await h.request('/api/products/'+h.product.id+'/stage-two-pricing')).json();assert.equal(receipt.options.pricing.rows[0].calculation.costKrw,422);assert.equal(receipt.options.pricing.rows[0].calculation.supplyPrice,3420);assert.equal(receipt.options.pricing.rows[0].calculation.salePrice,6220);assert.equal(receipt.options.options.rows[0].unitCostCny,0.28);assert.equal(receipt.options.options.rows[0].unitsPerPack,1);
 }finally{h.close();}
});

test('registration pricing omits thumbnails and inline quantity edits while standalone options retain owned images',async()=>{
 const company=priceTableCompanies[0],prefix='price-owner-'+company.code+'/',manual=prefix+'manual.png',source=prefix+'source.png';
 const h=await optionPriceTableUI(company,{count:3,imageKeys:[manual,source],sourceImageKeys:{'price-001':source,'price-002':source,'price-003':'unowned/source.png'},rowImages:{'price-001':manual}});try{
  const tree=nodes(h.render()),images=tree.filter(node=>node.type==='img'&&node.props.alt?.startsWith('가격 옵션 '));assert.equal(images.length,0);
  assert.equal(tree.filter(node=>node.type==='th'&&node.props['data-price-column']).length,9);
  assert.equal(tree.some(node=>node.type==='input'&&node.props['aria-label']==='가격 옵션 1 구성 수량'),false);
  const firstRow=tree.find(node=>node.type==='tr'&&node.props['data-price-option-id']==='price-001');assert.equal(text(nodes(firstRow).find(node=>node.props?.['data-price-column']==='quantity')),'1개');
  h.setPricingView(false);await h.settle();const standaloneImages=nodes(h.render()).filter(node=>node.type==='img'&&/옵션 \d+ 연결 이미지/u.test(node.props.alt??''));
  assert.equal(standaloneImages.length,1);assert.equal(standaloneImages[0].props.src,'/api/files/'+manual);assert.equal(standaloneImages.some(node=>node.props.src.includes('unowned')),false);
  assert.equal(h.writes.length,0);assert.equal(h.protectedSnapshot(),h.before);
 }finally{h.close();}
});

test('unchanged pricing can be explicitly saved once; lost ACK keeps inputs and recovers by GET without recalculation',async()=>{
 const h=await optionPriceTableUI(priceTableCompanies[0],{count:2,integrated:true});try{
  const before=plain(await h.rows()),policy=plain(h.policy),firstSupply=h.node('가격 옵션 1 공급가').props.value;
  assert.equal(h.button('가격 설정 저장하기').props.disabled,false);assert.equal(h.button('옵션 가격 저장하기').props.disabled,false);assert.equal(h.writes.length,0);
  let lost=true;h.controls.response=async(url,init,response)=>{if(lost&&init.method==='POST'&&url.includes('/stage-two-pricing')&&response.ok){lost=false;return Response.json({error:'synthetic lost ACK'},{status:503});}return response;};
  const save=h.button('가격 설정 저장하기').props.onClick;save();save();await h.settle();
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].recalculate,false);assert.deepEqual(plain(h.writes[0].policy),policy);assert.deepEqual(plain(h.writes[0].rows),plain(h.load('app/product-options.ts').optionInputs(before)));assert.equal(h.saved,0);
  assert.equal(h.node('가격 옵션 1 공급가').props.value,firstSupply);assert.equal(h.button('가격 설정 저장하기').props.disabled,true);
  h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(h.saved,1,text(h.render()));assert.equal(h.writes.length,1);assert.equal(h.node('가격 옵션 1 공급가').props.value,firstSupply);
  const receipt=await(await h.request('/api/products/'+h.product.id+'/stage-two-pricing')).json();assert.ok(receipt.pricingReview);assert.deepEqual(receipt.options.options.rows,plain(before.rows));assert.deepEqual(receipt.options.pricing.policy,policy);
 }finally{h.close();}
});
