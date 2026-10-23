import { automationStages, type AutomationStageId } from '@/app/automation/model';
import { supplierHubCompany } from '@/app/supplier-hub-company';
import { collectedTranslationAttributes } from '@/app/collected-translation-attributes';
import { optionTranslationBatch } from '@/app/option-translation';
import { collectionSourceReference } from '@/app/sourcing';
import { createSeoWorkspaceDraftState, parseSeoWorkspaceDraftState, runSeoWorkspaceDraft } from '@/app/seo-workspace-draft';
import { GOOGLE_TEXT_MODEL, type TranslationSource, type TranslationView } from '@/app/automation/translation';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptionsResponse } from '@/app/product-options';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationAiJobForScope, quotationAiScopedProposalChanges, quotationAiViewCurrent, type QuotationAiView, type QuotationAiJobView } from '@/app/quotation-ai-client';
import { confirmQuotationFieldsSave } from '@/app/quotation-fields-confirmation';
import { processSelectedImageStage, createSelectedImageStageState, type SelectedImageStageState } from '@/app/batch-selected-image-work';
import { runSelectedLabelWork } from '@/app/batch-selected-label-work';
import { readRegistrationLayout } from '@/app/registration-layout';
import { runSelectedPricingWork } from '@/app/batch-selected-pricing-work';

