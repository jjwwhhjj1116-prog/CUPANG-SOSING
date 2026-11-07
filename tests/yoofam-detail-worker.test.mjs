import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startDetailWorker } from '../cli/detail-worker.mjs';

const source = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nZkAAAAASUVORK5CYII=' };
const native = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
const line = threadId => JSON.stringify({ type: 'thread.started', thread_id: threadId }) + '\n';

async function run(t, writeResult, options = {}) {
  const base = await realpath(tmpdir()), home = await mkdtemp(join(base, 'yoofam-native-test-')), generated = join(home, 'generated_images');
  await mkdir(generated);
  t.after(async () => {
    const target = await realpath(home);
    assert.equal(dirname(target), base);
    assert.ok(basename(target).startsWith('yoofam-native-test-'));
    await rm(target, { recursive: true, force: true });
  });
  const controller = new AbortController(), calls = [], reports = [], launch = {}, threadId = randomUUID(), requestId = randomUUID();
  const server = {
    signal: controller.signal,
    getState: () => ({ connected: true, pendingCount: 0 }),
    enqueue(command, payload) {
      calls.push({ command, payload });
      if (command === 'detail-image/next') return Promise.resolve({ job: { requestId, prompt: 'synthetic Chinese image' }, image: source });
      controller.abort();
      return Promise.resolve({});
    },
  };
  await startDetailWorker(server, {
    pollMs: 1, timeoutMs: options.timeoutMs ?? 3000, environment: { CODEX_HOME: home },
    report: value => reports.push(value),
    spawnProcess(command, args, spawnOptions) {
      Object.assign(launch, { command, args, spawnOptions });
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough() });
      child.stdin.resume();
      setImmediate(async () => {
        try {
          await writeResult({ ...spawnOptions, generated, threadId, child });
          child.stdout.end();
          child.emit('close', 0);
        } catch (error) {
          child.emit('error', error);
          child.emit('close', 1);
        }
      });
      return child;
    },
  });
  return { launch, calls, reports, requestId };
}

async function writeNative(generated, threadId, image = native) {
  const folder = join(generated, threadId);
  await mkdir(folder);
  const path = join(folder, 'actual.png');
  await writeFile(path, Buffer.from(image.data, 'base64'));
  return path;
}

test('detail worker recovers exactly the current Codex native thread output', async t => {
  const result = await run(t, async ({ generated, threadId, child }) => {
    const unrelated = await writeNative(generated, randomUUID(), source);
    assert.ok(unrelated.endsWith('actual.png'));
    await writeNative(generated, threadId);
    const event = line(threadId);
    child.stdout.write(event.slice(0, 17));
    child.stdout.write(event.slice(17) + '{"type":"turn.completed"}\n');
  });
  assert.ok(result.launch.args.includes('--json'));
  assert.equal(result.launch.spawnOptions.stdio[1], 'pipe');
  assert.deepEqual(result.calls.at(-1), { command: 'detail-image/complete', payload: { requestId: result.requestId, image: native } });
});

test('a valid scratch result remains preferred over native output and malformed stdout', async t => {
  const result = await run(t, async ({ cwd, generated, threadId, child }) => {
    await writeFile(join(cwd, 'result.png'), Buffer.from(native.data, 'base64'));
    await writeNative(generated, threadId, source);
    child.stdout.write('unexpected child output\n');
  });
  assert.equal(result.calls.at(-1).command, 'detail-image/complete');
  assert.deepEqual(result.calls.at(-1).payload.image, native);
});

test('a fresh native PNG is not uploaded after the run deadline', async t => {
  const result = await run(t, async ({ generated, threadId, child }) => {
    await writeNative(generated, threadId);
    child.stdout.write(line(threadId));
    await delay(300);
  }, { timeoutMs: 150 });
  assert.deepEqual(result.calls.at(-1), { command: 'detail-image/fail', payload: { requestId: result.requestId, reason: 'timed-out' } });
});

for (const mode of ['missing-thread', 'foreign-thread', 'ambiguous-thread', 'repeated-thread', 'traversal', 'stale', 'multiple-images', 'invalid-png', 'unchanged', 'linked-directory', 'linked-file', 'oversized-json']) {
  test(`unsafe native output is rejected (${mode})`, async t => {
    const result = await run(t, async ({ cwd, generated, threadId, child }) => {
      if (mode === 'linked-directory') {
        const target = join(cwd, 'outside-generated-tree');
        await mkdir(target);
        await writeFile(join(target, 'image.png'), Buffer.from(native.data, 'base64'));
        try { await symlink(target, join(generated, threadId), 'junction'); }
        catch (error) { if (error.code === 'EPERM') t.skip('Local symlink creation is unavailable'); else throw error; }
      } else if (mode === 'linked-file') {
        const target = await writeNative(generated, randomUUID());
        await mkdir(join(generated, threadId));
        try { await symlink(target, join(generated, threadId, 'image.png'), 'file'); }
        catch (error) { if (error.code === 'EPERM') t.skip('Local symlink creation is unavailable'); else throw error; }
      } else {
        const image = await writeNative(generated, threadId, mode === 'unchanged' ? source : native);
        if (mode === 'stale') await utimes(image, 1, 1);
        if (mode === 'multiple-images') await writeFile(join(generated, threadId, 'second.png'), Buffer.from(native.data, 'base64'));
        if (mode === 'invalid-png') await writeFile(image, Buffer.alloc(100));
      }
      if (mode === 'oversized-json') child.stdout.write(JSON.stringify({ type: 'item.completed', text: 'x'.repeat(9 * 1024 * 1024) }) + '\n');
      if (mode !== 'missing-thread') child.stdout.write(line(mode === 'traversal' ? '../' + threadId : mode === 'foreign-thread' ? randomUUID() : threadId));
      if (mode === 'ambiguous-thread') child.stdout.write(line(randomUUID()));
      if (mode === 'repeated-thread') child.stdout.write(line(threadId));
    });
    assert.deepEqual(result.calls.at(-1), { command: 'detail-image/fail', payload: { requestId: result.requestId, reason: 'processing-failed' } });
  });
}
