import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAdditiveBootstrap, memoryDatabase, readMigrationFiles, runtimeDDL, schemaSnapshot, sqlTokens} from '../scripts/check-db-schema.mjs';

const files = readMigrationFiles(), migrationIndex = files.findIndex(file => file.name === '0017_collection_offer_claims.sql');
const version = '2026-10-07T00:00:00.000Z';
const offer = '813724060928';
const sourceUrl = `https://detail.1688.com/offer/${offer}.html`;
const ownerA = 'yun', ownerB = 'waih';
const original = JSON.stringify({sourceUrl, text: '원문과 수동 공란을 보존합니다', manualBlank: '', revision: 4});
const rows = db => Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name}) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row => ({...row}))]));
const job = (db, id, owner, status = 'awaiting_connector', offerId = offer) => db.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)')
  .run(id, owner, offerId, `https://detail.1688.com/offer/${offerId}.html`, 'work', status, version, version);

function seed(db) {
  for (const [id, owner] of [['p-yun', ownerA], ['p-waih', ownerB]]) {
    db.prepare(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,image_keys,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, owner, sourceUrl, 'PRIVATE MIGRATION FIXTURE', 3.6, 350, 50, 40, 4260, 7100, 9230, '[]', version, version);
  }
  job(db, 'yun-original', ownerA); job(db, 'yun-cancelled', ownerA, 'cancelled'); job(db, 'waih-original', ownerB);
  for (const [id, owner] of [['yun-original', ownerA], ['yun-cancelled', ownerA], ['waih-original', ownerB]]) {
    db.prepare('INSERT INTO collection_context VALUES(?,?)').run(id, original);
    db.prepare('INSERT INTO collection_results VALUES(?,?,?,?)').run(id, owner, original, version);
    db.prepare('INSERT INTO collection_source_supplements VALUES(?,?,?,?,?,?)').run(id, owner, original, original, original, version);
  }
  db.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('yun-original', ownerA, 'p-yun', version);
  db.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('waih-original', ownerB, 'p-waih', version);
  db.prepare('INSERT INTO collection_images VALUES(?,?,?,?,?,?,?)').run('yun-original', 0, ownerA, 'p-yun', 'yun/original.png', 'original-operation', version);
  db.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run(ownerA, 'p-yun', 'saved-evidence', Date.parse(version), 1, original);
}

test('the approved migration contains only the new claim table and the exact retirement of the old active-offer index', () => {
  assert.ok(migrationIndex > 0); const migration = files[migrationIndex];
  assert.doesNotThrow(() => assertAdditiveBootstrap(migration.sql));
  // A complete migration is intentionally multiple SQL statements, unlike one
  // runtime declaration; test its explicit bounded token contract separately.
  const statements = migration.sql.split(';').map(sqlTokens).filter(tokens => tokens.length);
  assert.equal(statements.length, 2);
  assert.deepEqual(statements.find(tokens => tokens[0] === 'drop'), ['drop', 'index', 'if', 'exists', 'idx_collection_active_offer']);
  assert.deepEqual(statements.find(tokens => tokens[0] === 'create'), sqlTokens(`CREATE TABLE IF NOT EXISTS collection_offer_claims (
    owner_id TEXT NOT NULL, offer_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES collection_jobs(id), PRIMARY KEY(owner_id, offer_id))`));
});

