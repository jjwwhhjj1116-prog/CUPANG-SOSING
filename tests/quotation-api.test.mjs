import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto, createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';

function load(file, overrides = {}, mode = 'development', cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const output = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(output, { exports, Error, Response, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, structuredClone, Blob, CompressionStream, DecompressionStream, crypto: webcrypto,
    process: { env: { NODE_ENV: mode } }, require(name) {
      if (name in overrides) return overrides[name];
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, overrides, mode, cache);
      throw Error(name);
    } });
  return exports;
}
const contentModel = load('app/product-content.ts'); const optionsModel = load('app/product-options.ts');
const { quotationData } = load('app/exports/quotation-data.ts');
const { defaultSettings } = load('app/workspace-settings.ts');
const policy = { exchangeRate: 100, supplyMargin: 0, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 10 };
const product = { id: 'test', owner_id: 'owner', title: '원문 상품', source_url: 'synthetic://test', source_price_cny: 999, supply_price: 99900, sale_price: 99900, msrp: 99900,
  pricing_policy: JSON.stringify(policy), exchange_rate: 190, supply_margin: 40, coupang_margin: 35, options_count: 2, image_keys: '["owner/option.png"]', updated_at: '2026-09-22T00:00:00.000Z' };
const content = contentModel.applyContentPatch(contentModel.emptyProductContent('test'), { seo: { title: '=SUM(1,1)', description: '설명' } }, product.updated_at);
const optionRows = [
  { ...optionsModel.emptyOptionInput('first'), originalName: '原文', translatedName: '첫 번째', supplierSku: 'SKU-1', unitCostCny: 0.001, unitsPerPack: 3, included: true, imageKey: 'owner/option.png' },
  { ...optionsModel.emptyOptionInput('second'), originalName: '第二', supplierSku: 'SKU-2', unitCostCny: 0.1, unitsPerPack: 3, included: true },
  { ...optionsModel.emptyOptionInput('excluded'), originalName: '제외됨', unitCostCny: null },
];
const options = optionsModel.applyOptionRows(optionsModel.emptyProductOptions('test'), optionRows, product.updated_at);
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const templateBytes = new TextEncoder().encode('상품명,옵션명,공급가,이미지\r\n');
const sha = createHash('sha256').update(templateBytes).digest('hex'); const templateKey = `owner/category-templates/${sha}.csv`;
const profile = { id: 'profile', revision: 1, verification: 'draft', createdAt: product.updated_at, updatedAt: product.updated_at,
  name: '시험용 양식', categoryId: 'test-category', categoryPath: ['시험'],
  template: { name: 'synthetic.csv', format: 'csv', sha256: sha, sheetName: '', headerRow: 1, headers: ['상품명', '옵션명', '공급가', '이미지'], storageKey: templateKey },
  mappings: [{ column: 0, field: 'title', required: true }, { column: 1, field: 'skuName', required: true }, { column: 2, field: 'supplyPrice', required: true }, { column: 3, field: 'mainImage', required: false }],
};
const assets = [{ key: 'owner/option.png', name: 'assets/image-001.png', data: png }];

test('quotation rows use the identical option policy/decimal cost calculation and omit excluded SKUs', () => {
  const rows = quotationData(product, content, defaultSettings, options.rows, assets);
  const calculated = optionsModel.calculateOptionPrices(optionRows, policy).filter(row => row.included);
  assert.equal(rows.length, 2); assert.equal(rows[0].skuName, '첫 번째'); assert.equal(rows[1].skuName, '第二');
  assert.equal(rows[0].sourcePriceCny, 0.003); assert.equal(rows[1].sourcePriceCny, 0.3);
  assert.equal(rows[0].supplyPrice, calculated[0].calculation.supplyPrice); assert.equal(rows[1].supplyPrice, calculated[1].calculation.supplyPrice);
  assert.equal(rows[0].mainImage, assets[0].name); assert.equal(rows[1].mainImage, '');
  assert.equal(rows[0].barcode, ''); assert.equal(rows[0].countryOfOrigin, '');
  assert.throws(() => quotationData(product, content, defaultSettings, options.rows, []), /누락/);
  assert.throws(() => quotationData(product, content, defaultSettings, [{ ...optionRows[0], included: false }], assets), /포함/);
});

