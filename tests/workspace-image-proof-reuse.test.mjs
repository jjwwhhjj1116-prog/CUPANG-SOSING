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

async function eightFileWorkspace(f) {
  const product = f.api.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.product.id);
  const extra = Array.from({ length: 4 }, (_, index) => 'owner/head-concurrency-' + index + '.png');
  for (const key of extra) await f.api.bindings.FILES.put(key, f.api.objects.get(f.selectedKeys[1]).slice(), { httpMetadata: { contentType: 'image/png' } });
  f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(product.image_keys), ...extra]), f.product.id);
  const before = await json(await f.read()), photos = before.workspace.document.photos;
  const document = f.document([...photos.slice(0, -1), ...extra.map((key, index) => ({ id: 'head-concurrency-' + index, originKey: key, key, role: 'body' })), photos.at(-1)]);
  return (await json(await f.put(await f.body(document, before)))).workspace.files.map(file => file.key);
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function delayedStorage(f) {
  const store = f.api.bindings.FILES, get = store.get, head = store.head;
  const active = { body: 0, head: 0, maxBody: 0, maxHead: 0 };
  store.get = async (...args) => {
    active.body++; active.maxBody = Math.max(active.maxBody, active.body);
    await delay(5); const value = await get(...args);
    if (!value) { active.body--; return null; }
    const reader = value.body.getReader(); let finished = false;
    const finish = () => { if (!finished) { finished = true; active.body--; } };
    return { ...value, body: new ReadableStream({
      async pull(controller) {
        try { await delay(5); const next = await reader.read(); if (next.done) { finish(); controller.close(); } else controller.enqueue(next.value); }
        catch (error) { finish(); controller.error(error); }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
    }) };
  };
  store.head = async key => {
    active.head++; active.maxHead = Math.max(active.maxHead, active.head);
    try { await delay(10); return await head(key); } finally { active.head--; }
  };
  return active;
}

test('fully proven HEAD-only scans reach six concurrent requests while initial image bodies stay bounded to two', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    await eightFileWorkspace(f); versionedStorage(f); const active = delayedStorage(f), before = f.tables();
    await json(await f.openImage());
    assert.equal(active.maxBody, 2); assert.equal(active.maxHead, 6);
    assert.equal(active.body, 0); assert.equal(active.head, 0); assert.deepEqual(f.tables(), before);
  } finally { f.api.close(); }
});

test('a mixed scan with even its last file unversioned keeps every batch bounded to two', async () => {
  const f = await workspaceImageEditFixture(companies[0]);
  try {
    const keys = await eightFileWorkspace(f), storage = versionedStorage(f);
    storage.versions.set(keys.at(-1), undefined); const active = delayedStorage(f);
    await json(await f.openImage());
    assert.equal(active.maxBody, 2); assert.equal(active.maxHead, 2);
    assert.equal(active.body, 0); assert.equal(active.head, 0);
    assert.equal(storage.reads.get(keys.at(-1)), 4, 'the unversioned file is independently hashed at each check');
  } finally { f.api.close(); }
});

test('six-way HEAD metadata errors and cancellation wait for every started request to settle', async () => {
  for (const failure of ['metadata', 'abort']) {
    const f = await workspaceImageEditFixture(companies[0]);
    try {
      await eightFileWorkspace(f); versionedStorage(f);
      const controller = new AbortController(), store = f.api.bindings.FILES, head = store.head; let started = 0, settled = 0, active = 0;
      store.head = async key => {
        const index = ++started; active++;
        try {
          await delay(index === 1 ? 1 : 30); const value = await head(key);
          if (index === 1) {
            if (failure === 'abort') controller.abort();
            else return { ...value, customMetadata: { ...value.customMetadata, imageWidth: '999' } };
          }
          return value;
        } finally { active--; settled++; }
      };
      const params = new URLSearchParams({ profileId: f.initialView.categoryContext.profileId, optionId: f.optionId, photoId: f.photoId });
      const response = await f.imageRoute.GET(new Request('https://app.test' + f.imageBase + '?' + params, { signal: controller.signal }), f.context);
      assert.notEqual(response.status, 200, failure); assert.equal(started, 6, failure);
      assert.equal(settled, 6, failure); assert.equal(active, 0, failure);
    } finally { f.api.close(); }
  }
});
