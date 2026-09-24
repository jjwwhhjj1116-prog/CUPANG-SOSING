import { env } from 'cloudflare:workers';
import type { QuotationAttributeRules } from '@/app/quotation-attribute-rules';
// Schema contract checked against migration 0007; deployment applies it before serving requests.
export const quotationAttributeRulesSchema = `CREATE TABLE IF NOT EXISTS quotation_attribute_rules (
  owner_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, category_id)
);`;

type Row = { payload: string; revision: number; updated_at: string };
const decode = (row: Row) => ({ rules: JSON.parse(row.payload) as QuotationAttributeRules, revision: row.revision, updatedAt: row.updated_at });
export async function getAttributeRules(owner: string, category: string) {
  const row = await env.DB.prepare('SELECT payload,revision,updated_at FROM quotation_attribute_rules WHERE owner_id=? AND category_id=?').bind(owner, category).first<Row>();
  return row ? decode(row) : null;
}
export async function saveAttributeRules(owner: string, rules: QuotationAttributeRules, revision: number) {
  const payload = JSON.stringify(rules), now = new Date().toISOString();
  const row = revision === 0
    ? await env.DB.prepare(`INSERT INTO quotation_attribute_rules(owner_id,category_id,payload,revision,updated_at)
      SELECT ?,?,?,1,? WHERE (SELECT COUNT(*) FROM quotation_attribute_rules WHERE owner_id=?) < 100
      ON CONFLICT(owner_id,category_id) DO NOTHING RETURNING payload,revision,updated_at`).bind(owner, rules.categoryId, payload, now, owner).first<Row>()
    : await env.DB.prepare(`UPDATE quotation_attribute_rules SET payload=?,revision=revision+1,updated_at=?
      WHERE owner_id=? AND category_id=? AND revision=? RETURNING payload,revision,updated_at`).bind(payload, now, owner, rules.categoryId, revision).first<Row>();
  return row ? decode(row) : null;
}
