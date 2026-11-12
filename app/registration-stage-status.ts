import type { AutomationStage, AutomationStageId, AutomationWorkflow } from '@/app/automation/model';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';
import {parseImageOriginalPreservationProof,type ImageOriginalPreservationProof} from '@/app/image-no-text-proof';
import type {FreeImageEditReview} from '@/app/free-image-edit-review';
import {isReferenceSizeChart} from '@/app/manual-size-chart';

export const registrationStageIds = ['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'] as const;
export type RegistrationStageState = 'pending' | 'complete' | 'failed' | 'running' | 'unused' | 'review';
export type RegistrationWorkProgress = { completed:number; total:number };
export type RegistrationStageStatus = { state: RegistrationStageState; detail: string;updatedAt?:string;sourceProofAt?:string;imageReview?:'unresolved'|'unconfirmed';originalImage?:true;progress?:RegistrationWorkProgress };
export type RegistrationStageSummary = Record<AutomationStageId, RegistrationStageStatus>;
export type RegistrationFinalImageKeys=Record<'main'|'additional'|'detail',string[]>;
export const registrationStepIds:Record<string,AutomationStageId> = { SEO:'seo',가격:'pricing','대표 이미지':'mainImage','추가 이미지':'additionalImages','상세 이미지':'detailImage',옵션:'sizeChart',사이즈표:'sizeChart',표시사항:'koreanLabel',견적서:'quotation' };
export function registrationStageLabel(state:RegistrationStageState) {return {pending:'대기',complete:'완료',failed:'오류',running:'진행 중',unused:'미사용',review:'검토 필요'}[state];}
export function pendingRegistrationStages(sizeUsed=false):RegistrationStageSummary {
  return Object.fromEntries(registrationStageIds.map(id=>[id,{state:id==='sizeChart'&&!sizeUsed?'unused':'pending',detail:id==='sizeChart'&&!sizeUsed?'사용 중인 사이즈표가 없습니다.':'현재 단계의 완료 근거가 없습니다.'}])) as RegistrationStageSummary;
}
const time=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
/** A saved reference or generated draft is not an executed, adopted stage. */
function completionEvidence(stage:AutomationStage,productId:string,productVersion:string):boolean {
  if(stage.reason!==null||!Number.isSafeInteger(stage.attempts)||stage.attempts<1||!time(stage.updatedAt)
    ||!Array.isArray(stage.artifacts)||!stage.artifacts.length||!Array.isArray(stage.evidence)||!stage.evidence.length
    ||stage.evidence.some(item=>!item||!time(item.observedAt)||Date.parse(item.observedAt)>Date.parse(stage.updatedAt))
    ||stage.artifacts.some(item=>!item||!item.id||item.data?.reviewRequired===true||item.data?.providerExecutionVerified===false||item.data?.fileContentVerified===false))return false;
  const has=(kind:string)=>stage.evidence.some(item=>item.kind===kind);
  if(!stage.evidence.some(item=>item.kind==='storedProduct'&&item.reference===`${productId}@${productVersion}`))return false;
  if(stage.id==='pricing')return has('localCalculation')&&stage.artifacts.every(item=>{
    const data=item.data,calculation=data?.calculation as Record<string,unknown>|undefined;
    return item.kind==='priceCalculation'&&!data?.error&&calculation&&['supplyPrice','salePrice'].every(key=>typeof calculation[key]==='number'&&Number.isFinite(calculation[key])&&(calculation[key] as number)>0);
  });
  if(stage.id==='quotation')return has('supplierTemplate')&&stage.artifacts.every(item=>item.kind==='supplierQuotation'&&item.submissionReady===true);
  if(!has('providerReceipt')||!has('savedContent'))return false;
  if(stage.id==='seo')return stage.artifacts.every(item=>item.kind==='text'&&item.data?.appliedToContent===true);
  return stage.artifacts.every(item=>item.kind==='image'&&typeof item.storageKey==='string'&&!!item.storageKey&&item.data?.appliedToContent===true&&item.data?.fileContentVerified===true);
}
/** Freshness is checked against the same full input fingerprint as automation GET. */
export function registrationStagesFromWorkflow(product:{id:string;updated_at?:string},workflow:AutomationWorkflow|null,fresh:boolean,sizeUsed=false):RegistrationStageSummary {
  const result=pendingRegistrationStages(sizeUsed);
  if(!fresh||!workflow||workflow.productId!==product.id||workflow.productVersion!==product.updated_at||!Array.isArray(workflow.stages))return result;
  for(const id of registrationStageIds){
    const matches=workflow.stages.filter(stage=>stage.id===id);if(matches.length!==1)continue;
    const stage=matches[0];
    if(!time(stage.updatedAt)||!Number.isSafeInteger(stage.attempts)||stage.attempts<1)continue;
    if(stage.status==='failed')result[id]={state:'failed',detail:stage.reason?.message||'단계 실행에 실패했습니다.',updatedAt:stage.updatedAt};
    else if(stage.status==='running')result[id]={state:'running',detail:stage.reason?.message||'저장된 현재 단계 작업을 실행 중입니다.',updatedAt:stage.updatedAt};
    else if(stage.status==='complete'&&completionEvidence(stage,product.id,workflow.productVersion))result[id]={state:'complete',detail:`현재 입력의 실행 결과 확인 · ${stage.updatedAt}`};
  }
  return result;
}

