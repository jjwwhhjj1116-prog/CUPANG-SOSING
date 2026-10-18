import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

// Reuse the actual primary-component scheduler and saved-value fixture without
// registering its tests. Only the readonly result assessment is substituted.
const fixtureUrl = new URL('./product-label-editor.test.mjs', import.meta.url);
const source = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
let helpers = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));
for (const [before, replacement] of [
  ['renderer,attach}={}', 'renderer,attach,assess,disabled=false,active=true}={}'],
  ['JSON.stringify(slots[i].deps)!==JSON.stringify(deps)', 'deps===undefined||slots[i].deps===undefined||slots[i].deps.length!==deps.length||deps.some((dep,index)=>!Object.is(dep,slots[i].deps[index]))'],
  ['const react={useState', 'const react={useMemo(factory,deps){const i=cursor++,old=slots[i];if(!old||deps.some((dep,index)=>!Object.is(dep,old.deps?.[index])))slots[i]={deps,value:factory()};return slots[i].value;},useState'],
  ['{exports,Error,AbortController', '{exports,window:browserWindow,crypto:webcrypto,Error,AbortController'],
  ['URL:localURL,fetch:request', 'URL:Object.assign(class extends URL {},localURL),fetch:request'],
  ["if(name==='react')return react;", "if(name==='@/app/product-label-result')return{readCurrentProductLabelResult:assess};if(name==='react')return react;"],
  ['version,profileId,refreshToken,onSaved()', 'version,profileId,refreshToken,disabled,active,onSaved()'],
  ['get saved(){return saved;}', 'setProfile(value){profileId=value;render();},setDisabled(value){disabled=value;render();},setActive(value){active=value;render();},get saved(){return saved;}'],
]) {
  assert.ok(helpers.includes(before), 'fixture adaptation exists: ' + before);
  helpers = helpers.replace(before, replacement);
}
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const confirmations = [], cases = [];
let confirmAllowed = true;
const browserWindow = { confirm(message) { confirmations.push(message); return confirmAllowed; } };
const { editor, fixture, nodes, text } = vm.runInNewContext(helpers + '\n({editor,fixture,nodes,text})', {
  assert, fs, vm, path, ts, createRequire, webcrypto, browserWindow, Response, Blob, JSON, URL, Date,
  AbortController, structuredClone, TextEncoder, setImmediate, setTimeout, clearTimeout,
});
const files = ['app/components/product-label-editor.tsx', 'app/product-label-result.ts', 'app/product-label-rewrite.ts', 'app/product-label.ts', 'tests/product-label-result-editor.test.mjs', 'tests/product-label-editor.test.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(new URL('../' + file, import.meta.url)))]));
const frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen, 'reviewed sources remain frozen throughout this run');
  fs.writeFileSync(new URL('../outputs/step712-result-ui-proof.json', import.meta.url), JSON.stringify({
    format: 'product-label-result-editor-proof-v1', sourceHashes: frozen, cases,
    boundary: 'Actual primary component, rewrite client and saved-value model; readonly receipt assessment is substituted with controlled DTOs. Child is retained as the actual JSX component node and its callbacks are exercised, not recursively rendered. Synthetic API/PNG/hook scheduler; no browser, pixel or remote receipt claim.',
    externalRequests: 0, browserActions: 0, realProductWrites: 0, supplierHubWrites: 0,
  }, null, 2) + '\n');
});
const keyFor = digit => `owner/quotation-label-${digit.repeat(64)}.png`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const child = h => nodes(h.render()).find(node => typeof node.type === 'function' && node.type.name === 'ProductLabelReferenceEditor');
const resultImage = h => nodes(h.render()).find(node => node.type === 'img' && node.props['data-current-label-result'] !== undefined);
const details = h => nodes(h.render()).find(node => node.type === 'details' && text(node).includes('최종 라벨 연결 편집'));
const waitFor = async (check, h) => {
  const deadline = Date.now() + 10000;
  while (!check()) { assert.ok(Date.now() < deadline, 'expected label-result callback'); h.render(); await new Promise(done => setImmediate(done)); }
};

