import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';

// Compile first. This check uses an ephemeral local bucket and synthetic PNG,
// never a production account, product, browser profile or Supplier Hub record.
const root = path.resolve(import.meta.dirname, '..');
const server = path.join(root, 'dist/server');
const config = JSON.parse(fs.readFileSync(path.join(server, 'wrangler.json'), 'utf8'));
const compiledModules = fs.readdirSync(server, { recursive: true }).filter(file => /\.(?:m?js)$/.test(file))
  .map(file => ({ type: 'ESModule', path: path.join(server, file) }));
const entry = path.resolve(server, config.main);
const mediaEntry = path.join(root, 'dist/public-detail/compiled/public-detail-worker.js');
if (!fs.existsSync(mediaEntry)) throw new Error('Build the image-only Worker with Wrangler --dry-run first.');
compiledModules.sort((a, b) => Number(b.path === entry) - Number(a.path === entry));
const token = 'f'.repeat(64), key = 'quotation-public-detail/' + token;
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const digest = createHash('sha256').update(png).digest('hex');
const fixtureScript = `export default { async fetch(request, env) {
  const bytes = new Uint8Array(${JSON.stringify([...png])});
  if (new URL(request.url).pathname === '/private') { await env.FILES.put('synthetic-owner/private.png',bytes); return new Response('ok'); }
  const stored = await env.FILES.put('${key}', bytes, { onlyIf: new Headers({'If-None-Match':'*'}), sha256:'${digest}',
    httpMetadata:{contentType:'image/png'}, customMetadata:{publication:'yoofam-public-detail-v1',sha256:'${digest}'} });
  return Response.json({created:stored!==null});
} };`;
const runtime = new Miniflare({ workers: [{ name: 'app', modules: compiledModules, modulesRoot: server,
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  r2Buckets: { FILES: 'ephemeral-detail-test' }, d1Databases: ['DB'], bindings: { NODE_ENV: 'production', YOOFAM_AUTH_ENABLED: 'true' },
  serviceBindings: { ASSETS: async () => new Response('Not found', { status: 404 }) },
}, { name: 'media', modules: true, scriptPath: mediaEntry, compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags, r2Buckets: { FILES: 'ephemeral-detail-test' },
}, { name: 'fixture', modules: true, script: fixtureScript, compatibilityDate: config.compatibility_date,
  r2Buckets: { FILES: 'ephemeral-detail-test' } }] });
try {
  const writer = await runtime.getWorker('fixture');
  const media = await runtime.getWorker('media');
  const address = 'https://example.com/media/quotation/' + token;
  const before = await runtime.dispatchFetch(address); assert.equal(before.status, 404); assert.equal(before.headers.get('cache-control'), 'no-store');
  assert.equal((await media.fetch(address)).status, 404);
  assert.equal((await (await writer.fetch('http://fixture/write')).json()).created, true);
  assert.equal((await (await writer.fetch('http://fixture/write')).json()).created, false);
  const response = await runtime.dispatchFetch(address); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  const publicResponse = await media.fetch(address); assert.equal(publicResponse.status, 200);
  assert.deepEqual(new Uint8Array(await publicResponse.arrayBuffer()), png);
  const head = await media.fetch(address, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await media.fetch(address, { method: 'PUT', body: 'ignored' })).status, 405);
  assert.equal((await media.fetch('https://example.com/api/files/synthetic-owner/private.png')).status, 404);
  assert.equal((await media.fetch('https://example.com/')).status, 404);
  assert.equal((await writer.fetch('http://fixture/private')).status, 200);
  assert.equal((await runtime.dispatchFetch('https://example.com/media/quotation/' + 'a'.repeat(64))).status, 404);
  assert.equal((await runtime.dispatchFetch('https://example.com/api/files/synthetic-owner/private.png')).status, 503);
  console.log('Compiled application and image-only Workers + native local R2: anonymous published PNG, GET/HEAD, write/private-path rejection, immutable conditional put, private file isolation passed. No production records used.');
} finally { await runtime.dispose(); }
