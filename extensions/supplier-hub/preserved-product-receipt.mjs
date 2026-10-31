import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {validatePreservedProductInspectionTarget} from './preserved-product-checkpoint.mjs';

export const HISTORICAL_PRODUCT_RECEIPT_URL='https://supplier.coupang.com/sr/draft/api/drafts/register-requested';
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const STATES=new Set(['created','update-requested','updated','validation-requested','validated','validation-rejected','navigation-requested','navigation-ready','awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested','pending','accepted','rejected']);
const STATUS={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'};
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const identifier=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)||integer(value,1);
const text=(value,max)=>typeof value==='string'&&Boolean(value.trim())&&value.length<=max;
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const invalid=()=>fail('HISTORICAL_RECEIPT_SCOPE','원래 요청·문서·회원·회사의 과거 접수 연결을 확인하지 못했습니다.');
function canonical(value,depth=0,seen=new Set()){
  if(depth>25)invalid();
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(!value||typeof value!=='object'||seen.has(value))invalid();
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string')||Object.values(fields).some(field=>!Object.hasOwn(field,'value')))invalid();
  if(Array.isArray(value)&&(keys.length!==value.length+1||Object.keys(value).some((key,index)=>key!==String(index))))invalid();
  if(!Array.isArray(value)&&keys.some(key=>['__proto__','prototype','constructor','password','cookie','authorization'].includes(key)))invalid();
  seen.add(value);const result=Array.isArray(value)?'['+value.map(item=>canonical(item,depth+1,seen)).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1,seen)).join(',')+'}';seen.delete(value);
  if(result.length>256*1024)invalid();return result;
}
const same=(a,b)=>canonical(a)===canonical(b),copy=value=>JSON.parse(canonical(value));
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const company=value=>exact(value,['code','name'])&&({A01526306:'유앤채',A01464742:'와이홉'})[value.code]===value.name;
const source=value=>exact(value,['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'])&&typeof value.productVersion==='string'&&Number.isFinite(Date.parse(value.productVersion))
  &&['contentRevision','optionRevision','quotationRevision'].every(key=>integer(value[key]))&&(value.profileRevision===null||integer(value.profileRevision));
const members=value=>Array.isArray(value)&&value.length>0&&value.length<=200&&value.every((row,index)=>exact(row,['optionId','optionLabel','documentIndex'])&&ID.test(row.optionId||'')&&typeof row.optionLabel==='string'&&row.optionLabel.length<=10000&&row.documentIndex===index)
  &&new Set(value.map(row=>row.optionId)).size===value.length;
export function validateHistoricalProductReceiptTarget(value){
  const target=copy(value);if(!exact(target,['requestId','productId','docId','company','qvtRequestId'])||!identifier(target.qvtRequestId))invalid();
  validatePreservedProductInspectionTarget(Object.fromEntries(Object.entries(target).filter(([key])=>key!=='qvtRequestId')));return freeze(target);
}
/** Read the identity that the existing authenticated native-assets GET still
 * returns when new-upload readiness is false. No compilation or file read. */
