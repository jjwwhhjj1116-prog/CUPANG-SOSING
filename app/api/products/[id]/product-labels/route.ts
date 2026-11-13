import {CURRENT_LABEL_POLICY,labelSuggestionBasis,labelSuggestionApplies,validateLabelSuggestions,type LabelSuggestionEntry} from '@/app/product-label-current-rules';
import {savedProductLabelDraftSource} from '@/app/product-label-draft-source';
import {buildProductLabelDraftPlan,processCurrentLabelCandidates,ProductLabelDraftError} from '@/app/product-label-draft';
import {productLabelsSnapshotFromSource,ProductLabelsSnapshotError} from '@/app/product-labels-source-snapshot';
import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getCategoryProfile } from '@/db/category-profiles';
import { readQuotationCollectionSource } from '@/db/quotation-fields';
import { readProductLabels, saveProductLabels, type ProductLabelSourceGuard } from '@/db/product-labels';
import { applyProductLabelChanges, PRODUCT_LABEL_BODY_LIMIT, PRODUCT_LABEL_STORAGE_LIMIT, validateProductLabelChanges, validateProductLabelStructure } from '@/app/product-label';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import { collectionRegistrationSettings } from '@/app/collection-registration-settings';
import { parseCollectionRequest } from '@/app/sourcing';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import {readQuotationFieldsForRequest} from '@/app/quotation-fields-read';
import {QuotationFieldsSnapshotError,stableQuotationFieldsView} from '@/app/quotation-fields-snapshot';
import {PublicDetailError} from '@/app/quotation-public-detail';
import {applyAllProductLabelValues,planAllProductLabels,verifyAllProductLabelTextSave} from '@/app/product-label-all-options';
import type {ProductLabelValues} from '@/app/product-label';

