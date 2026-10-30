import {planBatchImageWork,refreshBatchImageTask,type BatchImageTask} from '@/app/batch-image-work';
import {applyDetailBatchResult,recoverDetailBatchResult,detailBatchCapacity,detailBatchSelection,detailBatchTranslationSlots,type DetailImageBatch} from '@/app/detail-image-batch';
import {readFreeImageSource,recognizeFreeImage,translateFreeImageRegions,renderFreeImageTranslation,readFreeImageVisionStatus,type FreeImageVisionStatus,type FreeImageLoaded,type FreeImageRegion} from '@/app/free-image-translation-client';
import {FreeImageVisionError,type FreeImageVisionAttempt} from '@/app/free-image-vision-error';
import {isOwnedImageKey} from '@/app/image-files';
import type {ProductContent} from '@/app/product-content';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import type {ProductOptionsResponse} from '@/app/product-options';
import type {WorkspaceSettingsScope} from '@/app/workspace-settings-scope';
import type {WorkspaceSettings} from '@/app/workspace-settings';
import {selectedImagePurpose,hasForeignImageText,prepareSelectedImageCleanup} from '@/app/selected-image-purpose';
import {initializeVisionRegions} from '@/app/free-image-vision-style';
import {parseImageTextVisionResult} from '@/app/image-text-vision';

export type SelectedImageStage='main'|'additional'|'detail';
export type SelectedImageInferencePending={optionId:string;slotIndex:number;attempt:FreeImageVisionAttempt;code:string;message:string;observation?:FreeImageVisionStatus};
export type SelectedImageStageState={ownerId:string;productId:string;stage:SelectedImageStage;scope?:WorkspaceSettingsScope;settings?:WorkspaceSettings;content?:ProductContent;view?:QuotationFieldsView;batches:Record<string,DetailImageBatch>;inferencePending?:SelectedImageInferencePending};
export function createSelectedImageStageState(ownerId:string,productId:string,stage:SelectedImageStage):SelectedImageStageState{return{ownerId,productId,stage,batches:{}};}
export type SelectedImageStageResult={status:'completed'|'partial'|'skipped'|'uncertain';applied:number;failed:number;skipped:number;messages:string[];productVersion?:string;recoveryBatch?:DetailImageBatch;state:SelectedImageStageState;recovered?:boolean;sourceChanged?:true;inferencePending?:true};
export type SelectedImageStageOptions={ownerId:string;signal:AbortSignal;fetcher:typeof fetch;isCurrent?:()=>boolean;onProgress?:(message:string)=>void;expectedProductVersion?:string;state?:SelectedImageStageState};
type Dependencies={plan?:typeof planBatchImageWork;refresh?:typeof refreshBatchImageTask;readSource?:typeof readFreeImageSource;recognize?:typeof recognizeFreeImage;translate?:typeof translateFreeImageRegions;render?:typeof renderFreeImageTranslation;apply?:typeof applyDetailBatchResult;recover?:typeof recoverDetailBatchResult;observe?:typeof readFreeImageVisionStatus};
const label={main:'대표 이미지',additional:'추가 이미지',detail:'상세 이미지'};
export const SELECTED_IMAGE_SLOT_TIMEOUT_MS=90000;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const same=(first:unknown,second:unknown)=>JSON.stringify(first)===JSON.stringify(second);
const note=(cause:unknown)=>cause instanceof Error?cause.message:'이미지 초안을 저장하지 못했습니다.';
class SelectedImageScopeChanged extends Error{}
const changed=()=>new SelectedImageScopeChanged('계정·상품 또는 저장된 이미지가 변경됐습니다. 최신 저장본으로 작업을 다시 시작해주세요.');
const noTextMessage='읽을 수 있는 문구를 찾지 못했습니다. 필요한 영역과 원문을 직접 추가해주세요.';
const incompleteRegionIssue='자동 번역 미완료: ';
const savedEditKey=(key:string)=>key.split('/').at(-1)?.startsWith('free-image-')===true;
class NoForeignText extends Error{}
function release(image:FreeImageLoaded|undefined){if(image?.canvas){image.canvas.width=0;image.canvas.height=0;}}
function manualTarget(view:QuotationFieldsView,task:BatchImageTask){
 const selection=detailBatchSelection(view,task.optionId,task.profileId,task.stage),row=view.resolved.rows.find(row=>row.optionId===task.optionId)!;
 return selection.target.linked.some(key=>Object.hasOwn(view.overrides.common,key)||Object.hasOwn(view.overrides.options[task.optionId]??{},key)||['manual-common','manual-option'].includes(row.fields[key]?.source));
}

