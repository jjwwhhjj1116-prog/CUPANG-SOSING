import type {AutomationStageId} from '@/app/automation/model';
import type {SelectedBatchStageResult} from '@/app/batch-selected-work';
import type {RegistrationContentSummary} from '@/app/registration-content-summary';

type SourceProduct={id:string;updated_at:string;title:string;source_url?:string;image_keys?:string;content_summary?:unknown};
export type BatchBoardSource={productVersion:string;sourceFingerprint:string};
/** Display binding only. This is never an execution or completion receipt. */
export function batchBoardSource(product:SourceProduct):BatchBoardSource|null{
 if(!Number.isFinite(Date.parse(product.updated_at))||typeof product.title!=='string'||product.title.length>10000||typeof product.source_url!=='string'||typeof product.image_keys!=='string'
  ||product.source_url.length>4096||product.image_keys.length>65536)return null;
 const summary=product.content_summary,seoTitle=summary&&typeof summary==='object'&&!Array.isArray(summary)&&'seoTitle'in summary&&typeof summary.seoTitle==='string'?summary.seoTitle:null;
 return{productVersion:product.updated_at,sourceFingerprint:JSON.stringify([product.title,product.source_url,product.image_keys,seoTitle])};
}
export type BatchBoardActivity={runId:string;attempt:number;kind:'start'}|{runId:string;attempt:number;kind:'finish'}|{runId:string;attempt:number;kind:'stage';productId:string;result:SelectedBatchStageResult};
type Run={id:string;ownerId:string;stages:readonly AutomationStageId[]};
type Entry={source:BatchBoardSource;state:'running'|'failed';detail:string};
export type BatchBoardFeedback={scope:object;runId:string;attempt:number;ownerId:string;products:readonly string[];stages:readonly AutomationStageId[];entries:Record<string,Partial<Record<AutomationStageId,Entry>>>};
export function updateBatchBoardFeedback(previous:BatchBoardFeedback|null,scope:object,run:Run,products:readonly string[],event:BatchBoardActivity):BatchBoardFeedback|null{
 if(event.runId!==run.id||!Number.isSafeInteger(event.attempt)||event.attempt<1)return previous;
 const same=previous?.scope===scope&&previous.runId===run.id&&previous.ownerId===run.ownerId;
 if(event.kind==='start'){
  if(same&&event.attempt<=previous!.attempt)return previous;
  return{scope,runId:run.id,attempt:event.attempt,ownerId:run.ownerId,products:[...products],stages:[...run.stages],entries:{}};
 }
 if(!same||previous!.attempt!==event.attempt||JSON.stringify(previous!.stages)!==JSON.stringify(run.stages))return previous;
 const entries={...previous!.entries};
 if(event.kind==='finish'){
  for(const [id,values]of Object.entries(entries))entries[id]=Object.fromEntries(Object.entries(values).filter(([,value])=>value?.state!=='running'));
 }else{
  if(!previous!.products.includes(event.productId)||!previous!.stages.includes(event.result.id))return previous;
  const values={...entries[event.productId]},result=event.result,source=result.boardSource;
  delete values[result.id];
  if(['running','blocked','failed'].includes(result.status)&&source&&Number.isFinite(Date.parse(source.productVersion))&&typeof source.sourceFingerprint==='string'&&source.sourceFingerprint.length<=85000){
   values[result.id]={source:{...source},state:result.status==='running'?'running':'failed',detail:((result.status==='blocked'?'자료·검토 필요: ':'')+result.message).slice(0,2000)};
  }
  entries[event.productId]=values;
 }
 return{...previous!,entries};
}
export function projectBatchBoardFeedback<T extends SourceProduct&{owner_id?:string;content_summary?:RegistrationContentSummary|null}>(products:T[],ownerId:string|undefined,scope:object,feedback:BatchBoardFeedback|null):T[]{
 if(!feedback||feedback.scope!==scope||feedback.ownerId!==ownerId)return products;
 return products.map(product=>{
  const source=batchBoardSource(product),summary=product.content_summary,entries=feedback.entries[product.id];
  if(product.owner_id!==ownerId||!source||!summary?.stages||!entries)return product;
  const statuses=Object.entries(entries).filter(([,entry])=>entry&&entry.source.productVersion===source.productVersion&&entry.source.sourceFingerprint===source.sourceFingerprint);
  if(!statuses.length)return product;
  return{...product,content_summary:{...summary,stages:{...summary.stages,...Object.fromEntries(statuses.map(([id,entry])=>[id,{state:entry!.state,detail:entry!.detail}]))}}};
 });
}
