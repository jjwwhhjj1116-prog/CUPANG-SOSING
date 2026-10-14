import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
async function fixture(company) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', h.context.category);
  const queue = h.load('app/intake-queue.ts'), calls = [], published = [], updates = [];
  const row = (index, patch = {}) => ({ ...queue.intakeRow(profile, 'row-' + index), url: 'https://detail.1688.com/offer/66400000000' + index + '.html?spm=synthetic', features: company.name + ' 특징 ' + index, keywords: '키워드 ' + index, ...patch });
  const fetcher = async (path, init) => {
    assert.equal(path, '/api/collection-jobs'); const body = JSON.parse(init.body); calls.push(body);
    return h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test' + path, { ...init, headers: { 'content-type': 'application/json' } }));
  };
  const options = { signal: new AbortController().signal, fetcher, onJobs: jobs => published.push(...jobs), onRow: (id, state) => updates.push({ id, ...state }) };
  return { h, profile, queue, row, calls, published, updates, options };
}

for (const company of companies) {
  test(`${company.name}: empty URL category rows are retained and only an entered URL reaches the actual API`, async () => {
    const f = await fixture(company);
    try {
      const rows = [f.row(1, { url: '', features: '미완성 특징', keywords: '' }), f.row(2), f.row(3, { url: '  ', features: '보관할 입력', keywords: '미완성 키워드' })], before = JSON.stringify(rows);
      assert.deepEqual(Array.from(f.queue.intakeRowsForCollection(rows), row => row.id), ['row-2']);
      await f.queue.submitIntakeQueue(rows, 'price', f.options);
      assert.equal(f.calls.length, 1); assert.deepEqual(f.updates.map(value => value.id), ['row-2']);
      assert.equal(f.updates[0].status, 'saved'); assert.equal(JSON.stringify(rows), before);
      const job = f.published[0]; assert.equal(job.context.company.code, company.code); assert.equal(job.context.company.name, company.name);
      assert.equal(job.context.category.id, f.profile.id); assert.equal(job.context.category.revision, f.profile.revision);
      assert.equal(job.context.features, rows[1].features); assert.equal(job.context.keywords, rows[1].keywords);
      assert.equal(job.source_url, 'https://detail.1688.com/offer/664000000002.html');
    } finally { f.h.close(); }
  });
  test(`${company.name}: local invalid row does not prevent valid rows from pinning their own contexts`, async () => {
    const f = await fixture(company);
    try {
      const rows = [f.row(1), f.row(2, { url: 'https://example.invalid/not-1688' }), f.row(3)], before = JSON.stringify(rows);
      await f.queue.submitIntakeQueue(rows, 'price', f.options);
      assert.deepEqual(f.calls.map(value => value.urls[0]), ['https://detail.1688.com/offer/664000000001.html', 'https://detail.1688.com/offer/664000000003.html']);
      assert.equal(f.updates.find(value => value.id === 'row-2').status, 'error');
      assert.match(f.updates.find(value => value.id === 'row-2').message, /^2번째 URL/u);
      assert.equal(f.updates.find(value => value.id === 'row-1').status, 'saved'); assert.equal(f.updates.find(value => value.id === 'row-3').status, 'saved');
      assert.equal(f.published.length, 2); assert.equal(f.published[1].context.features, rows[2].features); assert.equal(JSON.stringify(rows), before);
    } finally { f.h.close(); }
  });
  test(`${company.name}: duplicate canonical URLs both stay retryable while a different valid row proceeds`, async () => {
    const f = await fixture(company);
    try {
      const rows = [f.row(1), f.row(2, { url: 'https://detail.1688.com/offer/664000000001.html?other=duplicate' }), f.row(3)];
      await f.queue.submitIntakeQueue(rows, 'price', f.options);
      assert.equal(f.calls.length, 1); assert.equal(f.published.length, 1); assert.equal(f.published[0].offer_id, '664000000003');
      for (const id of ['row-1', 'row-2']) { const state = f.updates.find(value => value.id === id); assert.equal(state.status, 'error'); assert.match(state.message, /중복/); }
    } finally { f.h.close(); }
  });
  test(`${company.name}: blank-only and invalid-only starts cannot create products or falsely complete placeholders`, async () => {
    const f = await fixture(company);
    try {
      const beforeProducts = f.h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n;
      await f.queue.submitIntakeQueue([f.row(1, { url: '' }), f.row(2, { url: '  ' })], 'price', f.options);
      assert.equal(f.calls.length, 0); assert.equal(f.updates.length, 0); assert.equal(f.published.length, 0);
      await assert.rejects(f.queue.submitIntakeQueue([f.row(3, { url: 'wrong' })], 'price', f.options), /1개 행/);
      assert.equal(f.calls.length, 0); assert.equal(f.updates[0].status, 'error'); assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n, beforeProducts);
    } finally { f.h.close(); }
  });
  test(`${company.name}: skipped blank rows do not renumber duplicate diagnostics`, async () => {
    const f = await fixture(company);
    try {
      const rows = [f.row(1), f.row(2, { url: '' }), f.row(3, { url: 'https://detail.1688.com/offer/664000000001.html?duplicate=1' }), f.row(4)];
      const selectedIds = new Set(['row-1', 'row-3', 'row-4']);
      const validation = f.queue.validateIntakeQueue(rows.filter(row => selectedIds.has(row.id)), 'price', rows);
      assert.deepEqual(Array.from(validation.errors, value => value.row), [1, 3]);
      await f.queue.submitIntakeQueue(rows, 'price', { ...f.options, selectedIds });
      assert.equal(f.calls.length, 1); assert.equal(f.published[0].offer_id, '664000000004');
      for (const id of ['row-1', 'row-3']) assert.match(f.updates.find(value => value.id === id).message, /1, 3행/u);
      assert.equal(f.updates.some(value => value.id === 'row-2'), false);
    } finally { f.h.close(); }
  });
  test(`${company.name}: a preflight row callback abort prevents all later updates and requests`, async () => {
    const f = await fixture(company), controller = new AbortController();
    try {
      await f.queue.submitIntakeQueue([f.row(1, { url: 'wrong' }), f.row(2, { url: 'wrong-again' }), f.row(3)], 'price', {
        ...f.options, signal: controller.signal, onRow: (id, state) => { f.updates.push({ id, ...state }); controller.abort(); },
      });
      assert.equal(f.updates.length, 1); assert.equal(f.calls.length, 0); assert.equal(f.published.length, 0);
    } finally { f.h.close(); }
  });
  test(`${company.name}: URL-only remains supported without inventing keyword or feature values`, async () => {
    const f = await fixture(company);
    try {
      await f.queue.submitIntakeQueue([f.row(1, { features: '', keywords: '' })], 'price', f.options);
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0].features, ''); assert.equal(f.calls[0].keywords, '');
      assert.equal(f.published[0].context.features, ''); assert.equal(f.published[0].context.keywords, '');
    } finally { f.h.close(); }
  });
}