/** The explicit selected-work action authorizes draft saves. This runner keeps
 * a single OCR canvas/PNG at a time and delegates each write to the existing
 * source-bound CAS + reread verifier. No upload is retried automatically. */
export async function processSelectedImageStage(productId:string,stage:SelectedImageStage,options:SelectedImageStageOptions,deps:Dependencies={}):Promise<SelectedImageStageResult>{
 const {signal,fetcher,ownerId}=options,state=options.state??createSelectedImageStageState(ownerId,productId,stage),result:SelectedImageStageResult={status:'partial',applied:0,failed:0,skipped:0,messages:[],state};
 const purpose=selectedImagePurpose(stage),action=purpose==='cleanup'?'문구 제거':'번역';
 const active=()=>{signal.throwIfAborted();if(options.isCurrent?.()===false)throw changed();};
 active();if(!/^[A-Za-z0-9_-]{1,100}$/.test(productId)||!['main','additional','detail'].includes(stage)||!isOwnedImageKey(ownerId,ownerId+'/scope.png'))throw changed();
 if(state.ownerId!==ownerId||state.productId!==productId||state.stage!==stage||!object(state.batches))throw changed();
 const plan=await(deps.plan??planBatchImageWork)([{id:productId,title:productId}],signal,fetcher);active();
 if(plan.scope.ownerId!==ownerId||!plan.scope.company||state.scope&&!same(state.scope,plan.scope))throw changed();
 state.scope??=structuredClone(plan.scope);
 let recoveredInference:SelectedImageInferencePending|undefined;
 if(state.inferencePending){
  const pending=state.inferencePending;
  try{
   const observation=await(deps.observe??readFreeImageVisionStatus)(pending.attempt,signal,fetcher);active();pending.observation=observation;
   if(observation.status==='completed'){
    if(observation.format!=='yoofam-image-vision-status-v1'||observation.requestId!==pending.attempt.requestId||observation.sourceLanguage!==pending.attempt.sourceLanguage
      ||!same(observation.source,pending.attempt.source)||!same(observation.configuration,pending.attempt.configuration)||observation.readOnly!==true||observation.execution?.requests!==0
      ||observation.failure!==null||!parseImageTextVisionResult(observation.result,pending.attempt.source.width,pending.attempt.source.height))throw changed();
    recoveredInference=pending;
    result.messages.push('원래 Vision 요청의 완료된 번역을 읽었습니다. 현재 원본과 저장 버전을 다시 대조한 뒤 이어 적용하며 새 추론은 요청하지 않습니다.');
   }else if(observation.status==='failed'){
    if(observation.format!=='yoofam-image-vision-status-v1'||observation.requestId!==pending.attempt.requestId||observation.sourceLanguage!==pending.attempt.sourceLanguage
      ||!same(observation.source,pending.attempt.source)||!same(observation.configuration,pending.attempt.configuration)||observation.readOnly!==true||observation.execution?.requests!==0||observation.result!==null)throw changed();
    // A terminal failure is no longer an unknown inference. A later explicit
    // selected-work action may retry, but this observation never starts it.
    delete state.inferencePending;result.failed=1;
    result.messages.push(`원래 이미지 Vision 요청 ${pending.attempt.requestId}의 확정 실패를 확인했습니다. 원본을 유지했으며 새 추론·업로드는 요청하지 않았습니다.`);return result;
   }else{
    result.inferencePending=true;result.failed=1;
   const labels={running:'처리 중',completed:'번역 응답 확인 · 적용 전 검토 필요',failed:'확정 실패',uncertain:'추론 결과 미확정','not-found':'같은 요청 기록 미확인'};
   result.messages.push(`원래 이미지 Vision 요청 ${pending.attempt.requestId}: ${labels[observation.status]}. 새 추론·업로드는 요청하지 않았습니다. 남은 이미지는 자동 실행하지 않습니다.`);
    return result;
   }
  }catch(cause){active();result.inferencePending=true;result.failed=1;result.messages.push(note(cause)+' 원래 요청 '+pending.attempt.requestId+'를 보존하고 새 추론·업로드는 요청하지 않았습니다.');return result;}
 }
 // A retry of an unknown save is read-only. Keep its exact PNG and attempt
 // before dispatch so cancellation/ACK loss cannot erase the recovery proof.
 const uncertain=Object.values(state.batches).find(batch=>batch.items.some(item=>item.status==='uncertain'));
 if(uncertain){
  result.status='uncertain';result.recoveryBatch=uncertain;
  try{
   const recovered=await(deps.recover??recoverDetailBatchResult)(uncertain,signal,next=>{state.batches[next.optionId]=next;state.view=next.view;},{fetcher});active();
   if(recovered.items.some(item=>item.status==='uncertain'))throw Error('이전 이미지의 저장 상태를 아직 확인하지 못했습니다.');
   state.batches[recovered.optionId]={...recovered,items:recovered.items.map(item=>item.status==='applied'?{...item,rendered:undefined,attempt:undefined}:item)};state.view=recovered.view;
   result.applied=Object.values(state.batches).flatMap(batch=>batch.items).filter(item=>item.status==='applied').length;
   const partialDrafts=Object.values(state.batches).flatMap(batch=>batch.items).filter(item=>item.translationReview?.status==='partial');
   result.failed=partialDrafts.length;
   const pending=partialDrafts.length>0||Object.values(state.batches).flatMap(batch=>batch.items).some(item=>['pending','ready','failed','uncertain'].includes(item.status))
    ||plan.tasks.some(task=>task.productId===productId&&task.stage===stage&&!state.batches[task.optionId]);
   result.status=pending?'partial':result.applied?'completed':'skipped';result.recovered=true;result.productVersion=recovered.view.productVersion;result.recoveryBatch=undefined;
   result.messages.push('이전 이미지의 저장 상태만 확인했습니다. 새 업로드는 하지 않았습니다.'+(partialDrafts.length?' 일부 문구가 미완료인 초안입니다. 저장된 이미지를 수동 편집에서 열어 원문과 번역을 확인해주세요.':pending?' 남은 이미지는 작업 다시 시도로 이어갈 수 있습니다.':''));return result;
  }catch(cause){active();result.failed=1;result.messages.push(note(cause)+' 같은 이미지의 저장 상태를 먼저 확인해주세요. 새 업로드는 하지 않았습니다.');return result;}
 }
 if(!plan.enabled&&!Object.values(state.batches).some(batch=>batch.items.some(item=>item.translationReview?.status==='partial'))){result.status='skipped';result.messages.push('저장된 기본설정에서 이미지 번역이 꺼져 있어 원본을 유지했습니다.');return result;}
 if(state.settings&&!same(state.settings,plan.settings))throw changed();state.settings??=structuredClone(plan.settings);
 async function content(view?:QuotationFieldsView,requestSignal=signal){
  active();requestSignal.throwIfAborted();const response=await fetcher(`/api/products/${encodeURIComponent(productId)}/content`,{signal:requestSignal,cache:'no-store',redirect:'error'}),body=await response.json() as {content?:ProductContent;error?:string};active();requestSignal.throwIfAborted();
  const value=body.content,asset=value?.assets?.[stage];
  if(response.ok&&value&&(value.productId!==productId||view&&value.revision!==view.contentRevision))throw changed();
  if(!response.ok||!value||value.productId!==productId||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0||view&&value.revision!==view.contentRevision
   ||!object(asset)||!['unverified','collected','translated','generated','manual'].includes(asset.provenance as string)||!Array.isArray(asset.value)||asset.value.some(key=>!isOwnedImageKey(ownerId,key)))throw Error(body.error||'저장된 이미지 역할·버전을 확인하지 못했습니다.');
  return value;
 }
 const originalContent=await content();
 if(state.content&&!same(state.content,originalContent))throw changed();state.content??=structuredClone(originalContent);
 if(originalContent.assets[stage].provenance==='manual'){result.status='skipped';result.skipped=originalContent.assets[stage].value.length||1;result.messages.push(`직접 저장한 ${label[stage]} 역할과 빈 값을 유지했습니다.`);return result;}
 const tasks=plan.tasks.filter(task=>task.productId===productId&&task.stage===stage);
 const recoveryTarget=recoveredInference;
 if(recoveryTarget&&!tasks.some(task=>task.optionId===recoveryTarget.optionId
   &&state.batches[task.optionId]?.items.some(item=>item.slotIndex===recoveryTarget.slotIndex&&item.sourceKey===recoveryTarget.attempt.source.sourceKey)))throw changed();
 if(!tasks.length){result.failed=1;result.messages.push(...(plan.messages.length?plan.messages.map(row=>row.message):['처리할 저장 이미지 연결이 없습니다. 이미지 설정을 확인해주세요.']));return result;}
 let latest=state.view;
 for(const task of tasks){
  active();
  const view=await(deps.refresh??refreshBatchImageTask)(task,plan,signal,fetcher);active();
  if(latest&&!same(view,latest)||!latest&&options.expectedProductVersion!==undefined&&view.productVersion!==options.expectedProductVersion)throw changed();
  const currentContent=await content(view);if(!same(currentContent,originalContent))throw changed();
  const selected=detailBatchTranslationSlots(view,task.optionId,task.profileId,stage);
  if(selected.keys.some(key=>!isOwnedImageKey(ownerId,key)))throw changed();
  if(stage==='main'){
   const response=await fetcher(`/api/products/${encodeURIComponent(productId)}/options`,{signal,cache:'no-store',redirect:'error'}),body=await response.json() as ProductOptionsResponse;active();
   const rows=body.options?.rows?.filter(row=>row.id===task.optionId),option=rows?.[0];
   if(!response.ok||body.productVersion!==view.productVersion||body.options?.productId!==productId||body.options.revision!==view.optionRevision||rows?.length!==1||!option
    ||!['unverified','manual','collected','translated'].includes(option.provenance?.imageKey))throw changed();
   if(option.provenance.imageKey==='manual'){result.skipped+=selected.keys.length||1;result.messages.push(`${task.optionLabel} · 직접 저장한 옵션 대표 이미지 선택을 유지했습니다.`);latest=view;continue;}
  }
  const retained=state.batches[task.optionId];
  if(retained&&(retained.productId!==productId||retained.optionId!==task.optionId||retained.profileId!==task.profileId||retained.stage!==stage
   ||!same(selected.keys,retained.items.map(item=>item.status==='applied'?item.appliedKey:item.sourceKey))))throw changed();
  // Only this session's exact last verified view permits our own generated
  // override to resume. A genuinely manual field has no retained batch.
  const manualSelection=!retained&&manualTarget(view,task);
  if(manualSelection&&!selected.keys.some(savedEditKey)){result.skipped+=selected.keys.length||1;result.messages.push(`${task.optionLabel} · 직접 저장한 ${label[stage]} 선택을 유지했습니다.`);latest=view;continue;}
  let batch:DetailImageBatch=retained?{...retained,view}:{productId,optionId:task.optionId,profileId:task.profileId,stage,language:'zh',view,
   items:selected.keys.map((sourceKey,slotIndex)=>({slotIndex,sourceKey,status:selected.protectedSlots.includes(slotIndex)||manualSelection&&!savedEditKey(sourceKey)?'skipped':'pending',message:'',texts:[]}))};
  const remember=(next:DetailImageBatch)=>{batch=next;state.batches[task.optionId]=next;state.view=next.view;};remember(batch);
  result.skipped+=selected.protectedSlots.length;
  for(const slotIndex of selected.slots){
   active();const entry=batch.items.find(item=>item.slotIndex===slotIndex)!;
   if(entry.status==='applied'){
    result.applied++;
    if(entry.translationReview?.status==='partial'){result.failed++;result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: ${entry.translationReview.message} 저장된 이미지를 수동 편집에서 열어 확인해주세요. 자동 재요청하지 않았습니다.`);break;}
    continue;
   }
   if(entry.status==='skipped'){result.skipped++;continue;}
   const savedEdit=savedEditKey(entry.sourceKey);
   if(!savedEdit&&!detailBatchCapacity(batch.view)){result.failed++;entry.status='failed';result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: 새 ${action} 이미지를 저장할 공간이 없습니다.`);continue;}
   const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>controller.abort(Error('이 이미지의 처리 시간이 90초를 초과했습니다. 원본과 확인된 저장 결과를 유지했습니다.')),SELECTED_IMAGE_SLOT_TIMEOUT_MS);
   let image:FreeImageLoaded|undefined;
   const check=()=>{active();controller.signal.throwIfAborted();};
   const progress=(message:string)=>{check();options.onProgress?.(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}/${selected.keys.length}: ${message}`);};
   try{
    if(savedEdit){
     // Fresh sessions must read the persisted editor issue marker before
     // treating a saved generated/manual-option image as completed review.
     // This restores the original pixels, never OCRs the flattened result.
     progress('저장된 이미지 편집 상태 확인 중');const target=detailBatchSelection(batch.view,task.optionId,task.profileId,stage);
     image=await(deps.readSource??readFreeImageSource)(productId,batch.view.productVersion,entry.sourceKey,stage,controller.signal,fetcher,{kind:'quotation',profileId:task.profileId,optionId:task.optionId,input:stage==='main'?'mainImage':stage==='additional'?'additionalImages':'detailImages',fieldKey:target.target.primary,slotIndex,revision:batch.view.revision,inputFingerprint:batch.view.inputFingerprint,optionRevision:batch.view.optionRevision,value:target.value},{restoreEditor:true,anchorPolicy:'current-target-v1'});check();
     if(image.source.productId!==productId||!isOwnedImageKey(ownerId,image.source.sourceKey)||(image.source.editorSource?.resultKey??image.source.sourceKey)!==entry.sourceKey||image.source.productVersion!==batch.view.productVersion||image.source.role!==stage)throw changed();
     // Explicit manual retries may replace our prefix with a newer validation
     // error. Any retained region issue still requires review.
     const unresolved=image.editDocument?.regions.filter(region=>region.issue?.trim())??[];
     if(unresolved.length){
      const accepted=image.editDocument!.regions.filter(region=>region.translationProvenance==='generated'&&region.translated.trim()&&!region.issue).length;
      const message=`이전 작업의 일부 번역 초안에 미완료 문구 ${unresolved.length}개가 남아 있습니다. 저장된 이미지를 수동 편집에서 열어 원문과 번역을 확인해주세요.`;
      remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,status:'failed',translationReview:{status:'partial',acceptedRegions:accepted,unresolvedRegions:unresolved.length,message},message}:item)});
      result.failed++;result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: ${message}`);break;
     }
     remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,status:'skipped',translationReview:undefined}:item)});
     result.skipped++;result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: 저장된 편집 결과를 유지했습니다.`);continue;
    }
    if(!(entry.status==='ready'&&entry.rendered)){
    progress('원문 확인·문구 인식 중');const target=detailBatchSelection(batch.view,task.optionId,task.profileId,stage);
    image=await(deps.readSource??readFreeImageSource)(productId,batch.view.productVersion,entry.sourceKey,stage,controller.signal,fetcher,{kind:'quotation',profileId:task.profileId,optionId:task.optionId,input:stage==='main'?'mainImage':stage==='additional'?'additionalImages':'detailImages',fieldKey:target.target.primary,slotIndex,revision:batch.view.revision,inputFingerprint:batch.view.inputFingerprint,optionRevision:batch.view.optionRevision,value:target.value});check();
    if(image.source.productId!==productId||!isOwnedImageKey(ownerId,image.source.sourceKey)||image.source.sourceKey!==entry.sourceKey||image.source.productVersion!==batch.view.productVersion||image.source.role!==stage)throw changed();
    let regions:FreeImageRegion[];
    if(recoveredInference&&recoveredInference.optionId===task.optionId&&recoveredInference.slotIndex===slotIndex){
     const pending=recoveredInference,observation=pending.observation!;
     if(!same(image.source,pending.attempt.source)||image.visionConfiguration&&!same(image.visionConfiguration,pending.attempt.configuration))throw changed();
     const vision=parseImageTextVisionResult(observation.result,image.width,image.height);if(!vision)throw changed();
     image.visionRequestId=pending.attempt.requestId;image.visionResult=vision;image.visionExecution={requests:0,cached:true};
     if(!vision.blocks.length){delete state.inferencePending;recoveredInference=undefined;throw new NoForeignText();}
     const styled=initializeVisionRegions(vision.blocks,image.canvas,image.width,image.height);image.visionStyleIssues=styled.issues;regions=styled.regions;
    }else{
     // No other slot may bypass a retained, completed-but-not-yet-consumed
     // result through a fresh provider call.
     if(recoveredInference)throw changed();
     try{regions=await(deps.recognize??recognizeFreeImage)(image,'zh',controller.signal,progress);}catch(cause){if(cause instanceof Error&&cause.message===noTextMessage)throw new NoForeignText();throw cause;}
    }check();
    let prepared:FreeImageRegion[],translationReview:DetailImageBatch['items'][number]['translationReview'],texts:{original:string;translated:string}[];
    if(purpose==='cleanup'){
     prepared=prepareSelectedImageCleanup(image,regions);
     const chosen=prepared.filter(region=>region.selected);if(!chosen.length)throw new NoForeignText();
     texts=chosen.map(region=>({original:region.text,translated:''}));
    }else{
    if(image.visionStyleIssues?.length)throw Error(`Vision 초기 스타일 검토가 필요합니다: ${image.visionStyleIssues.join(', ')}. 원본을 유지했습니다. 이미지 편집에서 문구와 영역을 확인해주세요.`);
    const selectedRegions=regions.filter(region=>region.selected&&hasForeignImageText(region.text));
    if(!selectedRegions.length)throw new NoForeignText();
    const translated=new Map<string,string>(),issues=new Map<string,string>();let incompleteMessage='';
    if(image.visionResult){
     for(const region of selectedRegions){if(region.translationProvenance==='generated'&&region.translated.trim()&&!region.issue)translated.set(region.id,region.translated);else issues.set(region.id,region.issue||'Vision 번역 검증을 통과하지 못했습니다.');}
     if(issues.size)incompleteMessage='Vision으로 읽은 일부 문구의 한국어 검증을 통과하지 못했습니다. 자동으로 다른 번역 서비스를 요청하지 않았습니다.';
    }
    for(const language of ['zh','en'] as const){
     if(image.visionResult)break;
     const group=selectedRegions.filter(region=>/\p{Script=Han}/u.test(region.text)===(language==='zh'));if(!group.length)continue;
     progress('한국어 번역 중');const reply=await(deps.translate??translateFreeImageRegions)(image.source,language,group.map(({id,text})=>({id,text})),controller.signal,fetcher);check();
     const failures=group.flatMap(region=>{
      const row=reply.regions.find(row=>row.id===region.id);
      if(row?.original===region.text&&row.translated?.trim()&&!row.issue){translated.set(region.id,row.translated);return[];}
      const issue=row?.issue||'해당 문구의 번역 응답이 없습니다.';issues.set(region.id,issue);return[issue];
     });
     if(failures.length){
      const recovery=reply.workersRecovery,recoveryStatus={completed:'완료',partial:'일부 문구만 검증됨',failed:'요청 실패',limited:'무료 요청 한도 도달',timeout:'응답 시간 초과','invalid-response':'응답 검증 실패','input-limit':'입력 한도 초과'};
      incompleteMessage=[`${group.length}개 문구 중 ${failures.length}개를 번역하지 못해 원본을 유지했습니다.`,
       recovery?`무료 AI 결과: ${recoveryStatus[recovery.status]} (${recovery.translatedRegions}/${recovery.sourceRegions}개 검증).`:'',
       ...[...new Set(failures)].slice(0,3),...reply.warnings].filter(Boolean).join(' ');
      // Keep accepted regions from this response and earlier language groups.
      // A partial response never starts another language/provider request.
      break;
     }
    }
    if(!translated.size)throw Error(incompleteMessage||'검증된 번역 문구가 없어 원본을 유지했습니다.');
    const unresolved=selectedRegions.filter(region=>!translated.has(region.id));
    for(const region of unresolved)if(!issues.has(region.id))issues.set(region.id,'앞선 문구의 일부 번역이 미완료여서 추가 번역 요청을 중단했습니다. 원문을 유지했습니다.');
    prepared=regions.map(region=>translated.has(region.id)?{...region,translated:translated.get(region.id)!,issue:null,translationProvenance:'generated'}:{...region,selected:false,...(issues.has(region.id)?{translated:'',translationProvenance:'empty' as const,issue:(incompleteRegionIssue+issues.get(region.id)!).slice(0,2000)}:{})});
    translationReview=unresolved.length?{status:'partial' as const,acceptedRegions:translated.size,unresolvedRegions:unresolved.length,
     message:`검증된 ${translated.size}개 문구만 초안에 반영했습니다. ${unresolved.length}개 미완료 문구는 원문과 오류를 보존하고 선택 해제했습니다. ${incompleteMessage}`} : undefined;
    texts=selectedRegions.filter(region=>translated.has(region.id)).map(region=>({original:region.text,translated:translated.get(region.id)!}));
    }
    progress(`${action} 이미지 초안 생성 중`);const rendered=await(deps.render??renderFreeImageTranslation)(image,prepared,controller.signal,[],undefined,'zh');check();release(image);image=undefined;
    if(!rendered.output.size||rendered.output.size>10*1024*1024||rendered.output.type!=='image/png')throw Error(`${action} 이미지 초안 파일을 확인하지 못했습니다. 원본을 유지했습니다.`);
    if((purpose==='cleanup'||translationReview)&&!rendered.editDocument)throw Error(`${action} 초안의 편집 문서를 확인하지 못했습니다. 원본을 유지했습니다.`);
    remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,status:'ready',rendered,translationReview,
     texts}:item)});
    if(recoveredInference?.optionId===task.optionId&&recoveredInference.slotIndex===slotIndex){delete state.inferencePending;recoveredInference=undefined;}
    }
    await content(batch.view,controller.signal);check();
    progress(`${action} 이미지 초안 저장 중`);
    remember(await(deps.apply??applyDetailBatchResult)(batch,slotIndex,controller.signal,remember,{fetcher,readSource:async(...args)=>{const loaded=await(deps.readSource??readFreeImageSource)(...args);release(loaded);return loaded;}}));
    if(batch.items.find(item=>item.slotIndex===slotIndex)?.status!=='applied')throw Error(`${action} 이미지 저장 확인을 받지 못했습니다.`);
    result.applied++;latest=batch.view;result.productVersion=batch.view.productVersion;
    // Keep only verified keys after a save, freeing the prior PNG immediately.
    remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,rendered:undefined,attempt:undefined}:item)});check();
    const partial=batch.items.find(item=>item.slotIndex===slotIndex)?.translationReview;
    if(partial?.status==='partial'){result.failed++;result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: ${partial.message} 저장된 이미지를 수동 편집에서 열어 확인해주세요.`);break;}
   }catch(cause){
    if(cause instanceof FreeImageVisionError&&cause.code==='IMAGE_VISION_CAPACITY'&&!cause.uncertain){
     active();
     if(!image||!same(cause.attempt.source,image.source))throw changed();
     result.failed++;remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,status:'failed',message:note(cause),rendered:undefined}:item)});
     result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: ${note(cause)} 남은 이미지 처리를 멈췄습니다.`);return result;
    }
    if(cause instanceof FreeImageVisionError&&cause.uncertain){
     if(!image||cause.attempt.requestId!==image.visionRequestId||!same(cause.attempt.source,image.source))throw changed();
     const pending={optionId:task.optionId,slotIndex,attempt:structuredClone(cause.attempt),code:cause.code,message:note(cause)};
     state.inferencePending=pending;result.inferencePending=true;result.failed++;
     remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,status:'failed',message:note(cause),rendered:undefined}:item)});
     result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: ${note(cause)} 원래 요청 ${cause.attempt.requestId}를 보존하고 남은 이미지 추론을 멈췄습니다.`);
     return result;
    }
    if(cause instanceof SelectedImageScopeChanged)result.sourceChanged=true;
    if(batch.items.some(item=>item.status==='uncertain')){result.status='uncertain';result.failed++;result.recoveryBatch=batch;result.messages.push(note(cause)+' 같은 이미지의 저장 상태를 확인하기 전에는 다음 이미지에 적용하지 않습니다.');return result;}
    active();
    if(batch.items.find(item=>item.slotIndex===slotIndex)?.status==='applied'){result.failed++;result.messages.push(note(cause)+' 확인된 저장 결과를 유지하고 다음 이미지 처리를 멈췄습니다.');return result;}
    if(result.sourceChanged){result.failed++;result.messages.push(note(cause));remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,status:'failed',message:note(cause),rendered:undefined}:item)});return result;}
    if(cause instanceof NoForeignText){const message=`문구 인식을 완료했으며 자동 ${action}할 중국어·영어 문구를 찾지 못해 원본을 유지했습니다.`;result.skipped++;result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: ${message}`);remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,status:'skipped',message,rendered:undefined}:item)});}
    else{result.failed++;result.messages.push(`${task.optionLabel} · ${label[stage]} ${slotIndex+1}: ${controller.signal.aborted?note(controller.signal.reason):note(cause)}`);remember({...batch,items:batch.items.map(item=>item.slotIndex===slotIndex?{...item,status:'failed',message:note(cause),rendered:undefined}:item)});}
   }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);release(image);}
  }
  latest=batch.view;result.productVersion=batch.view.productVersion;
  if(result.failed)break;
 }
 active();result.status=result.failed?'partial':result.applied?'completed':'skipped';
 result.messages.push(result.applied?`${label[stage]} ${action} 초안 ${result.applied}개 저장 확인 · 최종 사용 전 결과를 검토해주세요.`:result.failed?`${label[stage]} ${action} 초안을 저장하지 못했습니다. 원본을 유지했습니다.`:`${label[stage]}의 원본·직접 저장한 선택·편집 결과를 유지했습니다.`);
 return result;
}
