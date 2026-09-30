import fs from 'node:fs';
import path from 'node:path';
import { assertProductionArtifactConfig } from '../deployment/cloudflare-config.mjs';

const root = path.resolve(import.meta.dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'dist/server/wrangler.json'), 'utf8'));
const hosting = JSON.parse(fs.readFileSync(path.join(root, '.openai/hosting.json'), 'utf8'));
assertProductionArtifactConfig(app, hosting);
const directory = path.join(root, 'dist/public-detail');
fs.mkdirSync(directory, { recursive: true });
const config = {
  name: 'yoofam-plus-media', account_id: app.account_id,
  main: '../../deployment/public-detail-worker.ts', tsconfig: '../../tsconfig.json',
  compatibility_date: app.compatibility_date, compatibility_flags: app.compatibility_flags,
  workers_dev: true, preview_urls: false,
  r2_buckets: [{ binding: 'FILES', bucket_name: app.r2_buckets[0].bucket_name }],
};
fs.writeFileSync(path.join(directory, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
console.log('Image-only Worker configuration prepared from the verified application account and FILES bucket. No deployment performed.');