export type RegistrationFinalContent = {optionId:string|null;title:string;main:string[];additional:string[];detail:string[];label:string[];imageIssues?:Partial<Record<'main'|'additional'|'detail'|'label',boolean>>;manualImages?:Partial<Record<'main'|'additional'|'detail'|'label',boolean>>;manualPrices?:{supplyPrice:string;salePrice:string}};
const korean=(value:unknown)=>typeof value==='string'&&!!value.trim()&&/\p{Script=Hangul}/u.test(value)&&!/\p{Script=Han}|[\u0000-\u001f]/u.test(value);
/** Explicit saved field intent or an exact adopted SEO document proves saved
 * work. Unassigned provider output and generated drafts cannot satisfy it. */
export function registrationStagesFromSavedContent(product:{id:string;owner_id?:string;updated_at?:string;categoryId?:string|null},content:ProductContent|null,options:ProductOptions|null,keys:readonly string[],finalRows:RegistrationFinalContent[]|null,noTextProofs:readonly ImageOriginalPreservationProof[]=[],sizeChartRequired=false):RegistrationStageSummary {
  const size=content?.assets?.size,used=!!size?.value?.length||!!content?.manualSizeChart;
  const result=pendingRegistrationStages(used||sizeChartRequired);
  if(sizeChartRequired&&!used)result.sizeChart.detail='이 카테고리는 사이즈표가 필요합니다. 사이즈표 편집에서 원본을 선택하거나 표를 작성해주세요.';
  const owned=(key:string)=>keys.includes(key)&&(!product.owner_id||key.startsWith(product.owner_id+'/'));
  const done=(id:AutomationStageId,detail:string)=>{result[id]={state:'complete',detail};};
  const unchanged=new Set(noTextProofs.flatMap(value=>{const proof=parseImageOriginalPreservationProof(value);return proof?.productId===product.id&&proof.sourceLanguage==='zh'&&owned(proof.sourceKey)?[proof.sourceKey]:[];}));
  const proofDates=new Map(noTextProofs.flatMap(value=>{const proof=parseImageOriginalPreservationProof(value);return proof?.productId===product.id&&unchanged.has(proof.sourceKey)?[[proof.sourceKey,proof.verifiedAt]as const]:[];}));
  if(finalRows?.length){
    for(const [id,role] of [['mainImage','main'],['additionalImages','additional'],['detailImage','detail'],['koreanLabel','label']] as const){
      if(finalRows.every(row=>row.manualImages?.[role]&&row[role].length>0&&(role!=='main'||row.main.length===1)&&new Set(row[role]).size===row[role].length&&!row.imageIssues?.[role]&&row[role].every(owned)))done(id,'직접 저장한 현재 카테고리의 최종 이미지 연결 확인');
      else if(finalRows.some(row=>row.manualImages?.[role]&&row.imageIssues?.[role]))result[id]={state:'failed',detail:'직접 저장한 이미지의 현재 연결을 확인해주세요.'};
    }
    if(finalRows.every(row=>row.manualPrices&&Object.values(row.manualPrices).every(value=>/^\d+(?:\.\d+)?$/.test(value.trim())&&Number.isFinite(Number(value))&&Number(value)>0)))done('pricing','직접 저장한 현재 카테고리의 공급가·판매가 연결 확인');
  }
  if(!content||content.productId!==product.id||content.schemaVersion!==1||!Number.isSafeInteger(content.revision)||content.revision<1||!time(content.updatedAt))return result;
  const saved=(field:{provenance?:string;updatedAt?:string|null}|undefined)=>field?.provenance==='manual'&&time(field.updatedAt)&&(!product.updated_at||Date.parse(field.updatedAt!)<=Date.parse(product.updated_at));
  const document=content.seoTitleDocument,title=content.seo?.title,rows=options?.rows??[];
  const savedSeoTitle=saved(title)||['generated','translated'].includes(title?.provenance)&&time(title.updatedAt)
    &&(!product.updated_at||Date.parse(title.updatedAt!)<=Date.parse(product.updated_at));
  if(document?.policy==='couplus-seo-save-v1'&&document.sourceTitle===title?.value&&document.value===title.value&&document.sourceUpdatedAt===title.updatedAt
    &&savedSeoTitle&&korean(title.value)&&title.value.length<=100&&options?.productId===product.id&&rows.some(row=>row.included)&&rows.filter(row=>row.included).every(row=>korean(row.translatedName)&&['manual','translated'].includes(row.provenance?.translatedName))
    &&content.seo.keywords.value.every(value=>! /\p{Script=Han}/u.test(value))&&(!finalRows||finalRows.every(row=>korean(row.title))))done('seo',saved(title)?'직접 저장한 현재 SEO 상품명과 한국어 옵션명 확인':'저장된 현재 SEO 상품명과 한국어 옵션명 확인');
  const exact=(left:readonly string[],right:readonly string[])=>JSON.stringify(left)===JSON.stringify(right);
  if(finalRows?.length){
    const manualRowsByRole=new Map<string,Set<RegistrationFinalContent>>();
    for(const [id,role] of [['mainImage','main'],['additionalImages','additional'],['detailImage','detail'],['koreanLabel','label']] as const){
      const roles=role==='detail'?['detailTop','detail','detailBottom'] as const:[role];
      const fields=roles.map(name=>content.assets[name]),selected=fields.flatMap(field=>field.value);
      const assignment=selected.length>0&&selected.every(owned)&&fields.filter(field=>field.value.length).every(saved)&&(role!=='detail'||content.assets.detail.value.length>0);
      let originalMain=false;
      const manualRows=new Set(finalRows.filter(row=>{
        const option=row.optionId===null?undefined:rows.find(option=>option.id===row.optionId);
        const collected=(field:{provenance?:string;updatedAt?:string|null}|undefined)=>field?.provenance==='collected'&&time(field.updatedAt)&&(!product.updated_at||Date.parse(field.updatedAt!)<=Date.parse(product.updated_at));
        const individual=role==='main'&&!!option?.imageKey&&(option.provenance?.imageKey==='manual'||collected({provenance:option.provenance?.imageKey,updatedAt:option.updatedAt}))&&time(option.updatedAt)&&owned(option.imageKey);
        const original=role==='main'&&(individual?option?.provenance?.imageKey==='collected':selected.length===1&&collected(content.assets.main));
        const expected=individual?[option!.imageKey!]:selected;
        const finalKeys=row[role],valid=finalKeys.length>0&&(role!=='main'||finalKeys.length===1)&&new Set(finalKeys).size===finalKeys.length&&!row.imageIssues?.[role]&&finalKeys.every(owned);
        const accepted=valid&&(row.manualImages?.[role]===true||(individual||assignment||original)&&exact(finalKeys,expected));
        if(accepted&&original)originalMain=true;
        return accepted;
      }));
      manualRowsByRole.set(role,manualRows);
      if(manualRows.size===finalRows.length)done(id,originalMain?'수집 원본 대표이미지 사용 · 편집은 선택사항입니다.':`직접 저장한 현재 ${role==='main'?'대표 이미지':role==='additional'?'추가 이미지':role==='detail'?'상세 이미지':'한글표시사항 이미지'} 역할과 최종 연결 확인`);
      else if(finalRows.some(row=>row.imageIssues?.[role]&&(row.manualImages?.[role]||fields.some(saved))))result[id]={state:'failed',detail:'직접 저장한 이미지의 현재 연결을 확인해주세요.'};
      if(role==='main'&&originalMain&&manualRows.size===finalRows.length)result.mainImage.originalImage=true;
    }
    for(const [id,role]of [['mainImage','main'],['additionalImages','additional'],['detailImage','detail']]as const){
      const roles=role==='detail'?['detailTop','detail','detailBottom']as const:[role];
      const manualKeys=new Set(roles.flatMap(name=>saved(content.assets[name])?content.assets[name].value:[]));
      const manualRows=manualRowsByRole.get(role)!;
      if(result[id].state==='pending'&&finalRows.every(row=>manualRows.has(row)||row[role].length>0&&(role!=='main'||row[role].length===1)&&new Set(row[role]).size===row[role].length&&!row.imageIssues?.[role]
        &&row[role].every(key=>owned(key)&&(unchanged.has(key)||manualKeys.has(key))))
        &&(role!=='detail'||content.assets.detail.value.length>0||finalRows.every(row=>row.manualImages?.detail===true))){
          const times=finalRows.filter(row=>!manualRows.has(row)).flatMap(row=>row[role].filter(key=>!manualKeys.has(key)).map(key=>proofDates.get(key)!));
          done(id,manualRows.size?'직접 저장한 최종 이미지와 서버 원본 보존 검증 확인':noTextProofs.some(proof=>proof.reason==='product-markings-only'&&finalRows.some(row=>row[role].includes(proof.sourceKey)))?'현재 최종 이미지의 서버 원본 보존 검증 확인 · 실물 인쇄 유지':'현재 최종 이미지의 서버 외국어 없음 검증 확인 · 원본 유지');
          if(times.length&&times.every(time))result[id].sourceProofAt=new Date(Math.min(...times.map(value=>Date.parse(value)))).toISOString();
        }
    }
  }
  if(size?.value?.length&&saved(size)&&size.value.every(owned))done('sizeChart','직접 저장한 현재 사이즈표 연결 확인');
  else if(size?.value?.length&&saved(size))result.sizeChart={state:'failed',detail:'저장한 사이즈표 이미지의 현재 연결을 확인해주세요.'};
  else if(size?.provenance==='generated'&&size.value.length===1&&size.value.every(owned)&&time(size.updatedAt)
    &&(!product.updated_at||Date.parse(size.updatedAt!)<=Date.parse(product.updated_at))&&isReferenceSizeChart(content.manualSizeChart))done('sizeChart','저장된 참고용 Free Size 안내표 연결 확인');
  return result;
}

