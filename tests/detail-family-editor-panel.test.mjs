import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Extract the established actual-TSX/actual-client adapter without registering
// its original tests. Only its fake server gains the additive editor envelope.
const sourceUrl = new URL('./detail-family-panel.test.mjs', import.meta.url), source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) {
    const name = statement.moduleSpecifier.text, resolved = name.startsWith('.') ? new URL(name, sourceUrl).href : import.meta.resolve(name);
    parts.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(resolved)));
  } else if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) {
    let code = statement.getText(ast).replaceAll('import.meta.url', JSON.stringify(sourceUrl.href));
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'harness') {
      assert.ok(code.includes('lostAck = false, hold }'));
      code = code.replace('lostAck = false, hold }', 'lostAck = false, hold, editor = true }');
      const insert = `if (editor) catalog.editor = { policy: 'saved-inputs-v1', images: 2, categoryId: '81221' };
        const editorInputs = { format: 'saved-detail-inputs-v1', categoryId: '81221',
          origin: { productId, sourceOptionId: 'saved-origin-option', uploadId: 'b'.repeat(64), revision: 3 },
          output: { key: catalog.image?.key, sha256: catalog.image?.sha256, bytes: catalog.image?.bytes },
          images: [{ key: 'owner/first.png', sha256: 'e'.repeat(64), width: 800, height: 300 },
            { key: 'owner/second.png', sha256: 'f'.repeat(64), width: 800, height: 300 }] };
        class Element {`;
      assert.ok(code.includes('class Element {')); code = code.replace('class Element {', insert);
      const pattern = /bytes: catalog\.image\.bytes,\s+targets:/;
      assert.ok(pattern.test(code));
      code = code.replace(pattern, "bytes: catalog.image.bytes, ...(body.editorPolicy ? { editor: { policy: body.editorPolicy, inputs: structuredClone(editorInputs) } } : {}), targets:");
      assert.ok(code.includes('catalog, document, outside'));
      code = code.replace('catalog, document, outside', 'catalog, editorInputs, document, outside');
    }
    parts.push(code);
  } else break;
}
const { harness, nodes, text, storageKey } = await import('data:text/javascript,'
  + encodeURIComponent(parts.join('\n') + '\nexport { harness, nodes, text, storageKey };'));
function copyControl(h) {
  const label = nodes(h.render()).find(node => node.type === 'label' && text(node).includes('저장 전 개별 사진'));
  return nodes(label).find(node => node.type === 'input' && node.props.type === 'checkbox');
}
async function setCopy(h, checked) {
  const control = copyControl(h); assert.ok(control, 'saved photo mode is available'); assert.ok(!control.props.disabled);
  control.props.onChange({ target: { checked } }); await h.tick();
}
async function approve(h) {
  const label = nodes(h.render()).find(node => node.type === 'label' && text(node).includes('적용 대상과 상세 HTML을 비우는 범위를 확인했습니다.'));
  const control = nodes(label).find(node => node.type === 'input'); assert.ok(control); assert.ok(!control.props.disabled);
  control.props.onChange({ target: { checked: true } }); await h.tick();
}

test('saved-input catalog defaults the new choice on and previews the exact copied photo count before approval', async () => {
  const h = harness(); try {
    await h.idle(); await h.click('분할 상품에 상세 적용');
    assert.equal(copyControl(h).props.checked, true); assert.match(text(h.render()), /저장 전 개별 사진 2장/);
    await h.click('상세 적용 미리보기');
    assert.equal(h.calls.find(call => call.kind === 'preview').body.editorPolicy, 'saved-inputs-v1');
    assert.match(text(h.find('div', '분할 상품 상세 적용 미리보기')), /저장 전 사진 2장의 순서/);
    assert.equal(h.button('확인한 상품에 상세 적용').props.disabled, true);
    await approve(h); assert.equal(h.button('확인한 상품에 상세 적용').props.disabled, false);
    await h.click('확인한 상품에 상세 적용'); assert.equal(h.saved(), 1);
    assert.equal(h.calls.find(call => call.kind === 'commit').body.editorPolicy, 'saved-inputs-v1');
  } finally { h.close(); }
});

test('changing saved-photo mode clears the exact review and approval, then explicitly sends the selected legacy mode', async () => {
  const h = harness(); try {
    await h.idle(); await h.click('분할 상품에 상세 적용'); await h.click('상세 적용 미리보기'); await approve(h);
    await setCopy(h, false); assert.equal(h.find('div', '분할 상품 상세 적용 미리보기'), undefined);
    assert.equal(h.button('확인한 상품에 상세 적용').props.disabled, true);
    assert.equal(h.calls.some(call => call.kind === 'commit'), false);
    await h.click('상세 적용 미리보기');
    const last = h.calls.filter(call => call.kind === 'preview').at(-1); assert.equal(Object.hasOwn(last.body, 'editorPolicy'), false);
    assert.doesNotMatch(text(h.find('div', '분할 상품 상세 적용 미리보기')), /저장 전 사진 2장의 순서/);
    assert.equal(h.button('확인한 상품에 상세 적용').props.disabled, true);
    await approve(h); await h.click('확인한 상품에 상세 적용');
    assert.equal(Object.hasOwn(h.calls.find(call => call.kind === 'commit').body, 'editorPolicy'), false);
  } finally { h.close(); }
});

