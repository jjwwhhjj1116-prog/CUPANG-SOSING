export const SAVED_DOCUMENT_STEP_VALIDATION_FORMAT='yoofam-saved-document-step-validation-v1';
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const CATEGORIES=['required','consent','price','image','file','invalid','unclassified'];
const FAILURES=['timeout','network','http','response','source-changed','prior-uncertain','cancelled'];
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const dense=(value,max)=>Array.isArray(value)&&value.length<=max&&Object.keys(value).length===value.length&&Object.keys(value).every((key,index)=>key===String(index));
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
const same=(left,right)=>canon(left)===canon(right);
const fail=()=>{throw Error('저장 문서 단계 검사의 원래 요청·결과 연결을 확인하지 못했습니다. 파일·본문 저장이나 등록전송은 하지 않았습니다.');};
const RETRY_FORMAT='yoofam-saved-document-step-retry-v1';
const RETRY_BINDINGS=['requestId','docId','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','checkpointSequence','actualRawBodySha256','fileSetSha256','legalSetSha256'];
export function validateSavedDocumentStepRetryRequest(value,expected={}){
 if(!exact(value,['format',...RETRY_BINDINGS,'stage','acknowledgeRepeatedValidation'])||value.format!==RETRY_FORMAT||!ID.test(value.requestId||'')
  ||!(integer(value.docId,1,Number.MAX_SAFE_INTEGER)||typeof value.docId==='string'&&/^[1-9]\d{0,29}$/.test(value.docId))
  ||!['identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','actualRawBodySha256','fileSetSha256','legalSetSha256'].every(key=>HASH.test(value[key]||''))
  ||!integer(value.checkpointSequence,1,100000)||![2,3,4,5].includes(value.stage)||value.acknowledgeRepeatedValidation!==true)fail();
 for(const key of RETRY_BINDINGS)if(expected[key]!==undefined&&!same(value[key],expected[key]))fail();
 return structuredClone(value);
}
export const SAVED_DOCUMENT_STEP_RESULT_KEYS=Object.freeze(['stage','state','responseRows','errors','errorCount','errorsTruncated','cached','requested','failureCode']);
function stageValid(row,index){
 if(!exact(row,SAVED_DOCUMENT_STEP_RESULT_KEYS)||row.stage!==index+2||!['passed','rejected','uncertain'].includes(row.state)||!(row.responseRows===null||integer(row.responseRows,1,200))
  ||!dense(row.errors,40)||!integer(row.errorCount,0,200)||row.errors.length!==Math.min(row.errorCount,40)||row.errorsTruncated!==(row.errorCount>40)
  ||typeof row.cached!=='boolean'||typeof row.requested!=='boolean'||row.cached&&row.requested||row.state!=='uncertain'&&row.cached===row.requested
  ||!(row.failureCode===null||FAILURES.includes(row.failureCode))||row.state==='uncertain'&&row.failureCode===null||row.state!=='uncertain'&&row.failureCode!==null
  ||row.state==='passed'&&(row.errorCount!==0||row.responseRows===null)||row.state==='rejected'&&row.responseRows===null)return false;
 return row.errors.every(error=>exact(error,['rowIndex','columnName','category'])&&integer(error.rowIndex,0,199)&&row.responseRows!==null&&error.rowIndex<row.responseRows
  &&typeof error.columnName==='string'&&error.columnName.length>=1&&error.columnName.length<=160&&/^[\p{L}\p{N} _*().,·%+\-:［］\[\]]+$/u.test(error.columnName)
  &&!/(?:https?:|www\.|\.(?:png|jpe?g|pdf|gif|webp|xlsx?|csv|txt|zip)\b|password|cookie|authorization|access.?token|api.?key)/i.test(error.columnName)&&CATEGORIES.includes(error.category));
}
// Only a complete trusted page reply can prove that its validation POST was
// not dispatched. Timeouts/cancellation and ambiguous prior records remain
// reserved, even if an outer caller did not observe a request.
function provenNotSent(row,index){
 return stageValid(row,index)&&row.state==='uncertain'&&row.cached===false&&row.requested===false
  &&['network','http','response','source-changed'].includes(row.failureCode);
}
export function validateSavedDocumentStepValidationReport(value,expected={},now=Date.now()){
 const bindingKeys=['requestId','docId','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','checkpointSequence'];
 const keys=['format',...bindingKeys,'target','observedAt','actualRawBodySha256','fileSetSha256','legalSetSha256','stages','bodyWrites','fileWrites','created','submitted','canResume','registered'];
 if(!exact(value,keys)||value.format!==SAVED_DOCUMENT_STEP_VALIDATION_FORMAT||!ID.test(value.requestId||'')
  ||!(integer(value.docId,1,Number.MAX_SAFE_INTEGER)||typeof value.docId==='string'&&/^[1-9]\d{0,29}$/.test(value.docId))
  ||!['identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','actualRawBodySha256','fileSetSha256','legalSetSha256'].every(key=>HASH.test(value[key]||''))
  ||!integer(value.checkpointSequence,1,100000)||!exact(value.target,['tabId','windowId'])||!integer(value.target.tabId,0,Number.MAX_SAFE_INTEGER)||!integer(value.target.windowId,0,Number.MAX_SAFE_INTEGER)
  ||!integer(value.observedAt,1,Number.MAX_SAFE_INTEGER)||Math.abs(now-value.observedAt)>60000||!dense(value.stages,4)||value.stages.length<1
  ||!value.stages.every(stageValid)||value.stages.slice(0,-1).some(row=>row.state!=='passed')||value.stages.at(-1)?.state==='passed'&&value.stages.length!==4
  ||['bodyWrites','fileWrites','created','submitted','canResume','registered'].some(key=>value[key]!==false))fail();
 for(const key of bindingKeys)if(expected.binding?.[key]!==undefined&&!same(value[key],expected.binding[key]))fail();
 if(expected.target!==undefined&&!same(value.target,expected.target))fail();
 for(const key of ['actualRawBodySha256','fileSetSha256','legalSetSha256'])if(expected[key]!==undefined&&value[key]!==expected[key])fail();
 const result=structuredClone(value),freeze=item=>{if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}return item;};return freeze(result);
}

