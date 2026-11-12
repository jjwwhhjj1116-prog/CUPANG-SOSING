import { quotationGeneratedSourceBasis, quotationGeneratedResultPolicy, scopedGeneratedQuotation } from '@/app/quotation-generated-adoption';
import { readProductLabels } from '@/db/product-labels';
import { collectionRegistrationSettings } from '@/app/collection-registration-settings';
import { registrationBrandChoices } from '@/app/quotation-brand-choices';
import { scopedQuotationOverrides, hasLegacyQuotationOverrides, quotationScope } from '@/app/quotation-scopes';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions, readOptionRegistrationNumbers } from '@/db/product-options';
import { getCategoryProfile } from '@/db/category-profiles';
import { readQuotationFields, readQuotationCollectionSource, quotationSourcesCurrent, type QuotationSourceGuard } from '@/db/quotation-fields';
import { getQuotationSchema, resolveQuotationFieldsPair, type QuotationFieldsView } from '@/app/quotation-schema';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import { validateCategoryProfile, type TemplateDefinition } from '@/app/category-profiles';
import { validateCategoryIdentity } from '@/app/category-identity';
import { productImageKeys } from '@/app/product-content';
import { isOwnedImageKey } from '@/app/image-files';
import { parseCollectionRequest } from '@/app/sourcing';
import { fingerprint, productFingerprintSource } from '@/app/automation/model';
import { env } from 'cloudflare:workers';
import { publicDetailConfig, publicDetailVersion, resolvePublicDetail } from '@/app/quotation-public-detail';
import { optionPriceCalculationRevision } from '@/app/product-options';
import { savedProductFingerprintSettings } from '@/app/settings-fingerprint';
import { quotationNoticeBindingFingerprint, quotationLabelsHaveBindings } from '@/app/quotation-notice-inputs';
import { quotationPackagedWeightBindingFingerprint } from '@/app/quotation-packaged-weight';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { verifyCapturedCollectionCompany } from '@/app/collection-company';
import { scopedQuotationPackagingBasis, quotationPackQuantities } from '@/app/quotation-packaging-basis';
import { detailEditorInputs } from '@/app/detail-editor-inputs';
import { currentStageTwoMsrp, scopedStageTwoMsrp } from '@/app/stage-two-msrp';
import { retainedQuotationWorkbook } from '@/app/quotation-workbook-retained';
import { sizeChartRequiredFromSchemaString, type RegistrationLayout } from '@/app/registration-layout';
import {quotationValidationSourceBinding,parseSavedQuotationValidation,currentSavedQuotationValidation,savedQuotationValidationResult} from '@/app/quotation-save-validation';
import {readQuotationValidationActor} from '@/db/quotation-save-validation';