export async function historicalProductReceiptSourceFromNativePlan({plan:rawPlan,requestedProfileId,productName,categoryPath}){
  const plan=copy({format:rawPlan?.format,registered:rawPlan?.registered,remoteWrites:rawPlan?.remoteWrites,metadataValid:rawPlan?.metadataValid,identity:rawPlan?.identity,identityDigest:rawPlan?.identityDigest}),identity=plan.identity;
  if(plan.format!=='yoofam-native-asset-source-plan-v1'||plan.registered!==false||plan.remoteWrites!==false||typeof plan.metadataValid!=='boolean'
    ||!exact(identity,['ownerId','productId','company','categoryId','categoryPath','schemaSha256','sourceFingerprint','inputFingerprint','source','members'])
    ||!HASH.test(identity.sourceFingerprint||'')||!Array.isArray(identity.categoryPath)||!identity.categoryPath.length||identity.categoryPath.length>30||identity.categoryPath.some(value=>!text(value,500))
    ||(plan.identityDigest===null?plan.metadataValid!==false:!HASH.test(plan.identityDigest||'')||await digest(identity)!==plan.identityDigest)
    ||!exact(identity.source,['productVersion','contentRevision','optionRevision','quotationRevision','profileId','profileRevision'])
    ||!ID.test(identity.ownerId||'')||!ID.test(identity.productId||'')||!company(identity.company)||!members(identity.members)||!HASH.test(identity.inputFingerprint||'')||!HASH.test(identity.schemaSha256||'')
    ||!(requestedProfileId===null||requestedProfileId===identity.source.profileId)||!text(productName,500)||!text(categoryPath,10000))invalid();
  const {profileId,...clocks}=identity.source;if(!(profileId===null||ID.test(profileId||''))||!source(clocks)||!/^\d{1,20}$/.test(identity.categoryId||'')||!categoryPath.endsWith(' ('+identity.categoryId+')'))invalid();
  return freeze({ownerId:identity.ownerId,company:identity.company,productId:identity.productId,profileId,requestedProfileId,categoryId:identity.categoryId,inputFingerprint:identity.inputFingerprint,schemaSha256:identity.schemaSha256,
    source:clocks,members:identity.members,productName,categoryPath});
}
/** Historical hashes identify the retained request. They deliberately make no
 * assertion about today's native readiness, file bytes or remote body equality.
 * The checkpoint argument must come from the extension-private store, never a
 * page message. This pure validator cannot establish storage provenance. */
export async function historicalProductReceiptAnchor(input){
  const {target:rawTarget,checkpoint:rawCheckpoint,scope:rawScope,currentSource:rawCurrent,checkedAt=Date.now(),readId=crypto.randomUUID()}=input??{};
  const target=validateHistoricalProductReceiptTarget(rawTarget),checkpoint=copy(rawCheckpoint),scope=copy(rawScope),currentSource=copy(rawCurrent),identity=checkpoint.identity;
  if(!exact(scope,['origin','ownerId','company'])||!HANDOFF_ORIGINS.includes(scope.origin)||!ID.test(scope.ownerId||'')||!company(scope.company)||!same(scope.company,target.company)
    ||!integer(checkedAt,1)||checkedAt>Date.now()+5000||!ID.test(readId||''))invalid();
  const identityKeys=['origin','appTabId','windowId','ownerId','accountContext','company','productId','profileId','requestedProfileId','categoryId','fingerprint','inputFingerprint','schemaSha256','source','members'];
  if(!exact(identity,identityKeys)||identity.origin!==scope.origin||identity.ownerId!==scope.ownerId||identity.productId!==target.productId||!same(identity.company,scope.company)
    ||!integer(identity.appTabId)||!integer(identity.windowId)||![identity.accountContext,identity.fingerprint,identity.inputFingerprint,identity.schemaSha256].every(value=>HASH.test(value||''))
    ||!(identity.profileId===null||ID.test(identity.profileId||''))||!(identity.requestedProfileId===null||identity.requestedProfileId===identity.profileId)
    ||!/^\d{1,20}$/.test(identity.categoryId||'')||!source(identity.source)||!members(identity.members))invalid();
  const bytes=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',scope.ownerId,scope.company.code,scope.company.name]));
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(checkpoint.format!=='yoofam-supplier-hub-product-document-v1'||checkpoint.draftOnly!==true||!STATES.has(checkpoint.state)||checkpoint.requestId!==target.requestId
    ||String(checkpoint.docId)!==String(target.docId)||!identifier(checkpoint.docId)||![checkpoint.identityDigest,checkpoint.packetDigest,checkpoint.originalBodySha256,checkpoint.bodySha256].every(value=>HASH.test(value||''))
    ||!integer(checkpoint.sequence,1)||!integer(checkpoint.updatedAt,1)||checkpoint.updatedAt>checkedAt+5000||Date.parse(identity.source.productVersion)>checkpoint.updatedAt+5000
    ||!Array.isArray(checkpoint.baselineDocIds)||checkpoint.baselineDocIds.length>10000||checkpoint.baselineDocIds.some(value=>!identifier(value)||String(value)===String(checkpoint.docId))
    ||checkpoint.key!=='product-document:'+checkpoint.packetDigest||checkpoint.identityDigest!==await digest(identity)||identity.accountContext!==account)invalid();
  const logical=Object.fromEntries(Object.entries(identity).filter(([key])=>!['appTabId','windowId'].includes(key)));
  const lane=Object.fromEntries(['origin','ownerId','accountContext','company','productId'].map(key=>[key,identity[key]]));
  if(checkpoint.packetDigest!==await digest({identity:logical,bodySha256:checkpoint.bodySha256,originalBodySha256:checkpoint.originalBodySha256})||checkpoint.laneKey!=='product-document-lane:'+await digest(lane))invalid();
  const owned=checkpoint.ownedTarget,tab=checkpoint.tab;
  if(!exact(owned,['tabId','windowId','origin','requestId','packetDigest'])||!integer(owned.tabId)||owned.tabId===identity.appTabId||owned.windowId!==identity.windowId||owned.origin!=='https://supplier.coupang.com'
    ||owned.requestId!==target.requestId||owned.packetDigest!==checkpoint.packetDigest||!object(tab)||tab.tabId!==owned.tabId||tab.windowId!==owned.windowId||tab.origin!==owned.origin||tab.authenticated!==true
    ||tab.requestId!==target.requestId||tab.packetDigest!==checkpoint.packetDigest||!same(tab.company,scope.company))invalid();
  if(!exact(currentSource,['ownerId','company','productId','profileId','requestedProfileId','categoryId','inputFingerprint','schemaSha256','source','members','productName','categoryPath'])||currentSource.ownerId!==identity.ownerId||!same(currentSource.company,identity.company)||currentSource.productId!==identity.productId
    ||currentSource.profileId!==identity.profileId||currentSource.requestedProfileId!==identity.requestedProfileId||currentSource.categoryId!==identity.categoryId||!same(currentSource.source,identity.source)||!same(currentSource.members,identity.members)
    ||currentSource.inputFingerprint!==identity.inputFingerprint||currentSource.schemaSha256!==identity.schemaSha256
    ||!text(currentSource.productName,500)||!text(currentSource.categoryPath,10000)||!currentSource.categoryPath.endsWith(' ('+identity.categoryId+')'))fail('HISTORICAL_RECEIPT_SOURCE','원래 요청의 저장 버전·카테고리·포함 옵션이 변경되었습니다.');
  return freeze({format:'yoofam-historical-product-receipt-anchor-v1',target:{...target,docId:checkpoint.docId},identity,identityDigest:checkpoint.identityDigest,packetDigest:checkpoint.packetDigest,
    originalBodySha256:checkpoint.originalBodySha256,preparedBodySha256:checkpoint.bodySha256,checkpointSequence:checkpoint.sequence,checkpointUpdatedAt:checkpoint.updatedAt,
    ownedTarget:owned,currentSource,checkedAt,readId,historicalRequestOnly:true,currentBodyEqualityVerified:false,readOnly:true,remoteWrites:false,checkpointWrites:false,canResume:false});
}
/** Fresh transport provenance is supplied by the dedicated trusted reader.
 * A DOM label or caller-supplied status cannot become an official receipt. */
