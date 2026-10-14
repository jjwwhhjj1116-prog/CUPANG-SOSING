// Authenticated app proof only; this script never creates a Hub document.
let yoofamSingleSessionId=crypto.randomUUID(),yoofamSingleAccount=null;
const singleCanonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(singleCanonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+singleCanonical(value[key])).join(',')+'}';
async function singleDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(singleCanonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
async function singleReadJson(path){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(path,{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
    if(!response.ok||response.redirected||response.url!==location.origin+path)throw Error('현재 앱의 저장 자료를 읽지 못했습니다.');
    const text=await response.text();if(text.length>6*1024*1024)throw Error('개별 견적 자료가 너무 큽니다.');return JSON.parse(text);
  }finally{clearTimeout(timer);}
}
async function verifySingleDocumentSource(expected){
  const identity=expected?.identity,same=(a,b)=>singleCanonical(a)===singleCanonical(b),hash=/^[a-f0-9]{64}$/,id=/^\w[\w-]{0,99}$/;
  if(!identity||identity.origin!==location.origin||!['ownerId','productId','profileId','optionId'].every(key=>id.test(identity[key]||''))
    ||!['fingerprint','schemaSha256','accountContext'].every(key=>hash.test(identity[key]||''))||!hash.test(expected.bodySha256||'')
    ||!hash.test(expected.preparedBodySha256||'')||!hash.test(expected.packetDigest||''))throw Error('원래 회원·상품·옵션 요청을 확인해주세요.');
  const before=await singleReadJson('/api/supplier-hub/catalog-context'),context=singleCanonical([before.ownerId,before.company]);
  if(yoofamSingleAccount!==null&&yoofamSingleAccount!==context){yoofamSingleSessionId=crypto.randomUUID();yoofamSingleAccount=context;throw Error('현재 회원 회사가 변경되었습니다.');}
  yoofamSingleAccount=context;
  const bytes=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',before.ownerId,before.company?.code,before.company?.name]));
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(before.ownerId!==identity.ownerId||!same(before.company,identity.company)||account!==identity.accountContext)throw Error('원래 회원 회사로 로그인해주세요.');
  const value=await singleReadJson(`/api/products/${encodeURIComponent(identity.productId)}/supplier-hub-single-package?profileId=${encodeURIComponent(identity.profileId)}`);
  const history=await singleReadJson(`/api/products/${encodeURIComponent(identity.productId)}/supplier-hub-receipt?mode=history`),after=await singleReadJson('/api/supplier-hub/catalog-context');
  if(!same(before,after)||value.format!=='yoofam-supplier-hub-single-package-v1'||value.prepared!==true||value.registered!==false||value.remoteWrites!==false
    ||value.productId!==identity.productId||value.fingerprint!==identity.fingerprint||value.schemaSha256!==identity.schemaSha256||!same(value.company,identity.company)
    ||value.source?.profileId!==identity.profileId||!value.review?.canPrepare||!Array.isArray(value.review.issues)||value.review.issues.some(issue=>issue.level==='error')
    ||history.history?.productId!==identity.productId||history.history.blocked!==false)throw Error('현재 저장값 또는 이전 전송 이력을 확인해주세요.');
  const source={productVersion:value.source.productVersion,contentRevision:value.source.contentRevision,optionRevision:value.source.optionRevision,quotationRevision:value.source.quotationRevision,profileRevision:value.source.profileRevision};
  if(!same(source,identity.source)||!Array.isArray(value.options)||value.options.length!==value.payload?.jsonDocument?.length||value.options.filter(row=>row.optionId===identity.optionId).length!==1)throw Error('현재 포함 옵션 문서의 정확한 연결을 확인해주세요.');
  const index=value.options.findIndex(row=>row.optionId===identity.optionId),document=structuredClone(value.payload.jsonDocument[index]);
  const body={...value.payload,productName:document.startPage?.productName,jsonDocument:[document]};
  if(body.docId!==null||body.scope!=='Retail_Categorized_Single'||body.displayCategoryCode!==identity.categoryId||await singleDigest(body)!==expected.bodySha256)throw Error('준비한 개별 문서의 저장 본문이 다릅니다.');
  const deferred=structuredClone(body);for(const key of ['msrpAgree','labelContactAgreed'])if(deferred.jsonDocument[0].imagePage&&Object.hasOwn(deferred.jsonDocument[0].imagePage,key))deferred.jsonDocument[0].imagePage[key]=false;
  if(await singleDigest(deferred)!==expected.preparedBodySha256)throw Error('제출 전 동의를 분리한 본문이 다릅니다.');
  return {ok:true,current:true,submissionReady:true,priorDocumentClear:true,identity,bodySha256:expected.bodySha256,sessionId:yoofamSingleSessionId,checkedAt:Date.now()};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender?.id!==chrome.runtime.id||!['YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE','YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION'].includes(message?.type))return;
  if(message.type==='YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION'){respond({ok:false,error:'현재 문서와 동의 내용을 직접 확인한 제출 동작이 필요합니다.'});return;}
  verifySingleDocumentSource(message.expected).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