function setup({ reason = null, assess, attach, candidate = true } = {}) {
  const f = fixture(), key = keyFor('a'), before = plain(f.view), posts = [], reads = [];
  if (candidate) f.view.imageKeys.push(key);
  let storedEpoch = f.view.renderEpoch, storedKey = key;
  function assessment(input) {
    const view = plain(f.view), profileId = new URL(input.endpoint, 'https://app.test').searchParams.get('profileId');
    // The injected readonly helper has already validated this selected profile.
    view.categoryContext.profileId = profileId;
    const currentReason = reason ?? (storedEpoch !== view.renderEpoch ? 'stale' : null);
    return {
      references: { view, quotation: {}, keys: [storedKey] },
      result: currentReason ? null : { key: storedKey, proof: { recipe: 'product-label-png-v1', productId: view.productId, optionId: input.optionId, profileId, planSha256: 'c'.repeat(64), categorySha256: 'd'.repeat(64), ...(storedEpoch === undefined ? {} : { renderEpoch: storedEpoch }) }, plan: 'filtered' },
      reason: currentReason,
    };
  }
  function reply(url, init) {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body); posts.push(body);
      if (body.expectedRevision !== f.view.revision || body.expectedInputFingerprint !== f.view.inputFingerprint) return Response.json({ error: '동시 수정' }, { status: 409 });
      f.view.revision++; f.view.renderEpoch = (f.view.renderEpoch ?? 0) + 1;
      f.view.productVersion = new Date(Date.parse(f.view.productVersion) + 1).toISOString(); f.view.updatedAt = f.view.productVersion;
      f.view.inputFingerprint = hash(JSON.stringify([f.view.revision, f.view.renderEpoch])); f.view.quotationInputFingerprint = hash(f.view.productVersion);
      return Response.json(f.view);
    }
    return f.reply(url, init);
  }
  confirmAllowed = true; confirmations.length = 0;
  const h = editor(reply, {
    assess: async (input, request) => {
      const captured = assessment(input), call = { input, request, captured }; reads.push(call);
      return assess ? assess(call, reads.length) : captured;
    },
    attach: attach ?? (async (input, request) => {
      storedEpoch = f.view.renderEpoch; storedKey = keyFor('b');
      f.view.imageKeys.push(storedKey); f.view.quotationRevision++; f.source();
      input.onUploaded(storedKey);
      const view = await (await request(input.endpoint, { cache: 'no-store' })).json();
      return { view, quotation: {}, key: storedKey };
    }),
  });
  return { f, h, key, before, posts, reads, reply, assessment };
}

test('verified current saved PNG replaces the primary form with a readonly result and leaves child reference controls mounted', async () => {
  const { f, h, key, posts, reads } = setup();
  try {
    const before = plain(f.view); await h.idle();
    assert.ok(reads.length > 0); assert.ok(resultImage(h)); assert.equal(resultImage(h).props.src, '/api/files/' + key);
    assert.ok(nodes(h.render()).some(node => node.type === 'h4' && text(node) === '표시 정보 결과'));
    assert.equal(h.input('선택 옵션 제품명'), undefined); assert.equal(h.button('정보 저장하기'), undefined); assert.equal(h.button('저장한 표시사항 PNG 미리보기'), undefined);
    const download = nodes(h.render()).find(node => node.type === 'a' && text(node) === '이미지 다운로드');
    assert.equal(download.props.href, '/api/files/' + key); assert.ok(download.props.download);
    assert.equal(h.button('재작성').props.disabled, false); assert.equal(details(h).props.open, false);
    assert.ok(child(h)); assert.equal(child(h).props.disabled, false); assert.equal(child(h).props.beforeSave(), true);
    assert.equal(h.render().props['data-workspace-saving'], false); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(posts.length, 0); assert.equal(h.calls.some(call => call.init?.method === 'PUT' || call.url === '/api/files'), false); assert.deepEqual(plain(f.view), before);
    cases.push({ name: 'trusted completion', formHidden: true, currentImageAndDownload: true, childMountedAndEnabled: true, writes: 0 });
  } finally { h.close(); }
});

