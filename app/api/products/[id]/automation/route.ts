import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { listTranslationJobs } from '@/db/translation-jobs';
import { translationConfiguration, type TranslationSecrets } from '@/app/automation/translation';
import { imageConfiguration, type ImageSecrets } from '@/app/automation/image-edit';
import { getAutomation, getAutomationReceipt, getAutomationHistory, saveAutomation } from '@/db/automation';
import { automationCapabilities, parseAutomationCommand, fingerprint, automationInputFingerprint, planAutomation, executeLocalAutomation, explainProviderAvailability } from '@/app/automation/model';
import { savedRegistrationSettings } from '@/app/workspace-settings';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const unavailable = () => json({ error: '작업 상태를 저장하거나 읽지 못했습니다. 새로고침하여 저장 여부를 확인해주세요.' }, 503);
const conflict = () => json({ error: '상품 또는 작업이 변경되었습니다. 새로고침한 뒤 다시 실행해주세요.', code: 'AUTOMATION_VERSION_CONFLICT' }, 409);
const capabilities = () => ({ ...automationCapabilities, translationProvider: translationConfiguration(env as TranslationSecrets).configured, imageProvider: imageConfiguration(env as ImageSecrets).configured });

export async function GET(_request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 작업 상태를 사용할 수 있습니다.' }, 503);
  try {
    const owner = await getWorkspaceOwnerId();
    const { id } = await context.params;
    const product = await findProduct(owner, id);
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const [workflow, history, savedSettings, content, translations] = await Promise.all([getAutomation(owner, id), getAutomationHistory(owner, id), getSettings(owner), readProductContent(owner, id), listTranslationJobs(owner, id)]);
    const settings = savedRegistrationSettings(savedSettings ? JSON.parse(savedSettings.payload) : null);
    const translation = translations.find(job => job.status === 'completed' && job.productVersion === product.updated_at && job.contentRevision === content.revision) ?? null;
    const inputFingerprint = workflow ? await automationInputFingerprint(product, settings, content, translation) : null;
    return json({ workflow: workflow ? explainProviderAvailability(workflow, capabilities()) : null, history, stale: Boolean(workflow && workflow.inputFingerprint !== inputFingerprint), capabilities: capabilities() });
  } catch { return unavailable(); }
}

export async function POST(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 작업 실행을 사용할 수 있습니다.' }, 503);
  let command;
  try { command = parseAutomationCommand(await request.json()); }
  catch (error) { return json({ error: error instanceof Error ? error.message : '입력을 확인해주세요.' }, 400); }
  try {
    const owner = await getWorkspaceOwnerId();
    const { id } = await context.params;
    const product = await findProduct(owner, id);
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const requestFingerprint = await fingerprint(command);
    const receipt = await getAutomationReceipt(owner, id, command.idempotencyKey);
    if (receipt) return receipt.requestFingerprint === requestFingerprint
      ? json({ workflow: receipt.workflow, replayed: true, capabilities: capabilities() })
      : json({ error: '같은 중복 방지 키를 다른 요청에 사용할 수 없습니다.', code: 'IDEMPOTENCY_CONFLICT' }, 409);
    if (product.updated_at !== command.expectedVersion) return conflict();
    const [previous, savedSettings, content, translations] = await Promise.all([getAutomation(owner, id), getSettings(owner), readProductContent(owner, id), listTranslationJobs(owner, id)]);
    const settings = savedRegistrationSettings(savedSettings ? JSON.parse(savedSettings.payload) : null);
    const translation = translations.find(job => job.status === 'completed' && job.productVersion === product.updated_at && job.contentRevision === content.revision) ?? null;
    const plan = explainProviderAvailability(await planAutomation(product, settings, previous, content, translation), capabilities());
    if (command.action === 'retry' && !plan.stages.some(stage => command.stages.includes(stage.id) && stage.status === 'failed' && stage.retryable)) {
      return json({ error: '재시도 가능한 실패 단계가 없습니다. 입력을 수정했다면 실행 버튼으로 새 계산을 시작해주세요.', code: 'NO_RETRYABLE_STAGES' }, 409);
    }
    const workflow = executeLocalAutomation(plan, product, settings, command);
    try {
      const saved = await saveAutomation(owner, workflow, previous?.revision ?? null, command, requestFingerprint);
      if (saved) return json({ workflow: saved, replayed: false, capabilities: capabilities() });
      const committed = await getAutomationReceipt(owner, id, command.idempotencyKey);
      if (committed?.requestFingerprint === requestFingerprint) return json({ workflow: committed.workflow, replayed: true, capabilities: capabilities() });
      return conflict();
    } catch {
      // A concurrent copy of the same request may have committed first.
      const concurrent = await getAutomationReceipt(owner, id, command.idempotencyKey);
      if (concurrent?.requestFingerprint === requestFingerprint) return json({ workflow: concurrent.workflow, replayed: true, capabilities: capabilities() });
      if (concurrent) return json({ error: '같은 중복 방지 키를 다른 요청에 사용할 수 없습니다.', code: 'IDEMPOTENCY_CONFLICT' }, 409);
      return unavailable();
    }
  } catch { return unavailable(); }
}
