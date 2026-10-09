import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto,createHash} from 'node:crypto';
const modules=new Map(),endpoint='/api/products/p1/quotation-fields?profileId=profile';
function load(file) {
  if(modules.has(file))return modules.get(file);
  const exports = {};
  modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URL, File, Blob, FormData, Error, TextEncoder, Uint8Array,structuredClone, crypto:webcrypto, require(name) { return load(`${name.slice(2)}.ts`); } });
  return exports;
}
const { attachQuotationLabel: attach } = load('app/quotation-label-attachment.ts');
const { attachQuotationLabels: batch } = load('app/quotation-label-batch.ts');
const cell = value => ({ value, source: 'manual-option' });
function fixture() {
  const view={ revision: 2, inputFingerprint: '1'.repeat(64), productVersion: '2026-09-24T00:00:00.000Z',updatedAt:'2026-09-24T00:00:00.000Z', contentRevision: 3,optionRevision:1, imageKeys: ['owner/old.png'],submissionReady:false,
    categoryContext: {source:'profile',categoryId: '80719',categoryPath:['주방'], profileId: 'profile' }, resolved: {
      schema: { categoryId: '80719', categoryPath: ['주방'],status:'unconfirmed', fields: [{ id: 'title', label: '상품명', section: 'start',type:'text',required:false }, { id: 'model', label: '모델명', section: 'product',type:'text',required:false }, { id: 'labelImages',label:'표시사항 이미지', type: 'images', section: 'image',maxItems:30,required:false }] },issues:[],
      rows: ['red', 'blue'].map(id => ({ optionId: id, optionLabel: id, included: true, fields: { title: cell('제품'), model: cell(id), labelImages: cell('owner/old.png') } })),
    } };view.overrides={common:{},options:Object.fromEntries(view.resolved.rows.map(row=>[row.optionId,Object.fromEntries(Object.entries(row.fields).map(([id,value])=>[id,value.value]))]))};view.automatic=structuredClone(view.resolved);return view;
}
function harness() {
  const initial = fixture(); let view = structuredClone(initial); let uploadedKey = null;const receipts=new Map();
  const calls = []; let failAttachment = false; let conflictPut = false; let changeAfterAttach = false;
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    if(url.startsWith('/api/files?labelUploadId='))return Response.json(receipts.get(url.split('=')[1])??{key:null});
    if (url === '/api/files') {
      const uploadId=init.body.get('labelUploadId'),proof=JSON.parse(init.body.get('quotationLabelProof')),file=init.body.get('file');
      const metadata=await load('app/quotation-label-proof.ts').verifiedQuotationLabelMetadata(proof,view,uploadId),key=`owner/quotation-label-${uploadId}.png`;
      const quotationLabelProof=load('app/quotation-label-proof.ts').quotationLabelReceiptFromMetadata({...metadata,labelUploadId:uploadId,labelBlobSha256:'a'.repeat(64)});
      receipts.set(uploadId,{key,contentType:'image/png',size:file.size,sha256:'a'.repeat(64),quotationLabelProof});
      return Response.json({key,contentType:'image/png',size:file.size,quotationLabelProof},{status:201});
    }
    if (url.endsWith('/attachments')) {
      if (failAttachment) { failAttachment = false; return Response.json({ error: '연결 충돌' }, { status: 409 }); }
      const body = JSON.parse(init.body); assert.equal(body.role, null); assert.equal(body.expectedContentRevision, view.contentRevision);
      assert.equal(body.expectedVersion, view.productVersion);
      view.imageKeys.push(body.key); view.productVersion = new Date(Date.parse(view.productVersion)+1).toISOString(); view.inputFingerprint = createHash('sha256').update(JSON.stringify(view.imageKeys)).digest('hex');
      if (changeAfterAttach) view.resolved.rows[0].fields.model.value = '다른 모델';
      return Response.json({ productVersion: view.productVersion });
    }
    if (init.method === 'PUT') {
      if (conflictPut) { conflictPut = false; return Response.json({ error: '견적 저장 충돌' }, { status: 409 }); }
      const body = JSON.parse(init.body); assert.equal(body.expectedInputFingerprint, view.inputFingerprint); assert.equal(body.expectedRevision, view.revision);
      assert.equal(body.changes.length, 1); assert.equal(body.changes[0].fieldKey, 'labelImages');
      for(const change of body.changes){view.resolved.rows.find(row=>row.optionId===change.optionId).fields[change.fieldKey]=cell(change.value);view.overrides.options[change.optionId][change.fieldKey]=change.value;}
      view.revision++;view.productVersion=new Date(Date.parse(view.productVersion)+1).toISOString();view.updatedAt=view.productVersion;view.inputFingerprint=createHash('sha256').update(JSON.stringify(view.overrides)+view.revision).digest('hex');
    }
    return Response.json(view);
  };
  return { initial, calls, fetcher,receipts,get added(){return calls.filter(call=>call.url==='/api/files').map(call=>receipts.get(call.body.get('labelUploadId')).key);},get view() { return view; }, set view(value) { view = value; },
    failAttachment() { failAttachment = true; }, conflictPut() { conflictPut = true; }, changeAfterAttach() { changeAfterAttach = true; },
    run() { return attach({ productId: 'p1', endpoint, renderedView: initial, optionId: 'red', blob: new Blob(['test'], { type: 'image/png' }), uploadedKey, onUploaded: key => { uploadedKey = key; } }, fetcher); },
  };
}
async function seedSaved(h){
 const keys=new Map();
 for(const row of h.initial.resolved.rows){
  const context={productId:'p1',endpoint,view:h.initial,optionId:row.optionId},uploadId=await load('app/quotation-label-upload.ts').quotationLabelUploadId(context),key=`owner/quotation-label-${uploadId}.png`;
  const metadata=await load('app/quotation-label-proof.ts').verifiedQuotationLabelMetadata(load('app/quotation-label-proof.ts').quotationLabelProofRequest(context),h.initial,uploadId);
  h.receipts.set(uploadId,{key,contentType:'image/png',size:3,sha256:'a'.repeat(64),quotationLabelProof:load('app/quotation-label-proof.ts').quotationLabelReceiptFromMetadata({...metadata,labelUploadId:uploadId,labelBlobSha256:'a'.repeat(64)})});keys.set(row.optionId,key);
 }
 return keys;
}
test('label attachment adds only the chosen option, preserves old labels and is idempotent', async () => {
  const h = harness(); const saved = await h.run();
  assert.equal(saved.resolved.rows[0].fields.labelImages.value, 'owner/old.png\n'+h.added[0]);
  assert.equal(saved.resolved.rows[1].fields.labelImages.value, 'owner/old.png');
  assert.deepEqual(saved.imageKeys, ['owner/old.png', h.added[0]]);
  assert.equal(h.initial.resolved.rows[0].fields.labelImages.value, 'owner/old.png');
  await h.run();
  assert.equal(h.calls.filter(call => call.url === '/api/files').length, 1);
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1);
});
test('retries reuse an uploaded file after product-attachment or quotation CAS failure', async () => {
  for (const failure of ['failAttachment', 'conflictPut']) {
    const h = harness(); h[failure](); await assert.rejects(h.run(), /충돌/);
    assert.equal(h.view.resolved.rows[0].fields.labelImages.value, 'owner/old.png');
    await h.run(); assert.equal(h.calls.filter(call => call.url === '/api/files').length, 1);
    assert.equal(h.view.resolved.rows[0].fields.labelImages.value, 'owner/old.png\n'+h.added[0]);
  }
});
test('changed label values, category or excluded option prevent stale PNG connection', async () => {
  for (const change of [v => { v.resolved.rows[0].fields.model.value = ''; }, v => { v.resolved.schema.categoryId = 'other'; }, v => { v.resolved.rows[0].included = false; }]) {
    const h = harness(); change(h.view); await assert.rejects(h.run());
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  }
  const h = harness(); h.changeAfterAttach(); await assert.rejects(h.run(), /변경/);
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 0);
  assert.ok(h.view.imageKeys.includes(h.added[0])); // Preserve partial upload; do not claim a linked label.
});
test('read-only, non-image or newly restricted canonical label controls refuse attachment before uploading',async()=>{
 for(const change of [field=>{field.readOnly=true;},field=>{field.type='text';},field=>{field.maxItems=0;}]){
  const h=harness();change(h.view.resolved.schema.fields.find(field=>field.id==='labelImages'));await assert.rejects(h.run(),/연결|규칙|최대|참조/);
  assert.equal(h.calls.filter(call=>call.method!=='GET').length,0);assert.equal(h.receipts.size,0);assert.equal(h.view.resolved.rows[0].fields.labelImages.value,'owner/old.png');
 }
});
test('limits are checked before uploading and latest existing labels are retained', async () => {
  const full = harness(); full.view.imageKeys = ['owner/old.png',...Array.from({ length: 49 }, (_, i) => `owner/${i}.png`)]; await assert.rejects(full.run(), /한도/);
  assert.equal(full.calls.filter(call=>call.method!=='GET').length, 0);
  const labels = harness();labels.view.imageKeys.push(...Array.from({length:30},(_,i)=>`owner/${i}.png`)); labels.view.resolved.rows[0].fields.labelImages.value = Array.from({ length: 30 }, (_, i) => `owner/${i}.png`).join('\n'); await assert.rejects(labels.run(), /한도/);
  const h = harness(); h.view.resolved.rows[0].fields.labelImages.value += '\nowner/another.png'; h.view.imageKeys.push('owner/another.png');
  const saved = await h.run(); assert.equal(saved.resolved.rows[0].fields.labelImages.value, 'owner/old.png\nowner/another.png\n'+h.added[0]);
});

