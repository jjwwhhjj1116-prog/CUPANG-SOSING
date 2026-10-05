import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readAppSupplierHubCatalog } from '../extensions/supplier-hub/catalog.mjs';
import { verifySupplierHubCompany } from '../extensions/supplier-hub/company.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

// The observed /dashboard/KR route and company menu use real serialized page
// adapters. Category/schema/workbook/auth responses remain local fixtures.
function dashboard(company = schemaCompanies[0], change = {}) {
  const snapshot = hubSchemaSnapshot(company), bytes = quotationWorkbook(['상품명', '카테고리', '공급가']);
  const parent = {categoryId: '100', name: schemaPath[0], isLeaf: false};
  const leaf = {categoryId: snapshot.categoryId, name: schemaPath[1], isLeaf: true};
  const sender = {url: 'http://localhost:3000/', frameId: 0, tab: {id: 1, windowId: 7}};
  const tab = {id: 2, windowId: 7, url: 'https://supplier.coupang.com/dashboard/KR', status: 'complete', ...change.tab};
  const location = {origin: new URL(tab.url).origin, pathname: new URL(tab.url).pathname};
  const document = {body: {innerText: company.name + ' 대시보드'}, querySelectorAll: selector => selector === 'button' ? [button] : []};
  const clicks = [], requests = [], scripts = [], queried = [], mutations = [];
  const button = {innerText: company.name, disabled: false, getClientRects: () => [{}], click() {
    clicks.push('company-menu'); document.body.innerText += '\nCompany Code: ' + (change.actualCode ?? company.code);
  }};
  const dto = node => ({displayItemCategoryDto: {displayItemCategoryCode: node.categoryId, name: node.name}, leaf: node.isLeaf});
  let ownerId = 'owner';
  const api = {tabs: {
    get: async id => id === 1 ? {id, windowId: 7, url: sender.url} : {...tab},
    query: async query => {queried.push(query); assert.equal(query.windowId, 7); return query.url.some(pattern => tab.url.startsWith(pattern.replace(/\*$/, ''))) ? [{...tab}] : [];},
    sendMessage: async (_id, message) => {assert.equal(message.type, 'YOOFAM_READ_CATALOG_CONTEXT'); return {ok: true, ownerId, company};},
    update: async () => {mutations.push('navigate'); throw Error('Existing dashboard must remain open');},
    create: async () => {mutations.push('create'); throw Error('Dashboard reads need no extra tab');},
  }, scripting: {executeScript: async ({target, func, args}) => {
    assert.equal(target.tabId, tab.id); scripts.push(func.name);
    const result = await vm.runInNewContext(`(${func.toString()})(...args)`, {
      args, location, document, URL, Date, TextEncoder, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout,
      crypto: webcrypto, btoa: value => Buffer.from(value, 'binary').toString('base64'),
      fetch: async (url, options) => {
        requests.push({url, ...options}); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
        assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
        let response;
        if (url === 'https://supplier.coupang.com/sr/category/api/') response = Response.json([dto(parent)]);
        else if (url === 'https://supplier.coupang.com/sr/category/api/find-by-parent-category-code?categoryCode=100') response = Response.json([dto(leaf)]);
        else if (url === `https://supplier.coupang.com/sr/schema/api/get-default-schemaform?internalDisplayCode=${leaf.categoryId}&useCustomizedJsonSchema=true`) response = Response.json({schemaString: snapshot.schemaString, ...snapshot.metadata});
        else if (url === 'https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=3000&locale=ko') response = new Response(bytes, {headers: {'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
        else throw Error('Unexpected read: ' + url);
        Object.defineProperty(response, 'url', {value: url});
        change.afterRead?.({document, location, tab, requests, changeOwner: value => {ownerId = value;}});
        return response;
      },
    });
    return [{result: JSON.parse(JSON.stringify(result))}];
  }}};
  const run = (type, trail = [], rest = {}) => readAppSupplierHubCatalog({type, trail, ...rest}, sender, api);
  return {company, snapshot, parent, leaf, sender, tab, location, document, clicks, requests, scripts, queried, mutations, run};
}

for (const company of schemaCompanies) test(`logged-in dashboard alone supports category → schema → official workbook reads (${company.code})`, async () => {
  const h = dashboard(company), originalTab = {...h.tab};
  const root = await h.run('YOOFAM_READ_CATEGORY_BRANCH');
  assert.equal(root.ownerId, 'owner'); assert.deepEqual(root.children.map(node => node.categoryId), [h.parent.categoryId]);
  const selection = {categoryId: h.leaf.categoryId, name: h.leaf.name};
  const detailed = await h.run('YOOFAM_READ_CATEGORY_SCHEMA', [h.parent], {selection});
  assert.equal(detailed.schema.schemaString, h.snapshot.schemaString);
  const connected = await h.run('YOOFAM_READ_CATEGORY_TEMPLATE', [h.parent], {selection, expectedSchema: {schemaString: detailed.schema.schemaString, metadata: detailed.schema.metadata}});
  assert.deepEqual(connected.company, company); assert.equal(connected.ownerId, 'owner');
  assert.equal(connected.template.registered, false); assert.equal(connected.template.kanCategoryId, '3000');
  assert.equal(connected.template.categoryId, h.leaf.categoryId);
  assert.equal(Buffer.from(connected.template.base64, 'base64').length, connected.template.size);
  assert.equal(connected.template.sha256, Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(connected.template.base64, 'base64'))).toString('hex'));
  assert.equal(h.scripts.filter(name => name === 'verifySupplierHubCompany').length, 3);
  assert.ok(h.scripts.includes('readSupplierHubCategoryBranch')); assert.ok(h.scripts.includes('readSupplierHubSchema')); assert.ok(h.scripts.includes('readSupplierHubTemplate'));
  assert.deepEqual(h.clicks, ['company-menu']); assert.deepEqual(h.mutations, []); assert.deepEqual(h.tab, originalTab);
});

test('dashboard reads retain exact company, original window and authenticated owner checks', async () => {
  const wrongCompany = dashboard(schemaCompanies[0], {actualCode: schemaCompanies[1].code});
  await assert.rejects(wrongCompany.run('YOOFAM_READ_CATEGORY_BRANCH'), /회사/); assert.equal(wrongCompany.requests.length, 0);
  for (const tab of [{windowId: 8}, {url: 'https://supplier.coupang.com/dashboard/US'}, {url: 'https://supplier.coupang.com/dashboard'}, {url: 'https://supplier.coupang.com/login'}, {pendingUrl: 'https://supplier.coupang.com/dashboard/KR'}]) {
    const invalid = dashboard(schemaCompanies[0], {tab});
    await assert.rejects(invalid.run('YOOFAM_READ_CATEGORY_BRANCH')); assert.equal(invalid.requests.length, 0); assert.deepEqual(invalid.mutations, []);
  }
  for (const afterRead of [
    ({document}) => {document.body.innerText = 'Company Code: ' + schemaCompanies[1].code;},
    ({location}) => {location.pathname = '/login';},
    ({changeOwner}) => {changeOwner('other');},
  ]) {
    const changed = dashboard(schemaCompanies[0], {afterRead});
    await assert.rejects(changed.run('YOOFAM_READ_CATEGORY_BRANCH')); assert.equal(changed.requests.length, 1); assert.deepEqual(changed.mutations, []);
  }
});

test('catalog dashboard support never authorizes registration-purpose company checks', async () => {
  const h = dashboard();
  for (const purpose of [undefined, 'registration']) {
    await assert.rejects(vm.runInNewContext(`(${verifySupplierHubCompany.toString()})(company,purpose)`, {company: h.company, purpose, location: h.location, document: h.document, setTimeout}));
  }
  assert.deepEqual(h.clicks, []);
});
