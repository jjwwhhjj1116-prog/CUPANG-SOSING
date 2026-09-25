import { env } from 'cloudflare:workers';
import type { IntakeDraft } from '@/app/intake-draft';
export const intakeDraftSchema = `CREATE TABLE IF NOT EXISTS intake_drafts (
  owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0),
  payload TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
async function database() {
  if (!env.DB) throw Error('D1 unavailable');
  await env.DB.prepare(intakeDraftSchema).run(); return env.DB;
}
type Row = { revision: number; payload: string; updated_at: string };
function decode(row: Row): IntakeDraft {
  const value = JSON.parse(row.payload);
  if (!Array.isArray(value.rows) || typeof value.goal !== 'string') throw Error('Invalid intake draft');
  return { ...value, revision: row.revision, updatedAt: row.updated_at };
}
export async function readIntakeDraft(owner: string): Promise<IntakeDraft> {
  const db = await database(); const row = await db.prepare('SELECT revision,payload,updated_at FROM intake_drafts WHERE owner_id=?').bind(owner).first<Row>();
  return row ? decode(row) : { revision: 0, rows: [], goal: 'price', updatedAt: null };
}
export async function saveIntakeDraft(owner: string, expectedRevision: number, value: Pick<IntakeDraft, 'rows' | 'goal'>) {
  const db = await database(); const now = new Date().toISOString();
  const row = expectedRevision === 0
    ? await db.prepare('INSERT INTO intake_drafts(owner_id,revision,payload,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner_id) DO NOTHING RETURNING revision,payload,updated_at').bind(owner, JSON.stringify(value), now).first<Row>()
    : await db.prepare('UPDATE intake_drafts SET payload=?,revision=revision+1,updated_at=? WHERE owner_id=? AND revision=? RETURNING revision,payload,updated_at').bind(JSON.stringify(value), now, owner, expectedRevision).first<Row>();
  return row ? decode(row) : null;
}
