import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { companies } from './helpers/image-download-ui.mjs';
import { detailWorkspaceFixture, json } from './helpers/detail-workspace-api.mjs';

const MiB = 1024 * 1024;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
async function within(promise, message) {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message())), 1000); })]); }
  finally { clearTimeout(timer); }
}

// Control only the external R2 body. Validation, hashing, SQLite and handlers
// remain real, and highWaterMark: 0 prevents reads before getReader().read().
function controlledFiles(f, configure = () => ({})) {
  const get = f.api.bindings.FILES.get, keys = new Set(f.selectedKeys), gates = new Map(), events = [];
  const state = { fetched: [], started: [], finished: [], canceled: [], active: 0, peak: 0, open: false };
  f.api.bindings.FILES.get = async (...args) => {
    const object = await get(...args), key = args[0];
    if (!keys.has(key)) return object;
    state.fetched.push(key);
    const config = configure(key, object);
    if (config.missing) return null;
    const gate = deferred(); gates.set(key, gate);
    const value = { ...object, size: config.size ?? object.size, body: new ReadableStream({
      async pull(controller) {
        state.started.push(key); state.active++; state.peak = Math.max(state.peak, state.active);
        for (const event of events) if (state.started.length >= event.count) event.resolve();
        try {
          if (!state.open) await gate.promise;
          if (config.error) throw config.error;
          controller.enqueue(config.bytes ?? f.api.objects.get(key).slice()); controller.close();
        } catch (error) { controller.error(error); }
        finally { state.active--; state.finished.push(key); }
      },
      async cancel() { state.canceled.push(key); if (config.cancelGate) await config.cancelGate; },
    }, { highWaterMark: 0 }) };
    if (config.beforeReturn) await config.beforeReturn;
    return value;
  };
  return Object.assign(state, {
    release(key) { assert.ok(gates.has(key), 'R2 object fetched before releasing its body'); gates.get(key).resolve(); },
    releaseAll() { state.open = true; for (const gate of gates.values()) gate.resolve(); },
    async untilStarted(count) {
      if (state.started.length >= count) return;
      await within(new Promise(resolve => events.push({ count, resolve })), () => `expected ${count} body reads; got ${state.started.length}`);
    },
  });
}

test('workspace proof reads overlap in pairs, preserve ordered unique proofs, and never start a third active read', async () => {
  const f = await detailWorkspaceFixture(companies[0]); let files, pending;
  try {
    const first = await json(await f.put(await f.body())), photos = first.workspace.document.photos,
      document = f.document([photos[0], { ...photos[1], key: photos[2].key }, photos[2], photos[3]]),
      saved = await json(await f.put(await f.body(document, first)));
    files = controlledFiles(f);
    pending = f.read();
    await files.untilStarted(2);
    assert.deepEqual(files.started, f.selectedKeys.slice(0, 2)); assert.equal(files.active, 2);
    files.release(f.selectedKeys[1]); await turn(); await turn();
    assert.equal(files.active, 1); assert.equal(files.started.length, 2, 'next pair waits for both current reads');
    files.release(f.selectedKeys[0]); await files.untilStarted(4);
    assert.equal(files.active, 2); assert.equal(files.peak, 2);
    files.release(f.selectedKeys[3]); files.release(f.selectedKeys[2]);
    const read = await json(await pending);
    assert.deepEqual(read.workspace, saved.workspace);
    assert.deepEqual(files.fetched, f.selectedKeys); assert.equal(files.active, 0);
    assert.deepEqual(read.workspace.files, f.selectedKeys.map(key => ({ key,
      sha256: createHash('sha256').update(f.api.objects.get(key)).digest('hex'),
      bytes: f.api.objects.get(key).length, width: 800, height: 1 })));
  } finally { files?.releaseAll(); if (pending) await pending; f.api.close(); }
});

test('workspace proof errors wait for active siblings and return the first key error in document order', async () => {
  const f = await detailWorkspaceFixture(companies[0]); let files, pending;
  try {
    await json(await f.put(await f.body()));
    files = controlledFiles(f, key => key === f.selectedKeys[0] ? { size: f.api.objects.get(key).length + 1 } : { bytes: new Uint8Array([1, 2, 3]), size: 3 });
    let settled = false; pending = f.read().then(response => { settled = true; return response; });
    await files.untilStarted(2);
    files.release(f.selectedKeys[1]); await turn(); await turn();
    assert.equal(settled, false, 'later image format failure must wait for earlier body');
    assert.equal(files.active, 1); assert.equal(files.started.length, 2);
    files.release(f.selectedKeys[0]);
    const response = await pending;
    assert.equal(response.status, 503); assert.match((await response.json()).error, /끝까지/);
    assert.equal(files.active, 0); assert.deepEqual(files.fetched, f.selectedKeys.slice(0, 2));
  } finally { files?.releaseAll(); if (pending) await pending; f.api.close(); }
});

test('a failed first workspace body waits for its still-reading sibling before returning', async () => {
  const f = await detailWorkspaceFixture(companies[0]); let files, pending;
  try {
    await json(await f.put(await f.body()));
    files = controlledFiles(f, key => key === f.selectedKeys[0] ? { error: Error('controlled R2 failure') } : {});
    let settled = false; pending = f.read().then(response => { settled = true; return response; });
    await files.untilStarted(2); files.release(f.selectedKeys[0]); await turn(); await turn();
    assert.equal(settled, false); assert.equal(files.active, 1); assert.equal(files.started.length, 2);
    files.release(f.selectedKeys[1]); assert.equal((await pending).status, 503);
    assert.equal(files.active, 0); assert.deepEqual(files.fetched, f.selectedKeys.slice(0, 2));
  } finally { files?.releaseAll(); if (pending) await pending; f.api.close(); }
});

