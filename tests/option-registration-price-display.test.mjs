import test from 'node:test';
import assert from 'node:assert/strict';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';

const dataRows=h=>nodes(h.render()).filter(node=>node.type==='tr'&&node.props['data-price-option-id']);
const numberCell=row=>text(nodes(row).find(node=>node.type==='td'&&node.props['data-price-column']==='id'));
const change=(h,label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
const read=h=>h.request('/api/products/'+h.product.id+'/options').then(response=>response.json());

for(const company of priceTableCompanies)test(`price display searches saved numbers and writes the same UUID after filtering (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3});try{
    const before=await read(h),numbers=before.optionRegistrationNumbers;
    assert.equal(Object.keys(numbers).length,3);
    assert.deepEqual(dataRows(h).map(numberCell),before.options.rows.map(row=>numbers[row.id]));
    const id=before.options.rows[1].id,number=numbers[id];
    change(h,'가격 옵션 검색',number);await h.settle();
    assert.deepEqual(dataRows(h).map(row=>row.props['data-price-option-id']),[id]);assert.equal(numberCell(dataRows(h)[0]),number);
    change(h,'가격 옵션 2 개당 원가','7.99');await h.settle();h.button('옵션 저장·가격 계산').props.onClick();await h.settle();
    const saved=await read(h);assert.equal(saved.options.rows.find(row=>row.id===id).unitCostCny,7.99);
    assert.equal(saved.options.rows[0].unitCostCny,before.options.rows[0].unitCostCny);
    assert.equal(saved.optionRegistrationNumbers[id],number);assert.equal(h.writes[0].rows[1].id,id);
    assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
});

test('price display remains keyed by saved UUID after reorder and sparse legacy metadata',async()=>{
  const h=await optionPriceTableUI(priceTableCompanies[0],{count:3});try{
    const before=await read(h),numbers=before.optionRegistrationNumbers;
    const inputs=h.load('app/product-options.ts').optionInputs(before.options).reverse();
    const response=await h.request('/api/products/'+h.product.id+'/options',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:before.options.revision,expectedProductVersion:before.productVersion,rows:inputs})});
    assert.equal(response.status,200);const saved=await response.json();h.changeProductVersion(saved.productVersion);await h.settle();
    assert.deepEqual(dataRows(h).map(numberCell),inputs.map(row=>numbers[row.id]));
    h.controls.response=async(url,init,response)=>{const body=await response.json();if(init.method===undefined&&url.endsWith('/options'))delete body.optionRegistrationNumbers;return Response.json(body,{status:response.status});};
    h.changeProductVersion(new Date(Date.parse(saved.productVersion)+1).toISOString());await h.settle();
    assert.deepEqual(dataRows(h).map(numberCell),inputs.map(row=>row.id));
    assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
});

test('a malformed map cannot replace a price draft or acknowledge its save',async()=>{
  const h=await optionPriceTableUI(priceTableCompanies[0],{count:2});try{
    const before=await read(h),numbers=before.optionRegistrationNumbers;
    change(h,'가격 옵션 1 개당 원가','8.99');await h.settle();
    h.controls.response=async(url,init,response)=>{const body=await response.json();if(url.endsWith('/options'))body.optionRegistrationNumbers={...body.optionRegistrationNumbers,foreign:'261015999001'};return Response.json(body,{status:response.status});};
    h.button('옵션 저장·가격 계산').props.onClick();await h.settle();
    assert.equal(h.node('가격 옵션 1 개당 원가').props.value,8.99);
    assert.deepEqual(dataRows(h).map(numberCell),before.options.rows.map(row=>numbers[row.id]));
    assert.match(text(h.render()),/옵션 등록번호 응답/);assert.equal(h.saved,0);
  }finally{h.close();}
});

test('a committed atomic grid save with malformed number metadata recovers by reading instead of repeating its POST',async()=>{
  const h=await optionPriceTableUI(priceTableCompanies[0],{count:2,integrated:true});try{
    const before=await read(h);change(h,'가격 옵션 2 개당 원가','6.99');await h.settle();
    h.controls.response=async(url,init,response)=>{const body=await response.json();if(url.endsWith('/stage-two-pricing')&&init.method==='POST')body.options.optionRegistrationNumbers={foreign:'261015999001'};return Response.json(body,{status:response.status});};
    h.button('옵션 가격 저장하기').props.onClick();await h.settle();
    assert.equal(h.node('가격 옵션 2 개당 원가').props.value,6.99);
    assert.match(text(h.render()),/옵션 등록번호 응답|한 번 저장 결과/);assert.equal(h.writes.filter(write=>write.kind==='stage-two-pricing').length,1);
    delete h.controls.response;h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();
    const saved=await read(h);assert.equal(saved.options.rows[1].unitCostCny,6.99);
    assert.equal(h.writes.filter(write=>write.kind==='stage-two-pricing').length,1);
    assert.equal(saved.optionRegistrationNumbers[before.options.rows[1].id],before.optionRegistrationNumbers[before.options.rows[1].id]);
    assert.equal(h.node('가격 옵션 2 개당 원가').props.value,6.99);
  }finally{h.close();}
});