test('quotation data keeps representative product price separate and does not create SKU rows when none are saved', () => {
  const rows = quotationData(product, content, defaultSettings, [], []);
  assert.equal(rows.length, 1); assert.equal(rows[0].sourcePriceCny, 999); assert.equal(rows[0].supplyPrice, product.supply_price);
  assert.equal(rows[0].skuId, undefined); assert.equal(rows[0].skuName, undefined);
});

function routeWith({ find = async () => product, readOptions = async () => options, readContent = async () => content, readProfile = async () => profile,
  readFields = async () => ({ schemaVersion: 1, productId: 'test', revision: 0, overrides: { common: {}, options: {} }, updatedAt: null }),
  readSettings = async () => null, sourcesCurrent = async () => true,
  get = async key => key === templateKey ? { size: templateBytes.length, arrayBuffer: async () => templateBytes.slice().buffer } : { size: png.length, arrayBuffer: async () => png.slice().buffer },
  mode,
} = {}) {
  return load('app/api/products/[id]/quotation/route.ts', {
    '@/db/queries': { findProduct: find, getSettings: readSettings }, '@/db/product-options': { readProductOptions: readOptions },
    '@/db/product-content': { readProductContent: readContent }, '@/db/category-profiles': { getCategoryProfile: readProfile },
    '@/db/quotation-fields': { readQuotationFields: async (...args) => { const state=await readFields(...args); const selected=await readProfile(); if (!selected) return state; return { ...state, overrides:{common:{},options:{}}, categoryOverrides:{['category:'+selected.categoryId]:state.overrides} }; }, readQuotationCollectionSource: async () => null, quotationSourcesCurrent: sourcesCurrent },
    'cloudflare:workers': { env: { FILES: { get } } },
  }, mode);
}
const request = body => new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: 'test' }) }; const preview = { action: 'preview', profileId: profile.id, dataStartRow: 2 };

test('real preview/export pipeline fills mapped CSV, includes option assets and preserves manual provenance', async () => {
  const route = routeWith(); const response = await route.POST(request(preview), context);
  assert.equal(response.status, 200); const review = await response.json();
  assert.match(review.fingerprint, /^[a-f0-9]{64}$/); assert.equal(review.report.optionRevision, 1); assert.equal(review.report.rowCount, 2);
  assert.equal(review.report.submissionReady, false); assert.equal(review.rows[0][2], 10); assert.equal(review.rows[1][2], 30);
  const exported = await route.POST(request({ ...preview, action: 'export', fingerprint: review.fingerprint }), context);
  assert.equal(exported.status, 200); assert.equal(exported.headers.get('content-type'), 'application/zip'); assert.equal(exported.headers.get('cache-control'), 'no-store');
  const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
  const csv = new TextDecoder().decode(files['quotation-filled.csv']);
  assert.ok(csv.includes('"\'=SUM(1,1)"')); assert.ok(csv.includes('"첫 번째","10","image-001.png"'));
  assert.ok(!csv.includes('제외됨')); assert.deepEqual(files['assets/image-001.png'], png);
  const exportedOptions = JSON.parse(new TextDecoder().decode(files['options.json']));
  assert.equal(exportedOptions.rows.length, 3); assert.equal(exportedOptions.rows[0].provenance.originalName, 'manual');
  assert.equal(JSON.parse(new TextDecoder().decode(files['quotation-report.json'])).submissionReady, false);
});

test('quotation export rejects stale approval fingerprints and detects edits during generation', async () => {
  let reads = 0;
  const stale = routeWith({ get: async () => { reads++; throw Error('must not load stale export'); } });
  const response = await stale.POST(request({ ...preview, action: 'export', fingerprint: '0'.repeat(64) }), context);
  assert.equal(response.status, 409); assert.equal(reads, 0);
  let calls = 0;
  const changing = routeWith({ readOptions: async () => ({ ...options, revision: ++calls }) });
  assert.equal((await changing.POST(request(preview), context)).status, 409);
});