export function normalizeHistoricalProductReceipt({anchor:rawAnchor,readResult:rawResult,now=Date.now()}){
  const anchor=copy(rawAnchor),result=copy(rawResult),p=result?.provenance,row=result?.row;
  if(anchor.format!=='yoofam-historical-product-receipt-anchor-v1'||anchor.historicalRequestOnly!==true||anchor.currentBodyEqualityVerified!==false||anchor.readOnly!==true||anchor.remoteWrites!==false||anchor.checkpointWrites!==false||anchor.canResume!==false
    ||!exact(result,['format','readOnly','remoteWrites','provenance','row'])||result.format!=='yoofam-historical-product-receipt-read-v1'||result.readOnly!==true||result.remoteWrites!==false
    ||!exact(p,['method','url','status','redirected','contentType','cache','company','docId','qvtRequestId','identityDigest','packetDigest','requestId','tabId','windowId','documentId','observedTab','readId','observedAt'])
    ||p.method!=='GET'||p.url!==HISTORICAL_PRODUCT_RECEIPT_URL||p.status!==200||p.redirected!==false||!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(p.contentType||'')||p.cache!=='no-store'
    ||!same(p.company,anchor.identity.company)||p.docId!==anchor.target.docId||p.qvtRequestId!==anchor.target.qvtRequestId||p.identityDigest!==anchor.identityDigest||p.packetDigest!==anchor.packetDigest||p.requestId!==anchor.target.requestId||p.readId!==anchor.readId
    ||!integer(p.tabId)||p.windowId!==anchor.identity.windowId||!text(p.documentId,200)||!integer(p.observedAt,1)||p.observedAt<anchor.checkedAt||p.observedAt>now+5000||now-p.observedAt>60000
    ||!exact(p.observedTab,['tabId','windowId','documentId','selection','originalTabId','originalTabAbsent'])||p.observedTab.tabId!==p.tabId||p.observedTab.windowId!==p.windowId||p.observedTab.documentId!==p.documentId||p.observedTab.originalTabId!==anchor.ownedTarget.tabId
    ||!(p.observedTab.selection==='original-owned-tab'&&p.tabId===anchor.ownedTarget.tabId&&p.observedTab.originalTabAbsent===false||p.observedTab.selection==='existing-same-window-tab'&&p.tabId!==anchor.ownedTarget.tabId&&p.observedTab.originalTabAbsent===true)
    ||!exact(row,['docId','status','qvtRequestId','productName','categoryPath','modifiedAt','remark'])||row.docId!==anchor.target.docId||row.qvtRequestId!==anchor.target.qvtRequestId||!Object.hasOwn(STATUS,row.status)
    ||row.productName!==anchor.currentSource.productName||row.categoryPath!==anchor.currentSource.categoryPath||row.modifiedAt!==null&&(typeof row.modifiedAt!=='string'||!Number.isFinite(Date.parse(row.modifiedAt)))||typeof row.remark!=='string'||row.remark.length>20000)fail('HISTORICAL_RECEIPT_UNCONFIRMED','원래 문서의 현재 공식 접수 JSON·회사·QVT 연결을 확인하지 못했습니다.');
  const receipt={state:STATUS[row.status],docId:anchor.target.docId,company:anchor.identity.company,identityDigest:anchor.identityDigest,preparedBodySha256:anchor.preparedBodySha256,observedAt:p.observedAt,
    receiptId:row.qvtRequestId,qvtRequestId:row.qvtRequestId,sourceStatus:row.status,evidence:'document-receipt',registered:false};
  return freeze({format:'yoofam-historical-product-receipt-candidate-v1',anchor,receipt,officialRow:row,provenance:p,historicalRequestOnly:true,currentBodyEqualityVerified:false,readOnly:true,remoteWrites:false,checkpointWrites:false,canResume:false});
}
/** Server-side shape/hash/source validation for the dedicated import route.
 * Storage/Chrome provenance is established by the worker, never inferred here.
 * The caller supplies freshly authenticated scope and persisted source data. */
