import type { QuotationFieldsView } from '@/app/quotation-schema';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';

export type SinglePackageView = {
  format: 'yoofam-supplier-hub-single-package-v1'; prepared: boolean; registered: false; remoteWrites: false; submissionReady: false;
  productId: string; fingerprint: string; company: SupplierHubCompany; schemaSha256: string;
  source: { productVersion: string; contentRevision: number; optionRevision: number; quotationRevision: number; profileId: string | null; profileRevision: number | null };
  options: { optionId: string | null; optionLabel: string }[];
  payload: { docId: null; productName: string; categoryPath: string; categoryId: number | string; displayCategoryCode: string;
    jsonDocument: Record<string, unknown>[]; scope: string; productNoticeNumber: number | string; version: number | string; remark?: string };
  review: { canPrepare: boolean; issues: { code: string; level: string; message: string }[]; fields: { optionId: string | null; fieldId: string; savedValue: string }[] };
  manifest: { optionId: string | null; role: string; files: { key: string; url: string; sha256: string; byteLength: number; published: boolean }[] }[];
};
export function singlePackageCurrent(value: SinglePackageView, view: QuotationFieldsView, productId: string) {
  return value.format === 'yoofam-supplier-hub-single-package-v1' && value.productId === productId && value.registered === false
    && value.remoteWrites === false && value.submissionReady === false && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && value.source.productVersion === view.productVersion && value.source.contentRevision === view.contentRevision
    && value.source.optionRevision === view.optionRevision && value.source.quotationRevision === view.revision
    && value.source.profileId === view.categoryContext.profileId && value.payload.displayCategoryCode === view.categoryContext.categoryId
    && Array.isArray(value.options) && value.options.length === value.payload.jsonDocument.length
    && JSON.stringify(value.options.map(row=>row.optionId)) === JSON.stringify(view.resolved.rows.filter(row=>row.included).map(row=>row.optionId));
}
/** One exact included option per Single document; preparation is not a receipt. */
export async function singlePackagePacket(value: SinglePackageView, ownerId: string, optionId: string) {
  if(!value.prepared||!value.review.canPrepare||value.review.issues.some(issue=>issue.level==='error')||!value.source.profileId
    ||value.payload.docId!==null||value.payload.scope!=='Retail_Categorized_Single'||!/^[a-f0-9]{64}$/.test(value.schemaSha256)
    ||value.options.filter(row=>row.optionId===optionId).length!==1||!/^[\w-]{1,100}$/.test(ownerId)||!/^[\w-]{1,100}$/.test(optionId))
    throw Error('저장한 옵션 1개와 준비된 개별 견적 자료를 확인해주세요.');
  const index=value.options.findIndex(row=>row.optionId===optionId), document=structuredClone(value.payload.jsonDocument[index]);
  const start=document.startPage as {productName?:unknown;categoryPath?:unknown}|undefined;
  if(typeof start?.productName!=='string'||!start.productName.trim()||start.categoryPath!==value.payload.categoryPath)throw Error('선택 옵션의 상품명·카테고리 연결을 확인해주세요.');
  const context=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',ownerId,value.company.code,value.company.name]));
  const accountContext=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',context)),byte=>byte.toString(16).padStart(2,'0')).join('');
  return freezeSingleJson(structuredClone({type:'YOOFAM_SINGLE_DOCUMENT_TRANSPORT',format:'yoofam-supplier-hub-single-document-v1',requestId:crypto.randomUUID(),ownerId,accountContext,
    company:value.company,productId:value.productId,profileId:value.source.profileId,optionId,categoryId:value.payload.displayCategoryCode,
    fingerprint:value.fingerprint,schemaSha256:value.schemaSha256,
    source:{productVersion:value.source.productVersion,contentRevision:value.source.contentRevision,optionRevision:value.source.optionRevision,
      quotationRevision:value.source.quotationRevision,profileRevision:value.source.profileRevision},
    body:{...value.payload,productName:start.productName,jsonDocument:[document]}}));
}

