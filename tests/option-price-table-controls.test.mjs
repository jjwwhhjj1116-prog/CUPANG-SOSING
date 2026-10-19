import test from 'node:test';
import assert from 'node:assert/strict';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';
const dataRows = h => nodes(h.render()).filter(node => node.type === 'tr' && node.props['data-price-option-id']);
const ids = h => dataRows(h).map(node => node.props['data-price-option-id']);
const change = (h, label, value) => h.node(label).props.onChange({ target: { value, valueAsNumber: Number(value) } });
const toggle = (h, label, checked) => h.node(label).props.onChange({ target: { checked } });
const columns = ['옵션명', '옵션번호', '번들수량', '재고', '중국원가(CNY)', '공급가(KRW)', '공급마진', '판매가(KRW)', '쿠팡마진'];
const headerLabels = h => nodes(h.render()).filter(node => node.type === 'th' && node.props['data-price-column']).map(text);
const summaries = h => nodes(h.render()).find(node => node.props?.['aria-label'] === '전체 옵션 가격 요약');

test('displayed row percentages and averages round the row margin rates like the recorded table while prices stay exact', async () => {
  const h = await optionPriceTableUI(priceTableCompanies[0], { count: 2 }); try {
    const first = dataRows(h)[0], second = dataRows(h)[1];
    // Recorded formatNumber preserves fractional row margins; only the summary
    // average is rounded to whole KRW (docs/step697-sale-driven-msrp-2026-10-18.md).
    assert.equal(text(nodes(first).find(node => node.props?.['data-price-column'] === 'supplyMargin')), '3,003.5원(74%)');
    assert.equal(text(nodes(second).find(node => node.props?.['data-price-column'] === 'supplyMargin')), '3,003.5원(68%)');
    const summary = text(summaries(h));
    assert.match(summary, /평균 공급가4,225원/); assert.match(summary, /평균 판매가7,040원/);
    assert.match(summary, /평균 공급 마진: 3,004원/); assert.match(summary, /평균 쿠팡 마진: 2,815원/);
    assert.match(summary, /공급: 71%/); assert.match(summary, /쿠팡: 40%/);
    const response = await h.request('/api/products/' + h.product.id + '/options'), body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.pricing.rows.map(row => row.calculation.marginKrw), [3003.5, 3003.5]);
    assert.equal((await h.rows()).rows[0].unitCostCny, 2.99); assert.equal(h.writes.length, 0);
    assert.equal(h.protectedSnapshot(), h.before); assert.ok(h.apiCalls.every(call => call.method === 'GET'));
  } finally { h.close(); }
});

