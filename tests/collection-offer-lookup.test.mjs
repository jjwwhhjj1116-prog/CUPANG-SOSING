import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAdditiveBootstrap, memoryDatabase, readMigrationFiles, runtimeDDL, schemaSnapshot, sqlTokens } from '../scripts/check-db-schema.mjs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const indexName = 'idx_collection_owner_offer_status_created';
const files = readMigrationFiles(), migration = files.findIndex(file => file.name === '0023_collection_offer_lookup.sql');
const rows = db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all().map(row => ({ ...row }))]);
const job = (db, id, owner, offer, clock, status = 'awaiting_connector') => db.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)')
  .run(id, owner, offer, 'https://detail.1688.com/offer/' + offer + '.html', 'collect', status, clock, clock);
const clock = '2026-10-01T00:00:00.000Z', offer = '668100000001';

test('the new migration only adds the exact nonunique lookup index and preserves repeated offer history, claims and all stored rows', () => {
  assert.ok(migration > 0);
  assert.equal(Number(files[migration].name.slice(0, 4)), Number(files[migration - 1].name.slice(0, 4)) + 1);
  assert.doesNotThrow(() => assertAdditiveBootstrap(files[migration].sql));
  const statements = files[migration].sql.split(';').map(sqlTokens).filter(tokens => tokens.length);
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0], sqlTokens('CREATE INDEX IF NOT EXISTS ' + indexName + ' ON collection_jobs(owner_id, offer_id, status, created_at DESC, id DESC)'));
  const db = memoryDatabase();
  try {
    db.exec(files.slice(0, migration).map(file => file.sql).join('\n'));
    for (const [id, owner] of [['yun-old', 'yun'], ['yun-new', 'yun'], ['waih-old', 'waih']]) {
      job(db, id, owner, offer, clock);
      db.prepare('INSERT INTO collection_context VALUES(?,?)').run(id, JSON.stringify({ raw: '보존 원문', manualBlank: '', id }));
      db.prepare('INSERT INTO collection_results VALUES(?,?,?,?)').run(id, owner, JSON.stringify({ original: id, blank: '' }), clock);
    }
    db.prepare('INSERT INTO collection_offer_claims VALUES(?,?,?)').run('yun', offer, 'yun-new');
    db.prepare('INSERT INTO collection_offer_claims VALUES(?,?,?)').run('waih', offer, 'waih-old');
    const before = rows(db), schema = schemaSnapshot(db);
    db.exec(files[migration].sql); db.exec(files[migration].sql);
    assert.deepEqual(rows(db), before, 'index creation never rewrites jobs, context, receipts or claims');
    for (const table of schema.filter(item => item.type === 'table')) {
      const current = schemaSnapshot(db).find(item => item.name === table.name);
      assert.deepEqual(current.columns, table.columns); assert.deepEqual(current.foreignKeys, table.foreignKeys);
    }
    const index = db.prepare('PRAGMA index_list(collection_jobs)').all().find(row => row.name === indexName);
    assert.equal(index.unique, 0); assert.equal(index.partial, 0);
    assert.deepEqual(db.prepare('PRAGMA index_xinfo(' + indexName + ')').all().filter(row => row.key).map(row => [row.name, row.desc]),
      [['owner_id', 0], ['offer_id', 0], ['status', 0], ['created_at', 1], ['id', 1]]);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='idx_collection_active_offer'").get().n, 0);
    job(db, 'yun-another-history', 'yun', offer, clock);
    assert.throws(() => db.prepare('INSERT INTO collection_offer_claims VALUES(?,?,?)').run('yun', offer, 'yun-old'), /UNIQUE/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('fresh/repeated migrations and runtime DDL agree while retaining the retired unique-index policy', () => {
  const runtime = memoryDatabase(), migrated = memoryDatabase();
  try {
    for (const statement of runtimeDDL()) runtime.exec(statement.sql);
    migrated.exec(files.map(file => file.sql).join('\n'));
    const before = schemaSnapshot(migrated); migrated.exec(files.map(file => file.sql).join('\n'));
    assert.deepEqual(schemaSnapshot(migrated), before); assert.deepEqual(before, schemaSnapshot(runtime));
    assert.equal(before.filter(item => item.type === 'index' && item.name === indexName).length, 1);
    assert.equal(before.some(item => item.name === 'idx_collection_active_offer'), false);
  } finally { runtime.close(); migrated.close(); }
});

for (const company of [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }]) {
  test(`${company.companyCode}: actual enqueue uses owner/offer/status keys for absent URLs and preserves newest owned history and existing claims`, async () => {
    const h = mobileIntakeHarness(company), calls = [], prepare = h.bindings.DB.prepare;
    try {
      const api = h.load('db/collection-jobs.ts');
      h.bindings.DB.prepare = sql => {
        const statement = prepare(sql), bind = statement.bind, item = { sql, args: [] }; calls.push(item);
        statement.bind = (...args) => { item.args = args; return bind(...args); }; return statement;
      };
      h.sqlite.exec('BEGIN');
      for (let i = 0; i < 1000; i++) job(h.sqlite, 'owner-history-' + i, 'owner', String(668200000001 + i), clock);
      job(h.sqlite, 'owned-old', 'owner', offer, '2020-01-01T00:00:00.000Z');
      job(h.sqlite, 'owned-a', 'owner', offer, clock); job(h.sqlite, 'owned-z', 'owner', offer, clock);
      job(h.sqlite, 'owned-cancelled', 'owner', offer, '2030-01-01T00:00:00.000Z', 'cancelled');
      job(h.sqlite, 'foreign-newer', 'other-owner', offer, '2030-01-01T00:00:00.000Z');
      for (const id of ['owned-old', 'owned-a', 'owned-z']) h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run(id, JSON.stringify({ ...h.context, fixtureBlank: '' }));
      h.sqlite.exec('COMMIT');
      const history = JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_jobs ORDER BY id').all());
      const request = value => ({ offerId: value, sourceUrl: 'https://detail.1688.com/offer/' + value + '.html', goal: 'collect' });
      const selected = await api.enqueueCollection('owner', [request(offer)], h.context);
      assert.equal(selected[0].id, 'owned-z', 'newest owned active row uses the existing id DESC tie-break');
      assert.equal(selected[0].context.fixtureBlank, '');
      assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_jobs ORDER BY id').all()), history);
      const repeated = await api.enqueueCollection('owner', [request(offer)], h.context); assert.equal(repeated[0].id, selected[0].id);
      assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_jobs ORDER BY id').all()), history);
      const lookup = calls.find(item => item.sql.startsWith('INSERT INTO collection_offer_claims(owner_id,offer_id,job_id)') && item.sql.includes('SELECT j.owner_id,j.offer_id,j.id'));
      assert.ok(lookup);
      const missingArgs = [...lookup.args]; missingArgs[1] = '668999999999';
      h.sqlite.exec('DROP INDEX ' + indexName);
      const before = h.sqlite.prepare('EXPLAIN QUERY PLAN ' + lookup.sql).all(...missingArgs).map(row => row.detail);
      assert.ok(before.some(detail => detail.startsWith('SEARCH j ') && detail.endsWith('(owner_id=?)')), 'control plan only narrows by owner');
      h.sqlite.exec(api.collectionOfferLookupIndex);
      for (const args of [lookup.args, missingArgs]) {
        const after = h.sqlite.prepare('EXPLAIN QUERY PLAN ' + lookup.sql).all(...args).map(row => row.detail);
        assert.ok(after.some(detail => detail === 'SEARCH j USING COVERING INDEX ' + indexName + ' (owner_id=? AND offer_id=? AND status=?)'), after.join('\n'));
        assert.ok(!after.some(detail => detail.includes('USE TEMP B-TREE')), 'ordered tuple lookup needs no temporary sort');
      }
      const beforeFresh = h.sqlite.prepare('SELECT count(*) n FROM collection_jobs').get().n;
      const fresh = await api.enqueueCollection('owner', [request('668999999999')], h.context);
      assert.notEqual(fresh[0].id, selected[0].id); assert.equal(fresh[0].offer_id, '668999999999');
      assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_jobs').get().n, beforeFresh + 1);
      assert.equal((await api.findCollectionJob('other-owner', selected[0].id)), null);
      assert.equal(h.sqlite.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').get('owner', offer).job_id, 'owned-z');
      assert.equal(h.network.length, 0); assert.equal(h.aiSources.length, 0);
    } finally { h.close(); }
  });
}