/** A separate durable attempt ledger. It never alters the original transport
 * checkpoint or claims a successfully updated/submitted document. Per-key
 * writes avoid overwriting another product's independent validation attempt. */
export async function runSavedDocumentStepValidation({audit,storage,sendStep,fresh,now=Date.now,retryConfirmation}){
 if(!storage||typeof storage.get!=='function'||typeof storage.set!=='function'||typeof sendStep!=='function'||typeof fresh!=='function')fail();
 const binding=Object.fromEntries(['requestId','docId','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','checkpointSequence'].map(key=>[key,audit[key]]));
 const source={actualRawBodySha256:audit.rawBodySha256,fileSetSha256:audit.fileSetSha256,legalSetSha256:audit.legalSetSha256};
 const {checkpointSequence:omittedSequence,...ledgerBinding}=binding;void omittedSequence;
 const scope={format:'yoofam-saved-document-step-attempt-v1',...ledgerBinding,...source};
 const retry=retryConfirmation===undefined?null:validateSavedDocumentStepRetryRequest(retryConfirmation,{...binding,...source});
 const retryKeyFor=stage=>'yoofamSavedStepValidationRetryV1:'+binding.packetDigest+':'+String(binding.docId)+':'+stage;
 async function readRetry(prior,stage){
  const key=retryKeyFor(stage),records=await storage.get(key);await fresh();
  if(!object(records)||Object.keys(records).some(name=>name!==key))fail();const value=records[key];
  if(value!==undefined&&(!exact(value,['format','scope','stage','previousAttempt','requestedAt','state',...(value.state==='observed'?['result']:[])])
   ||value.format!=='yoofam-saved-document-step-retry-attempt-v1'||!same(value.scope,scope)||!same(value.previousAttempt,prior)
   ||value.stage!==stage||!integer(value.requestedAt,1,Number.MAX_SAFE_INTEGER)||!['requested','observed','uncertain'].includes(value.state)))fail();
  return value;
 }
 async function passedRetryPrefix(prior,stage){
  const value=await readRetry(prior,stage);if(value?.state!=='observed'||!stageValid(value.result,stage-2)||value.result.state!=='passed')fail();
  return {...structuredClone(value.result),cached:true,requested:false};
 }
 if(retry)for(const priorStage of [2,3,4,5].filter(stage=>stage<=retry.stage)){
  await fresh();const priorKey='yoofamSavedStepValidationV1:'+binding.packetDigest+':'+String(binding.docId)+':'+priorStage;
  const records=await storage.get(priorKey);await fresh();const value=records?.[priorKey];
  if(!object(records)||Object.keys(records).some(name=>name!==priorKey)||!object(value)||!same(value.scope,scope)||value.stage!==priorStage)fail();
  if(priorStage===retry.stage){if(value.state!=='uncertain')fail();}
  else if(value.state==='uncertain')await passedRetryPrefix(value,priorStage);
  else if(value.state!=='observed'||!stageValid(value.result,priorStage-2)||value.result.state!=='passed')fail();
 }
 const stages=[];
 for(const stage of [2,3,4,5]){
  await fresh();const key='yoofamSavedStepValidationV1:'+binding.packetDigest+':'+String(binding.docId)+':'+stage;
  const saved=await storage.get(key);await fresh();
  if(!object(saved)||Object.keys(saved).some(name=>name!==key))fail();
  const prior=saved[key];
  let retryKey=null,retryPending=null;
  if(prior!==undefined){
   if(!exact(prior,['scope','stage','requestedAt','state',...(['observed','observed-not-sent'].includes(prior.state)?['result']:[])])||!same(prior.scope,scope)||prior.stage!==stage||!integer(prior.requestedAt,1,Number.MAX_SAFE_INTEGER)||!['requested','observed','observed-not-sent','uncertain'].includes(prior.state))fail();
   if(retry?.stage===stage&&prior.state!=='uncertain')fail();
   if(prior.state==='observed'){
    const row={...structuredClone(prior.result),cached:true,requested:false};if(!stageValid(row,stage-2))fail();stages.push(row);
    if(row.state!=='passed')break;continue;
   }
   if(retry&&stage<retry.stage&&prior.state==='uncertain'){
    // Only this explicit recheck may use the separately observed retry prefix.
    // The ordinary validation path still stops at its original uncertain row.
    stages.push(await passedRetryPrefix(prior,stage));continue;
   }
   if(retry?.stage===stage){
    // A deliberate validation-only recheck is a separate, single-use journal.
    // Preserve the legacy uncertain entry byte-for-byte; it never grants a
    // body/file write or transport-checkpoint recovery capability.
    if(prior.state!=='uncertain')fail();
    retryKey=retryKeyFor(stage);
    const previousRetry=await readRetry(prior,stage);
    if(previousRetry!==undefined){
     if(previousRetry.state==='observed'){
      const row={...structuredClone(previousRetry.result),cached:true,requested:false};if(!stageValid(row,stage-2))fail();stages.push(row);
      if(row.state!=='passed')break;continue;
     }
     stages.push({stage,state:'uncertain',responseRows:null,errors:[],errorCount:0,errorsTruncated:false,cached:true,requested:false,failureCode:'prior-uncertain'});break;
    }
    retryPending={format:'yoofam-saved-document-step-retry-attempt-v1',scope:structuredClone(scope),stage,previousAttempt:structuredClone(prior),requestedAt:now(),state:'requested'};
    await storage.set({[retryKey]:retryPending});const persistedRetry=await storage.get(retryKey);if(!same(persistedRetry?.[retryKey],retryPending))fail();await fresh();
   }else if(prior.state==='observed-not-sent'){
    if(!provenNotSent(prior.result,stage-2))fail();
    // This is a new explicit run. Persist a fresh reservation below before
    // asking the page to recheck; never loop or retry within a single run.
   }else{
    stages.push({stage,state:'uncertain',responseRows:null,errors:[],errorCount:0,errorsTruncated:false,cached:true,requested:false,failureCode:'prior-uncertain'});break;
   }
  }
  if(retry?.stage===stage&&!retryKey)fail();
  const pending={scope:structuredClone(scope),stage,requestedAt:now(),state:'requested'};
  if(!retryKey){await storage.set({[key]:pending});const persisted=await storage.get(key);if(!same(persisted?.[key],pending))fail();await fresh();}
  let result;
  try{result=await sendStep(stage);await fresh();}
  catch{result={stage,state:'uncertain',responseRows:null,errors:[],errorCount:0,errorsTruncated:false,cached:false,requested:true,failureCode:'source-changed'};}
  if(!stageValid(result,stage-2))result={stage,state:'uncertain',responseRows:null,errors:[],errorCount:0,errorsTruncated:false,cached:false,requested:true,failureCode:'response'};
  const current=await storage.get(key);if(!same(current?.[key],retryKey?prior:pending))fail();
  if(retryKey){
   const currentRetry=await storage.get(retryKey);if(!same(currentRetry?.[retryKey],retryPending))fail();
   await storage.set({[retryKey]:result.state==='uncertain'?{...retryPending,state:'uncertain'}:{...retryPending,state:'observed',result:structuredClone(result)}});
  }else await storage.set({[key]:provenNotSent(result,stage-2)?{...pending,state:'observed-not-sent',result:structuredClone(result)}:
   result.state==='uncertain'?{...pending,state:'uncertain'}:{...pending,state:'observed',result:structuredClone(result)}});
  stages.push(result);if(result.state!=='passed')break;
 }
 await fresh();
 return validateSavedDocumentStepValidationReport({format:SAVED_DOCUMENT_STEP_VALIDATION_FORMAT,...binding,target:structuredClone(audit.target),observedAt:now(),...source,stages,
  bodyWrites:false,fileWrites:false,created:false,submitted:false,canResume:false,registered:false},{binding,target:audit.target,...source},now());
}