export type SingleDocumentPacket = Awaited<ReturnType<typeof singlePackagePacket>>;
export type SingleConsentStage = 'productPage'|'imagePage'|'logisticsPage';
export type SingleConsentItem = {key:string;id:string;text:string;required:boolean;title?:string;termsText?:string};
export type SingleConsentChallenge = {id:string;docId:string|number;packetDigest:string;issuedAt:number;expiresAt:number;stage?:SingleConsentStage;items:SingleConsentItem[]};
export type SingleConfirmation = {action:'confirm-and-continue'|'confirm-and-submit';stage?:SingleConsentStage;userInitiated:true;challengeId:string;confirmedAt:number;approvedKeys:string[]};
export type SingleDocumentPreview = {format:string;fingerprint:string;productId:string;optionId:string;identityDigest:string;preparedBodySha256:string;originalBodySha256:string;liveVerified:boolean;registered:false;remoteWrites:false};
export type SingleDocumentReceipt = {state:'pending'|'accepted'|'rejected'|'registered';docId:string|number;company:SupplierHubCompany;identityDigest:string;preparedBodySha256:string;observedAt:number;
  evidence:'document-receipt'|'document-and-sku';receiptId?:string|number;skuId?:string|number;sourceStatus?:'SUBMITTED'|'REJECTED'|'FINISHED';qvtRequestId?:string|number};
export type SingleDocumentState = {format:string;requestId:string;identity:Record<string,unknown>;identityDigest:string;packetDigest:string;preparedBodySha256:string;originalBodySha256:string;
  state:string;docId:string|number|null;registered:boolean;success:boolean;needsRecovery:boolean;challenge?:SingleConsentChallenge;error?:{code:string;message:string};receipt?:SingleDocumentReceipt};
