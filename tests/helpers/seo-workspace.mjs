import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { memoryDatabase, runtimeDDL } from '../../scripts/check-db-schema.mjs';
import { providedOptionFixture } from './provided-option-quotation.mjs';

const nativeRequire = createRequire(import.meta.url);

/** Real app handlers and D1 batch SQL against temporary SQLite. No networking. */
export function seoWorkspaceHarness({ companyCode = 'A01464742', owner = 'owner', authenticated = true } = {}) {
  const sqlite = memoryDatabase();
  for (const entry of runtimeDDL()) sqlite.exec(entry.sql);
  // Product policy is an existing additive migration, not runtime CREATE DDL.
  sqlite.exec('ALTER TABLE products ADD COLUMN pricing_policy TEXT');
  const cache = new Map(), mutations = [], batches = [];
  let beforeBatch = null, beforeFind = null, findCalls = 0;
  const db = {
    prepare(sql) {
      let args = [];
      const statement = { sql, bind(...values) { args = values; return statement; },
        execute() { if (/^(UPDATE|INSERT|DELETE)/u.test(sql.trim())) mutations.push({ sql, args }); return sqlite.prepare(sql).all(...args); },
        async all() { return { results: statement.execute() }; }, async first() { return statement.execute()[0] ?? null; },
        async run() { return sqlite.prepare(sql).run(...args); },
      };
      return statement;
    },
    async batch(statements) {
      if (beforeBatch && /^UPDATE products/u.test(statements[0].sql)) { const hook = beforeBatch; beforeBatch = null; hook(); }
      batches.push(statements.length); sqlite.exec('BEGIN');
      try { const results = statements.map(statement => ({ results: statement.execute() })); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const bindings = { DB: db, FILES: { head() { throw Error('SEO must not reopen images.'); }, get() { throw Error('SEO must not fetch image bytes.'); }, put() { throw Error('SEO must not upload.'); } } };
  const auth = { getChatGPTUser: async () => authenticated ? { verifiedAccess: true, userId: owner, membership: { companyCode, companyName: companyCode === 'A01464742' ? '와이홉' : '유앤채', status: 'approved' } } : null, getWorkspaceOwnerId: async () => owner };
  const deps = { 'cloudflare:workers': { env: bindings }, '@/app/chatgpt-auth': auth, 'next/server': { NextResponse: Response } };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, Response, Request, Headers, TextDecoder, TextEncoder, Uint8Array, Date, Error, RangeError, URL, structuredClone, AbortController, AbortSignal, crypto: webcrypto, process: { env: { NODE_ENV: 'production' } },
        fetch() { throw Error('External requests are forbidden.'); }, require(name) {
          if (name in deps) return deps[name];
          if (name === 'parse5') return nativeRequire(name);
          if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
          if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
          throw Error(name);
        } }, { filename: file });
    return exports;
  }
  const queries = load('db/queries.ts'), find = queries.findProduct;
  queries.findProduct = async (...args) => { findCalls++; if (beforeFind) beforeFind(findCalls); return find(...args); };
  const fixture = providedOptionFixture({ reviewedNames: true }), id = fixture.product.id, version = fixture.product.updated_at;
  const content = structuredClone(fixture.content);
  content.assets.main = { value: ['owner/seed.png'], provenance: 'manual', updatedAt: version };
  content.label.material = { value: '직접 입력한 재질', provenance: 'manual', updatedAt: version };
  content.intakeKeywordSeed = { value: ['초기 태그'], updatedAt: version, sourceReference: 'synthetic-only' };
  const options = structuredClone(fixture.options);
  options.rows.push({ ...structuredClone(options.rows[0]), id: 'second', originalName: '合成选项', translatedName: '두 번째', included: false });
  options.rows[0].imageKey = 'owner/seed.png';
  options.rows[0].packagedWeightG = 350;
  const product = { ...fixture.product, owner_id: 'owner', image_keys: JSON.stringify(['owner/seed.png']), options_count: 1 };
  const columns = Object.keys(product);
  sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(key => product[key]));
  sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run(id, 'owner', content.revision, JSON.stringify(content), version);
  sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run(id, 'owner', options.revision, JSON.stringify(options), version);
  sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(id, 'owner', 1, JSON.stringify({ schemaVersion: 1, productId: id, revision: 1, overrides: { common: { title: '직접 견적 이름' }, options: { second: { salePrice: '', labelImages: '' } } } }), version);
  const route = load('app/api/products/[id]/seo-workspace/route.ts');
  const request = async (method = 'GET', body, headers = {}) => route[method](new Request('https://app.test/api/products/' + id + '/seo-workspace', { method, headers: { 'content-type': 'application/json', ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }), { params: Promise.resolve({ id }) });
  const stored = () => ({ product: sqlite.prepare('SELECT * FROM products WHERE id=?').get(id), content: sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(id), options: sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(id), quotation: sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(id) });
  return { sqlite, db, load, id, version, content, options, product, mutations, batches, request, stored,
    race(hook) { beforeBatch = hook; }, findRace(hook) { beforeFind = hook; findCalls = 0; }, close() { sqlite.close(); } };
}