export class QuotationFieldsSnapshotError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
const FieldsError = QuotationFieldsSnapshotError;
const changed = () => new FieldsError('상품·옵션·설정·카테고리 또는 다른 편집 내용이 바뀌었습니다. 입력한 수정값을 보존한 채 최신 자료를 다시 불러와 비교해주세요.', 409, 'QUOTATION_FIELDS_CONFLICT');
async function readSnapshotSource(owner: string, id: string, profileId: string | null) {
  const user = await getChatGPTUser();
  const company = user?.verifiedAccess && user.userId === owner ? approvedSupplierHubCompany(user.membership) : null;
  const product = await findProduct(owner, id);
  if (!product) throw new FieldsError('상품을 찾을 수 없습니다.', 404);
  const [content, options, savedSettings, state, profile, labelsState] = await Promise.all([
    readProductContent(owner, id), readProductOptions(owner, id), getSettings(owner), readQuotationFields(owner, id),
    profileId ? getCategoryProfile(owner, profileId) : Promise.resolve(null), readProductLabels(owner, id),
  ]);
  if (profileId && !profile) throw new FieldsError('카테고리 프로필을 찾을 수 없습니다.', 404);
  let settings = savedRegistrationSettings(savedSettings ? JSON.parse(savedSettings.payload) : null);
  const imageKeys = productImageKeys(product.image_keys).filter(key => isOwnedImageKey(owner, key));
  let categoryContext: QuotationFieldsView['categoryContext'] = { source: 'unknown', profileId: null, categoryId: null, categoryPath: [] };
  let collection: QuotationSourceGuard['collection'] = null;
  let hubSchema=profile?.hubSchema;
  let template=profile?.template;
  let capturedTemplate:TemplateDefinition|null=null;
  if (profile) categoryContext = { source: 'profile', profileId: profile.id, categoryId: profile.categoryId || null, categoryPath: [...profile.categoryPath] };
  {
    let offerId: string | null = null;
    try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* Legacy non-product URLs have no inferred category. */ }
    if (offerId) {
      const source = await readQuotationCollectionSource(owner, offerId, id); collection = { offerId, snapshot: source };
      const captured = source ? JSON.parse(source.payload) : null;
      if (source?.linked) {
        try { verifyCapturedCollectionCompany(captured, company); }
        catch (error) { throw new FieldsError(error instanceof Error ? error.message : '수집 당시 회사를 확인해주세요.', 409, 'QUOTATION_COMPANY_MISMATCH'); }
      }
      if (source?.linked) settings = collectionRegistrationSettings(settings, captured?.settings);
      if (source?.linked && profile) {
        const selected = captured?.category ? validateCategoryProfile(captured.category) : null;
        hubSchema=selected?.hubSchema;
        if (!selected || captured.category.id !== profile.id || selected.categoryId !== profile.categoryId
          || JSON.stringify(selected.categoryPath) !== JSON.stringify(profile.categoryPath)) {
          throw new FieldsError('상품 추가 시 선택한 카테고리와 견적서 양식이 다릅니다. 선택한 카테고리 양식을 사용해주세요.', 409, 'QUOTATION_CATEGORY_MISMATCH');
        }
        capturedTemplate=selected.template;
      }
      if (!profile && captured?.category) {
        const category = validateCategoryProfile(captured.category);
        hubSchema=category.hubSchema;
        template=category.template;
        categoryContext = { source: 'collection', profileId: typeof captured.category.id === 'string' ? captured.category.id : null,
          categoryId: category.categoryId || null, categoryPath: [...category.categoryPath] };
      }
    }
  }
  // Editing and exporting must resolve the same approved company. Membership
  // reassignment cannot turn an older captured form into the new company's form.
  if (company && [hubSchema, profile?.hubSchema].some(schema => schema && (schema.company.code !== company.code || schema.company.name !== company.name))) {
    throw new FieldsError('이 상품의 저장된 상세 양식 회사가 현재 로그인 회사와 다릅니다. 원래 회사의 상품과 양식을 사용해주세요.', 409, 'QUOTATION_COMPANY_MISMATCH');
  }
  if (categoryContext.categoryId) {
    try { validateCategoryIdentity({ categoryId: categoryContext.categoryId, categoryPath: categoryContext.categoryPath }); }
    catch (error) { throw new FieldsError(error instanceof Error ? error.message : '카테고리를 다시 선택해주세요.', 409, 'QUOTATION_CATEGORY_MISMATCH'); }
  }
  const source: QuotationSourceGuard = { productVersion: product.updated_at, imageKeys: product.image_keys, pricingPolicy: product.pricing_policy ?? null,
    contentRevision: content.revision, optionRevision: options.revision, labelRevision: labelsState.revision, settingsPayload: savedSettings?.payload ?? null,
    profile: profile ? { id: profile.id, revision: profile.revision } : null, collection };
  const inputs = { categoryId: categoryContext.categoryId, categoryPath: categoryContext.categoryPath, product, content, options, settings, labelsState,labelSettingsPayload:source.settingsPayload,...(hubSchema?{hubSchema}:{}),...(template?{template}:{}) };
  const registrationLayout: RegistrationLayout = { format: 'yoofam-registration-layout-v1', productId: id, productVersion: product.updated_at,
    categoryContext: { ...categoryContext, categoryPath: [...categoryContext.categoryPath] }, sizeChartRequired: sizeChartRequiredFromSchemaString(hubSchema?.schemaString) };
  return { user, company, state, profile, imageKeys, categoryContext, collection, hubSchema, template, capturedTemplate, source, inputs, registrationLayout };
}