/** The caller supplies only current included generated edit outputs. This runs
 * after ordinary manual/no-text completion so an attached partial translation
 * cannot turn green merely because its PNG reference was manually saved. */
export function registrationStagesWithImageReviews(productId:string,saved:RegistrationStageSummary,selected:RegistrationFinalImageKeys,reviews:readonly FreeImageEditReview[]):RegistrationStageSummary {
 const result={...saved};
 for(const [id,role]of [['mainImage','main'],['additionalImages','additional'],['detailImage','detail']]as const){
  const keys=[...new Set(selected[role])];if(!keys.length)continue;
  const states=keys.map(key=>{const found=reviews.filter(review=>review.productId===productId&&review.key===key&&review.format==='free-image-edit-review-v1');return found.length===1?found[0].status:'unconfirmed';});
  if(states.includes('unresolved'))result[id]={state:'failed',detail:'현재 선택한 이미지에 번역·편집 오류가 남아 있습니다. 해당 단계에서 수정한 뒤 저장해주세요.',imageReview:'unresolved'};
  else if(states.some(state=>state!=='clear'))result[id]={state:'pending',detail:'현재 선택한 이미지의 편집 검토 기록을 확인하지 못했습니다. 해당 단계에서 저장 결과를 확인해주세요.',imageReview:'unconfirmed'};
 }
 return result;
}

export function mergeRegistrationStages(saved:RegistrationStageSummary,execution:RegistrationStageSummary):RegistrationStageSummary {
  return Object.fromEntries(registrationStageIds.map(id=>{
    const latest=saved[id],previous=execution[id];
    if(['mainImage','additionalImages','detailImage'].includes(id)
      &&(latest.imageReview==='unresolved'&&latest.state==='failed'||latest.imageReview==='unconfirmed'&&latest.state==='pending'))return[id,latest];
    if(id==='mainImage'&&latest.state==='complete'&&latest.originalImage===true&&previous.state==='failed')return[id,latest];
    const resolvedFailure=previous.state==='failed'&&latest.state==='complete'&&time(latest.sourceProofAt)&&time(previous.updatedAt)&&Date.parse(latest.sourceProofAt!)>Date.parse(previous.updatedAt!);
    return[id,resolvedFailure?latest:['failed','running','complete'].includes(previous.state)?previous:latest];
  })) as RegistrationStageSummary;
}