type Context = { params: Promise<{ id: string }> };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
class LabelError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
const conflict = () => new LabelError('상품·옵션·설정·카테고리·견적 또는 표시사항 저장값이 변경되었습니다. 입력을 유지하고 최신 자료를 다시 확인해주세요.', 409, 'PRODUCT_LABELS_CONFLICT');
async function ownerId() {
  const user = await getChatGPTUser();
  if ((process.env.NODE_ENV === 'production' || (env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED === 'true' || process.env.YOOFAM_AUTH_ENABLED === 'true') && !user?.verifiedAccess)
    throw new LabelError('운영 인증 연결 후 표시사항을 편집할 수 있습니다.', 503, 'AUTH_REQUIRED');
  return user?.verifiedAccess && user.userId ? user.userId : await getWorkspaceOwnerId();
}
function selection(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'profileId') || params.getAll('profileId').length > 1) throw new LabelError('카테고리 양식 선택을 확인해주세요.', 400);
  const profileId = params.get('profileId');
  if (profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(profileId)) throw new LabelError('카테고리 양식 선택을 확인해주세요.', 400);
  return profileId;
}
function checkProductId(id: string) {
  if (!/^\w[\w-]{0,99}$/.test(id)) throw new LabelError('상품 식별값을 확인해주세요.', 400);
}
async function readLabelQuotation<T>(read: () => Promise<T>) {
  try { return await read(); }
  catch (error) {
    if (error instanceof QuotationFieldsSnapshotError) throw new LabelError(error.message, error.status, error.code);
    if (error instanceof PublicDetailError) throw new LabelError(error.message, error.status);
    throw new LabelError('견적서 자동 입력 자료와 수정값을 읽거나 저장하지 못했습니다.', 503);
  }
}
async function snapshot(owner: string, id: string, profileId: string | null, request: Request) {
  checkProductId(id);
  const product = await findProduct(owner, id); if (!product) throw new LabelError('상품을 찾을 수 없습니다.', 404);
  const [content, options, savedSettings, state, profile] = await Promise.all([
    readProductContent(owner, id), readProductOptions(owner, id), getSettings(owner), readProductLabels(owner, id),
    profileId ? getCategoryProfile(owner, profileId) : Promise.resolve(null),
  ]);
  if (profileId && !profile) throw new LabelError('카테고리 양식을 찾을 수 없습니다.', 404);
  let settings = savedRegistrationSettings(savedSettings ? JSON.parse(savedSettings.payload) : null);
  let collection: ProductLabelSourceGuard['collection'] = null;
  let offerId: string | null = null;
  try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* Legacy sources have no fabricated collection context. */ }
  if (offerId) {
    const source = await readQuotationCollectionSource(owner, offerId, id); collection = { offerId, snapshot: source };
    if (source?.linked) settings = collectionRegistrationSettings(settings, JSON.parse(source.payload)?.settings);
  }
  // Reuse the actual category/company-aware quotation resolver read-only. This
  // gives the selected final SEO value without guessing legal notice identities
  // or maintaining a competing schema/default initialization path.
  const url = new URL(`/api/products/${encodeURIComponent(id)}/quotation-fields`, request.url);
  if (profileId) url.searchParams.set('profileId', profileId);
  const quotation: QuotationFieldsView = await readLabelQuotation(() => readQuotationFieldsForRequest(new Request(url,{headers:request.headers}),{params:Promise.resolve({id})}));
  return productLabelsSnapshotFromSource({owner,id,profileId,product,content,options,settings,state,quotation,source:{productVersion:product.updated_at,imageKeys:product.image_keys,pricingPolicy:product.pricing_policy??null,contentRevision:content.revision,optionRevision:options.revision,settingsPayload:savedSettings?.payload??null,profile:profile?{id:profile.id,revision:profile.revision}:null,collection}});
}
function failure(error: unknown) {
  if (error instanceof LabelError || error instanceof ProductLabelsSnapshotError || error instanceof ProductLabelDraftError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  return json({ error: '표시사항 저장본을 읽거나 저장하지 못했습니다. 기존 내용과 입력은 유지됩니다.' }, 503);
}
export async function GET(request: Request, context: Context) {
  try {
    const owner = await ownerId(), { id } = await context.params, profileId = selection(request);
    checkProductId(id);
    const saved = await readLabelQuotation(() => stableQuotationFieldsView(owner, id, profileId));
    const source = { ...saved.source };
    // The existing label fingerprint seals its revision separately. Keep that
    // same input for ordinary reads, writes and previously prepared PNGs.
    delete source.labelRevision;
    const { view } = await productLabelsSnapshotFromSource({ owner, id, profileId, ...saved.labelInputs,
      options: saved.options, state: saved.labelsState, source, quotation: saved.view });
    return json(view);
  }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const owner = await ownerId();
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new LabelError('같은 사이트에서 표시사항을 저장해주세요.', 400);
    const body = await readBoundedJson(request, PRODUCT_LABEL_BODY_LIMIT) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedRevision', 'expectedInputFingerprint', 'changes', 'structure','automaticProcessing'].includes(key))
      || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0 || typeof body.expectedInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedInputFingerprint)) throw new LabelError('표시사항 저장 버전과 변경 내용을 확인해주세요.', 400);
    const { id } = await context.params, profileId = selection(request), current = await snapshot(owner, id, profileId, request);
    if (body.expectedRevision !== current.view.revision || body.expectedInputFingerprint !== current.view.inputFingerprint) throw conflict();
    let changes, structure = current.view.structure;
    try {
      if (Object.hasOwn(body, 'structure')) structure = validateProductLabelStructure(body.structure);
      changes = validateProductLabelChanges(body.changes, current.options.rows.map(option => option.id), structure, Object.hasOwn(body, 'structure')||Object.hasOwn(body,'automaticProcessing'));
    }
    catch (error) { throw new LabelError(error instanceof Error ? error.message : '변경한 표시사항 항목을 확인해주세요.', 400); }
    const overrides = applyProductLabelChanges(current.view.overrides, changes, structure);
    let suggestions=validateLabelSuggestions(current.state.automaticSuggestions);
    if(suggestions){suggestions.entries=suggestions.entries.filter(entry=>(structure===undefined||structure.some(field=>field.id===entry.fieldKey))&&!changes.some(change=>change.fieldKey===entry.fieldKey&&(change.optionId===null||change.optionId===entry.optionId)));}
    if(body.automaticProcessing!==undefined){
      const processing=body.automaticProcessing as {optionId:string|null;values:Record<string,string>;candidates?:Record<string,string>};
      if(!processing||typeof processing!=='object'||Array.isArray(processing)||!['optionId,values','candidates,optionId,values'].includes(Object.keys(processing).sort().join(','))||processing.optionId!==null&&!current.options.rows.some(row=>row.id===processing.optionId&&row.included)||!processing.values||typeof processing.values!=='object'||Array.isArray(processing.values)||!Object.keys(processing.values).length||Object.keys(processing.values).some(key=>!['netContents','material','productType'].includes(key))||Object.values(processing.values).some(value=>typeof value!=='string'||value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)))throw new LabelError('표시사항 자동 처리 범위를 확인해주세요.',400);
      const hasCandidates=Object.hasOwn(processing,'candidates');
      if(hasCandidates&&(!processing.candidates||typeof processing.candidates!=='object'||Array.isArray(processing.candidates)||Object.keys(processing.candidates).sort().join(',')!==Object.keys(processing.values).sort().join(',')||Object.values(processing.candidates).some(value=>typeof value!=='string'||value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))))throw new LabelError('표시사항 원문 후보 범위를 확인해주세요.',400);
      const source=await savedProductLabelDraftSource(owner,current,processing.optionId);
      const plan=buildProductLabelDraftPlan(current.view,processing.optionId,source),keys=Object.keys(processing.values);
      if(keys.some(key=>structure!==undefined&&!structure.some(field=>field.id===key)||!plan.fields.some(field=>field.key===key)||changes.some(change=>change.fieldKey===key&&(change.optionId===null||change.optionId===processing.optionId))))throw new LabelError('수동·삭제된 표시사항은 자동 처리할 수 없습니다.',400);
      const selected={...plan,fields:plan.fields.filter(field=>keys.includes(field.key))};
      const response=Object.fromEntries(Object.entries(hasCandidates?processing.candidates!:processing.values).map(([key,value])=>[key==='netContents'?'content':key==='productType'?'type':key,value]));
      const processed=processCurrentLabelCandidates(selected,response),basis=labelSuggestionBasis({content:current.content,options:current.options,settings:current.settings,categoryId:current.quotation.categoryContext.categoryId,categoryPath:current.quotation.categoryContext.categoryPath,overrides:current.quotation.overrides,schema:current.quotation.resolved.schema,settingsPayload:current.source.settingsPayload});
      // Candidates are untrusted lower-authority text, never provider attestation.
      // Recompute once from raw text and prove the reviewed display before any write.
      if(hasCandidates&&keys.some(key=>processed.values[key as LabelSuggestionEntry['fieldKey']]!==processing.values[key]))throw new LabelError('표시사항 후보와 현재 처리 결과가 다릅니다. 초안을 다시 확인해주세요.',400);
      const entries:LabelSuggestionEntry[]=Object.entries(processed.values).map(([fieldKey,value])=>({optionId:processing.optionId,fieldKey:fieldKey as LabelSuggestionEntry['fieldKey'],value:value!,classification:processed.classifications[fieldKey as LabelSuggestionEntry['fieldKey']]!}));
      const existing=suggestions?suggestions.entries.filter(entry=>labelSuggestionApplies(suggestions!,entry.optionId,basis)):[];
      suggestions={policy:CURRENT_LABEL_POLICY,basis,entries:[...existing.filter(entry=>!entries.some(next=>next.optionId===entry.optionId&&next.fieldKey===entry.fieldKey)),...entries]};
    }

    if (new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, productId: id, revision: current.view.revision + 1, overrides, updatedAt: new Date().toISOString(), ...(structure === undefined ? {} : { structure }),
      ...(current.view.renderEpoch === undefined ? {} : { renderEpoch: current.view.renderEpoch }) })).length > PRODUCT_LABEL_STORAGE_LIMIT)
      throw new LabelError('표시사항 저장 한도 512KB를 초과했습니다. 긴 입력을 줄여주세요.', 413);
    if (!await saveProductLabels(owner, id, overrides, current.view.revision, current.source, structure,undefined,suggestions??null)) throw conflict();
    return json((await snapshot(owner, id, profileId, request)).view);
  } catch (error) { return failure(error); }
}