export type SingleDocumentSession = {packet:SingleDocumentPacket;preview:SingleDocumentPreview;packetDigest:string;origin:string};
export type SingleDocumentAction = 'start'|'resume'|'recover'|'confirm'|'observe';
const singleHash=/^[a-f0-9]{64}$/,singleId=/^\w[\w-]{0,99}$/;
const singleOrigins=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
const singleObject=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
function singleExact(value:unknown,required:string[],optional:string[]=[]):value is Record<string,unknown>{return singleObject(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));}
const singleIdentifier=(value:unknown):value is string|number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0||typeof value==='string'&&value.length>0&&value.length<=200&&value===value.trim()&&!/[\u0000-\u001f]|\.\.\.|…/.test(value);
function freezeSingleJson<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freezeSingleJson);Object.freeze(value);}return value;}
function singleCanonical(value:unknown):string{
  let count=0;const seen=new Set<object>();
  const visit=(item:unknown,depth:number):string=>{
    if(++count>100000||depth>30)throw Error('개별 견적 자료가 처리 한도를 초과했습니다.');
    if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return JSON.stringify(item);
    if(!item||typeof item!=='object'||seen.has(item))throw Error('개별 견적 자료의 JSON 값을 확인해주세요.');
    seen.add(item);let text:string;
    if(Array.isArray(item)){if(Object.keys(item).length!==item.length)throw Error('개별 견적 자료의 배열을 확인해주세요.');text='['+item.map(child=>visit(child,depth+1)).join(',')+']';}
    else{const keys=Object.keys(item).sort();if(keys.some(key=>['__proto__','prototype','constructor','authorization','cookie','password','accessToken','refreshToken'].includes(key)))throw Error('개별 견적 자료에 지원하지 않는 항목이 있습니다.');text='{'+keys.map(key=>JSON.stringify(key)+':'+visit((item as Record<string,unknown>)[key],depth+1)).join(',')+'}';}
    seen.delete(item);return text;
  };
  const text=visit(value,0);if(new TextEncoder().encode(text).length>6*1024*1024)throw Error('개별 견적 자료가 6MB를 초과했습니다.');return text;
}
const singleDigest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(singleCanonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function singleLogicalIdentity(packet:SingleDocumentPacket,origin:string){return {origin,...Object.fromEntries(['ownerId','accountContext','company','productId','profileId','optionId','categoryId','fingerprint','schemaSha256','source'].map(key=>[key,packet[key as keyof SingleDocumentPacket]]))};}
async function singlePacketProof(packet:SingleDocumentPacket,origin:string){
  const originalBodySha256=await singleDigest(packet.body),deferred=structuredClone(packet.body),image=deferred.jsonDocument[0].imagePage;
  if(singleObject(image))for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(image,key))image[key]=false;
  const preparedBodySha256=await singleDigest(deferred),packetDigest=await singleDigest({identity:singleLogicalIdentity(packet,origin),bodySha256:preparedBodySha256,originalBodySha256});
  return {originalBodySha256,preparedBodySha256,packetDigest};
}
export class SingleDocumentBridgeError extends Error{constructor(message:string,public uncertain:boolean,public code='SINGLE_BRIDGE'){super(message);}}
/** An app click initiates one call. A missing acknowledgement never retries it. */
export function singleDocumentExchange(action:'preview'|SingleDocumentAction,packet:SingleDocumentPacket,signal:AbortSignal,confirmation?:SingleConfirmation):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new SingleDocumentBridgeError('개별 견적 작업을 취소했습니다.',false));return;}
    singleCanonical(packet);
    if(action==='confirm'&&!confirmation||action!=='confirm'&&confirmation){reject(new SingleDocumentBridgeError('현재 동의 동작을 확인해주세요.',false));return;}
    const requestId=crypto.randomUUID(),mutating=action!=='preview'&&action!=='observe'&&action!=='recover';
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new SingleDocumentBridgeError('개별 견적 응답 확인을 취소했습니다. 요청 결과는 조회로 확인해주세요.',mutating));};
    const receive=(event:MessageEvent)=>{
      if(event.source!==window||event.origin!==window.location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF_RESULT'||event.data.requestId!==requestId)return;
      cleanup();const envelope=event.data.result;
      if(!singleObject(envelope)||envelope.ok!==true||!Object.hasOwn(envelope,'result'))reject(new SingleDocumentBridgeError(typeof envelope?.error==='string'?envelope.error:'개별 견적 응답을 확인하지 못했습니다.',mutating,typeof envelope?.code==='string'?envelope.code:'SINGLE_BRIDGE'));
      else{try{singleCanonical(envelope.result);resolve(envelope.result);}catch{reject(new SingleDocumentBridgeError('개별 견적 응답의 크기·자료형을 확인해주세요.',mutating));}}
    };
    const timer=setTimeout(()=>{cleanup();reject(new SingleDocumentBridgeError('개별 견적 응답이 없습니다. 같은 요청을 다시 전송하지 말고 저장 결과를 확인해주세요.',mutating,'SINGLE_ACK_MISSING'));},action==='confirm'?120000:action==='preview'?20000:60000);
    window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
    window.postMessage({channel:'YOOFAM_HUB_HANDOFF',requestId,type:'SINGLE_DOCUMENT',payload:{action,packet,...(confirmation?{confirmation}:{})}},window.location.origin);
  });
}
export async function previewSingleDocument(packet:SingleDocumentPacket,signal:AbortSignal):Promise<SingleDocumentSession>{
  const origin=window.location.origin;if(!singleOrigins.includes(origin))throw Error('허용된 앱에서 개별 견적 자료를 확인해주세요.');
  const result=await singleDocumentExchange('preview',packet,signal),proof=await singlePacketProof(packet,origin);
  if(signal.aborted)throw Error('개별 견적 확인을 취소했습니다.');
  if(!singleObject(result)||result.format!==packet.format||result.fingerprint!==packet.fingerprint||result.productId!==packet.productId||result.optionId!==packet.optionId
    ||!singleHash.test(String(result.identityDigest))||result.preparedBodySha256!==proof.preparedBodySha256||result.originalBodySha256!==proof.originalBodySha256
    ||typeof result.liveVerified!=='boolean'||result.remoteWrites!==false||result.registered!==false||result.packetDigest!==undefined&&result.packetDigest!==proof.packetDigest)
    throw new SingleDocumentBridgeError('확장에 전달한 옵션·본문 식별값이 다릅니다.',false,'SINGLE_REPLY_IDENTITY');
  return freezeSingleJson({packet,preview:structuredClone(result) as SingleDocumentPreview,packetDigest:proof.packetDigest,origin});
}
export function validateSingleConsentChallenge(value:unknown,session:SingleDocumentSession,state:string,docId:unknown,time=Date.now()):SingleConsentChallenge{
  if(!singleExact(value,['id','docId','packetDigest','issuedAt','expiresAt','items'],['stage'])||!singleHash.test(String(value.id))||!singleIdentifier(value.docId)||value.docId!==docId||value.packetDigest!==session.packetDigest
    ||!Number.isSafeInteger(value.issuedAt)||Number(value.issuedAt)<=0||Number(value.issuedAt)>time+5000||value.expiresAt!==Number(value.issuedAt)+120000||time>=Number(value.expiresAt)
    ||!Array.isArray(value.items)||value.items.length>20||value.stage!==undefined&&!['productPage','imagePage','logisticsPage'].includes(String(value.stage)))throw Error('현재 문서의 동의 요청이 다르거나 만료됐습니다.');
  const intermediate=state==='awaiting-stage-consent';
  if(intermediate&&!['productPage','imagePage'].includes(String(value.stage))||!intermediate&&(state!=='awaiting-consent'||value.stage!==undefined&&value.stage!=='logisticsPage'))throw Error('현재 확인할 동의 단계가 다릅니다.');
  const items=value.items as unknown[];
  if(items.some(item=>!singleExact(item,['key','id','text','required'],['title','termsText'])||!singleId.test(String(item.key))||!singleId.test(String(item.id))||typeof item.required!=='boolean'
    ||typeof item.text!=='string'||!item.text.trim()||item.text.length>10000
    ||item.title!==undefined&&(typeof item.title!=='string'||!item.title.trim()||item.title.length>500)
    ||item.termsText!==undefined&&(typeof item.termsText!=='string'||!item.termsText.trim()||item.termsText.length>50000)
    ||intermediate&&(typeof item.title!=='string'||typeof item.termsText!=='string'))
    ||new Set(items.map(item=>(item as SingleConsentItem).key)).size!==items.length||new Set(items.map(item=>(item as SingleConsentItem).id)).size!==items.length
    ||(intermediate||value.stage===undefined||items.length>0)&&!items.some(item=>(item as SingleConsentItem).required))throw Error('동의 항목의 정확한 이름·약관 전문을 확인해주세요.');
  return freezeSingleJson(structuredClone(value) as SingleConsentChallenge);
}
export function singleConsentConfirmation(challenge:SingleConsentChallenge,approvedKeys:string[],time=Date.now()):SingleConfirmation{
  if(time<challenge.issuedAt||time>=challenge.expiresAt||new Set(approvedKeys).size!==approvedKeys.length||singleCanonical([...approvedKeys].sort())!==singleCanonical(challenge.items.filter(item=>item.required).map(item=>item.key).sort()))throw Error('현재 약관의 필수 항목을 직접 확인해주세요.');
  const intermediate=challenge.stage==='productPage'||challenge.stage==='imagePage';
  return freezeSingleJson({action:intermediate?'confirm-and-continue':'confirm-and-submit',...(challenge.stage?{stage:challenge.stage}:{}),userInitiated:true,challengeId:challenge.id,confirmedAt:time,approvedKeys:[...approvedKeys]});
}
export async function runSingleDocument(session:SingleDocumentSession,action:SingleDocumentAction,signal:AbortSignal,confirmation?:SingleConfirmation):Promise<SingleDocumentState>{
  if(session.preview.liveVerified!==true)throw new SingleDocumentBridgeError('개별 문서의 실제 등록 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.',false,'SINGLE_LIVE_CONTRACT_UNVERIFIED');
  if(window.location.origin!==session.origin)throw Error('원래 앱에서 개별 견적 요청을 확인해주세요.');
  const value=await singleDocumentExchange(action,session.packet,signal,confirmation),proof=await singlePacketProof(session.packet,session.origin);
  if(signal.aborted)throw new SingleDocumentBridgeError('응답 확인을 취소했습니다. 저장 결과를 조회해주세요.',action!=='recover'&&action!=='observe');
  const states=['prepared','create-requested','created','update-requested','updated','validation-requested','validated','validation-rejected','navigation-requested','awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested','pending','accepted','rejected','registered','scope-blocked'];
  const fail=():never=>{throw new SingleDocumentBridgeError('개별 견적 응답의 회원·문서·본문 연결을 확인하지 못했습니다. 저장 결과를 조회해주세요.',action!=='recover'&&action!=='observe','SINGLE_REPLY_IDENTITY');};
  if(!singleObject(value)||value.format!==session.packet.format||value.requestId!==session.packet.requestId||!singleObject(value.identity)||value.identityDigest!==session.preview.identityDigest
    ||value.packetDigest!==session.packetDigest||value.packetDigest!==proof.packetDigest||value.originalBodySha256!==proof.originalBodySha256||value.preparedBodySha256!==proof.preparedBodySha256
    ||!states.includes(String(value.state))||typeof value.needsRecovery!=='boolean'||value.docId!==null&&!singleIdentifier(value.docId)
    ||value.registered!==(value.state==='registered')||value.success!==value.registered)fail();
  const result=structuredClone(value) as unknown as SingleDocumentState,identity=result.identity;
  if(!Number.isSafeInteger(identity.appTabId)||Number(identity.appTabId)<0||!Number.isSafeInteger(identity.windowId)||Number(identity.windowId)<0
    ||Object.keys(identity).some(key=>!['origin','appTabId','windowId','ownerId','accountContext','company','productId','profileId','optionId','categoryId','fingerprint','schemaSha256','source'].includes(key))
    ||await singleDigest(identity)!==session.preview.identityDigest)fail();
  const logical=Object.fromEntries(Object.entries(identity).filter(([key])=>!['appTabId','windowId'].includes(key)));
  if(singleCanonical(logical)!==singleCanonical(singleLogicalIdentity(session.packet,session.origin)))fail();
  if(['awaiting-stage-consent','awaiting-consent'].includes(result.state))result.challenge=validateSingleConsentChallenge(result.challenge,session,result.state,result.docId);
  else if(result.challenge!==undefined)fail();
  if(['pending','accepted','rejected','registered'].includes(result.state)){
    const receipt=result.receipt;
    if(!receipt)return fail();
    if(!singleObject(receipt)||receipt.state!==result.state||receipt.docId!==result.docId||singleCanonical(receipt.company)!==singleCanonical(session.packet.company)
      ||receipt.identityDigest!==session.preview.identityDigest||receipt.preparedBodySha256!==proof.preparedBodySha256||!Number.isSafeInteger(receipt.observedAt)||Number(receipt.observedAt)<=0||Number(receipt.observedAt)>Date.now()+5000
      ||!['document-receipt','document-and-sku'].includes(String(receipt.evidence))||['accepted','registered'].includes(result.state)&&!singleIdentifier(receipt.receiptId)
      ||result.state==='registered'&&(receipt.evidence!=='document-and-sku'||!singleIdentifier(receipt.skuId)))fail();
    if(receipt.sourceStatus!==undefined){
      const states:Record<string,string>={SUBMITTED:'pending',REJECTED:'rejected',FINISHED:'accepted'};
      if(!Object.hasOwn(states,receipt.sourceStatus)||receipt.state!==states[receipt.sourceStatus]||receipt.evidence!=='document-receipt'
        ||!singleIdentifier(receipt.qvtRequestId)||receipt.qvtRequestId!==receipt.receiptId||receipt.skuId!==undefined||result.registered!==false||result.success!==false)fail();
    }else if(receipt.qvtRequestId!==undefined)fail();
  }
  return freezeSingleJson(structuredClone(result));
}
/** Later observations retain the original owned document and registration
 * file identity. A rejected refresh never replaces the previously shown proof. */
