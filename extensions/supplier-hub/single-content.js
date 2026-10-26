// Authenticated app proof only; this script never creates a Hub document.
/* global yoofamSingleConfirmation */
let yoofamSingleSessionId=crypto.randomUUID(),yoofamSingleAccount=null;
let yoofamSingleSessionBound=false,yoofamSingleAccountChanged=false;
let yoofamSingleConfirmationAttempt=null;
const singleCanonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(singleCanonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+singleCanonical(value[key])).join(',')+'}';
async function singleDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(singleCanonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
async function singleReadJson(path){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  const resource=path==='/api/supplier-hub/catalog-context'?'catalog-context':path.includes('/native-assets')?'native-assets':path.includes('/supplier-hub-product-receipt')?'product-receipt':path.includes('/supplier-hub-receipt')?'receipt-history':'single-package';
  const failure=(code,status)=>Object.assign(Error('현재 앱의 저장 자료 조회를 확인하지 못했습니다.'),{sourceFailure:{code,resource,...(status===undefined?{}:{status})}});
  try{let response;try{response=await fetch(path,{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});}catch{throw failure(controller.signal.aborted?'SOURCE_READ_TIMEOUT':'SOURCE_READ_NETWORK');}
    if(!response.ok)throw failure('SOURCE_READ_HTTP',response.status);
    if(response.redirected||response.url!==location.origin+path||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw failure('SOURCE_READ_RESPONSE');
    let text;try{text=await response.text();}catch{throw failure(controller.signal.aborted?'SOURCE_READ_TIMEOUT':'SOURCE_READ_NETWORK');}
    if(controller.signal.aborted)throw failure('SOURCE_READ_TIMEOUT');if(text.length>6*1024*1024)throw failure('SOURCE_READ_RESPONSE');try{return JSON.parse(text);}catch{throw failure('SOURCE_READ_RESPONSE');}
  }finally{clearTimeout(timer);}
}
function singleSourceIdentity(identity,wholeProduct){
  const id=/^\w[\w-]{0,99}$/;
  if(!identity||!['ownerId','productId'].every(key=>id.test(identity[key]||'')))return false;
  if(!wholeProduct)return ['profileId','optionId'].every(key=>id.test(identity[key]||''))&&!Object.hasOwn(identity,'members');
  return !Object.hasOwn(identity,'optionId')&&(identity.profileId===null||id.test(identity.profileId||''))
    &&(identity.requestedProfileId===null||id.test(identity.requestedProfileId||''))
    &&(identity.requestedProfileId===null||identity.requestedProfileId===identity.profileId)&&/^[a-f0-9]{64}$/.test(identity.inputFingerprint||'')
    &&Array.isArray(identity.members)&&identity.members.length>0&&identity.members.length<=200
    &&identity.members.every((member,index)=>member&&id.test(member.optionId||'')&&member.documentIndex===index&&typeof member.optionLabel==='string'&&member.optionLabel.length<=10000)
    &&new Set(identity.members.map(member=>member.optionId)).size===identity.members.length;
}
async function verifySingleDocumentSource(expected,wholeProduct=false,nativeAssets=false){
  const identity=expected?.identity,same=(a,b)=>singleCanonical(a)===singleCanonical(b),hash=/^[a-f0-9]{64}$/;
  if(!singleSourceIdentity(identity,wholeProduct)||identity.origin!==location.origin
    ||!['fingerprint','schemaSha256','accountContext'].every(key=>hash.test(identity[key]||''))||!hash.test(expected.bodySha256||'')
    ||!hash.test(expected.preparedBodySha256||'')||!hash.test(expected.packetDigest||''))throw Error('원래 회원·상품·옵션 요청을 확인해주세요.');
  const before=await singleReadJson('/api/supplier-hub/catalog-context'),context=singleCanonical([before.ownerId,before.company]);
  if(yoofamSingleAccount!==null&&yoofamSingleAccount!==context){yoofamSingleSessionId=crypto.randomUUID();yoofamSingleAccount=context;yoofamSingleAccountChanged=true;yoofamSingleSessionBound=false;throw Error('현재 회원 회사가 변경되었습니다.');}
  yoofamSingleAccount=context;
  const bytes=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',before.ownerId,before.company?.code,before.company?.name]));
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(before.ownerId!==identity.ownerId||!same(before.company,identity.company)||account!==identity.accountContext)throw Error('원래 회원 회사로 로그인해주세요.');
  const requested=wholeProduct?identity.requestedProfileId:identity.profileId;
  // These three authenticated reads are independent. Keep both account fences
  // and await every result before interpreting any source or receipt proof.
  const reads=await Promise.allSettled([
    singleReadJson(`/api/products/${encodeURIComponent(identity.productId)}/${nativeAssets?'native-assets':'supplier-hub-single-package'}${requested===null?'':`?profileId=${encodeURIComponent(requested)}`}`),
    singleReadJson(`/api/products/${encodeURIComponent(identity.productId)}/supplier-hub-receipt?mode=history`),
    singleReadJson(`/api/products/${encodeURIComponent(identity.productId)}/supplier-hub-product-receipt`),
  ]);
  const failed=reads.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  const [value,history,native]=reads.map(result=>result.value),after=await singleReadJson('/api/supplier-hub/catalog-context');
  const identifier=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value);
  const nativeAllowed=row=>{
    const receipt=row?.receipt,states={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'};
    if(!row||!['yoofam-single-receipt-v1','yoofam-product-document-receipt-v1'].includes(row.format)
      ||row.productId!==identity.productId||!same(row.company,identity.company)||row.registered!==false||!/^\w[\w-]{0,99}$/.test(row.requestId||'')||!identifier(row.docId)
      ||!['packetDigest','identityDigest','preparedBodySha256'].every(key=>hash.test(row[key]||''))
      ||!receipt||!Object.hasOwn(states,receipt.sourceStatus)||receipt.state!==states[receipt.sourceStatus]||receipt.evidence!=='document-receipt'||receipt.registered!==false
      ||!same(receipt.company,row.company)||!same(receipt.docId,row.docId)||receipt.identityDigest!==row.identityDigest||receipt.preparedBodySha256!==row.preparedBodySha256
      ||!identifier(receipt.qvtRequestId)||!same(receipt.receiptId,receipt.qvtRequestId)||!Number.isSafeInteger(receipt.observedAt)||receipt.observedAt<=0||receipt.observedAt>Date.now()+5000
      ||Object.keys(receipt).some(key=>!['state','docId','company','identityDigest','preparedBodySha256','observedAt','receiptId','qvtRequestId','sourceStatus','evidence','registered'].includes(key)))return false;
    // A known rejection permits a new document. A pending or completed file
    // permits only recovery of this exact original request/document; it must
    // never authorize another creation. The endpoint already parses records.
    return receipt.sourceStatus==='REJECTED'||row.packetDigest===expected.packetDigest&&row.requestId===expected.requestId&&same(row.docId,expected.docId);
  };
  if(native.format!=='yoofam-native-receipt-history-v1'||native.productId!==identity.productId||!Array.isArray(native.receipts)||native.receipts.length>1000
    ||native.receipts.some(row=>!nativeAllowed(row)))throw Error('이 상품의 다른 전송 문서가 이미 보관돼 있거나 확인 이력이 다릅니다.');
  if(nativeAssets){
    const source=value.identity,{sourcePlanSha256:omitted,...manifest}=value;void omitted;
    if(value.format!=='yoofam-native-asset-source-plan-v1'||value.metadataValid!==true||value.sourcePlanSha256!==identity.fingerprint||value.registered!==false||value.remoteWrites!==false||value.submissionReady!==false||value.transportReady!==false||value.bytesVerified!==false
      ||!Array.isArray(value.issues)||value.issues.some(issue=>issue.level==='error')||!source||source.ownerId!==identity.ownerId||source.productId!==identity.productId||!same(source.company,identity.company)||source.categoryId!==identity.categoryId||source.schemaSha256!==identity.schemaSha256||source.inputFingerprint!==identity.inputFingerprint
      ||!same(source.source,{...identity.source,profileId:identity.profileId})||!same(source.members,identity.members)||await singleDigest(manifest)!==identity.fingerprint||await singleDigest(source)!==value.identityDigest||value.originalBodySha256!==expected.bodySha256||value.preparedBodySha256!==expected.preparedBodySha256
      ||!same(before,after)||history.history?.productId!==identity.productId||history.history.blocked!==false)throw Error('현재 파일명 원본 계획·회사·이전 전송 이력을 확인해주세요.');
  }else if(!same(before,after)||value.format!=='yoofam-supplier-hub-single-package-v1'||value.prepared!==true||value.registered!==false||value.remoteWrites!==false
    ||value.productId!==identity.productId||value.fingerprint!==identity.fingerprint||value.schemaSha256!==identity.schemaSha256||!same(value.company,identity.company)
    ||value.source?.profileId!==identity.profileId||!value.review?.canPrepare||!Array.isArray(value.review.issues)||value.review.issues.some(issue=>issue.level==='error')
    ||history.history?.productId!==identity.productId||history.history.blocked!==false)throw Error('현재 저장값 또는 이전 전송 이력을 확인해주세요.');
  const savedSource=nativeAssets?value.identity.source:value.source,options=nativeAssets?value.identity.members:value.options,payload=nativeAssets?value.body:value.payload;
  const source={productVersion:savedSource.productVersion,contentRevision:savedSource.contentRevision,optionRevision:savedSource.optionRevision,quotationRevision:savedSource.quotationRevision,profileRevision:savedSource.profileRevision};
  if(!same(source,identity.source)||!Array.isArray(options)||options.length!==payload?.jsonDocument?.length)throw Error('현재 포함 옵션 문서의 정확한 연결을 확인해주세요.');
  let body;
  if(wholeProduct){
    if(!nativeAssets&&(value.requestedProfileId!==identity.requestedProfileId||value.inputFingerprint!==identity.inputFingerprint)||options.length!==identity.members.length
      ||options.some((row,index)=>row.optionId!==identity.members[index].optionId||row.optionLabel!==identity.members[index].optionLabel))throw Error('전체 포함 옵션의 순서·저장값이 변경되었습니다.');
    body=structuredClone(payload);
  }else{
    if(value.options.filter(row=>row.optionId===identity.optionId).length!==1)throw Error('현재 선택 옵션의 연결을 확인해주세요.');
    const index=value.options.findIndex(row=>row.optionId===identity.optionId),document=structuredClone(value.payload.jsonDocument[index]);
    body={...value.payload,productName:document.startPage?.productName,jsonDocument:[document]};
  }
  if(body.docId!==null||body.scope!=='Retail_Categorized_Single'||body.displayCategoryCode!==identity.categoryId||await singleDigest(body)!==expected.bodySha256)throw Error('준비한 개별 문서의 저장 본문이 다릅니다.');
  const deferred=structuredClone(body);for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(document.imagePage&&Object.hasOwn(document.imagePage,key))document.imagePage[key]=false;
  if(await singleDigest(deferred)!==expected.preparedBodySha256)throw Error('제출 전 동의를 분리한 본문이 다릅니다.');
  if(nativeAssets&&!yoofamSingleSessionBound&&!yoofamSingleAccountChanged){
    const sourceExpected=Object.fromEntries(['identity','bodySha256','preparedBodySha256','packetDigest','requestId','docId'].map(key=>[key,expected[key]]));
    const restored=await chrome.runtime.sendMessage({type:'YOOFAM_READ_PRODUCT_SOURCE_SESSION',expected:sourceExpected});
    if(restored?.ok!==true||Object.keys(restored).sort().join(',')!=='ok,sessionId'||restored.sessionId!==null&&!/^\w[\w-]{0,99}$/.test(restored.sessionId||''))throw Error('원래 새 초안의 연결 기록을 확인하지 못했습니다.');
    if(!same(before,await singleReadJson('/api/supplier-hub/catalog-context')))throw Error('연결 기록을 확인하는 동안 회원 회사가 변경되었습니다.');
    if(restored.sessionId!==null)yoofamSingleSessionId=restored.sessionId;
  }
  yoofamSingleSessionBound=true;
  return {ok:true,current:true,submissionReady:true,priorDocumentClear:true,identity,bodySha256:expected.bodySha256,sessionId:yoofamSingleSessionId,checkedAt:Date.now()};
}
function singleConfirmationInput(expected,wholeProduct=false){
  const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)),same=(a,b)=>singleCanonical(a)===singleCanonical(b),hash=/^[a-f0-9]{64}$/,id=/^\w[\w-]{0,99}$/;
  const exact=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
  const identifier=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&value.length>0&&value.length<=200&&value===value.trim()&&!/[\u0000-\u001f]|\.\.\.|…/.test(value);
  const identity=expected?.identity,challenge=expected?.challenge,details=expected?.confirmation,source=expected?.sourceExpected,time=Date.now();
  if(!object(expected)||!object(identity)||!object(source)||!same(source.identity,identity)||identity.origin!==location.origin
    ||!singleSourceIdentity(identity,wholeProduct)
    ||!['fingerprint','schemaSha256','accountContext'].every(key=>hash.test(identity[key]||''))
    ||!exact(identity.company,['code','name'])||({A01526306:'유앤채',A01464742:'와이홉'})[identity.company.code]!==identity.company.name
    ||!['bodySha256','preparedBodySha256','packetDigest'].every(key=>hash.test(source[key]||''))||!id.test(expected.sessionId||'')||!hash.test(expected.identityDigest||'')
    ||!exact(challenge,['id','docId','packetDigest','items','issuedAt','expiresAt'],['stage'])||!hash.test(challenge.id||'')
    ||!identifier(expected.docId)||!same(expected.docId,challenge.docId)||challenge.packetDigest!==source.packetDigest
    ||!Number.isSafeInteger(challenge.issuedAt)||challenge.issuedAt<=0||challenge.issuedAt>time+5000||challenge.expiresAt!==challenge.issuedAt+120000||time>=challenge.expiresAt
    ||!Array.isArray(challenge.items)||challenge.items.length>20
    ||challenge.stage!==undefined&&!['productPage','imagePage','logisticsPage'].includes(challenge.stage))throw Error('현재 문서의 동의 요청을 확인해주세요.');
  const stage=challenge.stage,intermediate=stage==='productPage'||stage==='imagePage';
  if(challenge.items.some(item=>!exact(item,['key','id','text','required'],['title','termsText'])||!id.test(item.key||'')||!id.test(item.id||'')
    ||typeof item.text!=='string'||!item.text.trim()||item.text.length>10000||typeof item.required!=='boolean'
    ||item.title!==undefined&&(typeof item.title!=='string'||!item.title.trim()||item.title.length>500)
    ||item.termsText!==undefined&&(typeof item.termsText!=='string'||!item.termsText.trim()||item.termsText.length>50000)
    ||intermediate&&(typeof item.title!=='string'||typeof item.termsText!=='string'))
    ||new Set(challenge.items.map(item=>item.key)).size!==challenge.items.length||new Set(challenge.items.map(item=>item.id)).size!==challenge.items.length
    ||(intermediate||stage===undefined)&&!challenge.items.some(item=>item.required)
    ||stage==='logisticsPage'&&challenge.items.length>0&&!challenge.items.some(item=>item.required)
    ||!exact(details,['action','userInitiated','challengeId','confirmedAt','approvedKeys'],['stage'])||details.userInitiated!==true||details.challengeId!==challenge.id
    ||details.action!==(intermediate?'confirm-and-continue':'confirm-and-submit')
    ||(stage===undefined?details.stage!==undefined:details.stage!==stage)
    ||!Number.isSafeInteger(details.confirmedAt)||details.confirmedAt<challenge.issuedAt||details.confirmedAt>time+5000||details.confirmedAt>challenge.expiresAt
    ||!Array.isArray(details.approvedKeys)||new Set(details.approvedKeys).size!==details.approvedKeys.length
    ||!same([...details.approvedKeys].sort(),challenge.items.filter(item=>item.required).map(item=>item.key).sort()))throw Error('현재 단계의 약관과 직접 확인할 동작이 다릅니다.');
  return JSON.parse(singleCanonical(expected));
}
async function confirmSingleDocumentAction(expected,input,signal,current,wholeProduct=false,nativeAssets=false){
  const check=()=>{if(signal.aborted||!current()||Date.now()>=input.challenge.expiresAt||document.visibilityState!=='visible')throw Error('현재 동의 확인이 취소되었거나 만료됐습니다.');};
  check();if(await singleDigest(input.identity)!==input.identityDigest)throw Error('현재 문서의 회원 연결을 확인해주세요.');
  const before=await verifySingleDocumentSource(input.sourceExpected,wholeProduct,nativeAssets);check();
  if(before.sessionId!==input.sessionId)throw Error('현재 회원 세션이 변경되었습니다.');
  const accepted=await yoofamSingleConfirmation.prompt(input,{signal});check();
  if(accepted!==true)throw Error('동의 확인을 취소했습니다.');
  // The visible text and action are tied to this immutable request. Read the
  // current member and saved source again after the real extension UI click.
  singleConfirmationInput(expected,wholeProduct);
  const after=await verifySingleDocumentSource(input.sourceExpected,wholeProduct,nativeAssets);check();
  if(after.sessionId!==before.sessionId||after.sessionId!==input.sessionId||singleCanonical(after.identity)!==singleCanonical(input.identity))throw Error('확인 중 회원·회사·저장한 자료가 변경되었습니다.');
  return {ok:true,userInitiated:true,challengeId:input.challenge.id,identityDigest:input.identityDigest,checkedAt:Date.now()};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender?.id!==chrome.runtime.id||!['YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE','YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION','YOOFAM_VERIFY_PRODUCT_DOCUMENT_SOURCE','YOOFAM_CONFIRM_PRODUCT_DOCUMENT_ACTION','YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION'].includes(message?.type))return;
  const nativeAssets=message.type==='YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE'||message.type==='YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION',wholeProduct=nativeAssets||message.type==='YOOFAM_VERIFY_PRODUCT_DOCUMENT_SOURCE'||message.type==='YOOFAM_CONFIRM_PRODUCT_DOCUMENT_ACTION';
  if(message.type==='YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION'||message.type==='YOOFAM_CONFIRM_PRODUCT_DOCUMENT_ACTION'||message.type==='YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION'){
    let input;try{input=singleConfirmationInput(message.expected,wholeProduct);if(yoofamSingleConfirmationAttempt||typeof yoofamSingleConfirmation==='undefined')throw Error('현재 동의 확인을 마친 뒤 다시 확인해주세요.');}
    catch(error){respond({ok:false,error:error.message});return;}
    const controller=new AbortController(),snapshot=singleCanonical(message.expected);yoofamSingleConfirmationAttempt=controller;
    let timer;const cancelled=new Promise((resolve,reject)=>{controller.signal.addEventListener('abort',()=>reject(Error('동의 확인을 취소했거나 시간이 초과됐습니다.')),{once:true});});
    const invalidate=()=>controller.abort(),visibility=()=>{if(document.visibilityState!=='visible')invalidate();};
    window.addEventListener('pagehide',invalidate);document.addEventListener('visibilitychange',visibility);
    timer=setTimeout(invalidate,Math.max(0,input.challenge.expiresAt-Date.now()));
    const current=()=>yoofamSingleConfirmationAttempt===controller&&singleCanonical(message.expected)===snapshot;
    void Promise.race([confirmSingleDocumentAction(message.expected,input,controller.signal,current,wholeProduct,nativeAssets),cancelled])
      .then(respond,error=>respond({ok:false,error:error.message}))
      .finally(()=>{clearTimeout(timer);window.removeEventListener('pagehide',invalidate);document.removeEventListener('visibilitychange',visibility);if(yoofamSingleConfirmationAttempt===controller)yoofamSingleConfirmationAttempt=null;});
    return true;
  }
  verifySingleDocumentSource(message.expected,wholeProduct,nativeAssets).then(respond,error=>respond({ok:false,error:'현재 회원·회사·저장 자료를 확인하지 못했습니다.',...(error?.sourceFailure?{sourceFailure:error.sourceFailure}:{})}));return true;
});