/** Explicit one-label/all-options action. The normal selected/common PUT keeps
 * its existing scope and never silently overwrites other option edits. */
export async function PATCH(request:Request,context:Context){
 try{
  const owner=await ownerId();
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new LabelError('같은 사이트에서 표시사항을 저장해주세요.',400);
  const body=await readBoundedJson(request,PRODUCT_LABEL_BODY_LIMIT) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','sourceOptionId','expectedRevision','expectedInputFingerprint','values','structure'].includes(key))
   ||body.action!=='apply-all-text'||!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<0||typeof body.expectedInputFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedInputFingerprint)
   ||body.sourceOptionId!==null&&(typeof body.sourceOptionId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(body.sourceOptionId)))throw new LabelError('전체 옵션 저장의 검토 대상과 버전을 확인해주세요.',400);
  const {id}=await context.params,profileId=selection(request),current=await snapshot(owner,id,profileId,request);
  if(body.expectedRevision!==current.view.revision||body.expectedInputFingerprint!==current.view.inputFingerprint)throw conflict();
  let structure,overrides,plan;
  try{
   structure=validateProductLabelStructure(body.structure);
   overrides=applyAllProductLabelValues(current.view,body.values as ProductLabelValues,structure);
   plan=planAllProductLabels(current.view,body.sourceOptionId as string|null,body.values as ProductLabelValues,structure);
  }catch(error){throw new LabelError(error instanceof Error?error.message:'검토한 전체 옵션 표시사항을 확인해주세요.',400);}
  if(new TextEncoder().encode(JSON.stringify({schemaVersion:1,productId:id,revision:current.view.revision+1,overrides,structure,updatedAt:new Date().toISOString(),...(current.view.renderEpoch===undefined?{}:{renderEpoch:current.view.renderEpoch})})).length>PRODUCT_LABEL_STORAGE_LIMIT)
   throw new LabelError('표시사항 저장 한도 512KB를 초과했습니다. 기존 내용은 유지됩니다.',413);
  if(!await saveProductLabels(owner,id,overrides,current.view.revision,current.source,structure))throw conflict();
  const after=(await snapshot(owner,id,profileId,request)).view;verifyAllProductLabelTextSave(current.view,after,plan);
  return json(after);
 }catch(error){return failure(error);}
}

