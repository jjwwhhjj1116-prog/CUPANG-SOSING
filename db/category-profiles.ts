import { env } from 'cloudflare:workers';
import { validateCategoryProfile, type CategoryProfile, type CategoryProfileInput } from '@/app/category-profiles';

export const categoryProfileSchema = `CREATE TABLE IF NOT EXISTS category_profiles (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
type Row = { id: string; payload: string; revision: number; created_at: string; updated_at: string };
async function database() {
  if (!env.DB) throw new Error('D1 unavailable');
  await env.DB.batch([env.DB.prepare(categoryProfileSchema), env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_category_profiles_owner ON category_profiles(owner_id, updated_at)')]);
  return env.DB;
}
function profile(row: Row): CategoryProfile {
  return { ...validateCategoryProfile(JSON.parse(row.payload)), id: row.id, revision: row.revision, verification: 'draft', createdAt: row.created_at, updatedAt: row.updated_at };
}
export async function listCategoryProfiles(ownerId: string): Promise<CategoryProfile[]> {
  const db = await database();
  return (await db.prepare('SELECT * FROM category_profiles WHERE owner_id=? ORDER BY updated_at DESC, id DESC LIMIT 100').bind(ownerId).all<Row>()).results.map(profile);
}
export async function getCategoryProfile(ownerId: string, id: string): Promise<CategoryProfile | null> {
  const db = await database();
  const result = await db.prepare('SELECT * FROM category_profiles WHERE owner_id=? AND id=?').bind(ownerId, id).first<Row>();
  return result ? profile(result) : null;
}
export const findCategoryProfile = getCategoryProfile;
export async function createCategoryProfile(ownerId: string, input: CategoryProfileInput): Promise<CategoryProfile | null> {
  const payload = JSON.stringify(validateCategoryProfile(input));
  const db = await database(); const now = new Date().toISOString();
  // Atomic limit check: simultaneous tabs cannot create unlimited profiles.
  const result = await db.prepare(`INSERT INTO category_profiles(id,owner_id,payload,revision,created_at,updated_at)
    SELECT ?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM category_profiles WHERE owner_id=?) < 100 RETURNING *`)
    .bind(crypto.randomUUID(), ownerId, payload, now, now, ownerId).first<Row>();
  return result ? profile(result) : null;
}
export async function updateCategoryProfile(ownerId: string, id: string, expectedRevision: number, input: CategoryProfileInput): Promise<CategoryProfile | null> {
  const payload = JSON.stringify(validateCategoryProfile(input));
  const db = await database();
  const result = await db.prepare(`UPDATE category_profiles SET payload=?, revision=revision+1, updated_at=?
    WHERE owner_id=? AND id=? AND revision=? RETURNING *`)
    .bind(payload, new Date().toISOString(), ownerId, id, expectedRevision).first<Row>();
  return result ? profile(result) : null;
}
