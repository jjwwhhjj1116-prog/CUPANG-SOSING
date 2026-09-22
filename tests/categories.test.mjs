import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { deflateRawSync } from 'node:zlib';

function load(file, overrides = {}, mode = 'development') {
  const output = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Response, Request, File, Blob, FormData, TextDecoder, DecompressionStream, crypto, URL, process: { env: { NODE_ENV: mode } }, require: name => {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/category-profiles') return load('app/category-profiles.ts');
    if (name === '@/app/request-body') return load('app/request-body.ts');
    if (name === '@/app/xlsx-template') return load('app/xlsx-template.ts');
    if (name === '@/db/category-templates') return { TemplateValidationError: class extends Error {}, validateStoredTemplate: async () => {} };
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    throw Error(name);
  } });
  return exports;
}
const model = load('app/category-profiles.ts');
const draft = { name: '테스트 초안', categoryId: '', categoryPath: ['테스트', '견적 검증용'], template: null, mappings: [] };
const mapped = { ...draft, categoryId: 'synthetic-category', template: { name: 'synthetic-template.csv', format: 'csv', sha256: 'a'.repeat(64), sheetName: '', headerRow: 1, headers: ['상품명', '공급가', '카테고리', '필수 확인값'] }, mappings: [{ column: 0, field: 'title', required: true }, { column: 1, field: 'supplyPrice', required: true }, { column: 2, field: 'categoryId', required: true }, { column: 3, field: 'constant', constant: '', required: true }] };
const request = (body, method = 'POST') => new Request('http://localhost/api/category-profiles', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function streamedRequest(chunks, headers, method = 'POST') {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream({ pull(controller) { if (state.pulled === chunks.length) controller.close(); else controller.enqueue(chunks[state.pulled++]); }, cancel() { state.cancelled = true; } });
  return { state, request: new Request('http://localhost/api/category-profiles', { method, headers, body: stream, duplex: 'half' }) };
}

test('category drafts require an explicit category path and never accept forged verification', () => {
  assert.equal(model.validateCategoryProfile(draft).categoryPath.length, 2);
  for (const change of [{ name: '' }, { categoryPath: [] }, { categoryPath: [''] }, { categoryPath: Array(11).fill('too deep') }, { verification: 'verified' }, { categoryId: 123 }, { mappings: [{ column: 0, field: 'title', required: true }] }]) assert.throws(() => model.validateCategoryProfile({ ...draft, ...change }));
  assert.equal(model.categoryProfileIssues(draft).length, 2);
  assert.equal(model.categoryProfileIssues(mapped).length, 0);
});

function makeZip(entries, compressed = false) {
  let offset = 0; const locals = []; const directory = [];
  for (const [path, value] of entries) {
    const name = Buffer.from(path); const content = Buffer.from(value); const packed = compressed ? deflateRawSync(content) : content;
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(compressed ? 8 : 0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(compressed ? 8 : 0, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, name); offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const data = Buffer.concat([...locals, dir, end]); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
const workbookEntries = () => [
  ['[Content_Types].xml', '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" PartName="/xl/workbook.xml"/></Types>'],
  ['_rels/.rels', '<Relationships><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml', '<workbook xmlns:r="relationships"><sheets><sheet name="견적서" r:id="sheet1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
  ['xl/sharedStrings.xml', '<sst><si><t>상품명</t></si><si><r><t>공급</t></r><r><t>가</t></r></si></sst>'],
  ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="3"><c r="A3" t="s"><v>0</v></c><c r="C3" t="s"><v>1</v></c><c r="D3" t="inlineStr"><is><t>옵션 &amp; 규격</t></is></c><c r="E3"><f>2+2</f><v>4</v></c></row><row r="13"><c r="B13" t="inlineStr"><is><t>다른 머리글</t></is></c></row></sheetData><mergeCells/><dataValidations/></worksheet>'],
];

test('XLSX reads stored and deflated workbooks, shared/inline rich strings, sparse cells and selected header rows', async () => {
  const reader = load('app/xlsx-template.ts');
  for (const compressed of [false, true]) {
    const result = await reader.inspectXlsx(makeZip(workbookEntries(), compressed));
    assert.equal(result.sheets[0].name, '견적서');
    assert.deepEqual(Array.from(reader.xlsxHeaders(result, '견적서', 3)), ['상품명', '', '공급가', '옵션 & 규격', '']);
    assert.deepEqual(Array.from(reader.xlsxHeaders(result, '견적서', 13)), ['', '다른 머리글']);
    assert.equal(result.warnings.length, 3); assert.throws(() => reader.xlsxHeaders(result, '견적서', 1));
  }
});

test('XLSX rejects CRC tampering, traversal, duplicate ZIP files, external sheet relationships, DTDs and invalid cells', async () => {
  const reader = load('app/xlsx-template.ts');
  const invalid = [
    [...workbookEntries(), ['../escape.xml', 'test']],
    [...workbookEntries(), workbookEntries()[0]],
    workbookEntries().map(([path, value]) => [path, path === 'xl/_rels/workbook.xml.rels' ? value.replace('Target="worksheets/sheet1.xml"', 'Target="https://example.com/sheet.xml" TargetMode="External"') : value]),
    workbookEntries().map(([path, value]) => [path, path === 'xl/sharedStrings.xml' ? '<!DOCTYPE sst [<!ENTITY x SYSTEM "file:///private">]>' + value : value]),
    workbookEntries().map(([path, value]) => [path, path === 'xl/worksheets/sheet1.xml' ? value.replace('r="A3"', 'r="A4"') : value]),
  ];
  for (const entries of invalid) await assert.rejects(reader.inspectXlsx(makeZip(entries)));
  const corrupted = new Uint8Array(makeZip(workbookEntries())); corrupted[60] ^= 1;
  await assert.rejects(reader.inspectXlsx(corrupted.buffer));
  await assert.rejects(reader.inspectXlsx(new Uint8Array(5_000_001).buffer));
});

test('template storage validates actual file headers and disallows foreign or forged original files', async () => {
  const bytes = new TextEncoder().encode('상품名,供給価\n').buffer;
  const template = { ...mapped.template, headers: ['商品名', '供給価'], storageKey: `owner/category-templates/${mapped.template.sha256}.csv` };
  const makeStore = metadata => load('db/category-templates.ts', { 'cloudflare:workers': { env: { FILES: { get: async () => ({ customMetadata: metadata, arrayBuffer: async () => bytes }) } } } });
  const storage = makeStore({ sha256: mapped.template.sha256, format: 'csv' });
  assert.equal(storage.ownsTemplateKey('owner', template.storageKey), true);
  assert.equal(storage.ownsTemplateKey('other', template.storageKey), false);
  await assert.rejects(storage.validateStoredTemplate('other', template));
  await assert.rejects(storage.validateStoredTemplate('owner', template));
  await storage.validateStoredTemplate('owner', { ...template, headers: ['상품名', '供給価'] });
  await assert.rejects(makeStore({ sha256: 'forged', format: 'csv' }).validateStoredTemplate('owner', template));
});

test('template API stores original workbook bytes, keeps the hash and blocks cross-owner retrieval', async () => {
  const objects = new Map();
  const bucket = {
    async put(key, bytes, options) { objects.set(key, { ...options, body: bytes, arrayBuffer: async () => bytes }); },
    async get(key) { return objects.get(key) ?? null; },
  };
  const environment = { 'cloudflare:workers': { env: { FILES: bucket } } };
  const storage = load('db/category-templates.ts', environment);
  const dependencies = { ...environment, '@/db/category-templates': storage };
  const route = load('app/api/category-profiles/template/route.ts', dependencies);
  const bytes = makeZip(workbookEntries(), true);
  const form = new FormData(); form.set('file', new File([bytes], 'synthetic.xlsx'));
  const response = await route.POST(new Request('http://localhost/api/category-profiles/template', { method: 'POST', body: form }));
  assert.equal(response.status, 201);
  const { template } = await response.json();
  assert.match(template.storageKey, /^owner\/category-templates\/[a-f0-9]{64}\.xlsx$/);
  assert.equal(template.sha256, Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join(''));
  const download = await route.GET(new Request(`http://localhost/api/category-profiles/template?key=${encodeURIComponent(template.storageKey)}`));
  assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(bytes));
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  const foreign = await route.GET(new Request(`http://localhost/api/category-profiles/template?key=${encodeURIComponent(template.storageKey.replace('owner/', 'other/'))}`));
  assert.equal(foreign.status, 404);
  const invalid = new FormData(); invalid.set('file', new File(['not an excel'], 'broken.xlsx'));
  assert.equal((await route.POST(new Request('http://localhost', { method: 'POST', body: invalid }))).status, 400);
  const production = load('app/api/category-profiles/template/route.ts', dependencies, 'production');
  assert.equal((await production.GET(new Request('http://localhost'))).status, 503);
  assert.equal((await production.POST(new Request('http://localhost', { method: 'POST' }))).status, 503);
});

test('template upload caps actual streamed bytes without a length header and rejects unexpected multipart fields', async () => {
  let stored = 0;
  const environment = { 'cloudflare:workers': { env: { FILES: { put: async () => { stored++; } } } } };
  const route = load('app/api/category-profiles/template/route.ts', { ...environment, '@/db/category-templates': load('db/category-templates.ts', environment) });
  const headers = { 'content-type': 'multipart/form-data; boundary=synthetic-boundary' };
  const chunks = Array.from({ length: 100 }, () => new Uint8Array(64 * 1024));
  for (const additional of [{}, { 'content-length': '1' }]) {
    const streamed = streamedRequest(chunks, { ...headers, ...additional });
    const response = await route.POST(streamed.request);
    assert.equal(response.status, 413); assert.equal(streamed.state.cancelled, true); assert.ok(streamed.state.pulled < chunks.length);
  }
  for (const field of ['extra-text', 'extra-file', 'duplicate-file']) {
    const form = new FormData(); form.append('file', new File(['상품명,공급가\n'], 'synthetic.csv'));
    if (field === 'extra-text') form.append('description', 'unexpected');
    else form.append(field === 'duplicate-file' ? 'file' : 'other', new File(['상품명\n'], 'other.csv'));
    assert.equal((await route.POST(new Request('http://localhost', { method: 'POST', body: form }))).status, 400);
  }
  const large = new FormData(); large.set('file', new File([new Uint8Array(5_000_001)], 'oversized.csv'));
  assert.equal((await route.POST(new Request('http://localhost', { method: 'POST', body: large }))).status, 413);
  assert.equal(stored, 0);
  const valid = new FormData(); valid.set('file', new File(['상품명,공급가\n'], 'synthetic.csv'));
  const encoded = new Request('http://localhost', { method: 'POST', body: valid });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const streamed = streamedRequest([bytes.slice(0, 17), bytes.slice(17, 81), bytes.slice(81)], { 'content-type': encoded.headers.get('content-type') });
  assert.equal(streamed.request.headers.has('content-length'), false);
  assert.equal((await route.POST(streamed.request)).status, 201); assert.equal(stored, 1);
});

test('mapping rejects duplicate/out of range columns, invalid source fields and oversized metadata', () => {
  for (const change of [
    { mappings: [...mapped.mappings, mapped.mappings[0]] },
    { mappings: [{ column: 4, field: 'title', required: true }] },
    { mappings: [{ column: '0', field: 'title', required: true }] },
    { mappings: [{ column: 0, field: 'toString', required: true }] },
    { mappings: [{ column: 0, field: 'title', required: 'true' }] },
    { template: { ...mapped.template, sha256: 'unverified' } },
    { template: { ...mapped.template, headers: Array(201).fill('column') } },
    { template: { ...mapped.template, headerRow: 0 } },
  ]) assert.throws(() => model.validateCategoryProfile({ ...mapped, ...change }));
  const validated = model.validateCategoryProfile({ ...mapped, mappings: [{ column: 0, field: 'title', required: false, constant: 'discard' }] });
  assert.equal(validated.mappings[0].constant, undefined);
});

test('CSV template parser respects quoted commas, escaped quotes, embedded newlines and BOM', () => {
  assert.deepEqual(Array.from(model.parseTemplateText('\uFEFF"상품, 이름","설명 ""인용""","여러\n줄"\r\n내용,내용,내용', ',')), ['상품, 이름', '설명 "인용"', '여러\n줄']);
  assert.deepEqual(Array.from(model.parseTemplateText('메모\n상품\t공급가\t옵션\n샘플\t1000\t검정', '\t', 2)), ['상품', '공급가', '옵션']);
  assert.throws(() => model.parseTemplateText('"닫히지 않음', ','));
  assert.throws(() => model.parseTemplateText('"닫힘"뒤 문자,다음', ','));
  assert.throws(() => model.parseTemplateText('열1,열2', ',', 2));
  assert.throws(() => model.parseTemplateText(Array(201).fill('column').join(','), ','));
});

test('quotation rows preserve template column positions and report missing required data without guessing', () => {
  const result = model.mapQuotationRow(mapped, { title: '테스트 상품', supplyPrice: 0, categoryId: 'forged-other-category' });
  assert.deepEqual(Array.from(result.values), ['테스트 상품', 0, 'synthetic-category', '']);
  assert.deepEqual(Array.from(result.missing), ['4열 필수 확인값']);
  assert.equal(model.mapQuotationRow(mapped, { title: ' ', supplyPrice: 100 }).missing.length, 2);
  assert.throws(() => model.mapQuotationRow(mapped, { supplyPrice: NaN }));
  assert.throws(() => model.mapQuotationRow(draft, {}));
});

test('category API fails closed in production and rejects malformed input before persistence', async () => {
  const production = load('app/api/category-profiles/route.ts', { '@/db/category-profiles': {} }, 'production');
  for (const response of [await production.GET(), await production.POST(request(draft)), await production.PUT(request({}))]) assert.equal(response.status, 503);
  const route = load('app/api/category-profiles/route.ts', { '@/db/category-profiles': {} });
  assert.equal((await route.POST(request({ ...draft, verification: 'verified' }))).status, 400);
  assert.equal((await route.POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status, 400);
  assert.equal((await route.POST(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(300001) }))).status, 413);
  assert.equal((await route.PUT(request({ id: 'id', expectedRevision: 0, profile: draft }))).status, 400);
});

test('category JSON limits actual UTF-8 bytes for streamed POST and PUT before persistence', async () => {
  let stored = 0;
  const route = load('app/api/category-profiles/route.ts', { '@/db/category-profiles': {
    createCategoryProfile: async (_owner, input) => { stored++; return { ...input, id: 'created', revision: 1 }; },
    getCategoryProfile: async () => { stored++; return draft; },
  } });
  // Every individual field is valid; aggregate Korean UTF-8 bytes exceed 300KB while character count does not.
  const headers = Array.from({ length: 30 }, (_, index) => `필수열${index}`);
  const profile = { ...mapped, template: { ...mapped.template, headers }, mappings: headers.map((_value, column) => ({ column, field: 'constant', required: false, constant: '한'.repeat(3500) })) };
  for (const method of ['POST', 'PUT']) {
    const serialized = JSON.stringify(method === 'POST' ? profile : { id: 'created', expectedRevision: 1, profile });
    assert.ok(serialized.length < model.CATEGORY_PROFILE_BODY_LIMIT);
    const bytes = new TextEncoder().encode(serialized); assert.ok(bytes.byteLength > model.CATEGORY_PROFILE_BODY_LIMIT);
    const chunks = []; for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(bytes.slice(offset, offset + 8192));
    const streamed = streamedRequest(chunks, { 'content-type': 'application/json' }, method);
    assert.equal(streamed.request.headers.has('content-length'), false);
    assert.equal((await route[method](streamed.request)).status, 413); assert.equal(streamed.state.cancelled, true);
  }
  assert.equal(stored, 0);
  const bytes = new TextEncoder().encode(JSON.stringify(draft));
  const valid = streamedRequest([bytes.slice(0, 15), bytes.slice(15, 16), bytes.slice(16)], { 'content-type': 'application/json' });
  assert.equal((await route.POST(valid.request)).status, 201); assert.equal(stored, 1);
});

test('category API exposes persisted records, owner scoping, conflicts, and storage errors honestly', async () => {
  const record = { ...draft, id: 'test-id', revision: 1, verification: 'draft', createdAt: 'test', updatedAt: 'test' };
  const route = load('app/api/category-profiles/route.ts', { '@/db/category-profiles': {
    listCategoryProfiles: async owner => { assert.equal(owner, 'owner'); return [record]; },
    createCategoryProfile: async (owner, input) => { assert.equal(owner, 'owner'); assert.equal(input.name, draft.name); return record; },
    getCategoryProfile: async () => record,
    updateCategoryProfile: async () => null,
  } });
  const created = await route.POST(request(draft));
  assert.equal(created.status, 201); assert.equal((await created.json()).profile.verification, 'draft');
  assert.equal((await (await route.GET()).json()).profiles.length, 1);
  assert.equal((await route.PUT(request({ id: 'test-id', expectedRevision: 1, profile: draft }))).status, 409);
  const missing = load('app/api/category-profiles/route.ts', { '@/db/category-profiles': { getCategoryProfile: async () => null } });
  assert.equal((await missing.PUT(request({ id: 'test-id', expectedRevision: 1, profile: draft }))).status, 404);
  const failed = load('app/api/category-profiles/route.ts', { '@/db/category-profiles': { createCategoryProfile: async () => { throw Error('secret internal detail'); } } });
  const result = await failed.POST(request(draft)); assert.equal(result.status, 503); assert.ok(!(await result.text()).includes('secret internal detail'));
});

test('real SQLite category revisions reject stale writers and cannot expose or modify another owner', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const db = { prepare(sql) { let args = []; const query = { bind(...values) { args = values; return query; }, execute() { return sqlite.prepare(sql).all(...args); }, async all() { return { results: query.execute() }; }, async first() { return query.execute()[0] ?? null; } }; return query; }, async batch(queries) { return queries.map(query => ({ results: query.execute() })); } };
  const storage = load('db/category-profiles.ts', { 'cloudflare:workers': { env: { DB: db } } });
  try {
    const created = await storage.createCategoryProfile('owner', draft);
    assert.equal(created.revision, 1); assert.equal(created.verification, 'draft');
    assert.equal(await storage.getCategoryProfile('other', created.id), null);
    assert.equal((await storage.listCategoryProfiles('other')).length, 0);
    assert.equal(await storage.updateCategoryProfile('other', created.id, 1, mapped), null);
    const updated = await storage.updateCategoryProfile('owner', created.id, 1, mapped);
    assert.equal(updated.revision, 2); assert.equal(updated.categoryId, 'synthetic-category');
    assert.equal(await storage.updateCategoryProfile('owner', created.id, 1, draft), null);
    const persisted = await storage.getCategoryProfile('owner', created.id);
    assert.equal(persisted.revision, 2); assert.equal(persisted.template.sha256, mapped.template.sha256);
    assert.equal((await storage.listCategoryProfiles('owner')).length, 1);
  } finally { sqlite.close(); }
});