export async function validateHistoricalProductReceiptCandidate(raw,{scope,currentSource,now=Date.now()}){
  const value=copy(raw),anchor=value?.anchor;
  if(!exact(value,['format','anchor','receipt','officialRow','provenance','historicalRequestOnly','currentBodyEqualityVerified','readOnly','remoteWrites','checkpointWrites','canResume'])
    ||value.format!=='yoofam-historical-product-receipt-candidate-v1'||value.historicalRequestOnly!==true||value.currentBodyEqualityVerified!==false||value.readOnly!==true||value.remoteWrites!==false||value.checkpointWrites!==false||value.canResume!==false
    ||!exact(anchor,['format','target','identity','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','checkpointSequence','checkpointUpdatedAt','ownedTarget','currentSource','checkedAt','readId','historicalRequestOnly','currentBodyEqualityVerified','readOnly','remoteWrites','checkpointWrites','canResume']))invalid();
  const target=validateHistoricalProductReceiptTarget(anchor.target),identity=anchor.identity;
  if(!exact(scope,['origin','ownerId','company'])||!HANDOFF_ORIGINS.includes(scope.origin)||!ID.test(scope.ownerId||'')||!company(scope.company)||!same(target.company,scope.company)
    ||!object(identity)||identity.origin!==scope.origin||identity.ownerId!==scope.ownerId||identity.productId!==target.productId||!same(identity.company,scope.company)
    ||!same(anchor.currentSource,currentSource)||!integer(anchor.checkpointSequence,1)||!integer(anchor.checkpointUpdatedAt,1)||anchor.checkpointUpdatedAt>anchor.checkedAt+5000||!integer(anchor.checkedAt,1)||anchor.checkedAt>now+5000||now-anchor.checkedAt>120000
    ||!HASH.test(anchor.identityDigest||'')||anchor.identityDigest!==await digest(identity)||![anchor.packetDigest,anchor.originalBodySha256,anchor.preparedBodySha256].every(hash=>HASH.test(hash||'')))invalid();
  if(!exact(identity,['origin','appTabId','windowId','ownerId','accountContext','company','productId','profileId','requestedProfileId','categoryId','fingerprint','inputFingerprint','schemaSha256','source','members'])
    ||!integer(identity.appTabId)||!integer(identity.windowId)||![identity.accountContext,identity.fingerprint,identity.inputFingerprint,identity.schemaSha256].every(hash=>HASH.test(hash||''))
    ||!(identity.profileId===null||ID.test(identity.profileId||''))||!(identity.requestedProfileId===null||identity.requestedProfileId===identity.profileId)||!/^\d{1,20}$/.test(identity.categoryId||'')||!source(identity.source)||!members(identity.members)
    ||Date.parse(identity.source.productVersion)>anchor.checkpointUpdatedAt+5000)invalid();
  const accountBytes=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',scope.ownerId,scope.company.code,scope.company.name]));
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',accountBytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(account!==identity.accountContext||!exact(currentSource,['ownerId','company','productId','profileId','requestedProfileId','categoryId','inputFingerprint','schemaSha256','source','members','productName','categoryPath'])
    ||['ownerId','company','productId','profileId','requestedProfileId','categoryId','inputFingerprint','schemaSha256','source','members'].some(key=>!same(identity[key],currentSource[key]))
    ||!text(currentSource.productName,500)||!text(currentSource.categoryPath,10000)||!currentSource.categoryPath.endsWith(' ('+identity.categoryId+')'))invalid();
  const owned=anchor.ownedTarget;
  if(!exact(owned,['tabId','windowId','origin','requestId','packetDigest'])||!integer(owned.tabId)||owned.tabId===identity.appTabId||owned.windowId!==identity.windowId||owned.origin!=='https://supplier.coupang.com'
    ||owned.requestId!==target.requestId||owned.packetDigest!==anchor.packetDigest||!ID.test(anchor.readId||''))invalid();
  const logical=Object.fromEntries(Object.entries(identity).filter(([key])=>!['appTabId','windowId'].includes(key)));
  if(anchor.packetDigest!==await digest({identity:logical,bodySha256:anchor.preparedBodySha256,originalBodySha256:anchor.originalBodySha256}))invalid();
  const normalized=normalizeHistoricalProductReceipt({anchor,readResult:{format:'yoofam-historical-product-receipt-read-v1',readOnly:true,remoteWrites:false,row:value.officialRow,provenance:value.provenance},now});
  if(!same(value,normalized))invalid();return normalized;
}
/** The only ports are reads. App receipt persistence is a separate operation;
 * this controller has no create/upload/update/validation/consent/submit port. */
export async function reconcilePreservedProductReceipt({target,signal,isCurrent=()=>true},ports){
  const check=()=>{if(signal?.aborted||!isCurrent())fail('HISTORICAL_RECEIPT_CANCELLED','과거 접수 확인이 취소되었거나 회원 범위가 변경되었습니다.');};
  const read=async fn=>{check();const value=await fn();check();return copy(value);};
  const scope=await read(()=>ports.readScope()),checkpoint=await read(()=>ports.readCheckpoint(target)),currentSource=await read(()=>ports.readCurrentSource(target));
  const anchor=await historicalProductReceiptAnchor({target,checkpoint,scope,currentSource});check();
  const result=await read(()=>ports.readHubReceipt(anchor));
  const afterScope=await read(()=>ports.readScope()),afterCheckpoint=await read(()=>ports.readCheckpoint(target)),afterSource=await read(()=>ports.readCurrentSource(target));
  if(!same(scope,afterScope)||!same(checkpoint,afterCheckpoint)||!same(currentSource,afterSource))fail('HISTORICAL_RECEIPT_CHANGED','접수 조회 중 원래 회원·문서·저장 버전이 변경되었습니다.');
  check();return normalizeHistoricalProductReceipt({anchor,readResult:result});
}