export function verifySingleDocumentObservation(previous:SingleDocumentState|null,result:SingleDocumentState):void{
  if(!previous)return;
  const before=previous.receipt,after=result.receipt;
  if(previous.docId!==null&&result.docId!==previous.docId
    ||before&&(!after||after.observedAt<before.observedAt
      ||before.receiptId!==undefined&&after.receiptId!==before.receiptId
      ||before.qvtRequestId!==undefined&&(after.qvtRequestId!==before.qvtRequestId||after.sourceStatus===undefined)
      ||previous.state==='accepted'&&result.state==='pending'
      ||previous.state==='registered'&&(result.state!=='registered'||after.skuId!==before.skuId)))
    throw new SingleDocumentBridgeError('원래 문서 또는 등록 파일 ID와 다른 조회 결과입니다. 이전 확인 결과를 유지했습니다.',false,'SINGLE_RECEIPT_CHANGED');
}
export async function readSingleCatalogContext(signal:AbortSignal):Promise<{ownerId:string;company:SupplierHubCompany}>{
  const controller=new AbortController(),abort=()=>controller.abort();if(signal.aborted)abort();signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,10000);
  try{
  const response=await fetch('/api/supplier-hub/catalog-context',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
  const text=await response.text();if(controller.signal.aborted||response.redirected||text.length>4096||response.url&&response.url!==window.location.origin+'/api/supplier-hub/catalog-context')throw Error('현재 회원 회사정보를 확인하지 못했습니다.');
  let value:unknown;try{value=JSON.parse(text);}catch{throw Error('현재 회원 회사정보를 읽지 못했습니다.');}
  if(!response.ok||!singleExact(value,['ownerId','company'])||!singleId.test(String(value.ownerId))||!singleExact(value.company,['code','name'])
    ||({A01526306:'유앤채',A01464742:'와이홉'} as Record<string,string>)[String(value.company.code)]!==value.company.name)throw Error('승인된 회원 회사로 자료를 확인해주세요.');
  return freezeSingleJson(structuredClone(value) as {ownerId:string;company:SupplierHubCompany});
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