test('server-recovered keys finish single and batch retries even at full image and label capacity', async () => {
  for (const method of ['single', 'batch']) {
    const h = harness(true); let renders = 0;
    const rows = method === 'single' ? [h.view.resolved.rows[0]] : h.view.resolved.rows;
    const keys=await seedSaved(h);h.view.imageKeys=[...keys.values(),...Array.from({length:48},(_,i)=>`owner/${i}.png`)];
    for(const row of rows){row.fields.labelImages.value=h.view.imageKeys.slice(0,30).join('\n');h.view.overrides.options[row.optionId].labelImages=row.fields.labelImages.value;}
    const request=h.fetcher;
    if (method === 'single') {
      const saved = await attach({ productId: 'p1', endpoint, renderedView: h.initial, optionId: 'red', blob: null, uploadedKey: null, onUploaded() {} }, request);
      assert.equal(saved.imageKeys.length, 50);
    } else {
      const result = await batch({ productId: 'p1', endpoint, view: h.initial, uploaded: new Map(), render: async () => { renders++; return { blob: new Blob(['png'],{type:'image/png'}) }; }, onProgress() {} }, request);
      assert.equal(result.completed, 2); assert.equal(result.stopped, false);
    }
    assert.equal(renders, 0); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
    for (const row of rows) assert.equal(row.fields.labelImages.value.split('\n').length, 30);
  }
});