test('manual, stale, missing, ambiguous and unconfirmed references keep the existing editable form without assuming completion', async () => {
  for (const reason of ['manual', 'stale', 'missing', 'ambiguous', 'unconfirmed']) {
    const { f, h, posts } = setup({ reason });
    try {
      const before = plain(f.view); await h.idle();
      assert.equal(resultImage(h), undefined, reason); assert.equal(h.input('선택 옵션 제품명').props.disabled, false, reason);
      assert.ok(h.button('저장한 표시사항 PNG 미리보기')); assert.equal(details(h).props.open, true);
      assert.equal(posts.length, 0); assert.deepEqual(plain(f.view), before);
    } finally { h.close(); }
  }
  const noCandidate = setup({ candidate: false });
  try { await noCandidate.h.idle(); assert.equal(noCandidate.reads.length, 0); assert.ok(noCandidate.h.input('선택 옵션 제품명')); }
  finally { noCandidate.h.close(); }
  cases.push({ name: 'unproven references', reasons: ['manual', 'stale', 'missing', 'ambiguous', 'unconfirmed'], manualOnlyAssessmentCalls: 0, editable: true, writes: 0 });
});

test('receipt read failure or mismatched saved snapshot cannot hide the editable values or report a completed image', async () => {
  for (const mode of ['unavailable', 'snapshot']) {
    const { h, posts } = setup({ assess: async call => {
      if (mode === 'unavailable') throw Error('합성 영수증 조회 실패');
      const altered = plain(call.captured); altered.references.view.revision++; return altered;
    } });
    try {
      await h.idle(); assert.equal(resultImage(h), undefined); assert.equal(h.input('선택 옵션 제조원').props.disabled, false); assert.equal(posts.length, 0);
      if (mode === 'unavailable') assert.match(text(h.render()), /저장된 생성 라벨을 확인하지 못했습니다/);
      h.edit('선택 옵션 제조원', '실패 뒤에도 유지할 수동값'); await h.idle(); assert.equal(h.input('선택 옵션 제조원').props.value, '실패 뒤에도 유지할 수동값');
      assert.equal(h.render().props['data-workspace-dirty'], true);
    } finally { h.close(); }
  }
  cases.push({ name: 'read and snapshot failure', manualEditingAvailable: true, falseCompletion: false, writes: 0 });
});

test('a delayed receipt cannot hide a new manual blank or return after cancel re-enters the same saved snapshot', async () => {
  const pending = deferred();
  const { h, reads, posts } = setup({ assess: (call, count) => count === 1 ? pending.promise : { ...call.captured, result: null, reason: 'manual' } });
  try {
    await waitFor(() => reads.length === 1, h); await h.idle();
    assert.equal(h.render().props['data-workspace-saving'], false, 'readonly assessment does not lock manual editing');
    h.edit('선택 옵션 원료명 및 성분명(재질)', ''); await h.idle();
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').props.value, ''); assert.equal(h.render().props['data-workspace-dirty'], true);
    const original = reads[0].captured;
    await h.click('입력 취소·저장 표시사항 다시 조회'); await waitFor(() => reads.length >= 2, h);
    pending.resolve(original); await h.idle();
    assert.equal(resultImage(h), undefined, 'old eligible token cannot regain authority after dirty/cancel ABA');
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').props.value, '공통 재질'); assert.equal(posts.length, 0);
    cases.push({ name: 'late receipt and same-snapshot cancel', pendingReadDoesNotLock: true, blankPreservedUntilCancel: true, oldReplyIgnored: true, writes: 0 });
  } finally { h.close(); }
});

test('child dirty and busy callbacks cancel old completion without disabling the child own save or cancellation path', async () => {
  const pending = deferred();
  const { h, reads, posts } = setup({ assess: (call, count) => count === 1 ? pending.promise : call.captured });
  try {
    await waitFor(() => reads.length === 1, h); await h.idle();
    const initialType = child(h).type; child(h).props.onEditingChange(true); child(h).props.onBusyChange(true); h.render();
    assert.equal(h.render().props['data-workspace-saving'], true); assert.equal(child(h).props.disabled, false);
    // The harness waits for workspace busy, so settle the current child before
    // examining its enabled controls, retaining its pending reference edits.
    child(h).props.onBusyChange(false); await h.idle();
    pending.resolve(reads[0].captured); await h.idle();
    assert.equal(resultImage(h), undefined); assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.equal(child(h).type, initialType); assert.equal(child(h).props.disabled, false); assert.equal(child(h).props.beforeSave(), true);
    assert.equal(h.input('선택 옵션 제품명').props.disabled, true, 'reference edits reserve the primary form');
    child(h).props.onEditingChange(false); await h.idle();
    assert.ok(resultImage(h)); assert.equal(child(h).type, initialType); assert.equal(child(h).props.disabled, false); assert.equal(posts.length, 0);
    cases.push({ name: 'reference editing lifecycle', childMounted: true, ownControlsEnabled: true, staleReceiptIgnored: true, completionAfterCancel: true, writes: 0 });
  } finally { h.close(); }
});

