import { env } from 'cloudflare:workers';
import type { AutomationCommand, AutomationWorkflow } from '@/app/automation/model';

type WorkflowRow = { revision: number; payload: string };
type ReceiptRow = { request_fingerprint: string; response: string };
export type AutomationHistory = { revision: number; action: string; created_at: string; workflow: AutomationWorkflow };

function database() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  return env.DB;
}

async function ensureAutomationDatabase() {
  await database().batch([
    database().prepare(`CREATE TABLE IF NOT EXISTS product_automation (
      product_id TEXT NOT NULL, owner_id TEXT NOT NULL, revision INTEGER NOT NULL,
      product_version TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (product_id, owner_id), FOREIGN KEY (product_id) REFERENCES products(id)
    )`),
    database().prepare(`CREATE TABLE IF NOT EXISTS product_automation_receipts (
      product_id TEXT NOT NULL, owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL, response TEXT NOT NULL, revision INTEGER NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (product_id, owner_id, idempotency_key)
    )`),
    database().prepare(`CREATE TABLE IF NOT EXISTS product_automation_history (
      product_id TEXT NOT NULL, owner_id TEXT NOT NULL, revision INTEGER NOT NULL,
      action TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (product_id, owner_id, revision)
    )`),
  ]);
}

export async function getAutomation(ownerId: string, productId: string): Promise<AutomationWorkflow | null> {
  await ensureAutomationDatabase();
  const row = await database().prepare('SELECT revision, payload FROM product_automation WHERE product_id=? AND owner_id=?')
    .bind(productId, ownerId).first<WorkflowRow>();
  return row ? JSON.parse(row.payload) as AutomationWorkflow : null;
}

export async function getAutomationReceipt(ownerId: string, productId: string, key: string) {
  await ensureAutomationDatabase();
  const row = await database().prepare('SELECT request_fingerprint, response FROM product_automation_receipts WHERE product_id=? AND owner_id=? AND idempotency_key=?')
    .bind(productId, ownerId, key).first<ReceiptRow>();
  return row ? { requestFingerprint: row.request_fingerprint, workflow: JSON.parse(row.response) as AutomationWorkflow } : null;
}

export async function getAutomationHistory(ownerId: string, productId: string): Promise<AutomationHistory[]> {
  await ensureAutomationDatabase();
  const result = await database().prepare('SELECT revision, action, payload, created_at FROM product_automation_history WHERE product_id=? AND owner_id=? ORDER BY revision DESC LIMIT 30')
    .bind(productId, ownerId).all<{ revision: number; action: string; payload: string; created_at: string }>();
  return result.results.map(({ payload, ...row }) => ({ ...row, workflow: JSON.parse(payload) as AutomationWorkflow }));
}

/** Workflow, idempotency receipt and audit history commit together, guarded by both input and workflow versions. */
export async function saveAutomation(ownerId: string, workflow: AutomationWorkflow, previousRevision: number | null, command: AutomationCommand, requestFingerprint: string, source?: { optionRevision: number; settingsPayload: string | null; quotationRevision?: number }): Promise<AutomationWorkflow | null> {
  await ensureAutomationDatabase();
  const payload = JSON.stringify(workflow);
  const sourceSql = source ? `AND COALESCE((SELECT revision FROM product_options WHERE product_id=? AND owner_id=?),0)=?
      AND (SELECT payload FROM workspace_settings WHERE owner_id=?) IS ?
      ${source.quotationRevision === undefined ? '' : 'AND COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=? AND owner_id=?),0)=?'}` : '';
  const sourceArgs = source ? [workflow.productId, ownerId, source.optionRevision, ownerId, source.settingsPayload,
    ...(source.quotationRevision === undefined ? [] : [workflow.productId, ownerId, source.quotationRevision])] : [];
  const result = await database().batch<WorkflowRow>([
    database().prepare(`INSERT INTO product_automation(product_id,owner_id,revision,product_version,payload,updated_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM products WHERE id=? AND owner_id=? AND updated_at=?)
      AND COALESCE((SELECT revision FROM product_content WHERE product_id=? AND owner_id=?),0)=?
      ${sourceSql}
      AND (? IS NULL OR EXISTS (SELECT 1 FROM product_automation WHERE product_id=? AND owner_id=? AND revision=?))
      ON CONFLICT(product_id,owner_id) DO UPDATE SET revision=excluded.revision,product_version=excluded.product_version,
      payload=excluded.payload,updated_at=excluded.updated_at WHERE product_automation.revision=?
      RETURNING revision,payload`)
      .bind(workflow.productId, ownerId, workflow.revision, workflow.productVersion, payload, workflow.updatedAt,
        workflow.productId, ownerId, command.expectedVersion, workflow.productId, ownerId, workflow.contentRevision,
        ...sourceArgs,
        previousRevision, workflow.productId, ownerId, previousRevision, previousRevision),
    database().prepare(`INSERT INTO product_automation_receipts(product_id,owner_id,idempotency_key,request_fingerprint,response,revision,created_at)
      SELECT product_id,owner_id,?,?,?,?,? FROM product_automation WHERE product_id=? AND owner_id=? AND revision=? AND changes()=1`)
      .bind(command.idempotencyKey, requestFingerprint, payload, workflow.revision, workflow.updatedAt, workflow.productId, ownerId, workflow.revision),
    database().prepare(`INSERT INTO product_automation_history(product_id,owner_id,revision,action,payload,created_at)
      SELECT product_id,owner_id,revision,?,?,? FROM product_automation_receipts
      WHERE product_id=? AND owner_id=? AND idempotency_key=? AND changes()=1`)
      .bind(command.action, payload, workflow.updatedAt, workflow.productId, ownerId, command.idempotencyKey),
  ]);
  return result[0].results[0] ? JSON.parse(result[0].results[0].payload) as AutomationWorkflow : null;
}