test('an unavailable saved-label lookup stops single and batch recovery without a new file or mutation', async () => {
  for (const method of ['single', 'batch']) {
    const h = harness(true); let renders = 0;
    const request = async (url, init) => url.startsWith('/api/files?labelUploadId=') ? Response.json({ error: '라벨 조회 실패' }, { status: 503 }) : h.fetcher(url, init);
    const run = method === 'single'
      ? attach({ productId: 'p1', endpoint, renderedView: h.initial, optionId: 'red', blob: new Blob(['png'],{type:'image/png'}), uploadedKey: null, onUploaded() {} }, request)
      : batch({ productId: 'p1', endpoint, view: h.initial, uploaded: new Map(), render: async () => { renders++; return { blob: new Blob(['png'],{type:'image/png'}) }; }, onProgress() {} }, request);
    await assert.rejects(run, /라벨 조회 실패/);
    assert.equal(renders, 0); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
    assert.deepEqual(h.view, h.initial);
  }
});

test('batch renders included option-specific values and preserves all prior labels', async () => {
  const h = harness(true); const plans = []; const progress = [];
  h.initial.resolved.rows.push({ optionId: 'excluded', optionLabel: 'excluded', included: false, fields: {} });
  const { view: saved } = await batch({ productId: 'p1', endpoint, view: h.initial, uploaded: new Map(),
    render: async plan => { plans.push(plan); return { blob: new Blob(['png'],{type:'image/png'}) }; }, onProgress: p => progress.push(p),
  }, h.fetcher);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].rows.find(row => row[0] === '모델명')[1], 'red');
  assert.equal(plans[1].rows.find(row => row[0] === '모델명')[1], 'blue');
  assert.equal(saved.resolved.rows[0].fields.labelImages.value, 'owner/old.png\n'+h.added[0]);
  assert.equal(saved.resolved.rows[1].fields.labelImages.value, 'owner/old.png\n'+h.added[1]);
  assert.equal(progress.at(-1).completed, 2);
  assert.equal(progress.at(-1).total, 2);
});

