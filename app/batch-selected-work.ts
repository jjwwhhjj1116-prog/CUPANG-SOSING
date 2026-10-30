import { automationStages, type AutomationStageId } from '@/app/automation/model';
import {batchBoardSource,type BatchBoardSource} from '@/app/batch-board-feedback';
import { supplierHubCompany } from '@/app/supplier-hub-company';
import { collectedTranslationAttributes } from '@/app/collected-translation-attributes';
import { optionTranslationBatch } from '@/app/option-translation';
import { collectionSourceReference } from '@/app/sourcing';
import { createSeoWorkspaceDraftState, parseSeoWorkspaceDraftState, runSeoWorkspaceDraft,refreshSeoWorkspaceDraft,
  readSeoGenerationContext,createSeoGenerationDraftState,parseSeoGenerationDraftState,runSeoGenerationDraft,parseSeoGenerationConfiguration,type SeoGenerationConfiguration } from '@/app/seo-workspace-draft';
import { GOOGLE_TEXT_MODEL, WORKERS_QWEN_MODEL, type TranslationSource, type TranslationView } from '@/app/automation/translation';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptionsResponse } from '@/app/product-options';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationAiJobForScope, quotationReviewedProposalChanges, quotationSavedSourceChanges, quotationAiViewCurrent, type QuotationAiView, type QuotationAiJobView } from '@/app/quotation-ai-client';
import { confirmQuotationFieldsSave } from '@/app/quotation-fields-confirmation';
import { processSelectedImageStage, createSelectedImageStageState, type SelectedImageStageState } from '@/app/batch-selected-image-work';
import { runSelectedLabelWork } from '@/app/batch-selected-label-work';
import { readRegistrationLayout } from '@/app/registration-layout';
import { runSelectedPricingWork } from '@/app/batch-selected-pricing-work';
import { runSelectedPackagingWork } from '@/app/batch-selected-packaging-work';

export type SelectedBatchStageResult = { id: AutomationStageId; status: 'waiting'|'running'|'draft'|'complete'|'blocked'|'failed'|'skipped'; message: string;boardSource?:BatchBoardSource };
type Controls = { stages: readonly AutomationStageId[]; mode?:'full'|'selected'; expectedOwnerId: string; signal: AbortSignal; fetcher: typeof fetch;
  keys: Map<string,string>; newKey:()=>string; onStage:(result:SelectedBatchStageResult)=>void;seoGenerationConsent?:SeoGenerationConfiguration;retryFailedQwen?:boolean };
type Outcome = Pick<SelectedBatchStageResult,'status'|'message'> & {uncertain?:boolean;stop?:boolean};
// The request owns keys across React remounts; keep binary image recovery state
// with that same lifetime without persisting source images in localStorage.
const imageRunStates=new WeakMap<Map<string,string>,Map<string,SelectedImageStageState>>();
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
class ScopeChanged extends Error {}

/** A toolbar request drafts the selected stages; it never transmits a product.
 * Keep ambiguous writes in the request ledger instead of retrying on remount. */
