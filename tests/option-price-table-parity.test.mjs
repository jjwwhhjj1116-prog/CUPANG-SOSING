import test from 'node:test';
import assert from 'node:assert/strict';
import { optionPriceTableUI, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';

const dataRows = h => nodes(h.render()).filter(node => node.type === 'tr' && node.props['data-price-option-id']);
const ids = h => dataRows(h).map(node => node.props['data-price-option-id']);
const change = (h, label, value) => h.node(label).props.onChange({ target: { value, valueAsNumber: Number(value) } });
const header = (h, column) => nodes(h.render()).find(node => node.type === 'th' && node.props['data-price-column'] === column);

test('opening a later focused price option retains the wizard heading and policy while focusing without page scroll',async()=>{
 const h=await optionPriceTableUI(undefined,{count:25,integrated:true,focusedOptionId:'price-024'});
 try{
  assert.ok(ids(h).includes('price-024'));assert.ok(h.focused.includes('가격 옵션 24 개당 원가'));
  assert.ok(h.scrollEvents.length);assert.ok(h.scrollEvents.every(event=>event.focus&&event.preventScroll===true));
  assert.equal(h.writes.length,0);assert.equal(h.protectedSnapshot(),h.before);
 }finally{h.close();}
});

test('price search ANDs tokens across columns while selection and complete source stay attached to UUIDs', async () => {
  const h = await optionPriceTableUI(undefined, { count: 23 });
  try {
    const before = JSON.stringify(await h.rows());
    h.node('가격 옵션 12 선택').props.onChange({ target: { checked: true } });
    change(h, '가격 옵션 검색', '합성 fixture-sku-12'); await h.settle();
    assert.deepEqual(ids(h), ['price-012']);
    assert.equal(h.node('가격 옵션 12 선택').props.checked, true);
    change(h, '가격 옵션 검색', '합성 fixture-sku-12 absent'); await h.settle();
    assert.deepEqual(ids(h), []);
    change(h, '가격 옵션 검색', ''); await h.settle();
    assert.equal(h.node('가격 옵션 12 선택').props.checked, true);
    assert.equal(JSON.stringify(await h.rows()), before); assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});

test('numeric price sorting changes only displayed order and a header cycles back to original source order', async () => {
  const h = await optionPriceTableUI(undefined, { count: 4 });
  try {
    const before = JSON.stringify(await h.rows());
    h.button('중국원가(CNY) 정렬').props.onClick(); await h.settle();
    assert.deepEqual(ids(h), ['price-001', 'price-003', 'price-002', 'price-004']);
    assert.equal(header(h, 'cost').props['aria-sort'], 'ascending');
    h.button('중국원가(CNY) 정렬').props.onClick(); await h.settle();
    assert.deepEqual(ids(h), ['price-002', 'price-004', 'price-001', 'price-003']);
    h.button('중국원가(CNY) 정렬').props.onClick(); await h.settle();
    assert.deepEqual(ids(h), ['price-001', 'price-002', 'price-003', 'price-004']);
    assert.equal(JSON.stringify(await h.rows()), before); assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});

test('registration freezes every visible column through the chosen column without blank sticky gaps', async () => {
  const h = await optionPriceTableUI(undefined, { count: 2, integrated: true });
  try {
    change(h, '가격표 고정할 열', 'quantity'); await h.settle();
    assert.equal(header(h, 'name').props.style.left, 36);
    assert.equal(header(h, 'id').props.style.left, 236);
    assert.equal(header(h, 'quantity').props.style.left, 296);
    assert.equal(header(h, 'stock').props.style, undefined);
    h.node('가격표 옵션번호 표시').props.onChange({ target: { checked: false } }); await h.settle();
    assert.equal(header(h, 'quantity').props.style.left, 236);
    assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});

test('registration quantity is read-only and image-free while standard price rows retain quantity editing', async () => {
  const h = await optionPriceTableUI(undefined, { count: 2, integrated: true });
  try {
    assert.equal(nodes(h.render()).some(node => node.props?.['aria-label'] === '가격 옵션 1 구성 수량'), false);
    const quantity = nodes(dataRows(h)[0]).find(node => node.props?.['data-price-column'] === 'quantity');
    assert.equal(text(quantity), '1개');
    assert.equal(nodes(h.render()).some(node => node.type === 'img' && node.props.alt?.startsWith('가격 옵션 ')), false);
    h.setPricingView(false); await h.settle();
    const standard = nodes(h.render()).find(node => node.props?.['data-price-layout'] === 'standard');
    assert.ok(nodes(standard).some(node => node.props?.['aria-label'] === '가격 옵션 1 구성 수량' && node.props.type === 'number'));
    assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});

test('column numeric conditions filter raw prices and filtered header selection keeps exact UUIDs', async () => {
  const h = await optionPriceTableUI(undefined, { count: 4 });
  try {
    const before = JSON.stringify(await h.rows()), trigger = { getBoundingClientRect: () => ({ left: 500, bottom: 240 }) };
    h.node('중국원가(CNY) 열 필터').props.onClick({ currentTarget: trigger });
    let popup = nodes(h.render()).find(node => node.type === 'price-filter-popup');
    assert.deepEqual(JSON.parse(JSON.stringify(popup.props.choices)), [{ value: '2.99', count: 2 }, { value: '3.99', count: 2 }]);
    popup.props.onApply({ mode: 'conditions', conditions: [{ operator: 'gte', value: '3' }, { operator: 'lte', value: '4' }] }); await h.settle();
    assert.deepEqual(ids(h), ['price-002', 'price-004']);
    h.node('가격 검색 결과 전체 선택').props.onChange({ target: { checked: true } });
    assert.equal(h.node('가격 옵션 2 선택').props.checked, true); assert.equal(h.node('가격 옵션 4 선택').props.checked, true);
    h.node('중국원가(CNY) 열 필터').props.onClick({ currentTarget: trigger });
    popup = nodes(h.render()).find(node => node.type === 'price-filter-popup');
    assert.equal(popup.props.choices.length, 2, 'the edited column retains choices excluded by its own active condition');
    popup.props.onApply(undefined); await h.settle();
    assert.equal(h.node('가격 옵션 1 선택').props.checked, false); assert.equal(h.node('가격 옵션 2 선택').props.checked, true);
    assert.equal(JSON.stringify(await h.rows()), before); assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});

test('header context hide respects the final visible column and restore keeps source order', async () => {
  const h = await optionPriceTableUI(undefined, { count: 2 });
  try {
    const before = JSON.stringify(await h.rows());
    for (const column of ['id','quantity','stock','cost','supply','supplyMargin','sale','coupangMargin']) {
      header(h,column).props.onContextMenu({ preventDefault(){}, clientX: 100, clientY: 200, currentTarget: {} });
      h.button('이 열 숨기기').props.onClick(); await h.settle();
    }
    header(h,'name').props.onContextMenu({ preventDefault(){}, clientX: 100, clientY: 200, currentTarget: {} });
    assert.equal(h.button('이 열 숨기기').props.disabled,true);
    h.button('전체 열 표시').props.onClick(); await h.settle();
    assert.equal(nodes(h.render()).filter(node=>node.type==='th'&&node.props['data-price-column']).length,9);
    assert.deepEqual(ids(h),['price-001','price-002']); assert.equal(JSON.stringify(await h.rows()),before); assert.equal(h.writes.length,0);
  } finally { h.close(); }
});

test('named query favorites restore the complete token query without source writes', async () => {
  const h = await optionPriceTableUI(undefined, { count: 4, prompt: () => '분홍 검색' });
  try {
    const before = JSON.stringify(await h.rows());
    assert.equal(h.button('검색어 즐겨찾기 추가').props.disabled, true);
    change(h,'가격 옵션 검색','합성 fixture-sku-2');h.button('검색어 즐겨찾기 추가').props.onClick();await h.settle();
    change(h,'가격 옵션 검색','absent');await h.settle();assert.deepEqual(ids(h),[]);
    h.button('분홍 검색').props.onClick();await h.settle();assert.equal(h.node('가격 옵션 검색').props.value,'합성 fixture-sku-2');assert.deepEqual(ids(h),['price-002']);
    h.button('분홍 검색 즐겨찾기 삭제').props.onClick();await h.settle();assert.equal(nodes(h.render()).some(node=>node.type==='button'&&text(node)==='분홍 검색'),false);
    assert.equal(JSON.stringify(await h.rows()),before);assert.equal(h.writes.length,0);
  } finally { h.close(); }
});

test('same-tick column changes cannot hide the final visible column', async () => {
  const h = await optionPriceTableUI(undefined,{count:2});
  try {
    const controls=nodes(h.render()).filter(node=>node.type==='input'&&/^가격표 .+ 표시$/u.test(node.props['aria-label']??''));
    assert.equal(controls.length,9);
    for(const control of controls)control.props.onChange({target:{checked:false}});
    await h.settle();
    assert.equal(nodes(h.render()).filter(node=>node.type==='th'&&node.props['data-price-column']).length,1);
    assert.equal(h.writes.length,0);
  } finally {h.close();}
});