for (const company of priceTableCompanies) test(`the nine-column price table uses page 20, owned identities, stock zero/unknown and full-option averages (${company.code})`, async () => {
  const h = await optionPriceTableUI(company); try {
    assert.deepEqual(headerLabels(h), columns); assert.equal(h.node('가격표 페이지당 옵션 수').props.value, 20);
    assert.deepEqual(nodes(h.node('가격표 페이지당 옵션 수')).filter(node => node.type === 'option').map(node => node.props.value), [10, 20, 25, 50, 100]);
    assert.equal(dataRows(h).length, 20); assert.equal(h.node('가격표 고정할 열').props.value, 'name');
    assert.equal(h.node('가격표 높이 고정 Y').props.checked, true);
    const metadataResponse=await h.request('/api/products/'+h.product.id+'/options'),metadata=await metadataResponse.json();
    assert.equal(metadataResponse.status,200);assert.ok(metadata.optionRegistrationNumbers['price-001']);
    assert.equal(text(nodes(dataRows(h)[0]).find(node=>node.props?.['data-price-column']==='id')),metadata.optionRegistrationNumbers['price-001']);
    assert.equal(dataRows(h)[0].props['data-price-option-id'],'price-001');
    assert.equal(text(nodes(dataRows(h)[0]).find(node => node.props?.['data-price-column'] === 'stock')), '0');
    assert.equal(text(nodes(dataRows(h)[1]).find(node => node.props?.['data-price-column'] === 'stock')), '미확인');
    const beforeSummary = text(summaries(h)), original = JSON.stringify(await h.rows());
    h.node('가격표 다음 페이지').props.onClick(); await h.settle(); assert.equal(ids(h)[0], 'price-021');
    assert.equal(h.node('가격표 현재 페이지').props.children[0], 2);
    change(h, '가격 옵션 검색', 'fixture-sku-73'); await h.settle(); assert.deepEqual(ids(h), ['price-073']);
    assert.equal(text(summaries(h)), beforeSummary, 'search cannot replace full-option price averages');
    change(h,'가격 옵션 검색',metadata.optionRegistrationNumbers['price-062']);await h.settle();assert.deepEqual(ids(h),['price-062']);
    assert.equal(text(nodes(dataRows(h)[0]).find(node=>node.props?.['data-price-column']==='id')),metadata.optionRegistrationNumbers['price-062']);
    assert.equal(text(summaries(h)),beforeSummary);
    change(h, '가격 옵션 검색', ''); change(h, '가격표 페이지당 옵션 수', '25'); await h.settle();
    assert.equal(dataRows(h).length, 25); assert.equal(ids(h)[0], 'price-001');
    assert.equal(JSON.stringify(await h.rows()), original); assert.equal(h.protectedSnapshot(), h.before);
    assert.ok(h.apiCalls.every(call => call.method === 'GET')); assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});

test('filtered selection, visibility, pin and height alter only presentation and preserve selections across a filtered empty table', async () => {
  const h = await optionPriceTableUI(); try {
    const original = JSON.stringify(await h.rows()); toggle(h, '가격 검색 결과 전체 선택', true);
    h.node('가격표 다음 페이지').props.onClick(); await h.settle(); assert.equal(h.node('가격 검색 결과 전체 선택').props.checked, true);
    toggle(h, '가격 옵션 21 선택', false); h.node('가격표 이전 페이지').props.onClick(); await h.settle();
    assert.equal(h.node('가격 검색 결과 전체 선택').props.checked, false); assert.equal(h.node('가격 검색 결과 전체 선택').props['aria-checked'], 'mixed'); assert.equal(h.node('가격 옵션 1 선택').props.checked, true);
    toggle(h, '가격표 재고 표시', false); assert.deepEqual(headerLabels(h), columns.filter(label => label !== '재고'));
    change(h, '가격표 고정할 열', 'sale'); assert.ok(nodes(h.render()).filter(node => node.props?.['data-price-column'] === 'sale').every(node => node.props.className === 'option-price-grid-pinned'));
    toggle(h, '가격표 판매가(KRW) 표시', false); assert.equal(h.node('가격표 고정할 열').props.value, '');
    h.node('가격표 높이 고정 N').props.onChange(); assert.ok(!h.node('옵션 가격표 스크롤 영역').props.className.includes('option-price-grid-fixed'));
    change(h, '가격 옵션 검색', 'NO-SYNTHETIC-MATCH'); await h.settle(); assert.equal(dataRows(h).length, 0);
    assert.equal(h.node('가격 검색 결과 전체 선택').props.disabled, true); assert.match(text(h.render()), /검색 결과가 없습니다/);
    change(h, '가격 옵션 검색', 'fixture-sku-11'); await h.settle(); assert.equal(h.node('가격 옵션 11 선택').props.checked, true);
    h.button('가격표 전체 열 표시').props.onClick(); assert.deepEqual(headerLabels(h), columns);
    assert.equal(JSON.stringify(await h.rows()), original); assert.equal(h.protectedSnapshot(), h.before); assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});

test('header selection replaces hidden selections with all filtered UUIDs across pages and unchecking clears every selection',async()=>{
 const h=await optionPriceTableUI();try{
  const before=JSON.stringify(await h.rows()),summary=text(summaries(h)),allLabel='가격 검색 결과 전체 선택';
  toggle(h,'가격 옵션 2 선택',true);
  h.node('가격표 다음 페이지').props.onClick();await h.settle();h.node('가격표 다음 페이지').props.onClick();await h.settle();
  assert.equal(ids(h)[0],'price-041');toggle(h,'가격 옵션 42 선택',true);
  change(h,'가격 옵션 검색','2.99');await h.settle();
  const expected=Array.from({length:37},(_,index)=>'price-'+String(index*2+1).padStart(3,'0'));
  assert.deepEqual(ids(h),expected.slice(0,20));assert.equal(h.node(allLabel).props.checked,false);
  assert.equal(h.node(allLabel).props['aria-checked'],false,'hidden selected rows do not mark an unselected filtered scope mixed');
  toggle(h,'가격 옵션 1 선택',true);const partial=h.node(allLabel),nativeCheckbox={indeterminate:false};
  assert.equal(partial.props['aria-checked'],'mixed');partial.props.ref(nativeCheckbox);assert.equal(nativeCheckbox.indeterminate,true);
  toggle(h,allLabel,true);await h.settle();assert.equal(h.node(allLabel).props.checked,true);assert.equal(h.node(allLabel).props['aria-checked'],true);
  h.node(allLabel).props.ref(nativeCheckbox);assert.equal(nativeCheckbox.indeterminate,false);
  assert.ok(text(h.render()).includes('선택 옵션 일괄 편집 · 37개 선택'));
  const selected=[];
  for(;;){for(const row of dataRows(h)){const checkbox=nodes(row).find(node=>node.type==='input'&&/ 선택$/u.test(node.props?.['aria-label']??''));if(checkbox.props.checked)selected.push(row.props['data-price-option-id']);}
   const next=h.node('가격표 다음 페이지');if(next.props.disabled)break;next.props.onClick();await h.settle();}
  assert.deepEqual(selected,expected,'all matching UUIDs replace previous selections, including the second page');
  for(const [id,index]of[['price-002',2],['price-042',42]]){
   change(h,'가격 옵션 검색',id);await h.settle();assert.deepEqual(ids(h),[id]);
   assert.equal(h.node('가격 옵션 '+index+' 선택').props.checked,false,'checking the header clears hidden UUID '+id);
   toggle(h,'가격 옵션 '+index+' 선택',true);
  }
  assert.ok(text(h.render()).includes('선택 옵션 일괄 편집 · 39개 선택'));
  change(h,'가격 옵션 검색','2.99');await h.settle();
  assert.equal(h.node(allLabel).props.checked,true);toggle(h,allLabel,false);await h.settle();
  assert.equal(h.node(allLabel).props.checked,false);assert.equal(h.node(allLabel).props['aria-checked'],false);
  assert.ok(text(h.render()).includes('선택 옵션 일괄 편집 · 0개 선택'));
  change(h,'가격 옵션 검색','');await h.settle();const retained=[];
  for(;;){for(const row of dataRows(h)){const checkbox=nodes(row).find(node=>node.type==='input'&&/ 선택$/u.test(node.props?.['aria-label']??''));if(checkbox.props.checked)retained.push(row.props['data-price-option-id']);}
   const next=h.node('가격표 다음 페이지');if(next.props.disabled)break;next.props.onClick();await h.settle();}
  assert.deepEqual(retained,[],'unchecking the header clears matching and hidden UUID selections together');
  change(h,'가격 옵션 검색','NO-SYNTHETIC-MATCH');await h.settle();assert.equal(h.node(allLabel).props.disabled,true);assert.equal(h.node(allLabel).props['aria-checked'],false);
  assert.equal(text(summaries(h)),summary);assert.equal(JSON.stringify(await h.rows()),before);assert.equal(h.protectedSnapshot(),h.before);
  assert.equal(h.writes.length,0);assert.ok(h.apiCalls.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('focused option page boundaries use the initial 20-row page without changing option identities',async()=>{
 for(const [focusedOptionId,first,page]of[['price-020','price-001',1],['price-021','price-021',2]]){
  const h=await optionPriceTableUI(priceTableCompanies[0],{focusedOptionId});try{
   assert.equal(h.node('가격표 페이지당 옵션 수').props.value,20);assert.equal(ids(h)[0],first);assert.equal(h.node('가격표 현재 페이지').props.children[0],page);
   assert.ok(ids(h).includes(focusedOptionId));assert.ok(h.focused.includes('가격 옵션 '+Number(focusedOptionId.slice(6))+' 구성 수량'));
   assert.equal(h.writes.length,0);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 }
});

for (const company of priceTableCompanies) test(`filtered row edits save the exact original option ID with the complete draft and retain every other source row (${company.code})`, async () => {
  const h = await optionPriceTableUI(company); try {
    const before = await h.rows(); change(h, '가격 옵션 검색', 'fixture-sku-62'); await h.settle(); assert.deepEqual(ids(h), ['price-062']);
    change(h, '가격 옵션 62 개당 원가', '5.99'); change(h, '가격 옵션 62 구성 수량', '3');
    assert.equal(h.button('옵션 저장·가격 계산').props.disabled, false); h.button('옵션 저장·가격 계산').props.onClick(); await h.settle();
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].rows.length, 73);
    assert.equal(h.writes[0].expectedRevision, before.revision);
    assert.equal(h.writes[0].rows[61].id, 'price-062'); assert.equal(h.writes[0].rows[61].unitCostCny, 5.99); assert.equal(h.writes[0].rows[61].unitsPerPack, 3);
    const after = await h.rows(); assert.equal(after.rows[61].unitCostCny, 5.99); assert.equal(after.rows[61].unitsPerPack, 3);
    for (let index = 0; index < before.rows.length; index++) if (index !== 61) assert.deepEqual(JSON.parse(JSON.stringify(after.rows[index])), JSON.parse(JSON.stringify(before.rows[index])), 'original option ' + index);
    assert.equal(after.revision, before.revision + 1); assert.equal(h.saved, 1); assert.equal(h.protectedSnapshot(), h.before);
    assert.equal(h.node('가격 옵션 62 개당 원가').props.value, 5.99);
  } finally { h.close(); }
});

test('focused later option initially opens its own price page and filtering preserves null/invalid/excluded distinctions', async () => {
  const h = await optionPriceTableUI(priceTableCompanies[0], { focusedOptionId: 'price-052' }); try {
    assert.equal(ids(h)[0], 'price-041'); assert.equal(h.node('가격표 현재 페이지').props.children[0], 3);
    assert.ok(h.focused.includes('가격 옵션 52 구성 수량'));
    change(h, '가격 옵션 검색', 'fixture-sku-52'); await h.settle(); assert.deepEqual(ids(h), ['price-052']);
    change(h, '가격 옵션 52 개당 원가', ''); await h.settle(); assert.equal(h.node('가격 옵션 52 개당 원가').props.value, '');
    assert.match(text(dataRows(h)[0]), /원가와 구성 수량을 입력해주세요/);
    toggle(h, '가격 옵션 52 견적 포함', false); await h.settle(); assert.match(text(dataRows(h)[0]), /견적 제외/);
    assert.ok(!text(dataRows(h)[0]).includes('0원'));
    assert.match(text(summaries(h)), /전체 견적 포함 72개 · 계산 가능 72개/);
    assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});

test('a stale source version cannot save a filtered draft and a pending save keeps every option in one request', async () => {
  const h = await optionPriceTableUI(); try {
    change(h, '가격 옵션 검색', 'fixture-sku-24'); await h.settle(); change(h, '가격 옵션 24 개당 원가', '6.25');
    const pending = h.holdSave(), save = h.button('옵션 저장·가격 계산').props.onClick; save(); await pending.arrived;
    save(); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].rows.length, 73);
    pending.release(); await h.settle(); assert.equal(h.saved, 1);
    change(h, '가격 옵션 24 개당 원가', '7.25'); h.changeProductVersion('2099-01-01T00:00:00.000Z'); await h.settle();
    assert.equal(h.button('옵션 저장·가격 계산').props.disabled, true); h.button('옵션 저장·가격 계산').props.onClick(); await h.settle();
    assert.equal(h.writes.length, 1); assert.equal(h.node('가격 옵션 24 개당 원가').props.value, 7.25);
    assert.equal(h.protectedSnapshot(), h.before);
  } finally { h.close(); }
});