test('claim migration upgrade keeps every prior job/context/receipt/link/status byte and removes only the retired index', () => {
  const db = memoryDatabase();
  try {
    db.exec(files.slice(0, migrationIndex).map(file => file.sql).join('\n')); seed(db);
    const before = rows(db), schema = schemaSnapshot(db);
    assert.equal(before.collection_jobs.length, 3);
    assert.throws(() => job(db, 'duplicate-before', ownerA), /UNIQUE/);
    db.exec(files[migrationIndex].sql);
    const after = rows(db);
    for (const [table, originalRows] of Object.entries(before)) assert.deepEqual(after[table], originalRows, table);
    assert.deepEqual(after.collection_offer_claims, []);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='index' AND name='idx_collection_active_offer'").get().count, 0);
    for (const table of schema.filter(item => item.type === 'table')) {
      const current = schemaSnapshot(db).find(item => item.type === 'table' && item.name === table.name);
      assert.deepEqual(current.columns, table.columns); assert.deepEqual(current.foreignKeys, table.foreignKeys);
      assert.deepEqual(current.indexes, table.indexes.filter(index => index.name !== 'idx_collection_active_offer'));
    }
    job(db, 'yun-new', ownerA);
    db.prepare('INSERT INTO collection_context VALUES(?,?)').run('yun-new', JSON.stringify({newRequest: true}));
    assert.equal(db.prepare('SELECT status FROM collection_jobs WHERE id=?').get('yun-original').status, 'awaiting_connector');
    assert.equal(db.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('yun-original').payload, original);
    assert.equal(db.prepare('SELECT job_id FROM collection_products WHERE product_id=?').get('p-yun').job_id, 'yun-original');
    const withHistory = rows(db);
    db.exec(files[migrationIndex].sql); db.exec(files[migrationIndex].sql);
    for (const statement of runtimeDDL()) db.exec(statement.sql);
    assert.deepEqual(rows(db), withHistory);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='idx_collection_active_offer'").get().count, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {db.close();}
});

test('owner/offer claims enforce one active claim and one job per claim while preserving both companies historical jobs', () => {
  const db = memoryDatabase();
  try {
    db.exec(files.map(file => file.sql).join('\n')); seed(db); job(db, 'yun-new', ownerA); job(db, 'waih-new', ownerB);
    const claim = db.prepare('INSERT INTO collection_offer_claims(owner_id,offer_id,job_id) VALUES(?,?,?)');
    claim.run(ownerA, offer, 'yun-new'); claim.run(ownerB, offer, 'waih-new');
    assert.throws(() => claim.run(ownerA, offer, 'yun-original'), /UNIQUE/);
    assert.throws(() => claim.run(ownerA, 'another-offer', 'yun-new'), /UNIQUE/);
    assert.throws(() => claim.run('other', 'unseen-offer', 'missing-job'), /FOREIGN KEY/);
    assert.throws(() => claim.run(null, 'unseen-offer', 'yun-original'), /NOT NULL/);
    assert.throws(() => claim.run(ownerA, null, 'yun-original'), /NOT NULL/);
    const previous = rows(db);
    db.exec(files[migrationIndex].sql);
    for (const statement of runtimeDDL()) db.exec(statement.sql);
    assert.deepEqual(rows(db), previous);
    db.prepare('DELETE FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').run(ownerA, offer);
    claim.run(ownerA, offer, 'yun-original');
    assert.equal(db.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=?').get(ownerB).job_id, 'waih-new');
    assert.equal(db.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('yun-original').payload, original);
    assert.equal(db.prepare('SELECT count(*) AS count FROM collection_jobs').get().count, 5);
  } finally {db.close();}
});

test('fresh and repeated migrations produce the same claim schema as ordered runtime DDL without reviving the old index', () => {
  const fresh = memoryDatabase(), runtime = memoryDatabase();
  try {
    const statements = runtimeDDL(), drops = statements.filter(statement => statement.type === 'drop-index');
    assert.equal(drops.length, 1); assert.deepEqual(sqlTokens(drops[0].sql).filter(token => token !== ';'), ['drop', 'index', 'if', 'exists', 'idx_collection_active_offer']);
    assert.equal(statements.at(-1).type, 'drop-index');
    for (const statement of statements) runtime.exec(statement.sql);
    fresh.exec(files.map(file => file.sql).join('\n')); const first = schemaSnapshot(fresh);
    fresh.exec(files.map(file => file.sql).join('\n'));
    assert.deepEqual(schemaSnapshot(fresh), first); assert.deepEqual(first, schemaSnapshot(runtime));
    assert.equal(first.some(item => item.name === 'idx_collection_active_offer'), false);
    assert.equal(first.filter(item => item.type === 'table').length, 30);
  } finally {fresh.close(); runtime.close();}
});
