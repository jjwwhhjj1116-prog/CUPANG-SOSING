import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { memoryDatabase, runtimeDDL } from '../../scripts/check-db-schema.mjs';
import * as rejectionDetails from '../../extensions/supplier-hub/rejection-details.mjs';
import * as pageSource from '../../extensions/supplier-hub/page-source.mjs';

const native = createRequire(import.meta.url);
export const priceTableCompanies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
export const priceTableNodes = value => Array.isArray(value) ? value.flatMap(priceTableNodes) : value && typeof value === 'object'
  ? [value, ...priceTableNodes(value.props?.children)] : [];
export const priceTableText = value => Array.isArray(value) ? value.map(priceTableText).join('') : value && typeof value === 'object'
  ? priceTableText(value.props?.children) : value == null ? '' : String(value);
const version = '2026-10-14T02:00:00.000Z';

/** Actual OptionsEditor + price table and options API/SQLite. The source URL is
 * inert synthetic data; all external requests and unrelated components fail shut. */
export async function optionPriceTableUI(company = priceTableCompanies[0], { count = 73, focusedOptionId, integrated=false,detail=false,fileStorage } = {}) {
  const sqlite = memoryDatabase(); for (const statement of runtimeDDL()) sqlite.exec(statement.sql);
  const owner = 'price-owner-' + company.code, productId = 'price-product-' + company.code;
  const apiCalls = [], writes = [], cache = new Map(), instances = new Map(), effects = [], layouts=[], focused = [],controls={};
  let currentInstance, cursor = 0, tree, saveCount = 0, closed = false, heldSave = null;
  const db = { prepare(sql) { let args = []; const statement = { bind(...values) { args = values; return statement; },
    execute() { return sqlite.prepare(sql).all(...args); }, async all() { return { results: statement.execute() }; },
    async first() { return statement.execute()[0] ?? null; }, async run() { return sqlite.prepare(sql).run(...args); } }; return statement; },
    async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map(statement => ({ results: statement.execute() })); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  const objects = new Map(), bindings = { DB: db, FILES: fileStorage ?? { head: async key => objects.has(key) ? { size: objects.get(key).length, httpMetadata: { contentType: 'image/png' } } : null } };
  const deps = { 'cloudflare:workers': { env: bindings }, 'next/server': { NextResponse: Response },
    '@/extensions/supplier-hub/page-source.mjs':pageSource,'../extensions/supplier-hub/page-source.mjs':pageSource,
    '@/app/chatgpt-auth': { getWorkspaceOwnerId: async () => owner, getChatGPTUser: async () => ({ verifiedAccess: true, userId: owner,
      membership: { status: 'approved', companyCode: company.code, companyName: company.name } }) },
    '@/db/collection-images': { readOptionSourceImages: async () => ({}),readRegistrationSourceImages:async()=>({}) } };
  const hooks = {
    useState(initial) { const index = cursor++, instance = currentInstance; if (!(index in instance.slots)) instance.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [instance.slots[index].value, value => { if (closed) return; instance.slots[index].value = typeof value === 'function' ? value(instance.slots[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; return currentInstance.slots[index] ?? (currentInstance.slots[index] = { current: initial }); },
    useMemo(fn, deps) { const index = cursor++, before = currentInstance.slots[index]; if (!before || deps.some((value, i) => !Object.is(value, before.deps[i]))) currentInstance.slots[index] = { value: fn(), deps }; return currentInstance.slots[index].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(effect, deps) { const index = cursor++, instance = currentInstance, before = instance.slots[index];
      if (!before || deps.some((value, i) => !Object.is(value, before.deps[i]))) { instance.slots[index] = { deps, cleanup: before?.cleanup };
        effects.push(() => { instance.slots[index].cleanup?.(); instance.slots[index].cleanup = effect(); }); } },
    useLayoutEffect(effect,deps){const index=cursor++,instance=currentInstance,before=instance.slots[index];if(!before||deps.some((value,i)=>!Object.is(value,before.deps[i]))){instance.slots[index]={deps,cleanup:before?.cleanup};layouts.push(()=>{instance.slots[index].cleanup?.();instance.slots[index].cleanup=effect();});}},
  };
  async function request(url, init = {}) {
    const parsed=new URL(url,'https://app.test'),kind=parsed.pathname.split('/').at(-1);assert.ok(['options',...(integrated?['quotation-fields','pricing','option-bundles','stage-two-pricing']:[]),...(fileStorage?['content','quotation']:[])].includes(kind));assert.equal(parsed.pathname,'/api/products/'+productId+'/'+kind);
    const method = init.method ?? 'GET'; apiCalls.push({ url, method,signal:init.signal });
    if (method !== 'GET') { const body = JSON.parse(init.body); writes.push({...body,method,kind}); if (heldSave) { heldSave.arrived(); await heldSave.promise; heldSave = null; } }
    await controls.before?.(url,init);
    const response=await load('app/api/products/[id]/'+kind+'/route.ts')[method](new Request('https://app.test' + url,
      { method, headers: { 'content-type': 'application/json' }, ...(method !=='GET' ? { body: init.body } : {}) }), { params: Promise.resolve({ id: productId }) });
    return controls.response?controls.response(url,init,response):response;
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    const source = fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8')+(detail&&file==='app/components/dashboard-client.tsx'?'\nexport {DetailPanel};':'');
    vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, Error, RangeError, Date, URL, URLSearchParams, Response, Request, Headers, Blob, TextEncoder, TextDecoder,
      Uint8Array, DataView, AbortController, structuredClone, crypto: webcrypto, process: { env: { NODE_ENV: 'production' } },...(fileStorage?{File,FormData,CompressionStream,DecompressionStream}:{}),
      fetch: request, require(name) {
        if(name==='../extensions/supplier-hub/rejection-details.mjs'||name==='@/extensions/supplier-hub/rejection-details.mjs')return rejectionDetails;
        if (name in deps) return deps[name]; if (name === 'react') return hooks;
        if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
        if (name.endsWith('.css')) return {};
        if (name.startsWith('@/app/components/') && !['@/app/components/product-options-editor', '@/app/components/option-price-table', '@/app/components/price-selection-dialog',...(integrated?['@/app/components/option-quotation-prices','@/app/components/stage-two-price-policy-fields']:[]),...(detail?['@/app/components/dashboard-client','@/app/components/price-editor']:[])].includes(name)) return new Proxy({}, { get: () => () => null });
        if (name.startsWith('@/')) return load(name.slice(2) + (name.includes('/components/') ? '.tsx' : '.ts'));
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
        return native(name);
      } }); return exports;
  }
  const model = load('app/product-options.ts'), policy = { exchangeRate: 350, supplyMargin: 50, coupangMargin: 40,
    minimumMargin: 3000, msrpMultiple: 1.3, roundingUnit: 10, roundingMode: 'nearest' };
  const product = { id: productId, owner_id: owner, source_url: 'https://detail.1688.com/offer/652000000001.html', title: company.name + ' 합성 가격표',
    source_price_cny: 2.99, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 4050, sale_price: 6750, msrp: 8780,
    options_count: count, seo_status: '대기', image_status: '대기', quote_status: '대기', registration_status: '미전송', supplier_hub_status: '미전송',
    image_keys: '[]', goal_stage: 'collect', created_at: version, updated_at: version };
  await load('db/queries.ts').insertProduct(product, policy);
  const rowInputs = Array.from({ length: count }, (_, index) => ({ ...model.emptyOptionInput('price-' + String(index + 1).padStart(3, '0')),
    originalName: '合成选项 ' + (index + 1), translatedName: '합성 옵션 ' + (index + 1), supplierSku: 'fixture-sku-' + (index + 1),
    unitCostCny: index % 2 ? 3.99 : 2.99, stock: index === 0 ? 0 : index === 1 ? null : 100 + index, included: true }));
  await load('db/product-options.ts').saveProductOptions(owner, model.applyOptionRows(model.emptyProductOptions(productId), rowInputs, version), 0, version);
  const protectedSnapshot = () => JSON.stringify(['collection_jobs', 'collection_results', 'collection_context', 'category_profiles', 'workspace_settings', 'product_price_policy']
    .filter(table => sqlite.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table)).map(table => [table, sqlite.prepare('SELECT * FROM ' + table).all().map(row=>table==='product_price_policy'?Object.fromEntries(Object.entries(row).filter(([key])=>key!=='updated_at')):row)]));
  const before = protectedSnapshot(), Component = detail?load('app/components/dashboard-client.tsx').DetailPanel:load('app/components/product-options-editor.tsx').ProductOptionsEditor;
  let currentProduct = product,profileId,refreshToken='0',policyLocked=false,fileBusy=false,allowCommit=true;
  function resolve(node, location = 'root') {
    if (Array.isArray(node)) return node.map((child, index) => resolve(child, location + '/' + index));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const key = location + '/' + (node.type.name || 'component') + ':' + (node.key ?? '');
      const instance = instances.get(key) ?? { slots: [] }; instances.set(key, instance);
      const old = currentInstance, oldCursor = cursor; currentInstance = instance; cursor = 0;
      const result = resolve(node.type(node.props), key); currentInstance = old; cursor = oldCursor; return result;
    }
    return { ...node, props: { ...node.props, children: resolve(node.props?.children, location + '/children') } };
  }
  const render = () => { tree = resolve({ type: Component, props: { product: currentProduct, pricingView: true, focusedOptionId,
    ...(detail?{tab:'가격',preferredProfileId:profileId,settings:{...load('app/workspace-settings.ts').defaultSettings,...policy,minimumMarginEnabled:true},
      onSavePrice:async(value,options={})=>{const response=await request('/api/products/'+productId+'/pricing',{method:'POST',body:JSON.stringify({expectedVersion:currentProduct.updated_at,policy:value,...options})});const body=await response.json();assert.equal(response.status,200,body.error);currentProduct=body.product;},
      onBeforeSeoGenerate:()=>false,onBeforeFreeImageApply:()=>false,onPrepareSubmission:()=>{},onProfilePrepared:()=>{},onReviewPackaging:()=>{},onManageCategories:()=>{},onUpload:()=>{}}:{}),
    editableQuotationPrices:integrated,profileId,refreshToken,pricePolicyLocked:policyLocked,imageProcessingBusy:fileBusy,beforePriceCommit:()=>allowCommit&&!policyLocked&&!fileBusy,
    onSaved() { saveCount++;if(integrated){currentProduct={...sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId)};refreshToken=String(Number(refreshToken)+1);} } } });
    for (const node of priceTableNodes(tree)) if (node.props?.ref && typeof node.props.ref === 'object') node.props.ref.current = {
      querySelector(selector) { const match = /data-price-option-id="([^"]+)"/.exec(selector), row = priceTableNodes(node).find(item => match && item.props?.['data-price-option-id'] === match[1]
        || !match && selector.includes('data-option-target') && item.props?.['data-option-target'] === true);
      return row ? { scrollIntoView() {}, querySelector() { const input = priceTableNodes(row).find(item => item.type === 'input' && item.props.type === 'number'); return input ? { focus() { focused.push(input.props['aria-label']); } } : null; } } : null; },
    };layouts.splice(0).forEach(effect=>effect());return tree; };
  const settle = async () => { for (let iteration = 0; iteration < 12; iteration++) { render(); effects.splice(0).forEach(effect => effect()); await new Promise(done => setImmediate(done)); } return render(); };
  await settle();
  return { sqlite, load, render, settle, apiCalls, writes, focused, product, policy, before, protectedSnapshot,controls,request,
    node(label) { const node = priceTableNodes(render()).find(node => node.props?.['aria-label'] === label); assert.ok(node, label); return node; },
    button(label) { const node = priceTableNodes(render()).find(node => node.type === 'button' && (priceTableText(node) === label || node.props['aria-label'] === label)); assert.ok(node, label); return node; },
    rows() { return load('db/product-options.ts').readProductOptions(owner, productId); },
    holdSave() { let release, arrive; const promise = new Promise(done => { release = done; }), arrived = new Promise(done => { arrive = done; }); heldSave = { promise, arrived: arrive }; return { release, arrived }; },
    changeProductVersion(value) { currentProduct = { ...currentProduct, updated_at: value }; },
    async reloadProduct() { currentProduct = await load('db/queries.ts').findProduct(owner,productId); },
    selectProfile(value){profileId=value;render();},locks({policy:policyValue,files,allowed}={}){if(policyValue!==undefined)policyLocked=policyValue;if(files!==undefined)fileBusy=files;if(allowed!==undefined)allowCommit=allowed;render();},
    get saved() { return saveCount; }, close() { for (const instance of instances.values()) for (const slot of instance.slots) slot?.cleanup?.(); closed = true; sqlite.close(); },
  };
}