test('quotation API enforces owner/template links, missing object errors and SHA-256 of the real original bytes', async () => {
  for (const [overrides, expected] of [
    [{ find: async () => null }, 404], [{ readProfile: async () => null }, 404],
    [{ readProfile: async () => ({ ...profile, template: { ...profile.template, storageKey: `other/category-templates/${sha}.csv` } }) }, 409],
    [{ get: async () => null }, 409],
    [{ get: async key => key === templateKey ? { size: 5_000_001 } : { size: png.length, arrayBuffer: async () => png.slice().buffer } }, 413],
    [{ get: async key => key === templateKey ? { size: 3, arrayBuffer: async () => new TextEncoder().encode('bad').buffer } : { size: png.length, arrayBuffer: async () => png.slice().buffer } }, 400],
  ]) assert.equal((await routeWith(overrides).POST(request(preview), context)).status, expected);
  const foreignOptions = { ...options, rows: [{ ...options.rows[0], imageKey: 'other/private.png' }] };
  assert.equal((await routeWith({ readOptions: async () => foreignOptions }).POST(request(preview), context)).status, 409);
});

test('quotation API validates action/start rows/size and is closed in production', async () => {
  for (const body of [null, {}, { ...preview, dataStartRow: 1 }, { ...preview, dataStartRow: 2.5 }, { ...preview, action: 'submit' }, { ...preview, action: 'export' }]) {
    assert.equal((await routeWith().POST(request(body), context)).status, 400);
  }
  assert.equal((await routeWith().POST(request({ padding: 'a'.repeat(5000) }), context)).status, 413);
  const production = routeWith({ mode: 'production', find: async () => { throw Error('must not query storage'); } });
  assert.equal((await production.POST(request(preview), context)).status, 503);
  const failed = await routeWith({ find: async () => { throw Error('private SQL data'); } }).POST(request(preview), context);
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private SQL'));
});


test('saved common/option overrides populate mapped cells and preserve blanks, inactive fields and exact image filenames', async () => {
  const state = { schemaVersion: 1, productId: 'test', revision: 4, updatedAt: product.updated_at,
    overrides: { common: { title: '견적 전용 이름', model: 'MODEL-007', boxSkuQuantity: '12', noticeMaterial: '확인한 재질', barcode: '00123456', searchTags: '수동태그', mainImage: 'owner/manual.png', retiredField: '다른 분류에서 작성' },
      options: { first: { title: '', supplyPrice: '12345', noticeMaterial: '첫 옵션 재질' }, excluded: { model: '제외 옵션 수정' }, deleted: { color: '삭제 옵션 수정' } } } };
  const bytes = new TextEncoder().encode('상품명,공급가,박스수량,재질,모델명,이미지,바코드\r\n');
  const digest = createHash('sha256').update(bytes).digest('hex'); const key = `owner/category-templates/${digest}.csv`;
  const advanced = { ...profile, categoryId: '80719', categoryPath: ['주방용품'], template: { ...profile.template, sha256: digest, headers: ['상품명','공급가','박스수량','재질','모델명','이미지','바코드'], storageKey: key },
    mappings: ['title','supplyPrice','boxQuantity','material','model','mainImage','barcode'].map((field,column) => ({ field,column,required:false })) };
  const requested = [];
  const route = routeWith({ find: async () => ({ ...product, image_keys: '["owner/option.png","owner/manual.png"]' }), readFields: async () => state, readProfile: async () => advanced,
    get: async path => { requested.push(path); const data = path === key ? bytes : png; return { size: data.length, arrayBuffer: async () => data.slice().buffer }; },
  });
  const reviewResponse = await route.POST(request(preview),context); assert.equal(reviewResponse.status,200); const review = await reviewResponse.json();
  assert.deepEqual(review.rows[0], ['',12345,12,'첫 옵션 재질','MODEL-007','image-002.png','00123456']);
  assert.equal(review.rows[1][0],'견적 전용 이름'); assert.equal(review.rows[1][3],'확인한 재질');
  assert.equal(review.report.quotationRevision,4); assert.ok(review.report.warnings.some(value=>value.includes('검색태그')&&value.includes('미연결')));
  assert.ok(requested.includes('owner/manual.png')); assert.ok(review.report.warnings.some(value=>value.includes('retiredField')));
  const response = await route.POST(request({...preview, action:'export', fingerprint:review.fingerprint}),context); assert.equal(response.status,200);
  const files=unzipSync(new Uint8Array(await response.arrayBuffer())); const decode=value=>new TextDecoder().decode(value);
  const doc=JSON.parse(decode(files['quotation-fields.json'])); assert.equal(doc.submissionReady,false); assert.equal(doc.categoryContext.categoryId,'80719');
  assert.equal(doc.rows.filter(row=>row.included).length,2); assert.equal(doc.rows.find(row=>row.optionId==='first').fields.title.source,'manual-option');
  assert.equal(doc.overrides.options.deleted.color,'삭제 옵션 수정'); assert.equal(doc.assets['owner/manual.png'],'assets/image-002.png'); assert.equal(doc.uploadFilenames['owner/manual.png'],'image-002.png');
  assert.ok(decode(files['quotation-filled.csv']).includes('"","12345","12","첫 옵션 재질","MODEL-007","image-002.png","00123456"'));
  assert.ok(decode(files['quotation-fields.csv']).includes('"product","2. Product Page · 상품 페이지","model"'));
  assert.ok(decode(files['quotation-overrides.csv']).includes('삭제 옵션 수정')); assert.ok(decode(files['quotation-overrides.csv']).includes('제외 옵션 수정')); assert.ok(decode(files['quotation-overrides.csv']).includes('다른 분류에서 작성'));
  assert.deepEqual(files['assets/image-002.png'],png); assert.ok(files['product-snapshot.csv']); assert.ok(!files['quotation-review.csv']);
});