test('batch resumes after second-option conflict without regenerating or duplicating either PNG', async () => {
  const h = harness(true); const uploaded = new Map(); let renders = 0; let fail = true;
  const request = async (url, init) => {
    if (init?.method === 'PUT' && JSON.parse(init.body).changes[0].optionId === 'blue' && fail) { fail = false; return Response.json({ error: '충돌' }, { status: 409 }); }
    return h.fetcher(url, init);
  };
  const input = { productId: 'p1', endpoint, view: h.initial, uploaded,
    render: async () => { renders++; return { blob: new Blob(['png'],{type:'image/png'}) }; }, onProgress() {},
  };
  await assert.rejects(batch(input, request), /충돌/);
  assert.ok(h.view.resolved.rows[0].fields.labelImages.value.includes(h.added[0]));
  assert.equal(h.view.resolved.rows[1].fields.labelImages.value, 'owner/old.png');
  await batch(input, request);
  assert.equal(renders, 2); assert.equal(uploaded.size, 2);
  assert.equal(h.calls.filter(call => call.url === '/api/files').length, 2);
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 2);
});

test('batch validates all plans before mutation and stops if later option changes during rendering', async () => {
  const h = harness(true); let renders = 0;
  const input = { productId: 'p1', endpoint, view: h.initial, uploaded: new Map(),
    render: async () => { renders++; if (renders === 2) h.view.resolved.rows[1].fields.model.value = 'changed'; return { blob: new Blob(['png'],{type:'image/png'}) }; }, onProgress() {},
  };
  await assert.rejects(batch(input, h.fetcher), /변경/);
  assert.equal(h.calls.filter(call => call.url === '/api/files').length, 1);
  assert.ok(h.view.resolved.rows[0].fields.labelImages.value.includes(h.added[0]));
  const invalid = fixture(); invalid.resolved.rows[1].fields.title.value = ''; invalid.resolved.rows[1].fields.model.value = '';
  await assert.rejects(batch({ ...input, view: invalid }, h.fetcher), /견적 값/);
  assert.equal(renders, 2);
});

test('batch capacity preflight stops before rendering or uploading and counts retained retry keys', async () => {
  const h = harness(true); h.view.imageKeys = ['owner/old.png',...Array.from({ length: 48 }, (_, i) => `owner/${i}.png`)];
  let renders = 0;
  const input = { productId: 'p1', endpoint, view: h.initial, uploaded: new Map(), render: async () => { renders++; return { blob: new Blob(['png'],{type:'image/png'}) }; }, onProgress() {} };
  await assert.rejects(batch(input, h.fetcher), /49개.*2개/);
  assert.equal(renders, 0); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  h.view.imageKeys = ['owner/old.png'];
  h.view.imageKeys.push(...Array.from({length:30},(_,i)=>`owner/${i}.png`));
  h.view.resolved.rows[1].fields.labelImages.value = Array.from({ length: 30 }, (_, i) => `owner/${i}.png`).join('\n');
  await assert.rejects(batch(input, h.fetcher), /blue.*30개/); assert.equal(renders, 0);
  const full = harness(true),uploaded=await seedSaved(full);full.view.imageKeys=[...uploaded.values(),...Array.from({length:48},(_,i)=>`owner/${i}.png`)];
  for(const row of full.view.resolved.rows){row.fields.labelImages.value=uploaded.get(row.optionId);full.view.overrides.options[row.optionId].labelImages=row.fields.labelImages.value;}
  const result = await batch({ ...input, view: full.initial, uploaded }, full.fetcher);
  assert.equal(result.completed, 2); assert.equal(result.stopped, false); assert.equal(renders, 0);
  assert.equal(full.calls.filter(call => call.method !== 'GET').length, 0);
});