async function snapshot(owner: string, id: string, profileId: string | null) {
  const { user, company, state, profile, imageKeys, categoryContext, collection, hubSchema, template, capturedTemplate, source, inputs, registrationLayout } = await readSnapshotSource(owner, id, profileId);
  const { product, content, options, settings, labelsState } = inputs;
  let generatedProfileFence:QuotationSourceGuard|null=null;
  let generatedAdoption = scopedGeneratedQuotation(state, categoryContext.categoryId, await quotationGeneratedSourceBasis({ ...inputs, categoryContext, source },quotationGeneratedResultPolicy(state,categoryContext.categoryId)));
  // Older collection-context layers remain first; mapped jobs seal the exact recorded profile instead.
  const storedGenerated=categoryContext.categoryId?state.categoryGenerated?.[quotationScope(categoryContext.categoryId)]:undefined;
  if(!generatedAdoption&&!profileId&&collection?.snapshot?.linked&&categoryContext.profileId&&storedGenerated?.entries.length){
    const mapped=await getCategoryProfile(owner,categoryContext.profileId);
    const contract=(schema:typeof hubSchema)=>schema?JSON.stringify({...schema,observedAt:null}):null;
    if(mapped&&mapped.id===categoryContext.profileId&&mapped.categoryId===categoryContext.categoryId
      &&JSON.stringify(mapped.categoryPath)===JSON.stringify(categoryContext.categoryPath)
      &&contract(mapped.hubSchema)===contract(hubSchema)){
      const mappedSource={...source,profile:{id:mapped.id,revision:mapped.revision}};
      generatedProfileFence=mappedSource;
      generatedAdoption=scopedGeneratedQuotation(state,categoryContext.categoryId,await quotationGeneratedSourceBasis({...inputs,categoryContext:{...categoryContext,source:'profile'},source:mappedSource},quotationGeneratedResultPolicy(state,categoryContext.categoryId)));
    }
  }
  const detailConfig = publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]);
  const detailVersion=detailConfig?await publicDetailVersion(detailConfig):null;
  const overrides = scopedQuotationOverrides(state, categoryContext.categoryId);
  const packagingBasis=scopedQuotationPackagingBasis(state,categoryContext.categoryId),optionPackQuantities=quotationPackQuantities(options.rows);
  const pair = resolveQuotationFieldsPair({ ...inputs, overrides, generatedAdoption,...(packagingBasis?{packagingBasis}:{}) });
  const automatic = (await resolvePublicDetail(pair.automatic,content,owner,imageKeys,detailConfig)).resolved;
  const resolved = (await resolvePublicDetail(pair.resolved,content,owner,imageKeys,detailConfig)).resolved;
  if (categoryContext.categoryId && hasLegacyQuotationOverrides(state)) resolved.issues.push('분류가 기록되지 않은 이전 수정값은 자동 적용하지 않았습니다. 자료 다운로드의 quotation-saved-scopes.json에 보존됩니다.');
  const fingerprintInputs = { ...inputs }; delete (fingerprintInputs as Partial<typeof inputs>).labelSettingsPayload; if (!quotationLabelsHaveBindings(labelsState)) delete (fingerprintInputs as Partial<typeof inputs>).labelsState;
  const inputFingerprint = await fingerprint({ inputs: { ...fingerprintInputs, product: productFingerprintSource(inputs.product), settings: savedProductFingerprintSettings(inputs.settings) }, schema: automatic.schema, categoryContext, profileRevision: profile?.revision ?? null, settingsPayload: source.settingsPayload, collection,
    ...(packagingBasis?{packagingBasis}:{}),
    ...quotationNoticeBindingFingerprint(inputs, resolved),
    ...quotationPackagedWeightBindingFingerprint(overrides, resolved, () => automatic),
    ...optionPriceCalculationRevision(product, options.rows, settings),
    ...(detailVersion ? { detailHtml: detailVersion } : {}) });
  // Response-only identifiers follow the saved option UUIDs. Read them after
  // calculating the operation fingerprint and before the source-clock check.
  const optionRegistrationNumbers = product.registration_number ? await readOptionRegistrationNumbers(owner, product, options) : undefined;
  const view: QuotationFieldsView = { revision: state.revision, inputFingerprint, ...(generatedAdoption ? { generatedAdoption } : {}), overrides, legacyOverrides: categoryContext.categoryId ? state.overrides : undefined, resolved, automatic, categoryContext,
    ...(optionRegistrationNumbers === undefined ? {} : { optionRegistrationNumbers }),
    protectedDetailImageKeys: [...new Set([...content.assets.detailTop.value, ...content.assets.detailBottom.value])].filter(key => imageKeys.includes(key)),
    registrationBrandChoices: registrationBrandChoices(settings.brand),
    detailSaveTextBasis: { policy: 'couplus-detail-alt-v1', productName: content.seo.title.value || product.title, metaDescription: content.seo.description.value,
      optionNames: Object.fromEntries(options.rows.map(option => [option.id, option.translatedName])) },
    productVersion: product.updated_at, contentRevision: content.revision, optionRevision: options.revision, imageKeys, updatedAt: state.updatedAt, submissionReady: false };
  const retainedWorkbook=retainedQuotationWorkbook(capturedTemplate,template,resolved.schema,overrides,options.rows.map(option=>option.id),hubSchema);
  if(retainedWorkbook)view.retainedWorkbook=retainedWorkbook;
  view.optionPackQuantities=optionPackQuantities;if(packagingBasis)view.packagingBasis=packagingBasis;
  const stageTwoMsrp=currentStageTwoMsrp(view,scopedStageTwoMsrp(state,categoryContext.categoryId));
  if(stageTwoMsrp)view.stageTwoMsrp=stageTwoMsrp;
  const editorInputs = detailEditorInputs(view, state, id);
  if (editorInputs) view.detailEditorInputs = editorInputs;
  let actor=await readQuotationValidationActor(owner),validationBinding:string|null=null;
  if(!company||JSON.stringify(actor?.company)!==JSON.stringify(company)||actor?.email!==user?.membership?.email.trim().toLowerCase()||actor?.role!==user?.membership?.role)actor=null;
  if(actor)try{validationBinding=await quotationValidationSourceBinding({actor,product,content,options,state,source,schema:resolved.schema,categoryContext,detailVersion,validation:savedQuotationValidationResult(view,id,profileId)});}catch{/* Unconfirmed metadata cannot complete a quotation. */}
  const checked=parseSavedQuotationValidation(state.savedValidation);
  if(checked&&validationBinding&&state.savedValidation?.sourceBinding===validationBinding){view.savedValidation=checked;if(!currentSavedQuotationValidation(view,id))delete view.savedValidation;}
  if(generatedProfileFence&&!await quotationSourcesCurrent(owner,id,generatedProfileFence))throw changed();
  return { view, source, options, labelsState, labelInputs:{product,content,settings}, registrationLayout,state,validationBinding,validationActor:actor,...(generatedAdoption&&generatedProfileFence?{mappedGenerated:{adoption:generatedAdoption,source:generatedProfileFence}}:{}) };
}
export async function stableQuotationFieldsView(owner: string, id: string, profileId: string | null) {
  const saved = await snapshot(owner, id, profileId);
  if (!await quotationSourcesCurrent(owner, id, saved.source)) throw changed();
  return saved;
}

export async function stableRegistrationLayout(owner: string, id: string, profileId: string | null): Promise<RegistrationLayout> {
  const { inputs, registrationLayout, source } = await readSnapshotSource(owner, id, profileId);
  publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]);
  // Use the same category and workbook validation without resolving every option row.
  getQuotationSchema(inputs.categoryId, inputs.categoryPath, inputs.hubSchema, inputs.template);
  if (!await quotationSourcesCurrent(owner, id, source)) throw changed();
  return registrationLayout;
}
