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