test('stop during an option save completes that option, then resumes with no duplicate upload', async () => {
  const h = harness(true); let stop = false; let renders = 0; const uploaded = new Map();
  const request = async (url, init) => {
    const response = await h.fetcher(url, init);
    if (init?.method === 'PUT') stop = true;
    return response;
  };
  const input = { productId: 'p1', endpoint, view: h.initial, uploaded, shouldStop: () => stop,
    render: async () => { renders++; return { blob: new Blob(['png'],{type:'image/png'}) }; }, onProgress() {} };
  const first = await batch(input, request);
  assert.equal(first.stopped, true); assert.equal(first.completed, 1);
  assert.equal(first.view.resolved.rows[0].fields.labelImages.value, 'owner/old.png\n'+h.added[0]);
  assert.equal(first.view.resolved.rows[1].fields.labelImages.value, 'owner/old.png');
  stop = false;
  const resumed = await batch(input, h.fetcher);
  assert.equal(resumed.stopped, false); assert.equal(resumed.completed, 2); assert.equal(renders, 2);
  assert.equal(h.calls.filter(call => call.url === '/api/files').length, 2);
});

test('stop before execution or during rendering never starts an upload', async () => {
  const h = harness(); let stop = true; let renders = 0;
  const input = { productId: 'p1', endpoint, view: h.initial, uploaded: new Map(), shouldStop: () => stop,
    render: async () => { renders++; stop = true; return { blob: new Blob(['png'],{type:'image/png'}) }; }, onProgress() {} };
  assert.equal((await batch(input, h.fetcher)).stopped, true);
  assert.equal(h.calls.length, 0); assert.equal(renders, 0);
  stop = false;
  const result = await batch(input, h.fetcher);
  assert.equal(result.stopped, true); assert.equal(result.completed, 0); assert.equal(renders, 1);
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
});

test('custom label edits invalidate rendered PNGs while hidden text edits do not', async () => {
 const labels=[{id:'custom-a',name:'관리',value:'세탁',visible:true},{id:'custom-b',name:'주의',value:'보관',visible:true},{id:'custom-c',name:'숨김',value:'초안',visible:false}];
 for(const change of [r=>{r.customLabels[0].value='변경';},r=>{r.customLabels[0].name='변경';},r=>{r.customLabels[0].visible=false;},r=>{r.customLabels.reverse();},r=>{r.customLabels=[];}]){
  const h=harness();h.initial.resolved.customLabels=structuredClone(labels);h.view.resolved.customLabels=structuredClone(labels);change(h.view.resolved);
  await assert.rejects(h.run(),/변경/);assert.equal(h.calls.filter(call=>call.method!=='GET').length,0);
 }
 const h=harness();h.initial.resolved.customLabels=structuredClone(labels);h.view.resolved.customLabels=structuredClone(labels);
 h.view.resolved.customLabels[2].value='다른 숨김';await h.run();assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);
 const raced=harness();raced.initial.resolved.customLabels=structuredClone(labels);raced.view.resolved.customLabels=structuredClone(labels);
 await assert.rejects(attach({productId:'p1',endpoint,renderedView:raced.initial,optionId:'red',blob:new Blob(['png'],{type:'image/png'}),onUploaded(){}},async(url,init)=>{
  const response=await raced.fetcher(url,init);if(url.endsWith('/attachments'))raced.view.resolved.customLabels[0].value='저장 중 변경';return response;
 }),/변경/);
 assert.equal(raced.calls.filter(call=>call.method==='PUT').length,0);
});

test('batch renders custom labels for every option and stops on a custom edit during rendering', async () => {
 const labels=[{id:'custom-a',name:'추가 안내',value:'보관 방법',visible:true}];
 const h=harness(true);h.initial.resolved.customLabels=structuredClone(labels);h.view.resolved.customLabels=structuredClone(labels);let renders=0;
 await assert.rejects(batch({productId:'p1',endpoint,view:h.initial,uploaded:new Map(),onProgress(){},render:async plan=>{
  assert.deepEqual(Array.from(plan.rows.at(-1)),['추가 안내','보관 방법']);renders++;
  if(renders===2)h.view.resolved.customLabels[0].value='새 안내';return {blob:new Blob(['png'],{type:'image/png'})};
 }},h.fetcher),/변경/);
 assert.equal(renders,2);assert.equal(h.calls.filter(call=>call.url==='/api/files').length,1);
 assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);
});
