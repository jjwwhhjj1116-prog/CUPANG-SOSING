import { calculatePrice, pricePolicy, type PricePolicy } from '@/app/pricing';
import { defaultSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import type { ProductRecord } from '@/db/queries';
import { contentDetailImageKeys, type ProductContent } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';
import { calculateOptionPrices, resolveOptionPricePolicy, type ProductOptions } from '@/app/product-options';

export const automationStages = ['seo', 'pricing', 'mainImage', 'additionalImages', 'detailImage', 'sizeChart', 'koreanLabel', 'quotation'] as const;
export type AutomationStageId = typeof automationStages[number];
export type AutomationStatus = 'ready' | 'blocked' | 'running' | 'failed' | 'complete' | 'draft';
export type AutomationArtifact = {
  id: string;
  kind: 'priceCalculation' | 'text' | 'image' | 'reviewPackage' | 'supplierQuotation';
  label: string;
  data?: Record<string, unknown>;
  storageKey?: string;
  /** Only a verified Supplier Hub template artifact can be submission ready. */
  submissionReady: boolean;
};
export type AutomationEvidence = {
  kind: 'storedProduct' | 'savedSettings' | 'savedContent' | 'storedAssetReference' | 'localCalculation' | 'providerReceipt' | 'supplierTemplate' | 'suppliedSource';
  reference: string;
  observedAt: string;
};
export type AutomationStage = {
  id: AutomationStageId;
  label: string;
  status: AutomationStatus;
  revision: number;
  attempts: number;
  dependencies: AutomationStageId[];
  reason: { code: string; message: string } | null;
  retryable: boolean;
  artifacts: AutomationArtifact[];
  evidence: AutomationEvidence[];
  updatedAt: string;
};
export type AutomationWorkflow = {
  productId: string;
  productVersion: string;
  contentRevision: number;
  revision: number;
  inputFingerprint: string;
  status: AutomationStatus;
  stages: AutomationStage[];
  createdAt: string;
  updatedAt: string;
};

/** Contract for a future authorized provider; a configured adapter alone is not a payment approval. */
export type PreparationProvider = {
  id: string;
  stages: AutomationStageId[];
  cost: 'free' | 'paid';
  execute(input: {
    product: ProductRecord; stage: AutomationStageId; inputRevision: number;
    idempotencyKey: string; settings: WorkspaceSettings;
  }): Promise<{ artifacts: AutomationArtifact[]; evidence: AutomationEvidence[] }>;
};

const labels: Record<AutomationStageId, string> = {
  seo: 'SEO·상품명 번역', pricing: '가격 계산', mainImage: '대표 이미지',
  additionalImages: '추가 이미지', detailImage: '상세 페이지', sizeChart: '사이즈표',
  koreanLabel: '한글 표시사항', quotation: 'Supplier Hub 견적서',
};
const dependencies: Record<AutomationStageId, AutomationStageId[]> = {
  seo: [], pricing: [], mainImage: [], additionalImages: [], detailImage: ['seo'],
  sizeChart: [], koreanLabel: [], quotation: ['seo', 'pricing', 'mainImage', 'additionalImages', 'detailImage', 'koreanLabel'],
};
const blockers: Partial<Record<AutomationStageId, { code: string; message: string }>> = {
  seo: { code: 'TRANSLATION_PROVIDER_UNCONFIGURED', message: '실제 번역·SEO 실행기가 연결되면 수집 원문으로 생성할 수 있습니다.' },
  mainImage: { code: 'IMAGE_PROVIDER_UNCONFIGURED', message: '원본 이미지의 번역·편집 실행기 연결이 필요합니다.' },
  additionalImages: { code: 'IMAGE_PROVIDER_UNCONFIGURED', message: '옵션별 원본 이미지와 번역·편집 실행기 연결이 필요합니다.' },
  detailImage: { code: 'IMAGE_PROVIDER_UNCONFIGURED', message: '상세 페이지 원문·이미지와 번역·편집 실행기 연결이 필요합니다.' },
  sizeChart: { code: 'MEASUREMENTS_UNVERIFIED', message: '원본의 실제 치수와 단위가 확인되지 않아 사이즈표를 만들지 않았습니다.' },
  koreanLabel: { code: 'LEGAL_INFORMATION_UNVERIFIED', message: '품목별 필수 표시사항·제조국·인증 근거 확인이 필요합니다.' },
  quotation: { code: 'SUPPLIER_TEMPLATE_UNVERIFIED', message: '실제 Supplier Hub 카테고리와 견적서 양식 매핑이 검증되어야 제출용 견적서를 생성할 수 있습니다.' },
};

export const automationCapabilities = {
  localPriceCalculation: true,
  translationProvider: false,
  imageProvider: false,
  verifiedSupplierTemplate: false,
  paidExecutionEnabled: false,
  productionSubmissionEnabled: false,
};

export type AutomationCommand = {
  action: 'plan' | 'run' | 'retry';
  expectedVersion: string;
  idempotencyKey: string;
  stages: AutomationStageId[];
};

export function parseAutomationCommand(input: unknown): AutomationCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('작업 요청 객체가 필요합니다.');
  const body = input as Record<string, unknown>;
  if (!['plan', 'run', 'retry'].includes(String(body.action))) throw new Error('작업 종류를 확인해주세요.');
  if (typeof body.expectedVersion !== 'string' || !Number.isFinite(Date.parse(body.expectedVersion))) throw new Error('상품을 새로고침해주세요.');
  if (typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.idempotencyKey)) throw new Error('유효한 중복 방지 키가 필요합니다.');
  const stages = body.stages === undefined ? [...automationStages] : body.stages;
  if (!Array.isArray(stages) || !stages.length || stages.length > automationStages.length || stages.some(stage => !automationStages.includes(stage))) throw new Error('실행할 단계를 확인해주세요.');
  // No status, result, provider, or approval supplied by a browser is accepted here.
  const permitted = new Set(['action', 'expectedVersion', 'idempotencyKey', 'stages']);
  if (Object.keys(body).some(key => !permitted.has(key))) throw new Error('클라이언트가 실행 결과나 승인 상태를 지정할 수 없습니다.');
  return { action: body.action as AutomationCommand['action'], expectedVersion: body.expectedVersion, idempotencyKey: body.idempotencyKey, stages: automationStages.filter(stage => stages.includes(stage)) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export async function fingerprint(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function currentTranslation(product: ProductRecord, content: ProductContent | null, job: TranslationJob | null) {
  return job?.status === 'completed' && job.result && job.productId === product.id && job.productVersion === product.updated_at && job.contentRevision === (content?.revision ?? 0) ? job : null;
}

export function automationInputFingerprint(product: ProductRecord, settings: WorkspaceSettings, content: ProductContent | null, translation: TranslationJob | null = null, options: ProductOptions | null = null) {
  if(options && options.productId!==product.id)throw new Error('옵션과 상품이 일치하지 않습니다.');
  const current = currentTranslation(product, content, translation);
  return fingerprint({ product, settings, content, options, translation: current ? { id: current.id, responseId: current.result!.responseId, fingerprint: current.review.fingerprint } : null });
}

export function policyForProduct(product: ProductRecord, settings: WorkspaceSettings): PricePolicy {
  if (product.pricing_policy) return pricePolicy(JSON.parse(product.pricing_policy));
  return pricePolicy({ ...settings, exchangeRate: product.exchange_rate, supplyMargin: product.supply_margin,
    coupangMargin: product.coupang_margin, minimumMargin: settings.minimumMarginEnabled ? settings.minimumMargin : 0 });
}

export function deriveWorkflowStatus(stages: AutomationStage[]): AutomationStatus {
  if (stages.some(stage => stage.status === 'running')) return 'running';
  if (stages.some(stage => stage.status === 'failed')) return 'failed';
  if (stages.every(stage => stage.status === 'complete')) return 'complete';
  if (stages.some(stage => stage.status === 'ready')) return 'ready';
  if (stages.every(stage => stage.status === 'complete' || stage.status === 'draft')) return 'draft';
  return 'blocked';
}

export function explainProviderAvailability(workflow: AutomationWorkflow, providers: { translationProvider: boolean; imageProvider: boolean }) {
  const copy = structuredClone(workflow);
  for (const stage of copy.stages) {
    if (stage.status !== 'blocked') continue;
    if (stage.id === 'seo' && stage.reason?.code === 'TRANSLATION_PROVIDER_UNCONFIGURED' && providers.translationProvider) stage.reason = { code: 'PAID_TRANSLATION_APPROVAL_REQUIRED', message: 'SEO 메뉴에서 실제 원문·모델·유료 요청을 검토하고 승인한 뒤 번역을 실행해주세요.' };
    if (['mainImage', 'additionalImages', 'detailImage'].includes(stage.id) && stage.reason?.code === 'IMAGE_PROVIDER_UNCONFIGURED' && providers.imageProvider) stage.reason = { code: 'PAID_IMAGE_APPROVAL_REQUIRED', message: '이미지 메뉴에서 원본·요청·유료 범위를 검토하고 가공을 실행해주세요. 생성 결과는 역할 지정 전 초안입니다.' };
  }
  return copy;
}

function savedDrafts(stages: AutomationStage[], product: ProductRecord, content: ProductContent | null, now: string) {
  if (!content) return;
  const revision = { productVersion: product.updated_at, contentRevision: content.revision };
  const evidence: AutomationEvidence[] = [
    { kind: 'storedProduct', reference: `${product.id}@${product.updated_at}`, observedAt: now },
    { kind: 'savedContent', reference: `${product.id}:content@${content.revision}`, observedAt: content.updatedAt ?? now },
  ];
  const draftReason = { code: 'SAVED_DRAFT_REVIEW_REQUIRED', message: '저장된 초안이 있습니다. 원문 사실·정확성·제출 요건은 별도로 검토해야 합니다.' };
  const hasSeo = content.seo.title.value.trim() || content.seo.description.value.trim() || content.seo.keywords.value.some(value => value.trim());
  if (hasSeo) {
    const seo = stages.find(stage => stage.id === 'seo')!;
    seo.status = 'draft'; seo.reason = draftReason; seo.attempts = 0; seo.retryable = false;
    seo.artifacts = [{ id: `saved-seo-${content.revision}`, kind: 'text', label: '저장된 SEO·상품명 초안 · 검토 필요', submissionReady: false,
      data: { draft: structuredClone(content.seo), ...revision, appliedToContent: true, provenanceScope: 'savedContentFields',
        providerExecutionVerified: false, sourceCollectionVerified: false, reviewRequired: true } }];
    seo.evidence = structuredClone(evidence); seo.updatedAt = content.updatedAt ?? now;
  }
  let ownedKeys = new Set<string>();
  try {
    const keys: unknown = JSON.parse(product.image_keys);
    if (Array.isArray(keys)) ownedKeys = new Set(keys.filter((key): key is string => typeof key === 'string' && key.startsWith(`${product.owner_id}/`) && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key.slice(product.owner_id.length + 1))));
  } catch { /* Invalid or missing product references cannot establish a saved image draft. */ }
  const roles = { mainImage: 'main', additionalImages: 'additional', detailImage: 'detail', sizeChart: 'size', koreanLabel: 'label' } as const;
  for (const [id, role] of Object.entries(roles) as [keyof typeof roles, typeof roles[keyof typeof roles]][]) {
    const field = content.assets[role];
    const imageKeys = id === 'detailImage' ? contentDetailImageKeys(content) : field.value;
    if (!imageKeys.length) continue;
    const stage = stages.find(item => item.id === id)!;
    const requested = [...new Set(imageKeys)];
    const valid = requested.filter(key => ownedKeys.has(key));
    const missing = requested.length - valid.length;
    stage.status = missing ? 'blocked' : 'draft'; stage.attempts = 0; stage.retryable = false;
    stage.reason = missing ? { code: 'SAVED_ASSET_REFERENCE_MISSING', message: `저장된 ${labels[id]} 참조 ${missing}개가 현재 상품의 이미지 목록에 없습니다. 파일을 다시 첨부하거나 역할을 수정해주세요.` }
      : { code: 'SAVED_DRAFT_REVIEW_REQUIRED', message: `저장된 ${labels[id]} 초안 ${valid.length}개가 있습니다. 첨부 참조를 확인했으며 파일 내용·원문 사실·표시사항의 적합성은 별도 검토가 필요합니다.` };
    const sourceField = (key: string) => id === 'detailImage'
      ? (['detailTop', 'detail', 'detailBottom'] as const).map(role => content.assets[role]).find(item => item?.value.includes(key)) ?? field : field;
    stage.artifacts = valid.map((storageKey, index) => ({ id: `saved-${role}-${content.revision}-${index}`, kind: 'image', label: `저장된 ${labels[id]} 초안 ${index + 1} · 검토 필요`, storageKey, submissionReady: false,
      data: { role, ...revision, provenance: sourceField(storageKey).provenance, provenanceScope: 'savedRoleAssignment', assetOrigin: 'unverified',
        providerExecutionVerified: false, sourceCollectionVerified: false, fileContentVerified: false, legalCorrectnessVerified: false, reviewRequired: true } }));
    stage.evidence = [...structuredClone(evidence), ...valid.map(reference => ({ kind: 'storedAssetReference' as const, reference, observedAt: sourceField(reference).updatedAt ?? content.updatedAt ?? now }))];
    stage.updatedAt = id === 'detailImage' ? content.updatedAt ?? now : field.updatedAt ?? content.updatedAt ?? now;
  }
}

export async function planAutomation(product: ProductRecord, settings: WorkspaceSettings = defaultSettings, previous: AutomationWorkflow | null = null, content: ProductContent | null = null, translation: TranslationJob | null = null, now = new Date().toISOString(), options: ProductOptions | null = null): Promise<AutomationWorkflow> {
  if (content && content.productId !== product.id) throw new Error('콘텐츠와 상품이 일치하지 않습니다.');
  const inputFingerprint = await automationInputFingerprint(product, settings, content, translation, options);
  const sameInput = previous?.inputFingerprint === inputFingerprint && previous.productVersion === product.updated_at;
  const stages: AutomationStage[] = automationStages.map(id => {
    const prior = previous?.stages.find(stage => stage.id === id);
    if (sameInput && prior) return structuredClone(prior);
    return { id, label: labels[id], status: id === 'pricing' ? 'ready' : 'blocked', revision: (prior?.revision ?? 0) + 1,
      attempts: 0, dependencies: [...dependencies[id]], reason: blockers[id] ?? null, retryable: false,
      artifacts: [], evidence: [], updatedAt: now };
  });
  savedDrafts(stages, product, content, now);
  const translated = currentTranslation(product, content, translation);
  if (translated) {
    const result = translated.result!; const seo = stages.find(stage => stage.id === 'seo')!;
    seo.status = 'draft'; seo.reason = { code: 'TRANSLATION_DRAFT_NOT_APPLIED', message: 'AI 번역 초안이 생성됐습니다. SEO 메뉴에서 검토 후 상품에 적용해주세요. 기존 저장값은 유지됩니다.' }; seo.attempts = 1; seo.retryable = false;
    const savedArtifacts = seo.artifacts.filter(artifact => artifact.id.startsWith('saved-seo-'));
    const savedEvidence = seo.evidence.filter(item => item.kind === 'savedContent' || item.kind === 'storedProduct');
    seo.artifacts = [{ id: translated.id, kind: 'text', label: 'AI 한국어 번역·SEO 초안 · 검토 필요',
      data: { draft: result.draft, provenance: result.provenance, appliedToContent: false, productVersion: product.updated_at,
        contentRevision: content?.revision ?? 0, providerExecutionVerified: true, sourceCollectionVerified: false, reviewRequired: true }, submissionReady: false }, ...savedArtifacts];
    seo.evidence = [{ kind: 'providerReceipt', reference: `OpenAI:${result.responseId}:${result.model}`, observedAt: result.generatedAt },
      { kind: 'suppliedSource', reference: `${translated.review.source.provenance}:${translated.review.fingerprint}`, observedAt: translated.createdAt }, ...savedEvidence];
    seo.updatedAt = result.generatedAt;
  }
  return { productId: product.id, productVersion: product.updated_at, contentRevision: content?.revision ?? 0, revision: (previous?.revision ?? 0) + 1,
    inputFingerprint, status: deriveWorkflowStatus(stages), stages, createdAt: previous?.createdAt ?? now, updatedAt: now };
}

/** Only deterministic, free work runs here. Provider side effects require a durable claim before an adapter can be enabled. */
export function executeLocalAutomation(workflow: AutomationWorkflow, product: ProductRecord, settings: WorkspaceSettings, command: AutomationCommand, now = new Date().toISOString(), options: ProductOptions | null = null): AutomationWorkflow {
  if(options && options.productId!==product.id)throw new Error('옵션과 상품이 일치하지 않습니다.');
  const result = structuredClone(workflow);
  if (command.action === 'plan') return result;
  for (const stage of result.stages) {
    if (!command.stages.includes(stage.id) || stage.status === 'complete' || stage.status === 'running') continue;
    // Replanning after a connector is configured is different from retrying a failed attempt.
    if (command.action === 'retry' && (stage.status !== 'failed' || !stage.retryable)) continue;
    if (command.action === 'run' && stage.status !== 'ready') continue;
    if (stage.id !== 'pricing') continue;
    stage.attempts += 1;
    stage.updatedAt = now;
    try {
      const policy = resolveOptionPricePolicy(product, settings).policy;
      if(options && (options.rows.length || options.revision>0)) {
        const included=options.rows.filter(row=>row.included);
        if(!included.length)throw new Error('견적에 포함할 옵션을 선택해주세요.');
        const rows=calculateOptionPrices(included,policy);
        stage.artifacts=rows.map(row=>({id:`pricing-${stage.revision}-${row.optionId}`,kind:'priceCalculation',
          label:`${included.find(option=>option.id===row.optionId)!.translatedName || included.find(option=>option.id===row.optionId)!.originalName || row.optionId} · 옵션 가격`,
          data:{...row,policy,optionRevision:options.revision,appliedToProduct:false},submissionReady:false}));
        const failed=rows.filter(row=>row.error||!row.calculation);
        if(failed.length){
          stage.status='failed';stage.reason={code:'INVALID_OPTION_PRICE_INPUT',message:`옵션 ${failed.length}개의 원가·구성 수량을 확인해주세요. 각 옵션의 계산 결과에 실패 원인을 표시했습니다.`};
          stage.retryable=false;stage.evidence=[{kind:'localCalculation',reference:`sourceflow.calculateOptionPrices:options@${options.revision}`,observedAt:now}];
          continue;
        }
      } else {
        const calculation = calculatePrice(product.source_price_cny, policy);
        stage.artifacts = [{ id: `pricing-${stage.revision}`, kind: 'priceCalculation', label: '저장 원가 기준 가격 계산',
          data: { sourcePriceCny: product.source_price_cny, policy, calculation, appliedToProduct: false }, submissionReady: false }];
      }
      stage.evidence = [
        { kind: 'storedProduct', reference: `${product.id}@${product.updated_at}`, observedAt: now },
        { kind: 'savedSettings', reference: product.pricing_policy ? 'product.pricing_policy' : 'workspace_settings + product exchange/margins', observedAt: now },
        { kind: 'localCalculation', reference: 'sourceflow.calculatePrice.v1', observedAt: now },
        ...(options ? [{kind:'localCalculation' as const,reference:`sourceflow.calculateOptionPrices:options@${options.revision}`,observedAt:now}] : []),
      ];
      stage.status = 'complete'; stage.reason = null; stage.retryable = false;
    } catch (error) {
      stage.status = 'failed'; stage.reason = { code: 'INVALID_PRICE_INPUT', message: error instanceof Error ? error.message : '저장된 원가나 가격 정책을 수정한 뒤 다시 실행해주세요.' };
      stage.retryable = false; stage.artifacts = []; stage.evidence = [];
    }
  }
  result.status = deriveWorkflowStatus(result.stages);
  result.updatedAt = now;
  return result;
}