test('abort during workspace R2 GET cancels both returned bodies and awaits cleanup without reading them', async () => {
  const f = await detailWorkspaceFixture(companies[0]), fetched = deferred(), returned = deferred(), canceled = deferred(); let files, pending;
  try {
    await json(await f.put(await f.body()));
    files = controlledFiles(f, () => {
      if (files.fetched.length === 2) fetched.resolve();
      return { beforeReturn: returned.promise, cancelGate: canceled.promise };
    });
    const controller = new AbortController(); let settled = false;
    pending = f.route.GET(new Request('https://app.test' + f.endpoint + '&optionId=' + encodeURIComponent(f.optionId), { signal: controller.signal }), f.context)
      .then(response => { settled = true; return response; });
    await within(fetched.promise, () => 'both R2 GETs must be active before abort');
    controller.abort(); returned.resolve(); await turn(); await turn();
    assert.deepEqual(files.started, []); assert.deepEqual(files.canceled, f.selectedKeys.slice(0, 2));
    assert.equal(settled, false, 'abort response must await R2 cancellation');
    canceled.resolve(); assert.equal((await pending).status, 503); assert.equal(files.active, 0);
  } finally { returned.resolve(); canceled.resolve(); files?.releaseAll(); if (pending) await pending; f.api.close(); }
});

test('workspace proof accepts exactly 30MiB and reserves every declared size in a pair before reading either body', async () => {
  const f = await detailWorkspaceFixture(companies[0]); let files;
  try {
    await json(await f.put(await f.body()));
    const padded = Buffer.alloc(10 * MiB); padded.set(f.api.objects.get(f.selectedKeys[0]));
    const sizes = [10 * MiB, 10 * MiB, 5 * MiB, 5 * MiB];
    files = controlledFiles(f, key => { const size = sizes[f.selectedKeys.indexOf(key)]; return { size, bytes: padded.subarray(0, size) }; }); files.releaseAll();
    const boundary = await f.read();
    assert.equal(boundary.status, 409, 'all 30MiB must be read before rejecting the changed SHA proof');
    assert.match((await boundary.json()).error, /저장 증거/); assert.deepEqual(files.started, f.selectedKeys); assert.equal(files.active, 0);
    files.fetched.length = 0; files.started.length = 0; sizes[2] = 7 * MiB; sizes[3] = 4 * MiB;
    const response = await f.read();
    assert.equal(response.status, 413); assert.match((await response.json()).error, /30MiB/);
    assert.deepEqual(files.fetched, f.selectedKeys);
    assert.deepEqual(files.started, f.selectedKeys.slice(0, 2), 'neither body in the pair exceeding 30MiB may start');
    assert.deepEqual(files.canceled, f.selectedKeys.slice(2));
    assert.equal(files.active, 0);
  } finally { files?.releaseAll(); f.api.close(); }
});

test('workspace proof missing and oversized objects reject their whole pair before body reads', async () => {
  for (const config of [{ missing: true }, { size: 0 }, { size: 10 * MiB + 1 }]) {
    const f = await detailWorkspaceFixture(companies[0]); let files;
    try {
      await json(await f.put(await f.body()));
      files = controlledFiles(f, key => key === f.selectedKeys[1] ? config : {}); files.releaseAll();
      assert.equal((await f.read()).status, 409); assert.deepEqual(files.started, []);
      assert.deepEqual(files.fetched, f.selectedKeys.slice(0, 2)); assert.equal(files.active, 0);
      assert.deepEqual(files.canceled, config.missing ? f.selectedKeys.slice(0, 1) : f.selectedKeys.slice(0, 2));
    } finally { files?.releaseAll(); f.api.close(); }
  }
});

test('workspace proof keeps actual byte count, streamed byte limit, image dimensions, and SHA validation', async () => {
  for (const mode of ['length', 'stream-limit', 'format', 'dimensions', 'sha']) {
    const f = await detailWorkspaceFixture(companies[0]); let files;
    try {
      await json(await f.put(await f.body()));
      const bytes = mode === 'stream-limit' ? new Uint8Array(10 * MiB + 1) : f.api.objects.get(f.selectedKeys[0]).slice();
      if (mode === 'dimensions') new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(16, 16001);
      if (mode === 'sha') bytes[bytes.length - 1] ^= 1;
      files = controlledFiles(f, key => key !== f.selectedKeys[0] ? {} : mode === 'length' ? { size: bytes.length + 1 } : mode === 'stream-limit' ? { size: 10 * MiB, bytes }
        : mode === 'format' ? { size: 3, bytes: new Uint8Array([1, 2, 3]) } : { bytes }); files.releaseAll();
      const before = f.tables(), response = await f.read();
      assert.equal(response.status, mode === 'length' ? 503 : mode === 'stream-limit' ? 413 : mode === 'dimensions' ? 415 : 409, mode);
      assert.equal(files.active, 0); assert.deepEqual(f.tables(), before, mode + ' must not mutate stored proof');
    } finally { files?.releaseAll(); f.api.close(); }
  }
});