test('explicit rewrite returns to editing and only a newly attached current-epoch image restores completion', async () => {
  const { f, h, posts } = setup();
  try {
    await h.idle(); assert.ok(resultImage(h)); const before = plain(f.view);
    await h.click('재작성'); assert.equal(posts.length, 1); assert.equal(confirmations.length, 1); assert.equal(f.view.renderEpoch, 1);
    assert.equal(resultImage(h), undefined, 'unchanged old reference is stale after epoch advancement'); assert.ok(h.input('선택 옵션 제품명')); assert.ok(h.button('표시사항 재작성'));
    assert.deepEqual(plain(f.view.rows), before.rows); assert.deepEqual(plain(f.view.overrides), before.overrides); assert.deepEqual(plain(f.view.imageKeys), before.imageKeys);
    await h.click('저장한 표시사항 PNG 미리보기'); assert.equal(resultImage(h), undefined); assert.equal(h.plans.length, 1);
    await h.click('PNG 업로드·견적에 연결'); assert.equal(h.attachments.length, 1); assert.equal(posts.length, 1);
    assert.ok(resultImage(h)); assert.equal(resultImage(h).props.src, '/api/files/' + keyFor('b')); assert.equal(h.input('선택 옵션 제품명'), undefined);
    assert.deepEqual(plain(f.view.rows), before.rows); assert.deepEqual(plain(f.view.overrides), before.overrides);
    assert.ok(f.view.imageKeys.includes(keyFor('a')), 'old file stays in the pool');
    cases.push({ name: 'rewrite and new attachment', rewritePosts: 1, oldEpochNotCompleted: true, valuesPreserved: true, newAttachmentRestoresCompletion: true, oldFilesPreserved: true });
  } finally { h.close(); }
});

test('source, option and profile changes reject late receipt results and retained completed-card rewrite callbacks', async () => {
  for (const mode of ['source', 'option', 'profile']) {
    const pending = deferred();
    const { f, h, reads, posts } = setup({ assess: (call, count) => count === 1 ? pending.promise : { ...call.captured, result: null, reason: 'manual' } });
    try {
      await waitFor(() => reads.length === 1, h); await h.idle();
      if (mode === 'source') h.source(f.source());
      else if (mode === 'option') h.select('blue');
      else { f.view.categoryContext.profileId = 'other-profile'; h.setProfile('other-profile'); }
      await h.idle(); pending.resolve(reads[0].captured); await h.idle();
      assert.equal(resultImage(h), undefined, mode); assert.ok(h.input('선택 옵션 제품명')); assert.equal(posts.length, 0);
    } finally { h.close(); }
  }
  const completed = setup();
  try {
    await completed.h.idle(); const oldRewrite = completed.h.button('재작성').props.onClick;
    completed.h.select('blue'); oldRewrite(); await completed.h.idle(); assert.equal(completed.posts.length, 0); assert.equal(confirmations.length, 0);
  } finally { completed.h.close(); }
  cases.push({ name: 'scope and source callbacks', sourceOptionProfileProtected: true, retainedRewriteIgnored: true, writes: 0 });
});

test('unmount cancels pending completion publication without late state updates', async () => {
  const pending = deferred(), { h, reads, posts } = setup({ assess: () => pending.promise });
  await waitFor(() => reads.length === 1, h); await h.idle(); h.close(); pending.resolve(reads[0].captured);
  await new Promise(done => setImmediate(done)); await Promise.resolve();
  assert.equal(h.lateWrites, 0); assert.equal(posts.length, 0);
  cases.push({ name: 'unmount', lateStateWrites: 0, writes: 0 });
});
