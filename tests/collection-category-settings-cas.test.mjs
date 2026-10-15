import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const companies = [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }];
const offers = ['674000000001', '674000000002', '674000000003'];
const url = offer => 'https://detail.1688.com/offer/' + offer + '.html';
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };

async function harness(company, saved = true) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name,
    sourceFetcher: async () => { throw Error('No external source requests in intake CAS tests.'); } });
  const category = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: 'LOCAL CAS category', categoryId: '80719',
    categoryPath: [...h.load('app/quotation-schema.ts').getQuotationSchema('80719').categoryPath], mappings: [], template: null });
  if (saved) await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
  const at = '2026-10-15T02:00:00.000Z';
  for (const [id, offer, status] of [['cancelled-old', offers[0], 'cancelled'], ['legacy-old', offers[1], 'awaiting_connector']]) {
    h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run(id, 'owner', offer, url(offer), 'collect', status, at, at);
    h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run(id, JSON.stringify({ company, features: 'frozen old draft' }));
  }
  h.sqlite.prepare('INSERT INTO collection_offer_claims VALUES(?,?,?)').run('owner', offers[0], 'cancelled-old');
  h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('foreign-job', 'foreign-owner', offers[0], url(offers[0]), 'collect', 'awaiting_connector', at, at);
  h.sqlite.prepare('INSERT INTO collection_offer_claims VALUES(?,?,?)').run('foreign-owner', offers[0], 'foreign-job');
  let before, after, fault, guardedBatches = 0;
  const prepare = h.db.prepare, batch = h.db.batch;
  h.db.prepare = sql => { const query = prepare.call(h.db, sql); query.sql = sql; return query; };
  h.db.batch = async statements => {
    const guarded = statements[0]?.sql?.startsWith('DELETE FROM collection_offer_claims') && statements.at(-1)?.sql?.includes('AS category_current');
    if (guarded) { guardedBatches++; const callback = before; before = undefined; callback?.(); }
    if (guarded && fault !== undefined) {
      const query = statements[fault], execute = query.execute;
      query.execute = () => { execute(); throw Error('injected transaction failure ' + fault); };
    }
    const results = await batch.call(h.db, statements);
    if (guarded) { const callback = after; after = undefined; callback?.(); }
    return results;
  };
  const snapshot = () => JSON.stringify(['collection_jobs', 'collection_context', 'collection_offer_claims'].map(table =>
    [table, h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
  const settings = h.load('app/workspace-settings.ts').savedRegistrationSettings(saved ? h.settings : null);
  const body = { urls: offers.map(url), goal: 'work', profileId: category.id, expectedProfileRevision: category.revision,
    expectedSettings: settings, features: '새 입력 보존', keywords: '새키워드' };
  const post = input => h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test' }, body: JSON.stringify(input ?? body) }));
  return { ...h, category, body, post, snapshot, before(callback) { before = callback; }, after(callback) { after = callback; },
    fault(index) { fault = index; }, get guardedBatches() { return guardedBatches; } };
}

for (const company of companies) {
  test(`category revision/raw payload races leave every job, context and offer claim unchanged (${company.code})`, async () => {
    for (const kind of ['revision', 'payload', 'raw-bytes', 'deleted']) {
      const h = await harness(company); try {
        const frozen = h.snapshot();
        h.before(() => {
          const row = h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(h.category.id);
          if (kind === 'deleted') h.sqlite.prepare('DELETE FROM category_profiles WHERE id=?').run(h.category.id);
          else if (kind === 'revision') h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(h.category.id);
          else {
            const payload = kind === 'raw-bytes' ? ' ' + row.payload + ' ' : JSON.stringify({ ...JSON.parse(row.payload), name: '다른 편집기의 양식' });
            h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(payload, h.category.id);
          }
        });
        const result = await json(await h.post(), 409); assert.equal(result.code, 'CATEGORY_PROFILE_CHANGED', kind);
        assert.equal(h.snapshot(), frozen, kind + ': claim retirement and legacy backfill must also be no-ops');
        assert.equal(h.guardedBatches, 1); assert.deepEqual(h.network, []);
      } finally { h.close(); }
    }
  });

  test(`settings update/deletion and missing-to-created races retain the whole captured queue (${company.code})`, async () => {
    for (const kind of ['changed', 'raw-bytes', 'deleted', 'created']) {
      const h = await harness(company, kind !== 'created'); try {
        const frozen = h.snapshot();
        h.before(() => {
          if (kind === 'created') h.sqlite.prepare('INSERT INTO workspace_settings VALUES(?,?,?)').run('owner', JSON.stringify(h.settings), '2026-10-16');
          else if (kind === 'deleted') h.sqlite.prepare('DELETE FROM workspace_settings WHERE owner_id=?').run('owner');
          else {
            const row = h.sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get('owner');
            const payload = kind === 'raw-bytes' ? ' ' + row.payload + ' ' : JSON.stringify({ ...JSON.parse(row.payload), exchangeRate: 400 });
            h.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(payload, 'owner');
          }
        });
        const result = await json(await h.post(), 409); assert.equal(result.code, 'REGISTRATION_SETTINGS_CHANGED', kind);
        assert.equal(h.snapshot(), frozen); assert.equal(h.guardedBatches, 1); assert.deepEqual(h.network, []);
      } finally { h.close(); }
    }
  });

  test(`current snapshots queue atomically, retry idempotently and ignore changes after committed batch (${company.code})`, async () => {
    const h = await harness(company); try {
      const result = await json(await h.post()); assert.equal(result.jobs.length, 3); assert.equal(result.executionStarted, false);
      assert.notEqual(result.jobs[0].id, 'cancelled-old'); assert.equal(result.jobs[1].id, 'legacy-old');
      assert.equal(result.jobs[0].context.category.id, h.category.id); assert.equal(result.jobs[0].context.settings.exchangeRate, h.settings.exchangeRate);
      assert.deepEqual(result.jobs[0].context.company, company); assert.equal(result.jobs[0].context.features, '새 입력 보존');
      assert.equal(h.sqlite.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').get('foreign-owner', offers[0]).job_id, 'foreign-job');
      const frozen = h.snapshot(), retry = await json(await h.post()); assert.deepEqual(retry.jobs.map(job => job.id), result.jobs.map(job => job.id));
      assert.equal(h.snapshot(), frozen); assert.equal(h.guardedBatches, 2);
      h.after(() => h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(h.category.id));
      const committed = await json(await h.post()); assert.deepEqual(committed.jobs.map(job => job.id), result.jobs.map(job => job.id));
      assert.equal(h.snapshot(), frozen, 'a concurrent configuration update after COMMIT must not become a false failed acknowledgement');
      assert.deepEqual(h.network, []);
    } finally { h.close(); }
  });

  test(`injected companion failure rolls back retired claims and legacy backfill as well as new contexts (${company.code})`, async () => {
    for (const checkpoint of [0, 1, 3, 10, 18]) {
      const h = await harness(company); try {
        const frozen = h.snapshot(); h.fault(checkpoint); await json(await h.post(), 503);
        assert.equal(h.snapshot(), frozen, 'transaction checkpoint ' + checkpoint); assert.deepEqual(h.network, []);
      } finally { h.close(); }
    }
  });
}