test('quotation preview fingerprint binds override state, settings, selected profile and stable source reads', async () => {
  const state={schemaVersion:1,productId:'test',revision:1,overrides:{common:{title:'검토한 값'},options:{}},updatedAt:product.updated_at};
  let current=state, storageReads=0;
  const route=routeWith({readFields:async()=>current,get:async key=>{storageReads++; const bytes=key===templateKey?templateBytes:png;return{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer};}});
  const review=await (await route.POST(request(preview),context)).json(); const before=storageReads;
  current={...state,revision:2,overrides:{common:{title:'검토한 값',model:'수정'},options:{}}};
  assert.equal((await route.POST(request({...preview,action:'export',fingerprint:review.fingerprint}),context)).status,409); assert.equal(storageReads,before);
  for(const changed of ['fields','settings','profile']) {
    let downloaded=false;
    const modifying=routeWith({readFields:async()=>downloaded&&changed==='fields'?current:state,
      readSettings:async()=>downloaded&&changed==='settings'?{payload:JSON.stringify({...defaultSettings,brand:'수정 브랜드'})}:null,
      readProfile:async()=>({...profile,revision:downloaded&&changed==='profile'?2:1}),
      get:async key=>{downloaded=true;const bytes=key===templateKey?templateBytes:png;return{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer};},
    });
    assert.equal((await modifying.POST(request(preview),context)).status,409,changed);
  }
  assert.equal((await routeWith({sourcesCurrent:async()=>false,get:async()=>{throw Error('no R2 read for mixed source snapshot');}}).POST(request(preview),context)).status,409);
});

test('manual image overrides cannot export foreign or phantom keys even when stored JSON is stale',async()=>{
  for(const key of ['other/private.png','owner/missing.png']) {
    const route=routeWith({readFields:async()=>({schemaVersion:1,productId:'test',revision:1,updatedAt:null,overrides:{common:{mainImage:key},options:{}}}),get:async()=>{throw Error('must not fetch unowned images');}});
    assert.equal((await route.POST(request(preview),context)).status,409);
  }
});