test('re-enabling the mode or changing selected targets cannot reuse a previous approval', async () => {
  const h = harness(); try {
    await h.idle(); await h.click('분할 상품에 상세 적용'); await setCopy(h, false); await h.click('상세 적용 미리보기'); await approve(h);
    await setCopy(h, true); assert.equal(h.find('div', '분할 상품 상세 적용 미리보기'), undefined);
    assert.equal(h.button('확인한 상품에 상세 적용').props.disabled, true);
    await h.click('상세 적용 미리보기'); await approve(h); await h.check('대상 1 상세 적용 대상', false);
    assert.equal(copyControl(h).props.checked, true); assert.equal(h.find('div', '분할 상품 상세 적용 미리보기'), undefined);
    assert.equal(h.button('확인한 상품에 상세 적용').props.disabled, true); assert.equal(h.calls.some(call => call.kind === 'commit'), false);
  } finally { h.close(); }
});

test('an old catalog has no new choice and retains its unexpanded preview/commit envelope', async () => {
  const h = harness({ editor: false }); try {
    await h.idle(); await h.click('분할 상품에 상세 적용'); assert.equal(copyControl(h), undefined);
    await h.click('상세 적용 미리보기'); await approve(h); await h.click('확인한 상품에 상세 적용');
    assert.equal(h.saved(), 1);
    for (const call of h.calls.filter(call => ['preview', 'commit'].includes(call.kind))) assert.equal(Object.hasOwn(call.body, 'editorPolicy'), false);
  } finally { h.close(); }
});

for (const expanded of [true, false]) test(`lost ACK reload retains reviewed ${expanded ? 'saved-input' : 'unexpanded'} mode and recovers by GET only`, async () => {
  const storage = new Map(), ledger = new Map(), first = harness({ lostAck: true, storage, ledger });
  try {
    await first.idle(); await first.click('분할 상품에 상세 적용'); if (!expanded) await setCopy(first, false);
    await first.click('상세 적용 미리보기'); await approve(first); await first.click('확인한 상품에 상세 적용');
    const stored = JSON.parse(storage.get(storageKey()));
    assert.equal(stored.input.editorPolicy, expanded ? 'saved-inputs-v1' : undefined);
    assert.equal(Boolean(stored.preview.editor), expanded);
    assert.equal(first.button('확인한 상품에 상세 적용'), undefined); assert.equal(first.button('취소').props.disabled, true);
    assert.equal(first.saved(), 0);
  } finally { first.close(); }
  const restored = harness({ storage, ledger }); try {
    await restored.idle(); assert.equal(restored.calls.length, 0, 'reload cannot re-preview or commit');
    if (expanded) assert.match(text(restored.render()), /저장 전 사진 2장의 순서/);
    else assert.doesNotMatch(text(restored.render()), /저장 전 사진 2장의 순서/);
    assert.equal(copyControl(restored), undefined, 'pending mode cannot be toggled');
    await restored.click('상세 적용 결과 확인'); assert.deepEqual(restored.calls.map(call => call.kind), ['recover']);
    assert.equal(restored.calls[0].method, 'GET'); assert.equal(restored.saved(), 1); assert.equal(storage.has(storageKey()), false);
  } finally { restored.close(); }
});

test('legacy pending sessions are not upgraded merely because the current server supports editor inputs', async () => {
  const storage = new Map(), ledger = new Map(), first = harness({ editor: false, lostAck: true, storage, ledger });
  try {
    await first.idle(); await first.click('분할 상품에 상세 적용'); await first.click('상세 적용 미리보기'); await approve(first); await first.click('확인한 상품에 상세 적용');
  } finally { first.close(); }
  const h = harness({ storage, ledger }); try {
    await h.idle(); assert.equal(h.calls.length, 0); assert.doesNotMatch(text(h.render()), /저장 전 사진 2장의 순서/);
    await h.click('상세 적용 결과 확인'); assert.deepEqual(h.calls.map(call => call.kind), ['recover']); assert.equal(h.saved(), 1);
    assert.ok([...ledger.values()].every(receipt => receipt.editor === undefined));
  } finally { h.close(); }
});

test('malformed editor catalog summary blocks review without performing a preview or commit', async () => {
  const h = harness(); try {
    h.catalog.editor.images = 0; await h.idle();
    assert.equal(h.button('분할 상품에 상세 적용').props.disabled, true); assert.match(text(h.render()), /검토한 원본·회사·대상과 다릅니다/);
    assert.deepEqual(h.calls.map(call => call.kind), ['catalog']);
  } finally { h.close(); }
});
