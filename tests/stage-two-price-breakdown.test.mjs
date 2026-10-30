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

test('price name thumbnails use only current owned option/source bindings and keep the nine price columns',async()=>{
 const company=priceTableCompanies[0],prefix='price-owner-'+company.code+'/',manual=prefix+'manual.png',source=prefix+'source.png';
 const h=await optionPriceTableUI(company,{count:3,imageKeys:[manual,source],sourceImageKeys:{'price-001':source,'price-002':source,'price-003':'unowned/source.png'},rowImages:{'price-001':manual}});try{
  const tree=nodes(h.render()),images=tree.filter(node=>node.type==='img'&&node.props.alt?.startsWith('가격 옵션 '));assert.equal(images.length,2);
  assert.equal(images[0].props.src,'/api/files/'+manual);assert.equal(images[1].props.src,'/api/files/'+source);assert.equal(tree.filter(node=>node.type==='th'&&node.props['data-price-column']).length,9);
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