/** Explicit regeneration advances only the label render recipe. Existing facts,
 * structure, references and files remain stored until their own reviewed save. */
export async function POST(request: Request, context: Context) {
  try {
    const owner = await ownerId();
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new LabelError('같은 사이트에서 표시사항을 다시 작성해주세요.', 400);
    const body = await readBoundedJson(request, PRODUCT_LABEL_BODY_LIMIT) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedRevision', 'expectedInputFingerprint'].includes(key))
      || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0 || typeof body.expectedInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedInputFingerprint)) throw new LabelError('표시사항 다시 작성 버전을 확인해주세요.', 400);
    const { id } = await context.params, profileId = selection(request), current = await snapshot(owner, id, profileId, request);
    if (body.expectedRevision !== current.view.revision || body.expectedInputFingerprint !== current.view.inputFingerprint) throw conflict();
    if (current.view.revision >= Number.MAX_SAFE_INTEGER || current.view.renderEpoch === Number.MAX_SAFE_INTEGER) throw new LabelError('표시사항 다시 작성 버전 한도를 초과했습니다.', 409, 'PRODUCT_LABELS_CONFLICT');
    const renderEpoch = (current.view.renderEpoch ?? 0) + 1;
    if (new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, productId: id, revision: current.view.revision + 1, overrides: current.view.overrides,
      updatedAt: new Date().toISOString(), ...(current.view.structure === undefined ? {} : { structure: current.view.structure }), renderEpoch })).length > PRODUCT_LABEL_STORAGE_LIMIT)
      throw new LabelError('표시사항 저장 한도 512KB를 초과했습니다. 긴 입력을 줄여주세요.', 413);
    if (!await saveProductLabels(owner, id, current.view.overrides, current.view.revision, current.source, current.view.structure, renderEpoch)) throw conflict();
    return json((await snapshot(owner, id, profileId, request)).view);
  } catch (error) { return failure(error); }
}