export type SelectedBatchStageResult = { id: AutomationStageId; status: 'waiting'|'running'|'draft'|'complete'|'blocked'|'failed'|'skipped'; message: string };
type Controls = { stages: readonly AutomationStageId[]; expectedOwnerId: string; signal: AbortSignal; fetcher: typeof fetch;
  keys: Map<string,string>; newKey:()=>string; onStage:(result:SelectedBatchStageResult)=>void };
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
  const product=async()=>{
    const value=await read<{product:{id:string;updated_at:string;title:string}}>('');
    if(value.product?.id!==productId||!Number.isFinite(Date.parse(value.product.updated_at)))throw Error('현재 상품을 확인하지 못했습니다.');
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
  async function seo():Promise<Outcome>{
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
    const missing=(['title','keywords','description'] as const).some(key=>{
      const field=content.seo[key];return field.provenance!=='manual'&&(
        !['translated','generated'].includes(field.provenance)||!(Array.isArray(field.value)?field.value.length:field.value.trim()))
        &&(key!=='description'||source.description.trim());
    });
    if(!missing&&!batch.total)return{status:'skipped',message:'저장한 SEO·옵션 번역과 직접 수정한 값을 유지했습니다.'};
    if(!history.configuration.configured)return{status:'blocked',message:'번역 서비스 설정을 확인해주세요.'};
    if(history.configuration.model!==GOOGLE_TEXT_MODEL)return{status:'blocked',message:'SEO 편집에서 설정된 AI 서비스의 실행 안내를 확인해주세요.'};
    const input:TranslationSource={title:source.title,description:source.description,attributes:[...attributes,...batch.attributes],provenance:'manual',
      reference:collectionSourceReference(source.jobId,source.sourceUrl),category:{id:source.requestContext.categoryId,path:source.requestContext.categoryPath},
      guidance:{features:source.requestContext.features,keywords:source.requestContext.keywords}};
    const stateKey=identity+':seo:'+current.updated_at+':'+content.revision;
    const stored=keys.get(stateKey),state=stored?parseSeoWorkspaceDraftState(stored,productId):createSeoWorkspaceDraftState({
      productId,productVersion:current.updated_at,contentRevision:content.revision,source:input,configuration:history.configuration,
      memo:{brand:registration.settings.brand,features:source.requestContext.features,keywords:source.requestContext.keywords}});
    if(!state)throw Error('이전 SEO 실행 정보를 확인하지 못했습니다. SEO 이력을 확인해주세요.');
    keys.set(stateKey,JSON.stringify(state));
    keys.set(identity+':pending:seo','SEO 실행 결과 확인 필요');
    const generated=await runSeoWorkspaceDraft(state,{signal,fetcher,onState:value=>keys.set(stateKey,JSON.stringify(value))});
    if(generated.job?.status!=='completed'||!generated.job.result)return{status:'blocked',message:generated.message,uncertain:!generated.closed};
    const request={jobId:generated.job.id,expectedVersion:current.updated_at,linkQuotationSeoDefaults:true};
    const plan=await post<{productId:string;productVersion:string;contentRevision:number;optionRevision:number;fingerprint:string;preview:unknown[]}>('/translation-apply',{...request,action:'preview'});
    if(plan.productId!==productId||plan.productVersion!==current.updated_at||!hash(plan.fingerprint)||!Array.isArray(plan.preview))throw Error('SEO 적용 범위가 현재 상품과 다릅니다.');
    if(!plan.preview.length)return{status:generated.partial?'blocked':'skipped',message:'새로 적용할 번역이 없습니다. 수동 수정값을 유지했습니다. '+(generated.partial?'일부 원문 번역을 확인해주세요.':'')};
    const saved=await once('seo:'+plan.fingerprint,()=>post<{productId:string;productVersion:string;contentRevision:number;optionRevision:number;applied:number}>('/translation-apply',{...request,action:'apply',fingerprint:plan.fingerprint}));
    if(saved.productId!==productId||!(Date.parse(saved.productVersion)>Date.parse(current.updated_at))||saved.contentRevision!==plan.contentRevision+1
      ||saved.optionRevision!==plan.optionRevision+1||saved.applied!==plan.preview.length)throw Error('SEO 저장 결과를 확인하지 못했습니다. 저장본을 확인해주세요.');
    return{status:generated.partial||batch.remaining?'blocked':'draft',message:'SEO·옵션 번역 '+saved.applied+'개 항목을 저장했습니다.'+(generated.partial?' 일부 원문 번역을 확인해주세요.':'')+(batch.remaining?' 남은 옵션 항목 '+batch.remaining+'개는 추가 작업이 필요합니다.':'')};
  }
  async function pricing():Promise<Outcome>{
    return runSelectedPricingWork(productId,{fetcher,signal,assertCurrent});
  }
  async function image(id:'mainImage'|'additionalImages'|'detailImage'):Promise<Outcome>{
    const role=({mainImage:'main',additionalImages:'additional',detailImage:'detail'} as const)[id],current=await product();
    const stateKey=identity+':'+id;
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
    if(['completed','skipped'].includes(result.status))imageStates!.delete(stateKey);
    return{status:result.status==='completed'?'draft':result.status==='skipped'?'skipped':'blocked',message:result.messages.join(' '),uncertain:result.status==='uncertain',stop:result.recovered||result.status==='partial'};
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
    if(!state.configuration.configured)return{status:'blocked',message:'견적서 AI 서비스 설정을 확인해주세요.'};
    let job=quotationAiJobForScope(state,view,productId,null,true);
    if(!job){
      const key=identity+':quote:'+state.fingerprint;
      if(!keys.has(key))keys.set(key,controls.newKey());
      keys.set(identity+':pending:quotation','견적서 AI 실행 결과 확인 필요');
      const result=await post<{job:QuotationAiJobView;sourceCurrent?:boolean}>('/quotation-ai',{action:'generate',profileId:null,
        expectedFingerprint:state.fingerprint,expectedQuotationRevision:view.revision,optionId:null,applyToAllOptions:true,idempotencyKey:keys.get(key)});
      if(result.sourceCurrent===false)throw Error('견적 작성 중 자료가 변경됐습니다.');
      job=result.job;
    }
    if(!job||job.status!=='completed')return{status:'blocked',message:job?.error?.message??'견적서 AI 실행 결과를 먼저 확인해주세요. 중복 실행하지 않았습니다.',uncertain:!job||job.status!=='failed'};
    const changes=quotationAiScopedProposalChanges(view,job,state.fingerprint,null,true);
    if(changes.length){
      const previous=view;
      view=await once('quotation:'+job.id,()=>post<QuotationFieldsView>('/quotation-fields',{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes},'PUT'));
      confirmQuotationFieldsSave(previous,view,changes);
    }
    const missing=view.resolved.rows.filter(row=>row.included).flatMap(row=>view.resolved.schema.fields.filter(field=>field.required
      &&(!row.fields[field.id]?.value.trim()||row.fields[field.id]?.validationIssues?.length)).map(field=>field.label));
    return{status:missing.length?'blocked':'draft',message:'견적서 AI 항목 '+changes.length+'개를 저장했습니다.'+(missing.length?' 필수 입력 확인: '+[...new Set(missing)].slice(0,8).join(', ')+'.':' 견적서에서 최종 검토 후 등록전송할 수 있습니다.')};
  }
  const result:SelectedBatchStageResult[]=automationStages.filter(id=>controls.stages.includes(id)).map(id=>({id,status:'waiting',message:'실행 대기'}));
  const publish=(index:number,outcome:Outcome)=>{result[index]={id:result[index].id,status:outcome.status,message:outcome.message};controls.onStage({...result[index]});};
  const holdRemaining=(index:number)=>{
    for(let next=index+1;next<result.length;next++)publish(next,{status:'blocked',message:'앞 단계의 처리·저장 결과를 확인해야 하므로 이 단계는 아직 시작하지 않았습니다. 해당 단계만 선택해 별도로 작업할 수 있습니다.'});
  };
  for(let index=0;index<result.length;index++){
    if(signal.aborted)return null;
    const id=result[index].id;activeStage=id;
    stageWrites.clear();
    if(keys.has(identity+':pending:'+id)&&!imageStates.has(identity+':'+id)){
      publish(index,{status:'blocked',message:'이전 저장 결과를 단계 편집에서 먼저 확인해주세요. 뒤의 작업은 시작하지 않았습니다.'});holdRemaining(index);break;
    }
    publish(index,{status:'running',message:'선택한 단계 작업 중…'});
    try{
      await assertCurrent();
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
      publish(index,{status:'failed',message:cause instanceof Error?cause.message:'작업 결과를 확인하지 못했습니다.'});
      if(cause instanceof ScopeChanged||keys.has(identity+':pending:'+id)){holdRemaining(index);break;}
    }
  }
  return{productId,stages:result};
}