test('real XLSX pipeline writes final override values, identifiers and attachment basenames into preserved template',async()=>{
  const encode=value=>new TextEncoder().encode(value);
  const bytes=zipSync({
    '[Content_Types].xml':encode('<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
    '_rels/.rels':encode('<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml':encode('<workbook xmlns:r="relationship"><sheets><sheet name="견적" r:id="one"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels':encode('<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml':encode('<worksheet><dimension ref="A1:D2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>상품명</t></is></c><c r="B1" t="inlineStr"><is><t>모델명</t></is></c><c r="C1" t="inlineStr"><is><t>바코드</t></is></c><c r="D1" t="inlineStr"><is><t>이미지</t></is></c></row><row r="2"><c r="E2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'),
  },{level:0});
  const digest=createHash('sha256').update(bytes).digest('hex');const key=`owner/category-templates/${digest}.xlsx`;
  const advanced={...profile,categoryId:'80719',template:{...profile.template,format:'xlsx',sheetName:'견적',name:'fixture.xlsx',sha256:digest,storageKey:key,headers:['상품명','모델명','바코드','이미지']},
    mappings:['title','model','barcode','mainImage'].map((field,column)=>({field,column,required:false}))};
  const route=routeWith({readProfile:async()=>advanced,readFields:async()=>({schemaVersion:1,productId:'test',revision:1,updatedAt:null,overrides:{common:{model:'수동 모델',barcode:'00001234'},options:{first:{title:'첫 옵션 견적명'}}}}),
    get:async path=>{const data=path===key?bytes:png;return{size:data.length,arrayBuffer:async()=>data.slice().buffer};},
  });
  const reviewResponse=await route.POST(request(preview),context);assert.equal(reviewResponse.status,200);const review=await reviewResponse.json();
  const response=await route.POST(request({...preview,action:'export',fingerprint:review.fingerprint}),context);assert.equal(response.status,200);
  const files=unzipSync(new Uint8Array(await response.arrayBuffer()));const workbook=unzipSync(files['quotation-filled.xlsx']);const sheet=new TextDecoder().decode(workbook['xl/worksheets/sheet1.xml']);
  assert.ok(sheet.includes('첫 옵션 견적명'));assert.ok(sheet.includes('수동 모델'));assert.ok(sheet.includes('<c r="C2" t="inlineStr"><is><t xml:space="preserve">00001234</t>'));
  assert.ok(sheet.includes('image-001.png'));assert.ok(!sheet.includes('assets/image-001.png'));assert.ok(sheet.includes('<c r="E2"><f>1+1</f><v>2</v></c>'));
  assert.deepEqual(workbook['xl/workbook.xml'],unzipSync(bytes)['xl/workbook.xml']);assert.deepEqual(files['assets/image-001.png'],png);
});

test('advanced Excel mapping contains every observed/common field without claiming unknown category compatibility',()=>{
  const {categoryFields,validateCategoryProfile}=load('app/category-profiles.ts'); const {getQuotationSchema}=load('app/quotation-schema.ts');
  for(const field of getQuotationSchema('80719').fields)assert.ok(Object.hasOwn(categoryFields,field.id),field.id);
  const raw={...profile,mappings:[{column:0,field:'packagedDimensionsMm',required:false},{column:1,field:'noticeNameModel',required:false}]};
  assert.equal(validateCategoryProfile(raw).mappings[0].field,'packagedDimensionsMm');
  assert.equal(getQuotationSchema('not-observed').status,'unconfirmed');assert.ok(!getQuotationSchema('not-observed').fields.some(field=>field.id==='noticeNameModel'));
});

test('large common HTML fails with explicit 413 before full quotation JSON/CSV expansion and excluded rows stop contributing',async()=>{
  const rows=Array.from({length:200},(_,i)=>({...options.rows[0],id:`many-${i}`,imageKey:null}));
  const state={schemaVersion:1,productId:'test',revision:1,updatedAt:null,overrides:{common:{detailHtml:'x'.repeat(150000)},options:{}}};
  const huge=routeWith({readOptions:async()=>({...options,rows}),readFields:async()=>state});
  const rejected=await huge.POST(request(preview),context);assert.equal(rejected.status,413);assert.match((await rejected.json()).error,/6MB/);
  const bounded=routeWith({readOptions:async()=>({...options,rows:rows.map((row,index)=>({...row,included:index===0}))}),readFields:async()=>state});
  const response=await bounded.POST(request(preview),context);assert.equal(response.status,200);const review=await response.json();assert.equal(review.report.rowCount,1);
});
