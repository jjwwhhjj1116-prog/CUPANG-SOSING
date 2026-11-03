import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceImageEditFixture, json } from './helpers/workspace-image-edit-api.mjs';
import { companies } from './helpers/image-download-ui.mjs';

// Upload versions belong to storage, independently of image bytes and metadata.
function versionedStorage(f, ...suppliedVersion) {
  const version = suppliedVersion.length ? suppliedVersion[0] : 'r2-upload';
  const store = f.api.bindings.FILES, get = store.get, head = store.head, put = store.put;
  const versions = new Map([...f.api.objects.keys()].map((key, index) => [key, version === 'r2-upload' ? version + '-' + index : version]));
  const reads = new Map(), heads = new Map();
  store.get = async (...args) => {
    const version = versions.get(args[0]), value = await get(...args);
    reads.set(args[0], (reads.get(args[0]) ?? 0) + 1);
    return value ? { ...value, version } : null;
  };
  store.head = async key => {
    const value = await head(key); heads.set(key, (heads.get(key) ?? 0) + 1);
    return value ? { ...value, version: versions.get(key) } : null;
  };
  store.put = async (key, ...args) => {
    const value = await put(key, ...args);
    if (value) versions.set(key, 'r2-upload-' + crypto.randomUUID());
    return value;
  };
  return { reads, heads, versions };
}

test('workspace source GET hashes every file once per request and retains every later version fence', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const storage = versionedStorage(f), before = f.tables(), opened = await json(await f.openImage());
    const key = f.selectedKeys.find(key => key !== opened.source.sourceKey);
    assert.equal(storage.reads.get(key), 1, 'one independently hashed body for an unrelated workspace image');
    assert.equal(storage.heads.get(key), 3, 'all three later full-workspace checks remain');
    assert.equal(storage.reads.get(opened.source.sourceKey), 3, 'selected source keeps both independent image reads');
    assert.deepEqual(f.tables(), before);
    await json(await f.openImage());
    assert.equal(storage.reads.get(key), 2, 'another HTTP request starts with new actual bytes');
    assert.equal(storage.heads.get(key), 6);
  } finally { f.api.close(); }
});

test('every workspace source fence rejects an unrelated overwrite even when the original bytes were restored', async () => {
  for (const phase of [1, 2, 3]) {
    const f = await workspaceImageEditFixture(companies[0]);
    try {
      const storage = versionedStorage(f), store = f.api.bindings.FILES, head = store.head;
      const unrelated = f.selectedKeys[0], original = f.api.objects.get(unrelated).slice(); let fired = false;
      store.head = async key => {
        if (!fired && key === unrelated && (storage.heads.get(key) ?? 0) + 1 === phase) {
          fired = true;
          f.api.objects.set(key, await f.png('#123456'));
          storage.versions.set(key, 'r2-replaced');
          f.api.objects.set(key, original);
          storage.versions.set(key, 'r2-restored');
        }
        return head(key);
      };
      const before = f.tables(), response = await f.openImage();
      assert.equal(fired, true, 'checkpoint ' + phase);
      assert.equal(response.status, 409, 'checkpoint ' + phase);
      assert.deepEqual(f.tables(), before);
    } finally { f.api.close(); }
  }
});

test('missing, malformed or absent storage versions keep full independent workspace byte reads', async () => {
  for (const version of [undefined, '', 'bad version', 'x'.repeat(513)]) {
    const f = await workspaceImageEditFixture(companies[0]);
    try {
      const storage = versionedStorage(f, version), opened = await json(await f.openImage());
      const key = f.selectedKeys.find(key => key !== opened.source.sourceKey);
      assert.equal(storage.reads.get(key), 4);
      assert.equal(storage.heads.get(key) ?? 0, 0);
    } finally { f.api.close(); }
  }
});

test('version reuse still rejects metadata, missing object, source-row, workspace and membership changes', async () => {
  for (const kind of ['metadata', 'missing', 'version-lost', 'product', 'workspace', 'membership']) {
    const f = await workspaceImageEditFixture(companies[0]);
    try {
      const storage = versionedStorage(f), store = f.api.bindings.FILES, head = store.head, network = [...f.api.network]; let fired = false;
      store.head = async key => {
        const value = await head(key);
        if (!fired && key === f.selectedKeys[0] && storage.reads.has(key)) {
          fired = true;
          if (kind === 'metadata') return { ...value, customMetadata: { ...value.customMetadata, imageWidth: '999' } };
          if (kind === 'missing') return null;
          if (kind === 'version-lost') return { ...value, version: undefined };
          if (kind === 'product') f.api.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z', f.product.id);
          if (kind === 'workspace') f.api.sqlite.prepare('UPDATE product_detail_workspaces SET request_id=?').run('0'.repeat(64));
          if (kind === 'membership') f.api.setMembershipStatus('pending');
        }
        return value;
      };
      const response = await f.openImage();
      assert.equal(fired, true, kind); assert.notEqual(response.status, 200, kind);
      assert.deepEqual(f.api.network, network);
    } finally { f.api.close(); }
  }
});

