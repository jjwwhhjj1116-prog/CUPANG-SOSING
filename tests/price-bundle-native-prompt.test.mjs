import test from 'node:test';
import assert from 'node:assert/strict';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';

const select = (h, index = 1) => h.node(`가격 옵션 ${index} 선택`).props.onChange({ target: { checked: true } });
const dialog = h => nodes(h.render()).find(node => node.props?.role === 'dialog');

for (const company of priceTableCompanies) test(`${company.code}: native bundle prompt defaults to 2, immediately saves parsed quantity and accepts 1 to clear`, async () => {
  const prompts = [], answers = ['3.9', '1'];
  const h = await optionPriceTableUI(company, { count: 3, integrated: true, prompt: (...args) => { prompts.push(args); return answers.shift(); } });
  try {
    select(h); h.button('번들 적용').props.onClick(); await h.settle();
    assert.deepEqual(prompts[0], ['번들 수량을 입력하세요 (1을 입력하면 번들이 해제됩니다):', '2']);
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].kind, 'stage-two-pricing');
    assert.equal((await h.rows()).rows[0].unitsPerPack, 3); assert.equal((await h.rows()).rows[0].translatedName, '합성 옵션 1 (3개묶음)');
    assert.equal(dialog(h), undefined); assert.equal(h.node('가격 옵션 1 선택').props.checked, false);
    select(h); h.button('번들 적용').props.onClick(); await h.settle();
    assert.equal(h.writes.length, 2); assert.equal((await h.rows()).rows[0].unitsPerPack, 1);
    assert.equal((await h.rows()).rows[0].translatedName, '합성 옵션 1'); assert.equal(h.protectedSnapshot(), h.before);
  } finally { h.close(); }
});

test('native add-bundle prompt appends a distinct saved bundle while preserving its source facts', async () => {
  const prompts = [], h = await optionPriceTableUI(priceTableCompanies[0], { count: 3, integrated: true, prompt: (...args) => { prompts.push(args); return '2'; } });
  try {
    const before = await h.rows(); select(h); h.button('번들 추가').props.onClick(); await h.settle();
    assert.deepEqual(prompts, [['번들 수량을 입력하세요:', '2']]);
    assert.deepEqual(h.writes.map(write => write.kind), ['option-bundles']);
    const after = await h.rows(); assert.equal(after.rows.length, 4); assert.deepEqual(after.rows.slice(0, 3), before.rows);
    assert.equal(after.rows[3].unitsPerPack, 2); assert.equal(after.rows[3].translatedName, '합성 옵션 1 (2개묶음)');
    assert.equal(after.rows[3].unitCostCny, before.rows[0].unitCostCny); assert.equal(after.rows[3].stock, before.rows[0].stock);
    assert.equal(dialog(h), undefined); assert.equal(h.node('가격 옵션 1 선택').props.checked, false);
  } finally { h.close(); }
});

for (const kind of ['번들 추가', '번들 적용']) test(`${kind}: cancellation, invalid quantities and empty selection never save or change source`, async () => {
  let answer = null, promptCount = 0;
  const h = await optionPriceTableUI(priceTableCompanies[0], { count: 3, integrated: true, prompt: () => { promptCount++; return answer; } });
  try {
    const before = JSON.stringify(await h.rows()), action = h.button(kind).props.onClick;
    action(); await h.settle(); assert.equal(promptCount, 0); assert.equal(h.writes.length, 0);
    select(h);
    for (const value of [null, '', 'bad', '0', '1000001', ...(kind === '번들 추가' ? ['1'] : [])]) {
      answer = value; h.button(kind).props.onClick(); await h.settle();
      assert.equal(h.writes.length, 0); assert.equal(dialog(h), undefined); assert.equal(h.node('가격 옵션 1 선택').props.checked, true);
      assert.equal(JSON.stringify(await h.rows()), before);
    }
    assert.equal(h.protectedSnapshot(), h.before);
  } finally { h.close(); }
});

test('native prompt result cannot bypass a synchronous source lock or newer unsaved row edit', async () => {
  for (const update of ['lock', 'row']) {
    let h;
    h = await optionPriceTableUI(priceTableCompanies[0], { count: 3, integrated: true, prompt: () => {
      if (update === 'lock') h.locks({ files: true });
      else h.node('가격 옵션 1 개당 원가').props.onChange({ target: { value: '5.99', valueAsNumber: 5.99 } });
      return '2';
    } });
    try { select(h); h.button('번들 적용').props.onClick(); await h.settle(); assert.equal(h.writes.length, 0); assert.equal((await h.rows()).rows[0].unitsPerPack, 1); }
    finally { h.close(); }
  }
});

test('native accepted quantity remains visible after unknown ACK and read recovery never repeats the mutation', async () => {
  let promptCount = 0;
  const h = await optionPriceTableUI(priceTableCompanies[0], { count: 3, integrated: true, prompt: () => { promptCount++; return '3'; } });
  try {
    let lost = true; h.controls.response = (url, init, response) => {
      if (lost && init.method === 'POST' && url.includes('/stage-two-pricing')) { lost = false; return Response.json({ error: 'fixture lost native bundle ACK' }, { status: 503 }); }
      return response;
    };
    select(h); h.button('번들 적용').props.onClick(); await h.settle();
    assert.equal(h.writes.length, 1); assert.equal(h.node('적용할 번들 수량').props.value, '3'); assert.ok(dialog(h));
    nodes(dialog(h)).find(node => node.type === 'button' && text(node) === '취소').props.onClick();
    h.button('입력 유지 · 저장 결과 확인').props.onClick(); await h.settle();
    assert.equal(h.writes.length, 1); assert.equal(promptCount, 1); assert.equal((await h.rows()).rows[0].unitsPerPack, 3); assert.equal(h.protectedSnapshot(), h.before);
  } finally { h.close(); }
});

test('native quantity confirmation does not open a second custom dialog during a normal save', async () => {
  const h = await optionPriceTableUI(priceTableCompanies[0], { count: 3, integrated: true, prompt: () => '2' });
  const hold = h.holdSave();
  try {
    select(h); h.button('번들 적용').props.onClick(); await hold.arrived;
    assert.equal(dialog(h), undefined); assert.equal(h.writes.length, 1);
  } finally { hold.release(); await h.settle(); h.close(); }
});
