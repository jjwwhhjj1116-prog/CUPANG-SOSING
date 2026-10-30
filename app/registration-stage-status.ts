import type { AutomationStage, AutomationStageId, AutomationWorkflow } from '@/app/automation/model';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';

export const registrationStageIds = ['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'] as const;
export type RegistrationStageState = 'pending' | 'complete' | 'failed' | 'running' | 'unused';
export type RegistrationStageStatus = { state: RegistrationStageState; detail: string };
export type RegistrationStageSummary = Record<AutomationStageId, RegistrationStageStatus>;
export const registrationStepIds:Record<string,AutomationStageId> = { SEO:'seo',가격:'pricing','대표 이미지':'mainImage','추가 이미지':'additionalImages','상세 이미지':'detailImage',옵션:'sizeChart',사이즈표:'sizeChart',표시사항:'koreanLabel',견적서:'quotation' };
export function registrationStageLabel(state:RegistrationStageState) {return {pending:'대기',complete:'완료',failed:'오류',running:'작업중',unused:'미사용'}[state];}
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
    if(stage.status==='failed')result[id]={state:'failed',detail:stage.reason?.message||'단계 실행에 실패했습니다.'};
    else if(stage.status==='running')result[id]={state:'running',detail:stage.reason?.message||'저장된 현재 단계 작업을 실행 중입니다.'};
    else if(stage.status==='complete'&&completionEvidence(stage,product.id,workflow.productVersion))result[id]={state:'complete',detail:`현재 입력의 실행 결과 확인 · ${stage.updatedAt}`};
  }
  return result;
}

export type RegistrationFinalContent = {optionId:string|null;title:string;main:string[];additional:string[];detail:string[];label:string[];imageIssues?:Partial<Record<'main'|'additional'|'detail'|'label',boolean>>;manualImages?:Partial<Record<'main'|'additional'|'detail'|'label',boolean>>;manualPrices?:{supplyPrice:string;salePrice:string}};
const korean=(value:unknown)=>typeof value==='string'&&!!value.trim()&&/\p{Script=Hangul}/u.test(value)&&!/\p{Script=Han}|[\u0000-\u001f]/u.test(value);
/** Explicit saved field intent is stage-edit completion; automatic intake and
 * unassigned provider output have no manual provenance and cannot satisfy it. */
export function registrationStagesFromSavedContent(product:{id:string;owner_id?:string;updated_at?:string;categoryId?:string|null},content:ProductContent|null,options:ProductOptions|null,keys:readonly string[],finalRows:RegistrationFinalContent[]|null):RegistrationStageSummary {
  const size=content?.assets?.size,used=!!size?.value?.length||!!content?.manualSizeChart;
  const result=pendingRegistrationStages(used);
  const owned=(key:string)=>keys.includes(key)&&(!product.owner_id||key.startsWith(product.owner_id+'/'));
  const done=(id:AutomationStageId,detail:string)=>{result[id]={state:'complete',detail};};
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
  const explicit=content.explicitSeoQuotationDefaults,reviewedSeo=saved(title)||['generated','translated'].includes(title?.provenance)&&explicit?.policy==='couplus-explicit-seo-defaults-v1'
    &&explicit.productId===product.id&&explicit.categoryId===product.categoryId&&explicit.sourceTitle===title.value&&explicit.sourceUpdatedAt===title.updatedAt&&time(title.updatedAt);
  if(document?.policy==='couplus-seo-save-v1'&&document.sourceTitle===title?.value&&document.value===title.value&&document.sourceUpdatedAt===title.updatedAt
    &&reviewedSeo&&korean(title.value)&&title.value.length<=100&&options?.productId===product.id&&rows.every(row=>korean(row.translatedName)&&['manual','translated'].includes(row.provenance?.translatedName))
    &&content.seo.keywords.value.every(value=>! /\p{Script=Han}/u.test(value))&&(!finalRows||finalRows.every(row=>korean(row.title))))done('seo','직접 저장한 현재 SEO 상품명과 한국어 옵션명 확인');
  const exact=(left:readonly string[],right:readonly string[])=>JSON.stringify(left)===JSON.stringify(right);
  if(finalRows?.length){
    for(const [id,role] of [['mainImage','main'],['additionalImages','additional'],['detailImage','detail'],['koreanLabel','label']] as const){
      const roles=role==='detail'?['detailTop','detail','detailBottom'] as const:[role];
      const fields=roles.map(name=>content.assets[name]),selected=fields.flatMap(field=>field.value);
      const assignment=selected.length>0&&selected.every(owned)&&fields.filter(field=>field.value.length).every(saved)&&(role!=='detail'||content.assets.detail.value.length>0);
      const complete=finalRows.every(row=>{
        const option=row.optionId===null?undefined:rows.find(option=>option.id===row.optionId);
        const individual=role==='main'&&!!option?.imageKey&&option.provenance?.imageKey==='manual'&&time(option.updatedAt)&&owned(option.imageKey);
        const expected=individual?[option!.imageKey!]:selected;
        const finalKeys=row[role],valid=finalKeys.length>0&&(role!=='main'||finalKeys.length===1)&&new Set(finalKeys).size===finalKeys.length&&!row.imageIssues?.[role]&&finalKeys.every(owned);
        return valid&&(row.manualImages?.[role]===true||(individual||assignment)&&exact(finalKeys,expected));
      });
      if(complete)done(id,`직접 저장한 현재 ${role==='main'?'대표 이미지':role==='additional'?'추가 이미지':role==='detail'?'상세 이미지':'한글표시사항 이미지'} 역할과 최종 연결 확인`);
      else if(finalRows.some(row=>row.imageIssues?.[role]&&(row.manualImages?.[role]||fields.some(saved))))result[id]={state:'failed',detail:'직접 저장한 이미지의 현재 연결을 확인해주세요.'};
    }
  }
  if(size?.value?.length&&saved(size)&&size.value.every(owned))done('sizeChart','직접 저장한 현재 사이즈표 연결 확인');
  else if(size?.value?.length&&saved(size))result.sizeChart={state:'failed',detail:'저장한 사이즈표 이미지의 현재 연결을 확인해주세요.'};
  return result;
}

export function mergeRegistrationStages(saved:RegistrationStageSummary,execution:RegistrationStageSummary):RegistrationStageSummary {
  return Object.fromEntries(registrationStageIds.map(id=>[id,['failed','running','complete'].includes(execution[id].state)?execution[id]:saved[id]])) as RegistrationStageSummary;
}