export async function runSelectedBatchProduct(productId:string, controls:Controls):Promise<{productId:string;stages:SelectedBatchStageResult[]}|null>{
  const {signal,keys}=controls;
  let imageStates=imageRunStates.get(keys);
  if(!imageStates){imageStates=new Map();imageRunStates.set(keys,imageStates);}
  if(signal.aborted)return null;
  if(!/^[\w-]{1,100}$/u.test(productId)||!/^[\w-]{1,100}$/u.test(controls.expectedOwnerId)
    ||controls.mode!==undefined&&!['full','selected'].includes(controls.mode)
    ||!controls.stages.length||new Set(controls.stages).size!==controls.stages.length||controls.stages.some(id=>!automationStages.includes(id)))
    throw Error('작업 상품·계정·단계를 확인해주세요.');
  const base='/api/products/'+encodeURIComponent(productId), identity=controls.expectedOwnerId+':'+productId;
  async function responseJson(response:Response, operation:string):Promise<unknown>{
    signal.throwIfAborted();
    const format=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
    if(response.redirected||response.type==='opaqueredirect'||response.status>=300&&response.status<400)
      throw Error(`${operation}: 서버가 로그인 또는 다른 화면으로 이동했습니다 (HTTP ${response.status}).`);
    if(format!=='application/json')throw Error(`${operation}: 서버가 데이터 대신 다른 형식을 반환했습니다 (HTTP ${response.status}, ${format||'형식 없음'}).`);
    let body:unknown;
    try{body=await response.json();}catch{throw Error(`${operation}: 서버의 JSON 응답을 읽지 못했습니다 (HTTP ${response.status}).`);}
    signal.throwIfAborted();
    if(!response.ok)throw Error(object(body)&&typeof body.error==='string'?body.error:'작업 서버 응답을 확인하지 못했습니다.');
    return body;
  }
  async function account(){
    signal.throwIfAborted();
    const body=await responseJson(await controls.fetcher('/api/supplier-hub/catalog-context',{cache:'no-store',signal,credentials:'same-origin',redirect:'error'}),'작업 계정·회사 확인');
    if(!object(body)||body.ownerId!==controls.expectedOwnerId||!object(body.company)||!supplierHubCompany(body.company.code,body.company.name))
      throw new ScopeChanged('로그인 계정·회사가 변경되어 작업을 멈췄습니다.');
    return {ownerId:body.ownerId,company:supplierHubCompany(body.company.code,body.company.name)!};
  }
  const expected=await account();
  const scopeKey='batch-owner:'+controls.expectedOwnerId;
  if(keys.has(scopeKey)&&keys.get(scopeKey)!==JSON.stringify(expected))throw new ScopeChanged('작업을 시작한 회사가 변경되어 선택 상품 작업을 중단했습니다.');
  keys.set(scopeKey,JSON.stringify(expected));
  const assertCurrent=async()=>{if(!same(await account(),expected))throw new ScopeChanged('로그인 회사가 변경되어 작업을 멈췄습니다.');};
  const fetcher:typeof fetch=async(input,init)=>{
    signal.throwIfAborted();
    if(init?.method&&!['GET','HEAD'].includes(init.method.toUpperCase()))await assertCurrent();
    const requestSignal=init?.signal?AbortSignal.any([signal,init.signal]):signal;
    const response=await controls.fetcher(input,{...init,signal:requestSignal});
    signal.throwIfAborted();
    if(init?.method&&!['GET','HEAD'].includes(init.method.toUpperCase()))await assertCurrent();
    return response;
  };
  const read=async<T>(suffix:string)=>await responseJson(await fetcher(base+suffix,{cache:'no-store',credentials:'same-origin',redirect:'error'}),`상품 ${suffix||'/'} 조회`) as T;
  const post=async<T>(suffix:string,body:unknown,method='POST')=>await responseJson(await fetcher(base+suffix,{method,credentials:'same-origin',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),`상품 ${suffix} 저장`) as T;
  const boardObservation:{current:BatchBoardSource|null}={current:null};
  let boardSourceLost=false;
  const product=async()=>{
    const value=await read<{product:{id:string;owner_id?:string;updated_at:string;title:string;source_url?:string;image_keys?:string;content_summary?:unknown}}>('');
    if(value.product?.id!==productId||!Number.isFinite(Date.parse(value.product.updated_at))
      ||value.product.owner_id!==undefined&&value.product.owner_id!==controls.expectedOwnerId)throw new ScopeChanged('현재 상품을 확인하지 못했습니다.');
    boardObservation.current=batchBoardSource(value.product);
    return value.product;
  };
  let activeStage:AutomationStageId|null=null;
  const stageWrites=new Set<string>();
  const once=async<T>(name:string,operation:()=>Promise<T>)=>{
    const key=identity+':write:'+name;
    if(keys.has(key))throw Error('이전 작업의 저장 결과를 단계 편집에서 먼저 확인해주세요. 같은 요청을 다시 보내지 않았습니다.');
    if(activeStage)keys.set(identity+':pending:'+activeStage,'저장 결과 확인 필요');
    keys.set(key,'submitted');stageWrites.add(key);
    const result=await operation();keys.set(key,'confirmed');return result;
  };
  async function translateSeoOptions():Promise<Outcome>{
    const current=await product();
    const [history,contentBody,source,options,registration]=await Promise.all([
      read<TranslationView>('/translation'),read<{content:ProductContent}>('/content'),
      read<{productId:string;productVersion:string;jobId:string;sourceUrl:string;title:string;description:string;attributes:{name:string;value:string}[];
        requestContext:{categoryId:string;categoryPath:string[];features:string;keywords:string}|null}>('/translation-source'),
      read<ProductOptionsResponse>('/options'),read<{productId:string;settings:{brand:string}}>('/registration-settings')]);
    const content=contentBody.content;
    if(source.productId!==productId||source.productVersion!==current.updated_at||content?.productId!==productId
      ||options.options?.productId!==productId||options.productVersion!==current.updated_at||registration.productId!==productId
      ||!source.requestContext?.categoryId||!Array.isArray(source.requestContext.categoryPath)||!source.requestContext.categoryPath.length)
      return {status:'blocked',message:'수집 원문과 공식 카테고리를 먼저 연결해주세요.'};
    const attributes=collectedTranslationAttributes(source.attributes),batch=optionTranslationBatch(options.options,50-attributes.length,history.jobs);
    if(!batch.total)return{status:'skipped',message:'저장한 옵션 번역과 직접 수정한 값을 유지했습니다.'};
    if(!history.configuration.configured)return{status:'blocked',message:'번역 서비스 설정을 확인해주세요.'};
    if(history.configuration.model!==GOOGLE_TEXT_MODEL)return{status:'blocked',message:'SEO 편집에서 설정된 AI 서비스의 실행 안내를 확인해주세요.'};
    const input:TranslationSource={title:source.title,description:source.description,attributes:batch.attributes,provenance:'manual',
      reference:collectionSourceReference(source.jobId,source.sourceUrl),category:{id:source.requestContext.categoryId,path:source.requestContext.categoryPath},
      guidance:{features:source.requestContext.features,keywords:source.requestContext.keywords}};
    const stateKey=identity+':seo-options:'+current.updated_at+':'+content.revision;
    const stored=keys.get(stateKey),state=stored?parseSeoWorkspaceDraftState(stored,productId):createSeoWorkspaceDraftState({
      productId,productVersion:current.updated_at,contentRevision:content.revision,source:input,configuration:history.configuration,
      memo:{brand:registration.settings.brand,features:source.requestContext.features,keywords:source.requestContext.keywords}});
    if(!state)throw Error('이전 SEO 실행 정보를 확인하지 못했습니다. SEO 이력을 확인해주세요.');
    keys.set(stateKey,JSON.stringify(state));
    keys.set(identity+':pending:seo','SEO 실행 결과 확인 필요');
    const generated=await runSeoWorkspaceDraft(state,{signal,fetcher,onState:value=>keys.set(stateKey,JSON.stringify(value))});
    if(generated.job?.status!=='completed'||!generated.job.result)return{status:'blocked',message:generated.message,uncertain:!generated.closed};
    const request={jobId:generated.job.id,expectedVersion:current.updated_at,scope:'options'};
    const plan=await post<{productId:string;productVersion:string;contentRevision:number;optionRevision:number;fingerprint:string;preview:unknown[]}>('/translation-apply',{...request,action:'preview'});
    if(plan.productId!==productId||plan.productVersion!==current.updated_at||!hash(plan.fingerprint)||!Array.isArray(plan.preview))throw Error('옵션 번역 적용 범위가 현재 상품과 다릅니다.');
    if(!plan.preview.length)return{status:generated.partial?'blocked':'skipped',message:'새로 적용할 번역이 없습니다. 수동 수정값을 유지했습니다. '+(generated.partial?'일부 원문 번역을 확인해주세요.':'')};
    const saved=await once('seo:'+plan.fingerprint,()=>post<{productId:string;productVersion:string;contentRevision:number;optionRevision:number;applied:number}>('/translation-apply',{...request,action:'apply',fingerprint:plan.fingerprint}));
    if(saved.productId!==productId||!(Date.parse(saved.productVersion)>Date.parse(current.updated_at))||saved.contentRevision!==plan.contentRevision+1
      ||saved.optionRevision!==plan.optionRevision+1||saved.applied!==plan.preview.length)throw Error('SEO 저장 결과를 확인하지 못했습니다. 저장본을 확인해주세요.');
    return{status:generated.partial||batch.remaining?'blocked':'draft',message:'Google 옵션 번역 '+saved.applied+'개 항목을 저장했습니다.'+(generated.partial?' 일부 원문 번역을 확인해주세요.':'')+(batch.remaining?' 남은 옵션 항목 '+batch.remaining+'개는 추가 작업이 필요합니다.':'')};
  }
  async function qwenSeo(consent:SeoGenerationConfiguration):Promise<Outcome>{
    const pendingKey=identity+':pending:seo',hadPending=keys.has(pendingKey);
    const configuration=consent.translationConfig;
    if(!configuration?.configured||configuration.model!==WORKERS_QWEN_MODEL||configuration.freeOnly!==false)
      return{status:'blocked',message:'Qwen 번역 설정을 확인하지 못해 실행하지 않았습니다. '+(configuration?.issues.join(' ')??''),uncertain:hadPending};
    await assertCurrent();const current=await product();
    const [view,history,contentBody,options]=await Promise.all([
      readSeoGenerationContext(productId,signal,fetcher),read<TranslationView>('/translation'),read<{content:ProductContent}>('/content'),read<ProductOptionsResponse>('/options')]);
    await assertCurrent();
    if(view.productVersion!==current.updated_at||!same(view.company,expected.company)||contentBody.content?.productId!==productId||contentBody.content.revision!==view.contentRevision
      ||options.options?.productId!==productId||options.productVersion!==current.updated_at||options.options.revision!==view.optionRevision)
      throw new ScopeChanged('Qwen 번역 상품·원문·옵션·회사가 변경되어 작업을 멈췄습니다.');
    if(!same(parseSeoGenerationConfiguration(view.configuration),consent)||history.configuration.configured!==true
      ||history.configuration.model!==configuration.model||history.configuration.maxOutputTokens!==configuration.maxOutputTokens)
      return{status:'blocked',message:'작업 개시 전에 본 Qwen 모델·출력 한도·비용 안내와 현재 설정이 달라 실행하지 않았습니다.',uncertain:hadPending};
    const attributes=view.source.attributes,batch=optionTranslationBatch(options.options,50-attributes.length,history.jobs);
    const input:TranslationSource={...view.source,attributes:[...attributes,...batch.attributes]};
    const stateKey=identity+':seo-qwen:'+current.updated_at+':'+view.contentRevision+':'+view.optionRevision,pointerKey=identity+':seo-qwen-current';
    const previousKey=controls.retryFailedQwen===true?keys.get(pointerKey)??stateKey:stateKey,stored=keys.get(previousKey);
    let state=stored?parseSeoWorkspaceDraftState(stored,productId):null;
    const create=()=>createSeoWorkspaceDraftState({productId,productVersion:current.updated_at,contentRevision:view.contentRevision,source:input,configuration:history.configuration,memo:view.memo});
    if(controls.retryFailedQwen===true){
      if(!state?.jobId)return{status:'blocked',message:'확인된 실패 Qwen 요청이 없어 새 요청을 만들지 않았습니다. 필요한 단계로 새 작업을 시작해주세요.',uncertain:hadPending};
      if([...keys.keys()].some(key=>key.startsWith(identity+':write:seo-qwen:'))||hadPending&&keys.get(pendingKey)!=='Qwen 번역 결과 확인 필요')
        return{status:'blocked',message:'이전 Qwen 적용·저장 결과를 먼저 확인해주세요. 새 번역 요청을 만들지 않았습니다.',uncertain:true};
      const previous=state;
      const recovered=await refreshSeoWorkspaceDraft(previous,{signal,fetcher,onState:value=>keys.set(previousKey,JSON.stringify(value))});
      await assertCurrent();
      if(recovered.job?.status!=='failed'||!recovered.closed)return{status:recovered.job?.status==='completed'?'skipped':'blocked',message:'같은 Qwen 요청의 현재 상태만 확인했습니다. 실패로 확인된 요청만 새 초안으로 재시도할 수 있습니다.',uncertain:hadPending||!recovered.closed};
      const facts=(value:TranslationSource)=>({title:value.title,description:value.description,attributes:value.attributes,reference:value.reference,category:value.category});
      if(!same(facts(input),facts(previous.source))||!same(view.memo,previous.memo)||previous.configuration.model!==history.configuration.model||previous.configuration.maxOutputTokens!==history.configuration.maxOutputTokens)
        throw new ScopeChanged('실패 요청 이후 Qwen 원문·참고 입력·설정이 변경됐습니다. 기존 이력을 유지하고 필요한 단계로 새 작업을 시작해주세요.');
      const fresh=create();
      if(!same(fresh.source,previous.source)||!same(fresh.memo,previous.memo)||!same(fresh.configuration,previous.configuration))
        throw new ScopeChanged('실패 요청 이후 Qwen 원문·참고 입력·설정이 변경됐습니다. 기존 이력을 유지하고 필요한 단계로 새 작업을 시작해주세요.');
      state=fresh;
      if(previousKey!==stateKey)keys.delete(previousKey);
      keys.delete(pendingKey);
    }else if(!stored)state=create();
    if(!state)throw Error('이전 Qwen 실행 정보를 확인하지 못했습니다. 새 요청은 만들지 않았습니다.');
    keys.set(pointerKey,stateKey);keys.set(stateKey,JSON.stringify(state));keys.set(pendingKey,'Qwen 번역 결과 확인 필요');
    const generated=await runSeoWorkspaceDraft(state,{signal,fetcher,confirmAi:true,onState:value=>keys.set(stateKey,JSON.stringify(value))});
    await assertCurrent();
    if(generated.job?.status!=='completed'||!generated.job.result)return{status:'blocked',message:generated.message,uncertain:!generated.closed};
    const request={jobId:generated.job.id,expectedVersion:current.updated_at,scope:'all',linkQuotationSeoDefaults:true};
    const plan=await post<{scope:string;productId:string;productVersion:string;contentRevision:number;optionRevision:number;fingerprint:string;preview:unknown[]}>('/translation-apply',{...request,action:'preview'});
    if(plan.scope!=='all'||plan.productId!==productId||plan.productVersion!==current.updated_at||plan.contentRevision!==view.contentRevision||plan.optionRevision!==view.optionRevision||!hash(plan.fingerprint)||!Array.isArray(plan.preview))
      throw Error('Qwen SEO·옵션·표시 속성 적용 범위가 현재 상품과 다릅니다.');
    const partial=generated.partial||batch.remaining>0;
    if(!plan.preview.length)return{status:partial?'blocked':'skipped',message:'Qwen 초안을 확인했으며 새로 적용할 값이 없어 직접 수정한 값과 공란을 유지했습니다.'+(partial?' 일부 원문·남은 옵션은 해당 단계에서 확인해주세요.':'')};
    const saved=await once('seo-qwen:'+plan.fingerprint,()=>post<{scope:string;productId:string;productVersion:string;contentRevision:number;optionRevision:number;applied:number}>('/translation-apply',{...request,action:'apply',fingerprint:plan.fingerprint}));
    if(saved.scope!=='all'||saved.productId!==productId||!(Date.parse(saved.productVersion)>Date.parse(current.updated_at))||saved.contentRevision!==plan.contentRevision+1||saved.optionRevision!==plan.optionRevision+1||saved.applied!==plan.preview.length)
      throw Error('Qwen 저장 결과를 확인하지 못했습니다. 같은 요청을 다시 적용하지 말고 저장본을 확인해주세요.');
    return{status:partial?'blocked':'draft',message:'Cloudflare Workers AI Qwen SEO·옵션·표시 속성 '+saved.applied+'개 항목의 저장을 확인했습니다. 직접 수정한 값과 공란은 유지했습니다.'+(generated.partial?' 일부 원문 번역을 확인해주세요.':'')+(batch.remaining?' 남은 옵션 '+batch.remaining+'개는 추가 작업이 필요합니다.':'')};
  }
  async function seo():Promise<Outcome>{
    const consent=parseSeoGenerationConfiguration(controls.seoGenerationConsent);
    if(consent?.translationConfig)return qwenSeo(consent);
    const translated=await translateSeoOptions();
    if(translated.uncertain||translated.stop)return translated;
    const message=translated.message+' ';
    if(!consent)return{status:'blocked',message:message+'Cloudflare Workers AI의 실제 무료 한도 안내를 확인한 작업 개시가 필요합니다. Google 번역을 AI SEO 생성 완료로 표시하지 않았습니다.'};
    await assertCurrent();const before=await product(),view=await readSeoGenerationContext(productId,signal,fetcher);await assertCurrent();
    if(view.productVersion!==before.updated_at||!same(view.company,expected.company))throw new ScopeChanged('SEO 생성 상품·회사·원문이 변경되어 작업을 멈췄습니다.');
    const configuration=parseSeoGenerationConfiguration(view.configuration);
    if(!configuration||!same(configuration,consent)||!configuration.configured)return{status:'blocked',message:message+'무료 SEO 생성 설정이 없거나 작업 개시 전에 본 안내와 달라 실행하지 않았습니다. '+(configuration?.issues.join(' ')??'')};
    const {content}=await read<{content:ProductContent}>('/content');
    if(content.productId!==productId||content.revision!==view.contentRevision)throw new ScopeChanged('SEO 생성 중 저장한 상품 내용이 변경됐습니다.');
    if((['title','keywords','description'] as const).every(key=>content.seo[key].provenance==='manual'))return{status:translated.status==='blocked'?'blocked':'skipped',message:message+'직접 저장한 SEO와 공란을 모두 유지했습니다. AI 생성은 실행하지 않았습니다.'};
    const stateKey=identity+':seo-generation:'+view.productVersion+':'+view.contentRevision,stored=keys.get(stateKey),state=stored?parseSeoGenerationDraftState(stored,productId):createSeoGenerationDraftState(view);
    if(!state)throw Error('이전 SEO 생성 요청을 확인하지 못했습니다. 새 요청은 만들지 않았습니다.');
    keys.set(stateKey,JSON.stringify(state));keys.set(identity+':pending:seo','SEO 생성 결과 확인 필요');
    const generated=await runSeoGenerationDraft(state,{signal,fetcher,confirmAi:true,onState:value=>keys.set(stateKey,JSON.stringify(value))});
    await assertCurrent();
    if(generated.job?.status!=='completed'||!generated.job.result)return{status:'blocked',message:message+generated.message,uncertain:!generated.closed};
    const request={jobId:generated.job.id,expectedVersion:view.productVersion,linkQuotationSeoDefaults:true};
    const plan=await post<{purpose:string;scope:string;productId:string;productVersion:string;contentRevision:number;optionRevision:number;fingerprint:string;preview:unknown[]}>('/seo-generation',{...request,action:'preview'});
    if(plan.purpose!=='seo-generation'||plan.scope!=='all'||plan.productId!==productId||plan.productVersion!==view.productVersion||plan.contentRevision!==view.contentRevision||plan.optionRevision!==view.optionRevision||!hash(plan.fingerprint)||!Array.isArray(plan.preview))throw Error('생성된 SEO 적용 범위가 현재 상품과 다릅니다.');
    if(!plan.preview.length)return{status:translated.status==='blocked'?'blocked':'skipped',message:message+'AI SEO 초안을 확인했으며 새로 적용할 값이 없어 수동 수정값과 공란을 유지했습니다.'};
    const saved=await once('seo-generation:'+plan.fingerprint,()=>post<{purpose:string;scope:string;productId:string;productVersion:string;contentRevision:number;optionRevision:number;applied:number}>('/seo-generation',{...request,action:'apply',fingerprint:plan.fingerprint}));
    if(saved.purpose!=='seo-generation'||saved.scope!=='all'||saved.productId!==productId||!(Date.parse(saved.productVersion)>Date.parse(view.productVersion))||saved.contentRevision!==plan.contentRevision+1||saved.optionRevision!==plan.optionRevision+1||saved.applied!==plan.preview.length)throw Error('AI SEO 저장 결과를 확인하지 못했습니다. 같은 요청을 다시 적용하지 말고 저장본을 확인해주세요.');
    return{status:translated.status==='blocked'?'blocked':'draft',message:message+'Cloudflare Workers AI 생성 SEO '+saved.applied+'개 항목의 저장을 확인했습니다. 직접 수정값은 유지했습니다.'};
  }
  async function pricing():Promise<Outcome>{
    return runSelectedPricingWork(productId,{fetcher,signal,assertCurrent});
  }
  async function image(id:'mainImage'|'additionalImages'|'detailImage'):Promise<Outcome>{
    const role=({mainImage:'main',additionalImages:'additional',detailImage:'detail'} as const)[id];
    const stateKey=identity+':'+id;
    const inferenceLatch=identity+':vision-inference-pending',pendingInference=keys.get(inferenceLatch);
    if(pendingInference&&pendingInference!==stateKey)return{status:'blocked',message:'앞선 이미지 번역 응답이 확정되지 않아 추가 이미지 호출을 멈췄습니다. 표시사항·견적서 등 독립된 단계는 계속 진행합니다.'};
    const current=await product();
    let state=imageStates!.get(stateKey),expectedProductVersion:string|undefined;
    keys.set(identity+':pending:'+id,'이미지 저장 결과 확인 필요');
    if(!state){
      const prepared=await post<{productId:string;productVersion:string}>('/work-draft',{expectedVersion:current.updated_at,roles:[role]});
      if(prepared.productId!==productId||!(Date.parse(prepared.productVersion)>=Date.parse(current.updated_at)))throw Error('수집 이미지 연결 결과를 확인하지 못했습니다.');
      expectedProductVersion=prepared.productVersion;
      state=createSelectedImageStageState(controls.expectedOwnerId,productId,role);imageStates!.set(stateKey,state);
    }
    const result=await processSelectedImageStage(productId,role,{state,ownerId:controls.expectedOwnerId,signal,fetcher,expectedProductVersion,isCurrent:()=>!signal.aborted,
      onProgress:message=>controls.onStage({id,status:'running',message})});
    if(result.sourceChanged)boardSourceLost=true;
    if(result.inferencePending)keys.set(inferenceLatch,stateKey);
    else if(pendingInference===stateKey)keys.delete(inferenceLatch);
    if(result.status!=='uncertain'&&!result.sourceChanged){
      const savedVersion=result.productVersion??state.view?.productVersion??expectedProductVersion??current.updated_at;
      if((await product()).updated_at!==savedVersion)throw new ScopeChanged('이미지 작업 중 상품·원본 또는 저장값이 변경되어 뒤의 작업을 멈췄습니다. 확인된 저장본은 유지했습니다.');
    }
    if(['completed','skipped'].includes(result.status))imageStates!.delete(stateKey);
    // A confirmed partial needs correction in this stage, but is not an
    // ambiguous write. Other selected stages can use the current saved source.
    // Recovery stays a read-only action; scope changes still stop the run.
    return{status:result.status==='completed'?'draft':result.status==='skipped'?'skipped':'blocked',message:result.messages.join(' '),uncertain:result.status==='uncertain',stop:result.recovered||result.sourceChanged};
  }
  async function sizeChart():Promise<Outcome>{
    const current=await product();
    const [{content},rawLayout]=await Promise.all([read<{content:ProductContent}>('/content'),read<unknown>('/registration-layout')]);
    const layout=readRegistrationLayout(rawLayout,productId,current.updated_at);
    if(content?.productId!==productId)throw Error('사이즈표 상품이 다릅니다.');
    return content.assets.size.value.length||content.manualSizeChart
      ?{status:'draft',message:'저장된 사이즈표를 유지했습니다. 사이즈표 편집에서 검토할 수 있습니다.'}
      :layout.sizeChartRequired?{status:'blocked',message:'이 카테고리는 사이즈표가 필수입니다. 사이즈표 편집에서 원본을 선택하거나 표를 작성해주세요.'}
      :{status:'skipped',message:'저장된 사이즈표 원본이 없어 생략했습니다. 필요하면 사이즈표 편집에서 원본을 선택해주세요.'};
  }
  async function quotation():Promise<Outcome>{
    let view=await read<QuotationFieldsView>('/quotation-fields');
    const state=await read<QuotationAiView>('/quotation-ai');
    if(!quotationAiViewCurrent(state,view,productId))throw Error('견적서와 AI 작성 원문이 다릅니다.');
    const aiConfigured=state.configuration.configured;
    let job=aiConfigured?quotationAiJobForScope(state,view,productId,null,true):null;
    if(aiConfigured&&!job){
      const key=identity+':quote:'+state.fingerprint;
      if(!keys.has(key))keys.set(key,controls.newKey());
      keys.set(identity+':pending:quotation','견적서 AI 실행 결과 확인 필요');
      const result=await post<{job:QuotationAiJobView;sourceCurrent?:boolean}>('/quotation-ai',{action:'generate',profileId:null,
        expectedFingerprint:state.fingerprint,expectedQuotationRevision:view.revision,optionId:null,applyToAllOptions:true,idempotencyKey:keys.get(key)});
      if(result.sourceCurrent===false)throw Error('견적 작성 중 자료가 변경됐습니다.');
      job=result.job;
    }
    const failed=aiConfigured&&job?.status==='failed'&&job.error?.uncertain===false
      &&job.fingerprint===state.fingerprint&&job.quotationRevision===view.revision&&job.profileId===view.categoryContext.profileId
      &&job.scope?.optionId===null&&job.scope.applyToAllOptions===true;
    if(aiConfigured&&(!job||job.status!=='completed')&&!failed)return{status:'blocked',message:job?.error?.message??'견적서 AI 실행 결과를 먼저 확인해주세요. 중복 실행하지 않았습니다.',uncertain:true};
    // Use the same reviewed merge as the interactive editor. The server's
    // knownChanges includes exact saved option/label sources; recomputing from
    // product content alone silently drops material, country, quantity, etc.
    const knownChanges=quotationSavedSourceChanges(state,view,productId,null,true);
    const changes=quotationReviewedProposalChanges(state,view,productId,job?.status==='completed'?job:null,null,true);
    const aiCount=changes.length-knownChanges.length;
    const {content}=await read<{content:ProductContent}>('/content');
    if(content?.productId!==productId||content.schemaVersion!==1||content.revision!==view.contentRevision)
      throw new ScopeChanged('견적 작성 중 저장된 표시사항 원본이 변경되어 작업을 멈췄습니다.');
    if(changes.length){
      const previous=view;
      view=await once('quotation:'+(job?.id??'saved-notice:'+view.inputFingerprint),()=>post<QuotationFieldsView>('/quotation-fields',{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes},'PUT'));
      confirmQuotationFieldsSave(previous,view,changes);
    }
    const packaging=await once('packaging:'+view.inputFingerprint,()=>runSelectedPackagingWork(productId,{view,signal,fetcher,assertCurrent}));
    view=packaging.view;
    const missing=view.resolved.rows.filter(row=>row.included).flatMap(row=>view.resolved.schema.fields.filter(field=>field.required
      &&(!row.fields[field.id]?.value.trim()||row.fields[field.id]?.validationIssues?.length)).map(field=>field.label));
    const incomplete=missing.length>0||packaging.status==='incomplete'||packaging.remaining>0;
    const knownMessage=knownChanges.length?'저장된 표시·옵션 정보 '+knownChanges.length+'개를 적용했습니다. ':'저장된 표시·옵션 정보는 기존 값을 유지했습니다. ';
    const message=(failed?'견적서 AI 실패: '+job!.error!.message+' '+knownMessage
      :aiConfigured?'견적서 AI 항목 '+aiCount+'개'+(knownChanges.length?' · 저장된 표시·옵션 정보 '+knownChanges.length+'개':'')+'를 저장했습니다. '
      :'견적서 AI가 설정되지 않아 AI 작성은 실행하지 않았습니다. '+knownMessage)+packaging.message;
    return{status:!aiConfigured||failed||incomplete?'blocked':'draft',message:message+(missing.length?' 필수 입력 확인: '+[...new Set(missing)].slice(0,8).join(', ')+'.':incomplete?' 남은 포장값은 7단계에서 확인해주세요.':!aiConfigured||failed?' AI 설정·실행 이력과 견적 내용을 확인해주세요.':' 견적서에서 최종 검토 후 등록전송할 수 있습니다.')};
  }
  const result:SelectedBatchStageResult[]=automationStages.filter(id=>controls.stages.includes(id)).map(id=>({id,status:'waiting',message:'실행 대기'}));
  const publish=(index:number,outcome:Outcome)=>{result[index]={id:result[index].id,status:outcome.status,message:outcome.message,...(boardObservation.current?{boardSource:{...boardObservation.current}}:{})};controls.onStage({...result[index]});};
  const holdRemaining=(index:number)=>{
    for(let next=index+1;next<result.length;next++)publish(next,{status:'blocked',message:'앞 단계의 처리·저장 결과를 확인해야 하므로 이 단계는 아직 시작하지 않았습니다. 해당 단계만 선택해 별도로 작업할 수 있습니다.'});
  };
  for(let index=0;index<result.length;index++){
    if(signal.aborted)return null;
    const id=result[index].id;activeStage=id;
    stageWrites.clear();
    const failedQwenRead=controls.retryFailedQwen===true&&id==='seo'&&keys.get(identity+':pending:seo')==='Qwen 번역 결과 확인 필요'&&!!parseSeoGenerationConfiguration(controls.seoGenerationConsent)?.translationConfig;
    if(keys.has(identity+':pending:'+id)&&!imageStates.has(identity+':'+id)&&!failedQwenRead){
      publish(index,{status:'blocked',message:'이전 저장 결과를 단계 편집에서 먼저 확인해주세요. 뒤의 작업은 시작하지 않았습니다.'});holdRemaining(index);break;
    }
    publish(index,{status:'running',message:'선택한 단계 작업 중…'});
    try{
      await assertCurrent();
      if(controls.mode==='full'){
        // Read the same server-derived saved-source projection as the board.
        // The older automation model calls adopted manual work a draft, so
        // using its workflow alone repeats already-completed paid stages.
        // No board cache or client completion flag is accepted here.
        const current=await product(),summary=current.content_summary;
        await assertCurrent();
        // Missing legacy/failed optional metadata is unknown, never complete.
        // A non-null malformed positive projection must not trigger either a
        // skip or automatic replacement of the saved stage.
        if(summary!==undefined&&summary!==null&&(!object(summary)||summary.stages!==undefined&&(current.owner_id!==controls.expectedOwnerId
          ||typeof summary.seo!=='boolean'||typeof summary.missingImages!=='boolean'
          ||summary.seoTitle!==null&&typeof summary.seoTitle!=='string'||summary.mainImageKey!==null&&typeof summary.mainImageKey!=='string'
          ||['main','additional','detail','label'].some(role=>!Number.isSafeInteger(summary[role])||Number(summary[role])<0)
          ||!object(summary.stages)||Object.keys(summary.stages).length!==automationStages.length
          ||automationStages.some(stage=>{const value=(summary.stages as Record<string,unknown>)[stage];return!object(value)
            ||!['pending','complete','failed','running','unused'].includes(String(value.state))||typeof value.detail!=='string'||!value.detail.trim();}))))
          throw new ScopeChanged('전체 작업의 저장 단계 확인값이 현재 회원·상품과 다릅니다. 목록을 다시 확인해주세요.');
        if(object(summary)&&object(summary.stages)&&object(summary.stages[id])&&summary.stages[id].state==='complete'){
          publish(index,{status:'skipped',message:'현재 저장본에서 완료된 단계라 전체 작업에서 건너뛰었습니다. 다시 작업하려면 이 단계만 선택해주세요.'});continue;
        }
      }
      const outcome:Outcome=id==='seo'?await seo():id==='pricing'?await pricing():id==='mainImage'||id==='additionalImages'||id==='detailImage'?await image(id)
        :id==='sizeChart'?await sizeChart():id==='koreanLabel'?await once('label:'+(await product()).updated_at,()=>runSelectedLabelWork(productId,{signal,fetcher,assertCurrent}))
        :await quotation();
      await assertCurrent();publish(index,outcome);
      if(outcome.uncertain){holdRemaining(index);break;}
      keys.delete(identity+':pending:'+id);
      for(const key of stageWrites)keys.delete(key);
      if(outcome.stop){holdRemaining(index);break;}
    }catch(cause){
      if(signal.aborted)return null;
      if(cause instanceof ScopeChanged)boardSourceLost=true;
      publish(index,{status:'failed',message:cause instanceof Error?cause.message:'작업 결과를 확인하지 못했습니다.'});
      if(cause instanceof ScopeChanged||keys.has(identity+':pending:'+id)){holdRemaining(index);break;}
    }
  }
  // Later independent quotation/label saves can advance the product version.
  // Keep a display-only failure across those saves only if its observed source
  // DTO is still identical. Never carry an old failure onto changed images.
  if(boardSourceLost){for(const stage of result)delete stage.boardSource;}
  else if(boardObservation.current&&result.some(stage=>stage.status==='failed'||stage.status==='blocked')){
    try{
      await product();await assertCurrent();
      for(const stage of result){
        if(stage.boardSource&&boardObservation.current&&stage.boardSource.sourceFingerprint===boardObservation.current.sourceFingerprint)stage.boardSource={...boardObservation.current};
        else delete stage.boardSource;
      }
    }catch{/* Missing fresh display proof never starts or repeats work. */}
  }
  return{productId,stages:result};
}
