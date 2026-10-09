import { env } from 'cloudflare:workers';
import { CategoryProfileConflictError, validateCategoryProfile, type CategoryProfile, type CategoryProfileInput } from '@/app/category-profiles';

export const categoryProfileSchema = `CREATE TABLE IF NOT EXISTS category_profiles (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
type Row = { id: string; payload: string; revision: number; created_at: string; updated_at: string };
async function database() {
  if (!env.DB) throw new Error('D1 unavailable');
  await env.DB.batch([env.DB.prepare(categoryProfileSchema), env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_category_profiles_owner ON category_profiles(owner_id, updated_at)'), env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_category_profiles_owner_id ON category_profiles(owner_id, id)')]);
  return env.DB;
}
function profile(row: Row): CategoryProfile {
  return { ...validateCategoryProfile(JSON.parse(row.payload)), id: row.id, revision: row.revision, verification: 'draft', createdAt: row.created_at, updatedAt: row.updated_at };
}
export async function listCategoryProfiles(ownerId: string, afterId = ''): Promise<CategoryProfile[]> {
  const db = await database();
  return (await db.prepare('SELECT * FROM category_profiles WHERE owner_id=? AND id>? ORDER BY id ASC LIMIT 101').bind(ownerId, afterId).all<Row>()).results.map(profile);
}
export async function getCategoryProfile(ownerId: string, id: string): Promise<CategoryProfile | null> {
  const db = await database();
  const result = await db.prepare('SELECT * FROM category_profiles WHERE owner_id=? AND id=?').bind(ownerId, id).first<Row>();
  return result ? profile(result) : null;
}
export const findCategoryProfile = getCategoryProfile;
export async function createCategoryProfile(ownerId: string, input: CategoryProfileInput, requestId?: string): Promise<CategoryProfile | null> {
  const payload = JSON.stringify(validateCategoryProfile(input));
  const db = await database(); const now = new Date().toISOString();
  // Each category retains its own configuration; request IDs still prevent duplicate retries.
  const result = await db.prepare(`INSERT INTO category_profiles(id,owner_id,payload,revision,created_at,updated_at)
    VALUES (?,?,?,1,?,?)
    ON CONFLICT(id) DO NOTHING RETURNING *`)
    .bind(requestId ?? crypto.randomUUID(), ownerId, payload, now, now).first<Row>();
  if (result) return profile(result);
  if (requestId) {
    const saved = await db.prepare('SELECT * FROM category_profiles WHERE owner_id=? AND id=?').bind(ownerId, requestId).first<Row>();
    if (saved && saved.revision === 1 && saved.payload === payload) return profile(saved);
    if (saved) throw new CategoryProfileConflictError('이미 저장된 카테고리 요청의 내용이 변경되었습니다. 저장 설정을 다시 불러와주세요.');
  }
  return null;
}
export async function updateCategoryProfile(ownerId: string, id: string, expectedRevision: number, input: CategoryProfileInput): Promise<CategoryProfile | null> {
  const payload = JSON.stringify(validateCategoryProfile(input));
  const db = await database();
  const result = await db.prepare(`UPDATE category_profiles SET payload=?, revision=revision+1, updated_at=?
    WHERE owner_id=? AND id=? AND revision=? RETURNING *`)
    .bind(payload, new Date().toISOString(), ownerId, id, expectedRevision).first<Row>();
  return result ? profile(result) : null;
}

/** A refreshed definition is a new configuration. The source and every product
 * linked to it remain unchanged. The receipt is internal, never client input. */
export async function forkCategoryProfileDefinition(ownerId:string,sourceId:string,sourceRevision:number,input:CategoryProfileInput,requestId:string):Promise<CategoryProfile|null>{
  const payload=JSON.stringify({...validateCategoryProfile(input),_definitionSource:{id:sourceId,revision:sourceRevision}});
  const db=await database(),now=new Date().toISOString();
  const result=await db.prepare(`INSERT INTO category_profiles(id,owner_id,payload,revision,created_at,updated_at)
    SELECT ?,?,?,1,?,? WHERE EXISTS (SELECT 1 FROM category_profiles WHERE owner_id=? AND id=? AND revision=?)
    ON CONFLICT(id) DO NOTHING RETURNING *`)
    .bind(requestId,ownerId,payload,now,now,ownerId,sourceId,sourceRevision).first<Row>();
  if(result)return profile(result);
  const saved=await db.prepare(`SELECT * FROM category_profiles WHERE owner_id=? AND id=?
    AND EXISTS (SELECT 1 FROM category_profiles WHERE owner_id=? AND id=? AND revision=?)`)
    .bind(ownerId,requestId,ownerId,sourceId,sourceRevision).first<Row>();
  if(saved&&saved.revision===1&&saved.payload===payload)return profile(saved);
  if(saved)throw new CategoryProfileConflictError('이미 저장된 양식 갱신 요청의 내용이 변경되었습니다. 카테고리 목록을 다시 불러와주세요.');
  return null;
}