test('the first versioned read still hashes actual bytes and never trusts uploader metadata', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const storage = versionedStorage(f), before = f.tables(), key = f.selectedKeys[0];
    f.api.objects.set(key, await f.png('#123456'));
    assert.equal((await f.openImage()).status, 409);
    assert.equal(storage.reads.get(key), 1); assert.equal(storage.heads.size, 0);
    assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

async function visionFixture() {
  const f = await workspaceImageEditFixture(companies[0]), source = (await json(await f.openImage())).source, env = f.api.bindings;
  Object.assign(env, { SOURCEFLOW_IMAGE_TEXT_PROVIDER: 'workers-ai-vision', SOURCEFLOW_IMAGE_TEXT_MODEL: '@cf/qwen/qwen3.8-27b', SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED: 'true' });
  let providerCalls = 0; const controls = { provider: null };
  env.AI.run = async () => { providerCalls++; await controls.provider?.(); return { response: { decision: 'no-foreign-text', blocks: [] } }; };
  const configuration = JSON.parse(JSON.stringify(f.api.load('app/automation/workers-image-vision.ts').imageVisionConfiguration(env)));
  const policy = f.api.load('app/image-text-vision.ts').IMAGE_TEXT_INSPECTION_POLICY;
  const storage = versionedStorage(f), route = f.api.load('app/api/products/[id]/image-text/route.ts');
  const requestId = '90700000-0000-4000-8000-000000000031';
  return { ...f, source, storage, controls, requestId, providerCalls: () => providerCalls,
    post: () => route.POST(new Request('https://app.test' + f.base + '/image-text', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test' },
      body: JSON.stringify({ action: 'vision', source, configuration, sourceLanguage: 'zh', requestId, inspectionPolicy: policy }),
    }), f.context) };
}

test('Vision request reuses full-workspace byte proofs while retaining pre/post-provider and final fences', async () => {
  const f = await visionFixture();
  try {
    const response = await f.post();
    assert.equal(response.status, 200, await response.clone().text());
    const key = f.selectedKeys.find(key => key !== f.source.sourceKey);
    assert.equal(f.storage.reads.get(key), 1);
    assert.equal(f.storage.heads.get(key), 9, 'ten full-workspace checkpoints still observe the file');
    assert.equal(f.providerCalls(), 1);
  } finally { f.api.close(); }
});

test('unrelated overwrite-and-restore stays fenced before claim, before inference, after inference and after finish', async () => {
  for (const phase of ['preclaim', 'preprovider', 'provider', 'finished']) {
    const f = await visionFixture();
    try {
      const key = f.selectedKeys[0], bytes = f.api.objects.get(key).slice(), store = f.api.bindings.FILES, head = store.head;
      const originalRows = () => JSON.stringify(['products', 'product_content', 'product_options', 'product_quotation_fields', 'product_detail_workspaces'].map(table => f.api.sqlite.prepare('SELECT * FROM ' + table).all()));
      const before = originalRows(); let fired = false;
      const replaceAndRestore = () => {
        fired = true; f.storage.versions.set(key, 'r2-replaced'); f.api.objects.set(key, new Uint8Array([1, 2, 3]));
        f.api.objects.set(key, bytes); f.storage.versions.set(key, 'r2-restored');
      };
      if (phase === 'provider') f.controls.provider = replaceAndRestore;
      else store.head = async value => {
        const checkpoint = { preclaim: 2, preprovider: 4, finished: 8 }[phase];
        if (!fired && value === key && (f.storage.heads.get(key) ?? 0) + 1 === checkpoint) replaceAndRestore();
        return head(value);
      };
      const response = await f.post(); assert.equal(fired, true, phase); assert.equal(response.status, 409, phase);
      assert.equal(f.providerCalls(), ['provider', 'finished'].includes(phase) ? 1 : 0, phase);
      const row = f.api.sqlite.prepare('SELECT status,failure,provider_requests FROM image_vision_requests WHERE request_id=?').get(f.requestId);
      if (phase === 'preclaim') assert.equal(row, undefined);
      else assert.deepEqual(JSON.parse(JSON.stringify(row)), phase === 'preprovider' ? { status: 'failed', failure: 'BEFORE_CALL', provider_requests: 0 }
        : phase === 'provider' ? { status: 'uncertain', failure: 'CURRENT_CHANGED', provider_requests: 1 } : { status: 'completed', failure: null, provider_requests: 1 });
      assert.equal(originalRows(), before, phase);
    } finally { f.api.close(); }
  }
});

test('cancellation during a repeated version HEAD cannot release a workspace source', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    versionedStorage(f); const controller = new AbortController(), head = f.api.bindings.FILES.head; let fired = false;
    f.api.bindings.FILES.head = async key => { const value = await head(key); fired = true; controller.abort(); return value; };
    const params = new URLSearchParams({ profileId: f.initialView.categoryContext.profileId, optionId: f.optionId, photoId: f.photoId });
    const response = await f.imageRoute.GET(new Request('https://app.test' + f.imageBase + '?' + params, { signal: controller.signal }), f.context);
    assert.equal(fired, true); assert.notEqual(response.status, 200);
  } finally { f.api.close(); }
});
