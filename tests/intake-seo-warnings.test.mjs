import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const warnings = ['원문의 UV380은 판매자 주장으로 실제 성능 확인이 필요합니다.', '선택한 바스켓 카테고리와 원문 선글라스 상품이 일치하지 않습니다.'];
const content = h => JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const product = h => h.sqlite.prepare('SELECT * FROM products').get();
const snapshot = h => JSON.stringify({ product: product(h), content: content(h), options: h.sqlite.prepare('SELECT payload FROM product_options').get().payload });
const occurrences = (text, value) => text.split(value).length - 1;

// The warnings are controlled AI output, not evidence that production AI issued
// them. Supplier facts, real handlers and SQLite exercise their user-visible path.
for (const company of [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }]) {
  test(`recorded URL intake exposes saved AI review warnings and preserves explicit edits on reuse (${company.companyCode})`, async () => {
    const h = mobileIntakeHarness(company);
    try {
      const run = h.bindings.AI.run;
      h.bindings.AI.run = async (...args) => {
        const result = await run(...args); result.response.warnings = [...warnings, warnings[0]]; return result;
      };
      const message = await h.intake();
      for (const warning of warnings) assert.equal(occurrences(message, warning), 1, 'intake must show the generated review warning once');
      assert.match(message, /1단계 SEO 생성 이력/);
      assert.equal(h.aiSources.length, 1);
      assert.equal(h.aiSources[0].attributes.length, 42);
      assert.equal(content(h).categoryAttributes.values.length, 24);
      assert.equal(content(h).assets.main.value.length, 0, 'SEO-price keeps the observed image-stage behavior');
      const jobs = await (await h.route(`/api/products/${product(h).id}/translation`)).json();
      assert.deepEqual(jobs.jobs[0].result.draft.warnings, [...warnings, warnings[0]], 'display deduplication does not change the saved evidence');
      const policy = product(h).pricing_policy;
      const patched = await h.route(`/api/products/${product(h).id}/content`, { method: 'PATCH', body: {
        expectedRevision: content(h).revision, patch: { seo: { description: '', keywords: [] }, label: { material: '' }, labelClears: ['material'] },
      } });
      assert.equal(patched.status, 200, await patched.clone().text());
      const before = snapshot(h), retry = await h.intake();
      for (const warning of warnings) assert.equal(occurrences(retry, warning), 1);
      assert.equal(snapshot(h), before, 'warning display must not reapply the saved draft');
      assert.equal(content(h).seo.description.provenance, 'manual');
      assert.equal(content(h).label.material.provenance, 'manual');
      assert.equal(product(h).pricing_policy, policy);
      assert.equal(h.aiSources.length, 1, 'reuse the canonical completed result without another generation');
    } finally { h.close(); }
  });
}

function completedJob(id, values) {
  return { id, productId: 'p', productVersion: '2026-10-05T00:00:00.000Z', contentRevision: 1, status: 'completed',
    review: { destination: 'Cloudflare Workers AI' }, result: { draft: { warnings: values } } };
}
async function scenario(mode) {
  const h = mobileIntakeHarness(), first = completedJob('first', [warnings[0]]);
  const second = completedJob('second', [warnings[0], warnings[1], '추가 확인 '.repeat(50), '마지막 검토']);
  const original = JSON.stringify({ first, second }), actions = [], controller = new AbortController();
  let version = first.productVersion, options = 0;
  try {
    const outcome = await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome('p', async (_path, init) => {
      const body = JSON.parse(init.body); actions.push(body.action);
      if (body.action === 'prepare-collected') return Response.json({ job: first, autoDraft: true });
      if (body.action === 'prepare-intake-options') {
        options++;
        if (options > 1) return Response.json({ done: true, productId: 'p', productVersion: version });
        if (mode === 'failed-options') return Response.json({ job: { ...second, status: 'failed', result: null, error: { message: '옵션 생성 확인 필요' } }, autoDraft: true, optionsOnly: true });
        return Response.json({ job: second, autoDraft: true, optionsOnly: true, applyVersion: version });
      }
      if (body.action === 'preview') {
        if (mode === 'abort') controller.abort();
        if (mode === 'read-error') throw Error('미리보기 응답 확인 실패');
        return Response.json({ productId: 'p', productVersion: version, preview: [{}], fingerprint: 'a'.repeat(64) });
      }
      version = new Date(Date.parse(version) + 1).toISOString();
      return Response.json({ productId: 'p', productVersion: version, applied: 1 });
    }, controller.signal);
    assert.equal(JSON.stringify({ first, second }), original);
    return { outcome, actions };
  } finally { h.close(); }
}

test('option batches collect unique warnings with a bounded summary and an explicit full-history reference', async () => {
  const { outcome } = await scenario('complete');
  assert.equal(outcome.completed, true);
  for (const warning of warnings) assert.equal(occurrences(outcome.message, warning), 1);
  assert.match(outcome.message, /AI 검토 알림 4개/);
  assert.match(outcome.message, /외 1개/);
  assert.match(outcome.message, /…/);
  assert.match(outcome.message, /1단계 SEO 생성 이력/);
  assert.ok(outcome.message.length < 800);
});

test('partial option failure and apply-preview failure retain earlier warnings without claiming completion', async () => {
  for (const mode of ['failed-options', 'read-error']) {
    const { outcome } = await scenario(mode);
    assert.equal(outcome.completed, false, mode);
    assert.equal(occurrences(outcome.message, warnings[0]), 1, mode);
    assert.doesNotMatch(outcome.message, /초안을 생성해 반영했습니다/);
  }
});

test('closing the intake suppresses warnings and further saves together', async () => {
  const { outcome, actions } = await scenario('abort');
  assert.equal(outcome.completed, false); assert.equal(outcome.message, '');
  assert.deepEqual(actions, ['prepare-collected', 'preview']);
});
