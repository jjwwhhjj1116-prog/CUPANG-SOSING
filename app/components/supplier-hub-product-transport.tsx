'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import {createProductDocumentPacket,PRODUCT_DOCUMENT_REQUEST_TTL} from '../../extensions/supplier-hub/product-document.mjs';
import {sourceReadError} from '../../extensions/supplier-hub/product-document-source.mjs';
import {previewProductDocument,auditUnexpectedLegal,runProductDocument,runProductDocumentDraft,runPreparedProductDocument,preparedReceiptObservation,readNativeReceiptHistory,saveProductReceiptObservation,
  type UnexpectedLegalAuditReport,
  type ProductDocumentSession,type ProductDocumentState,type ProductDraftAction,type PreparedDocumentAction,type ProductValidationRejection,ProductDocumentBridgeError} from '@/app/supplier-hub-product-client';
import {singleConsentConfirmation,verifySingleDocumentObservation,type SingleDocumentAction} from '@/app/supplier-hub-single-client';
import type {NativeReceiptRecord} from '@/app/supplier-hub-product-receipt';
import {productReceiptCanonical} from '@/app/supplier-hub-product-receipt';
import {reconnectPreservedProductDraft} from '@/app/preserved-product-request-reconnect';
import {SupplierHubRejectionDetails} from '@/app/components/supplier-hub-rejection-details';
import {runReservedSegments} from '@/app/supplier-hub-reserved-work.mjs';
import {SupplierHubNativeRegistration} from '@/app/components/supplier-hub-native-registration';
import {readProductDocumentPending,productDocumentPendingKey,productDocumentPendingCurrent,assertProductDocumentPending,claimProductDocumentPending,
  readProductDocumentRejections,productDocumentRejectionKey,assertProductDocumentNotRejected,
  pendingProductRejection,clearRejectedProductDocumentPending,clearValidationRejectedProductDocumentPending,type ProductDocumentPending} from '@/app/supplier-hub-product-pending';

type Props={review:SupplierHubProductDocumentReview;disabled:boolean;refresh:(signal:AbortSignal)=>Promise<SupplierHubProductDocumentReview>;
  onLockChange:(locked:boolean,closeLocked?:boolean)=>void;onReceiptSaved?:()=>void};
const stageLabels={productPage:'상품 정보',imagePage:'이미지',logisticsPage:'최종 제출'};
const auditPathLabels:Record<string,string>={'document-header':'문서 기본정보','member-shape':'옵션 구성',startPage:'시작 정보',productPage:'상품 정보',imagePage:'이미지 연결',logisticsPage:'물류 정보',sourcingPage:'소싱 정보',legalPage:'법적 서류 정보','legalPage.other':'기타 서류 정보','legalPage.certificates':'인증 항목','legalPage.certificates.name':'인증 항목명','legalPage.certificates.value':'인증 값','legalPage.certificates.row-shape':'인증 항목 구성','legalPage.certificates.order':'인증 항목 순서'};
const auditValueLabels={missing:'항목 없음',empty:'빈 값',na:'해당사항없음',present:'값 있음','not-applicable':'—'};
// Sample the envelope clock only from an explicit event operation.
const draftOperationTime=()=>Date.now();
function completedPreviewSourceReadFailure(cause:unknown):cause is ProductDocumentBridgeError{
  if(!(cause instanceof ProductDocumentBridgeError)||cause.uncertain||!['SOURCE_READ_TIMEOUT','SOURCE_READ_NETWORK','SOURCE_READ_RESPONSE','SOURCE_READ_HTTP'].includes(cause.code))return false;
  const status=cause.code==='SOURCE_READ_HTTP'?Number(cause.message.match(/HTTP ([3-5]\d{2})\)/)?.[1]):undefined;
  if(cause.code==='SOURCE_READ_HTTP'&&!status)return false;
  return [undefined,'catalog-context','native-assets','single-package','receipt-history','product-receipt','legal-documents'].some(resource=>
    cause.message===sourceReadError({code:cause.code,...(resource?{resource}:{}),...(status===undefined?{}:{status})}).message);
}
/** The explicit whole-product handoff owns its request until a positive result
 * is read. Missing ACKs retain that request; they never create another one. */
export function SupplierHubProductTransport(props:Props){
  const {review,disabled,onLockChange}=props;
  const [session,setSession]=useState<ProductDocumentSession|null>(null),[state,setState]=useState<ProductDocumentState|null>(null);
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const [approved,setApproved]=useState<Record<string,boolean>>({}),[expired,setExpired]=useState(false);
  const [history,setHistory]=useState<NativeReceiptRecord[]>([]),[historyError,setHistoryError]=useState('');
  const [unsaved,setUnsaved]=useState<{packet:ProductDocumentSession['packet'];observation:ProductDocumentState}|null>(null);
  const [intent,setIntent]=useState<ProductDocumentPending|null>(null),[intentReady,setIntentReady]=useState(false),[intentError,setIntentError]=useState('');
  const [draftMode,setDraftMode]=useState(false);
  const [missingCreate,setMissingCreate]=useState(false),[retryApproved,setRetryApproved]=useState(false),[retryAttempted,setRetryAttempted]=useState(false),[approvedRetryPending,setApprovedRetryPending]=useState(false);
  const [closedTargetNeeded,setClosedTargetNeeded]=useState(false),[closedTargetApproved,setClosedTargetApproved]=useState(false);
  const [existingRepairNeeded,setExistingRepairNeeded]=useState(false),[existingRepairApproved,setExistingRepairApproved]=useState(false),[existingRepairAttempted,setExistingRepairAttempted]=useState(false);
  const [existingRepairRetryAttempted,setExistingRepairRetryAttempted]=useState(false);
  const [repairContinuationAttempted,setRepairContinuationAttempted]=useState(false);
  const [repairContinuationResumed,setRepairContinuationResumed]=useState(false);
  const [savedFileGroups,setSavedFileGroups]=useState(0);
  const knownDraftDocument=useRef<{requestId:string;docId:string|number}|null>(null);
  const reviewToken=useMemo(()=>({review}),[review]),reviewEpoch=useRef<typeof reviewToken|null>(reviewToken);
  const [reconnectInput,setReconnectInput]=useState<{token:object;requestId:string;docId:string}|null>(null);
  const reconnectRequest=reconnectInput?.token===reviewToken?reconnectInput.requestId:'';
  const reconnectDocument=reconnectInput?.token===reviewToken?reconnectInput.docId:'';
  const reconnectInputRef=useRef(reconnectInput);
  useLayoutEffect(()=>{reconnectInputRef.current=reconnectInput;},[reconnectInput]);
  const [reconnectReadTarget,setReconnectReadTarget]=useState<{token:object;input:NonNullable<typeof reconnectInput>}|null>(null);
  const reconnectReadTargetCurrent=Boolean(reconnectReadTarget?.token===reviewToken&&reconnectReadTarget.input===reconnectInput&&reconnectInput?.token===reviewToken);
  const [originalAuditContext,setOriginalAuditContext]=useState<{token:object;input:NonNullable<typeof reconnectInput>}|null>(null);
  const originalAuditCurrent=Boolean(originalAuditContext?.token===reviewToken&&originalAuditContext.input===reconnectInput&&reconnectInput?.token===reviewToken);
  const [originalAuditReport,setOriginalAuditReport]=useState<{context:NonNullable<typeof originalAuditContext>;report:UnexpectedLegalAuditReport}|null>(null);
  const shownOriginalAudit=originalAuditCurrent&&originalAuditReport?.context===originalAuditContext?originalAuditReport.report:null;
  const [releasedValidation,setReleasedValidation]=useState<{token:object;docId:string|number;rejection:ProductValidationRejection}|null>(null);
  const [draftReadHint,setDraftReadHint]=useState<{token:object;requestId:string;docId:string|number;state:string;identityDigest:string;packetDigest:string;originalBodySha256:string;preparedBodySha256:string;savedDraftTargetClosed?:boolean;continuationSnapshot?:boolean;resumeSnapshot?:boolean;nativeFileListObserved?:boolean}|null>(null);
  const [finishedReadError,setFinishedReadError]=useState<{token:object;session:ProductDocumentSession;intent:ProductDocumentPending;docId:string|number;message:string;reviewDigest:string;identityDigest:string;packetDigest:string;originalBodySha256:string;preparedBodySha256:string}|null>(null);
  const [finishedPreviewReadError,setFinishedPreviewReadError]=useState<{token:object;intent:ProductDocumentPending;packet:ProductDocumentSession['packet'];message:string}|null>(null);
  useLayoutEffect(()=>{reviewEpoch.current=reviewToken;return()=>{if(reviewEpoch.current===reviewToken)reviewEpoch.current=null;};},[reviewToken]);
  const current=useRef({props,mounted:true,session,state,uncertain,expired,approved,unsaved,intent,intentReady,intentError,draftMode,error,closedTargetNeeded,closedTargetApproved,existingRepairNeeded,existingRepairApproved,existingRepairAttempted,existingRepairRetryAttempted,repairContinuationAttempted,repairContinuationResumed,draftReadHint}),pending=useRef<AbortController|null>(null),historyPending=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{current.current={props,mounted:true,session,state,uncertain,expired,approved,unsaved,intent,intentReady,intentError,draftMode,error,closedTargetNeeded,closedTargetApproved,existingRepairNeeded,existingRepairApproved,existingRepairAttempted,existingRepairRetryAttempted,repairContinuationAttempted,repairContinuationResumed,draftReadHint};});
  // A terminal label alone cannot release the enclosing source/close guard.
  // Keep the accepted reservation for duplicate prevention, but allow closing
  // only after this exact observation is positively stored by the app API.
  const storedTerminal=Boolean(session&&state?.receipt&&!uncertain&&!unsaved&&['accepted','rejected'].includes(state.state)&&history.some(row=>
    'recordType' in row&&row.recordType==='product-document'&&row.requestId===session.packet.requestId&&row.docId===state.docId
    &&row.identityDigest===session.preview.identityDigest&&row.packetDigest===session.packetDigest
    &&row.originalBodySha256===review.originalBodySha256&&row.preparedBodySha256===review.preparedBodySha256
    &&row.receipt.state===state.state&&row.receipt.sourceStatus===state.receipt!.sourceStatus
    &&row.receipt.qvtRequestId===state.receipt!.qvtRequestId&&row.receipt.observedAt>=state.receipt!.observedAt));
  const sourceLocked=!intentReady||busy||uncertain||Boolean(unsaved)||Boolean(intent)||Boolean(intentError)||Boolean(session&&!(storedTerminal&&state?.state==='rejected'));
  const validatedDraft=Boolean(session&&intent&&draftMode&&state?.draftOnly===true&&state.state==='validated'&&state.draftProof?.validatedSteps.length===4
    &&session.packet.review.reviewDigest===review.reviewDigest&&session.packet.review.originalBodySha256===review.originalBodySha256&&session.packet.review.preparedBodySha256===review.preparedBodySha256
    &&!error&&!state.error&&!state.needsRecovery&&!uncertain&&!unsaved);
  // A verified read error may release this view, never the saved request or
  // source editor. Recheck durable ownership even if storage changed in this tab.
  let finishedReadDismissible=false;
  if(finishedReadError&&finishedReadError.token===reviewToken&&finishedReadError.session===session&&finishedReadError.intent===intent
    &&draftMode&&intentReady&&!disabled&&!busy&&!unsaved&&!intentError&&error===finishedReadError.message
    &&session?.packet.requestId===intent?.requestId
    &&(state?.docId===null||state?.docId===undefined||state.docId===finishedReadError.docId)
    &&finishedReadError.reviewDigest===review.reviewDigest&&finishedReadError.identityDigest===session?.preview.identityDigest&&finishedReadError.packetDigest===session?.packetDigest
    &&finishedReadError.originalBodySha256===review.originalBodySha256&&finishedReadError.preparedBodySha256===review.preparedBodySha256
    &&productReceiptCanonical(session.packet.review.identity)===productReceiptCanonical(review.identity)&&productReceiptCanonical(session.packet.review.members)===productReceiptCanonical(review.members)){
    try{assertProductDocumentPending(review,finishedReadError.intent,finishedReadError.session);finishedReadDismissible=true;}catch{/* Keep the close guard when durable ownership cannot be read exactly. */}
  }
  let finishedPreviewReadDismissible=false;
  if(finishedPreviewReadError&&finishedPreviewReadError.token===reviewToken&&finishedPreviewReadError.intent===intent&&!session&&!state
    &&intentReady&&!disabled&&!busy&&!unsaved&&!intentError&&error===finishedPreviewReadError.message&&finishedPreviewReadError.packet.requestId===intent?.requestId
    &&finishedPreviewReadError.packet.review.reviewDigest===review.reviewDigest&&finishedPreviewReadError.packet.review.originalBodySha256===review.originalBodySha256
    &&finishedPreviewReadError.packet.review.preparedBodySha256===review.preparedBodySha256
    &&productReceiptCanonical(finishedPreviewReadError.packet.review.identity)===productReceiptCanonical(review.identity)&&productReceiptCanonical(finishedPreviewReadError.packet.review.members)===productReceiptCanonical(review.members)){
    try{assertProductDocumentPending(review,finishedPreviewReadError.intent);finishedPreviewReadDismissible=true;}catch{/* Preserve the original request when storage cannot be verified. */}
  }
  const closeLocked=!intentReady||busy||Boolean(unsaved)||Boolean(intentError)||!(finishedReadDismissible||finishedPreviewReadDismissible)&&(uncertain||Boolean((session||intent)&&!storedTerminal&&!validatedDraft));
  useLayoutEffect(()=>{onLockChange(sourceLocked,closeLocked);},[sourceLocked,closeLocked,onLockChange]);
  useLayoutEffect(()=>()=>{current.current.mounted=false;pending.current?.abort();historyPending.current?.abort();current.current.props.onLockChange(false,false);},[]);
  useEffect(()=>{
    const load=(changed=false)=>{if(!current.current.mounted||current.current.props.review!==review)return;
      setFinishedReadError(null);
      setFinishedPreviewReadError(null);
      try{const value=readProductDocumentPending(review);readProductDocumentRejections(review);
        if(changed&&(current.current.session||pending.current)&&JSON.stringify(value)!==JSON.stringify(current.current.intent))throw Error('다른 탭에서 이 상품의 전송 기록이 변경되었습니다. 원래 문서의 결과를 다시 확인해주세요.');
        current.current.intent=value;setIntent(value);
        if(value&&!productDocumentPendingCurrent(value,review))throw Error('이 상품에 이전 저장값의 미확정 전송이 있습니다. 원래 상품·견적서를 복원하여 같은 문서의 결과를 확인해주세요.');
        current.current.intentError='';setIntentError('');
      }catch(cause){pending.current?.abort();pending.current=null;setBusy(false);current.current.intentError=cause instanceof Error?cause.message:'이전 전송 기록 확인 실패';setIntentError(current.current.intentError);}
      current.current.intentReady=true;setIntentReady(true);
    };
    load();const storage=(event:StorageEvent)=>{if(event.key===null||event.key===productDocumentPendingKey(review)||event.key===productDocumentRejectionKey(review))load(true);};
    window.addEventListener('storage',storage);return()=>window.removeEventListener('storage',storage);
  },[review]);
  useEffect(()=>{
    const controller=new AbortController();historyPending.current=controller;
    void readNativeReceiptHistory({productId:review.identity.productId},controller.signal,fetch).then(async rows=>{
      if(current.current.mounted&&!controller.signal.aborted&&current.current.props.review===review){setHistory(rows);setHistoryError('');
        const saved=readProductDocumentPending(review),rejected=saved&&rows.find(row=>pendingProductRejection(saved,row));
        if(saved&&rejected){const removed=await clearRejectedProductDocumentPending(review,saved,rejected,controller.signal,
          ()=>current.current.mounted&&current.current.props.review===review&&!pending.current&&!current.current.session&&!current.current.unsaved);
          if(removed&&current.current.mounted&&!controller.signal.aborted&&current.current.props.review===review){current.current.intent=null;current.current.intentError='';setIntent(null);setIntentError('');}}
      }
    }).catch(cause=>{if(current.current.mounted&&!controller.signal.aborted)setHistoryError(cause instanceof Error?cause.message:'접수 이력 조회 실패');});
    return()=>{controller.abort();if(historyPending.current===controller)historyPending.current=null;};
  },[review]);
  useEffect(()=>{
    const challenge=state?.challenge;if(!challenge)return;
    const timer=setTimeout(()=>{
      if(!current.current.mounted||current.current.state?.challenge?.id!==challenge.id)return;
      const inFlight=Boolean(pending.current);pending.current?.abort();pending.current=null;
      current.current.expired=true;current.current.approved={};current.current.uncertain=current.current.uncertain||inFlight;
      setExpired(true);setApproved({});setUncertain(value=>value||inFlight);setBusy(false);
      setError('동의 확인 시간이 만료됐습니다. 같은 문서의 현재 동의 내용을 다시 확인해주세요.');
    },Math.max(0,challenge.expiresAt-Date.now()));return()=>clearTimeout(timer);
  },[state?.challenge]);
  const canEnter=()=>reviewEpoch.current===reviewToken&&current.current.mounted&&!current.current.props.disabled&&!pending.current&&current.current.props.review===review&&current.current.intentReady&&!current.current.intentError;
  function begin(){const controller=new AbortController();pending.current=controller;setFinishedReadError(null);setFinishedPreviewReadError(null);setOriginalAuditReport(null);setBusy(true);setError('');current.current.props.onLockChange(true,true);
    return {controller,alive:()=>reviewEpoch.current===reviewToken&&current.current.mounted&&current.current.props.review===review&&!controller.signal.aborted&&pending.current===controller,
      active:()=>reviewEpoch.current===reviewToken&&current.current.mounted&&current.current.props.review===review&&!current.current.props.disabled&&!controller.signal.aborted&&pending.current===controller,
      finish:()=>{if(pending.current===controller){pending.current=null;if(current.current.mounted)setBusy(false);}}};}
  async function fresh(task:ReturnType<typeof begin>){
    const result=await current.current.props.refresh(task.controller.signal);
    if(!task.active()||result.reviewDigest!==review.reviewDigest||result.originalBodySha256!==review.originalBodySha256
      ||result.preparedBodySha256!==review.preparedBodySha256)throw Error('저장한 상품·옵션·회사 또는 견적서가 바뀌었습니다. 전체 문서를 다시 확인해주세요.');
  }
  async function connect(){
    if(!canEnter()||current.current.session||current.current.unsaved)return;const task=begin();
    let previewIntent:ProductDocumentPending|null=null,previewPacket:ProductDocumentSession['packet']|null=null,terminalPreviewError:unknown;
    try{await fresh(task);if(!task.active())return;const saved=readProductDocumentPending(review);
      if(saved)assertProductDocumentPending(review,saved);
      else assertProductDocumentNotRejected(review);
      if(saved&&current.current.intent&&productReceiptCanonical(saved)===productReceiptCanonical(current.current.intent))previewIntent=current.current.intent;
      // Only the TTL envelope is refreshed. The original operation UUID,
      // reviewed body and browser identity must remain exact for read recovery.
      const eventTime=draftOperationTime(),packet=await createProductDocumentPacket(review,saved?{requestId:saved.requestId,createdAt:eventTime,now:eventTime}:{});previewPacket=packet;
      let result:ProductDocumentSession;
      try{result=await previewProductDocument(packet,task.controller.signal);}catch(cause){terminalPreviewError=cause;throw cause;}
      await fresh(task);if(!task.active())return;if(saved)assertProductDocumentPending(review,saved,result);
      else {assertProductDocumentNotRejected(review);if(readProductDocumentPending(review)!==null)throw Error('다른 탭에서 이 상품의 전송을 시작했습니다. 원래 문서의 결과를 확인해주세요.');}
      current.current.intent=saved;setIntent(saved);current.current.session=result;current.current.uncertain=Boolean(saved);setSession(result);setUncertain(Boolean(saved));
      const draft=Boolean(saved&&!result.preview.liveVerified&&result.preview.draftPreparationAvailable===true);current.current.draftMode=draft;setDraftMode(draft);
    }catch(cause){if(task.active()){
      if(terminalPreviewError===cause&&completedPreviewSourceReadFailure(cause)&&previewIntent&&previewPacket&&current.current.intent===previewIntent
        &&!current.current.session&&!current.current.state&&!current.current.unsaved&&!current.current.intentError){
        try{assertProductDocumentPending(review,previewIntent);setFinishedPreviewReadError({token:reviewToken,intent:previewIntent,packet:previewPacket,message:cause.message});}
        catch{/* Read failure never releases an unverified durable request. */}
      }
      setError(cause instanceof Error?cause.message:'전체 견적 전송 자료 확인 실패');
    }}finally{task.finish();}
  }
  async function reconnectOriginal(recoverSavedTarget=false){
    if(!canEnter()||current.current.session||current.current.intent||current.current.state||current.current.unsaved)return;
    if(reconnectInputRef.current!==reconnectInput||recoverSavedTarget&&!reconnectReadTargetCurrent)return;
    const requestId=reconnectRequest.trim(),docId=reconnectDocument.trim();
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)||!/^[1-9]\d{0,29}$/.test(docId))return;
    const task=begin();
    const active=()=>task.active()&&reconnectInputRef.current===reconnectInput&&!current.current.session&&!current.current.intent&&!current.current.state&&!current.current.unsaved&&!current.current.intentError;
    try{
      const recovered=await reconnectPreservedProductDraft({review,target:{requestId,docId,productId:review.identity.productId,company:review.identity.company},
        signal:task.controller.signal,isCurrent:active,refresh:signal=>current.current.props.refresh(signal),...(recoverSavedTarget?{recoverSavedTarget:true}:{})});
      if(!active())return;
      // The helper has read the actual private checkpoint and the current full
      // source. It reserves this exact original request only after readback;
      // an inspector metadata report alone can never establish this session.
      assertProductDocumentPending(review,recovered.pending,recovered.session);
      current.current.intent=recovered.pending;current.current.session=recovered.session;current.current.state=recovered.observation;
      current.current.draftMode=true;current.current.uncertain=false;current.current.approved={};current.current.expired=false;current.current.error='';
      knownDraftDocument.current={requestId,docId:recovered.observation.docId!};
      setReconnectReadTarget(null);setIntent(recovered.pending);setSession(recovered.session);setState(recovered.observation);setDraftMode(true);setUncertain(false);setApproved({});setExpired(false);setError('');
      setOriginalAuditContext(null);
    }catch(cause){if(task.alive()){
      if(active()&&reconnectInput&&cause instanceof ProductDocumentBridgeError&&cause.uncertain===false
        &&cause.code==='PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE'&&['update-requested','updated'].includes(cause.draftState??'')&&String(cause.knownDocId)===docId)
        setOriginalAuditContext({token:reviewToken,input:reconnectInput});
      if(active()&&reconnectInput&&cause instanceof ProductDocumentBridgeError&&cause.uncertain===false&&cause.savedDraftTargetClosed===true
        &&cause.code==='PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE'&&['update-requested','updated'].includes(cause.draftState??'')&&String(cause.knownDocId)===docId)
        setReconnectReadTarget({token:reviewToken,input:reconnectInput});
      // A post-claim read can fail after the original reservation was written.
      // Same-window storage writes emit no event: synchronise its lock here
      // without adopting an unreturned session or authorising another request.
      try{
        const saved=readProductDocumentPending(review);
        if(saved){current.current.intent=saved;setIntent(saved);
          if(saved.requestId!==requestId||!productDocumentPendingCurrent(saved,review)){
            current.current.intentError='보관된 전송 요청이 현재 복구 범위와 다릅니다. 원래 상품·견적서에서 저장 결과를 확인해주세요.';setIntentError(current.current.intentError);
          }
        }
      }catch{current.current.intentError='원래 요청의 보관 상태를 확인하지 못했습니다. 새 전송을 시작하지 말고 저장 결과를 확인해주세요.';setIntentError(current.current.intentError);}
      setError(cause instanceof Error?cause.message:'원래 문서의 연결을 복구하지 못했습니다. 새 문서와 파일·본문은 전송하지 않았습니다.');
    }}
    finally{task.finish();}
  }
  async function auditOriginalSavedDocument(){
    if(!canEnter()||!originalAuditCurrent||!originalAuditContext||reconnectInputRef.current!==originalAuditContext.input||current.current.session||current.current.intent||current.current.state||current.current.unsaved)return;
    const context=originalAuditContext,input=context.input,requestId=input.requestId.trim(),docId=input.docId.trim();
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)||!/^[1-9]\d{0,29}$/.test(docId))return;
    const task=begin();
    const active=()=>task.active()&&reconnectInputRef.current===input&&!current.current.session&&!current.current.intent&&!current.current.state&&!current.current.unsaved&&!current.current.intentError;
    const freshAudit=async()=>{await fresh(task);if(!active())throw Error('원래 문서 읽기 범위가 변경되었습니다.');
      if(readProductDocumentPending(review)!==null)throw Error('이 상품의 전송 요청이 이미 보관되어 있습니다. 원래 요청의 조회를 이용해주세요.');
      assertProductDocumentNotRejected(review);};
    try{
      await freshAudit();const now=draftOperationTime(),packet=await createProductDocumentPacket(review,{requestId,createdAt:now,now});
      await freshAudit();const preview=await previewProductDocument(packet,task.controller.signal);
      await freshAudit();
      if(preview.packet.requestId!==requestId||productReceiptCanonical(preview.packet.review)!==productReceiptCanonical(review))throw Error('원래 견적의 읽기 연결이 다릅니다.');
      const report=await auditUnexpectedLegal(preview,task.controller.signal);await freshAudit();
      if(report.requestId!==requestId||String(report.docId)!==docId||report.identityDigest!==preview.preview.identityDigest||report.packetDigest!==preview.packetDigest)
        throw Error('현재 문서의 읽기 결과가 원래 요청과 다릅니다.');
      // A complete audit is still an observation. It cannot adopt a session,
      // claim the web reservation, delete files or enable registration.
      setOriginalAuditReport({context,report});
    }catch(cause){if(active())setError(cause instanceof Error?cause.message:'원래 문서의 저장 내용 대조에 실패했습니다.');}
    finally{task.finish();}
  }
  async function persist(attempt:NonNullable<typeof unsaved>,task:ReturnType<typeof begin>){
    const shown=current.current.state;
    try{const result=await saveProductReceiptObservation(attempt,task.controller.signal,fetch);if(!task.active()||current.current.unsaved!==attempt||current.current.state!==shown)return;
      if(!shown?.receipt||(['requestId','docId','identityDigest','packetDigest','originalBodySha256','preparedBodySha256'] as const).some(key=>shown[key]!==attempt.observation[key])
        ||productReceiptCanonical(shown.identity)!==productReceiptCanonical(attempt.observation.identity)||shown.receipt.qvtRequestId!==attempt.observation.receipt?.qvtRequestId
        ||result.receipt.observedAt<shown.receipt.observedAt||shown.receipt.state==='accepted'&&result.receipt.state==='pending'||shown.receipt.state==='rejected'&&result.receipt.state!=='rejected')throw Error('원래 문서의 현재 접수 기록과 저장 결과가 다릅니다. 확인한 결과는 유지했습니다.');
      historyPending.current?.abort();historyPending.current=null;setHistory(rows=>[result,...rows.filter(row=>row.requestId!==result.requestId)]);setHistoryError('');
      // The API may return a newer receipt for this exact request/document/qvt.
      // Keep its validated state and the displayed receipt together before a
      // rejection releases the reservation; the original packet/proofs remain.
      const storedObservation={...shown,state:result.receipt.state,receipt:result.receipt};
      current.current.state=storedObservation;setState(storedObservation);
      const saved=current.current.intent;if(saved&&result.receipt.sourceStatus==='REJECTED'){
        await clearRejectedProductDocumentPending(review,saved,result,task.controller.signal);if(!task.active())return;current.current.intent=null;setIntent(null);
      }
      current.current.unsaved=null;setUnsaved(null);try{current.current.props.onReceiptSaved?.();}catch{/* Stored receipt remains confirmed. */}
    }catch(cause){if(task.active())setError(cause instanceof Error?cause.message:'확인한 접수 결과를 보관하지 못했습니다. 결과는 화면에 유지했습니다.');}
  }
  async function retrySave(){if(!canEnter()||!current.current.unsaved)return;const task=begin();try{await persist(current.current.unsaved,task);}finally{task.finish();}}
  async function releaseValidationRejection(expected:ProductDocumentSession){
    if(!canEnter())return;const before=current.current,saved=before.intent,original=before.state;
    const draft=before.draftMode&&original?.draftOnly===true&&expected.preview.draftPreparationAvailable===true;
    if(before.session!==expected||!saved||original?.state!=='validation-rejected'||before.uncertain||before.unsaved||!draft&&!expected.preview.liveVerified)return;
    const task=begin();
    const active=()=>task.active()&&current.current.session===expected&&current.current.state===original&&current.current.intent===saved&&!current.current.uncertain&&!current.current.unsaved;
    try{
      await fresh(task);if(!active())return;assertProductDocumentPending(review,saved,expected);
      const result=draft?await runProductDocumentDraft(expected,'recoverDraft',task.controller.signal):await runProductDocument(expected,'recover',task.controller.signal);await fresh(task);if(!active())return;
      verifySingleDocumentObservation(original,result);
      if(result.state!=='validation-rejected'||result.docId!==original.docId||JSON.stringify(result.validationRejection)!==JSON.stringify(original.validationRejection))throw Error('원래 문서의 제출 전 검증 반려를 확인하지 못했습니다. 같은 문서의 저장 결과를 다시 확인해주세요.');
      const removed=await clearValidationRejectedProductDocumentPending(review,saved,expected,result,task.controller.signal,async()=>{
        await fresh(task);return active();
      });
      if(!removed||!active())return;
      setReleasedValidation({token:reviewToken,docId:original.docId!,rejection:original.validationRejection!});
      current.current.intent=null;current.current.session=null;current.current.state=null;current.current.approved={};current.current.expired=false;current.current.intentError='';current.current.draftMode=false;setDraftMode(false);
      setIntent(null);setSession(null);setState(null);setApproved({});setExpired(false);setIntentError('');
      setError('제출 전 단계 검증 반려를 확인했습니다. 상품·견적서를 수정한 뒤 전체 전송 자료를 다시 확인해주세요.');
    }catch(cause){if(task.alive())setError(cause instanceof Error?cause.message:'검증 반려 기록을 확인하지 못했습니다. 원래 전송 요청을 보관했습니다.');}finally{task.finish();}
  }
  async function operate(action:SingleDocumentAction,expected:ProductDocumentSession,challengeId?:string){
    if(!canEnter())return;const before=current.current;
    if(before.session!==expected||before.draftMode||before.state?.draftOnly||!expected.preview.liveVerified||before.unsaved||before.state?.state==='validation-rejected'&&!before.uncertain||before.uncertain&&action!=='recover'
      ||action==='start'&&(before.state||before.uncertain)||action==='confirm'&&(before.expired||before.state?.challenge?.id!==challengeId)
      ||action==='recover'&&!before.uncertain&&!before.expired)return;
    let confirmation;
    if(action==='confirm'){try{confirmation=singleConsentConfirmation(before.state!.challenge!,Object.entries(before.approved).filter(([,yes])=>yes).map(([key])=>key));}
      catch(cause){setError(cause instanceof Error?cause.message:'필수 약관을 확인해주세요.');return;}}
    const task=begin();let dispatched=false;
    try{await fresh(task);if(!task.active()||current.current.session!==expected)return;
      if(action==='start'){
        const saved=await claimProductDocumentPending(review,expected,task.controller.signal,async()=>{await fresh(task);if(!task.active()||current.current.session!==expected)throw Error('현재 전체 상품 전송 자료가 변경되었습니다.');});
        if(task.alive()){current.current.intent=saved;current.current.uncertain=true;setIntent(saved);setUncertain(true);}if(!task.active())return;
        // Waiting for another tab's short storage lock cannot authorize the
        // account/source that was current before that wait.
        await fresh(task);if(!task.active()||current.current.session!==expected)return;
      }
      const saved=current.current.intent;if(!saved)throw Error('원래 전송 요청의 보관 기록을 확인해주세요.');assertProductDocumentPending(review,saved,expected);
      dispatched=true;const result=await runProductDocument(expected,action,task.controller.signal,confirmation);
      await fresh(task);if(!task.active()||current.current.session!==expected)return;
      if(before.state?.state==='rejected'&&result.state!=='rejected')throw new ProductDocumentBridgeError('이미 반려된 문서의 상태를 다른 접수 결과로 바꿀 수 없습니다. 이전 결과를 유지했습니다.',false,'PRODUCT_RECEIPT_CHANGED');
      verifySingleDocumentObservation(before.state,result);
      current.current.state=result;current.current.uncertain=result.needsRecovery;current.current.approved={};current.current.expired=false;
      setState(result);setUncertain(result.needsRecovery);setApproved({});setExpired(false);if(result.error)setError(result.error.message);
      if(result.receipt?.evidence==='document-receipt'&&result.receipt.sourceStatus&&!result.needsRecovery){
        const attempt={packet:expected.packet,observation:result};current.current.unsaved=attempt;setUnsaved(attempt);await persist(attempt,task);
      }
    }catch(cause){if(task.alive()){
      if(dispatched&&(cause instanceof ProductDocumentBridgeError?cause.uncertain:true)){current.current.uncertain=true;current.current.approved={};setUncertain(true);setApproved({});}
      setError(cause instanceof Error?cause.message:'전체 상품 견적 응답 확인 실패');
    }}finally{task.finish();}
  }
  async function operateDraft(action:ProductDraftAction,expected:ProductDocumentSession){
    if(!canEnter())return;const before=current.current;
    const readHint=before.draftReadHint,fileListCurrent=draftHintCurrent(readHint,expected)&&readHint?.nativeFileListObserved===true;
    const savedTargetCurrent=draftHintCurrent(readHint,expected)&&readHint?.savedDraftTargetClosed===true
      &&knownDraftDocument.current?.requestId===expected.packet.requestId&&knownDraftDocument.current.docId===readHint.docId;
    const continuing=action==='prepareDraft'&&before.draftMode&&before.intent&&before.state?.draftOnly===true&&!before.uncertain
      &&['prepared','target-created','created','updated'].includes(before.state.state);
    if(before.session!==expected||expected.preview.draftPreparationAvailable!==true||before.unsaved
      ||action==='prepareDraft'&&(!continuing&&(before.state||before.intent||before.uncertain))
      ||action==='retryCreateDraft'&&(!before.draftMode||!before.intent||!before.uncertain||!missingCreate||!retryApproved||retryAttempted||approvedRetryPending)
      ||action==='resumeCreateRetryDraft'&&(!before.draftMode||!before.intent||!before.uncertain||!missingCreate||!approvedRetryPending||retryAttempted||expected.preview.createRetryContinuationAvailable!==true)
      ||action==='recoverClosedTarget'&&(!before.draftMode||!before.intent||!before.uncertain||!before.closedTargetNeeded||!before.closedTargetApproved)
      ||action==='recoverSavedDraftTarget'&&(!before.draftMode||!before.intent||!before.uncertain||before.state?.preparedLifecycle||!savedTargetCurrent||expected.preview.savedDraftTargetRecoveryAvailable!==true)
      ||action==='repairExistingDraft'&&(!before.draftMode||!before.intent||!before.uncertain||!before.existingRepairNeeded||!before.existingRepairApproved||before.existingRepairAttempted||expected.preview.existingDocumentRepairAvailable!==true)
      ||action==='retryExistingDraftRepair'&&(!before.draftMode||!before.intent||!before.uncertain||!before.existingRepairNeeded||!before.existingRepairApproved||!before.existingRepairAttempted||before.existingRepairRetryAttempted||expected.preview.existingDocumentRepairRetryAvailable!==true)
      ||action==='continueApprovedRepair'&&(!before.draftMode||!before.intent||!before.uncertain||!before.existingRepairRetryAttempted||before.repairContinuationAttempted||!fileListCurrent||expected.preview.existingDocumentRepairContinuationAvailable!==true)
      ||action==='resumeReservedRepair'&&(!before.draftMode||!before.intent||!before.uncertain||!before.existingRepairRetryAttempted||!before.repairContinuationAttempted||!fileListCurrent||(before.repairContinuationResumed&&expected.preview.existingDocumentRepairSegmentedAvailable!==true)||readHint?.continuationSnapshot!==true||typeof readHint?.resumeSnapshot!=='boolean'||readHint.resumeSnapshot&&expected.preview.existingDocumentRepairSegmentedAvailable!==true||expected.preview.existingDocumentRepairReservedResumeAvailable!==true)
      ||action==='recoverDraft'&&(!before.draftMode||!before.intent||!before.uncertain&&before.state?.draftOnly!==true))return;
    if(action==='recoverDraft'||action==='recoverSavedDraftTarget'){const previous=current.current.draftReadHint,next=previous?{...previous,savedDraftTargetClosed:undefined,continuationSnapshot:undefined,resumeSnapshot:undefined,nativeFileListObserved:undefined}:previous;current.current.draftReadHint=next;setDraftReadHint(next);}
    const task=begin();let dispatched=false,activeSession=expected,terminalReadError:unknown;
    try{
      await fresh(task);if(!task.active()||current.current.session!==expected)return;
      if((action==='prepareDraft'||action==='recoverSavedDraftTarget'||action==='retryCreateDraft'||action==='resumeCreateRetryDraft'||action==='recoverClosedTarget'||action==='repairExistingDraft'||action==='retryExistingDraftRepair'||action==='continueApprovedRepair'||action==='resumeReservedRepair')&&draftOperationTime()-expected.packet.createdAt>=PRODUCT_DOCUMENT_REQUEST_TTL){
        const now=draftOperationTime(),packet=await createProductDocumentPacket(review,{requestId:expected.packet.requestId,createdAt:now,now});
        const refreshed=await previewProductDocument(packet,task.controller.signal);await fresh(task);
        if(!task.active()||current.current.session!==expected)return;
        if(refreshed.preview.draftPreparationAvailable!==true||refreshed.preview.identityDigest!==expected.preview.identityDigest||refreshed.packetDigest!==expected.packetDigest)throw Error('원래 새 초안의 회사·문서 연결을 다시 확인해주세요.');
        if(current.current.intent)assertProductDocumentPending(review,current.current.intent,refreshed);
        activeSession=refreshed;current.current.session=refreshed;setSession(refreshed);
      }
      if(action==='prepareDraft'&&!current.current.intent){
        const saved=await claimProductDocumentPending(review,activeSession,task.controller.signal,async()=>{await fresh(task);if(!task.active()||current.current.session!==activeSession)throw Error('새 초안을 준비할 회원 회사·상품 자료가 변경되었습니다.');});
        if(task.alive()){current.current.intent=saved;current.current.uncertain=true;current.current.draftMode=true;setIntent(saved);setUncertain(true);setDraftMode(true);}if(!task.active())return;
        await fresh(task);if(!task.active()||current.current.session!==activeSession)return;
      }
      const saved=current.current.intent;if(!saved)throw Error('원래 새 초안 준비 요청의 보관 기록을 확인해주세요.');assertProductDocumentPending(review,saved,activeSession);
      if(action==='prepareDraft'||action==='recoverSavedDraftTarget'||action==='retryCreateDraft'||action==='resumeCreateRetryDraft'||action==='recoverClosedTarget'||action==='repairExistingDraft'||action==='retryExistingDraftRepair'||action==='continueApprovedRepair'||action==='resumeReservedRepair'){
        // Refresh only the short request envelope after the complete source
        // proof. The UUID, review, body and browser identity stay unchanged.
        const now=draftOperationTime(),packet=await createProductDocumentPacket(review,{requestId:activeSession.packet.requestId,createdAt:now,now});
        activeSession={...activeSession,packet};assertProductDocumentPending(review,saved,activeSession);
        current.current.session=activeSession;setSession(activeSession);
      }
      current.current.draftMode=true;setDraftMode(true);dispatched=true;
      if(action==='retryCreateDraft'||action==='resumeCreateRetryDraft'){setRetryAttempted(true);setRetryApproved(false);}
      if(action==='repairExistingDraft'){
        current.current.existingRepairAttempted=true;current.current.existingRepairApproved=false;current.current.existingRepairNeeded=false;
        setExistingRepairAttempted(true);setExistingRepairApproved(false);setExistingRepairNeeded(false);
      }
      if(action==='retryExistingDraftRepair'){current.current.existingRepairRetryAttempted=true;current.current.existingRepairApproved=false;current.current.existingRepairNeeded=false;setExistingRepairRetryAttempted(true);setExistingRepairApproved(false);setExistingRepairNeeded(false);}
      if(action==='continueApprovedRepair'){current.current.repairContinuationAttempted=true;setRepairContinuationAttempted(true);}
      if(action==='resumeReservedRepair'){current.current.repairContinuationResumed=true;current.current.draftReadHint=null;setRepairContinuationResumed(true);setDraftReadHint(null);setSavedFileGroups(0);}
      const send=async()=>{
        if(action==='resumeReservedRepair'&&activeSession.preview.existingDocumentRepairSegmentedAvailable===true){
          const now=draftOperationTime(),packet=await createProductDocumentPacket(review,{requestId:activeSession.packet.requestId,createdAt:now,now});
          if(!task.active()||current.current.session!==activeSession)throw Error('회사·상품 연결이 바뀌어 다음 파일을 요청하지 않았습니다.');
          const renewed={...activeSession,packet};assertProductDocumentPending(review,saved,renewed);
          activeSession=renewed;current.current.session=renewed;setSession(renewed);
        }
        try{return await runProductDocumentDraft(activeSession,action,task.controller.signal);}
        catch(cause){if(action==='recoverDraft'||action==='recoverSavedDraftTarget')terminalReadError=cause;throw cause;}
      };
      const known=knownDraftDocument.current?.requestId===activeSession.packet.requestId?knownDraftDocument.current.docId:undefined;
      const result=action==='resumeReservedRepair'&&activeSession.preview.existingDocumentRepairSegmentedAvailable===true&&known!==undefined
        ?await runReservedSegments({expected:{requestId:activeSession.packet.requestId,docId:known,packetDigest:activeSession.packetDigest,preparedBodySha256:activeSession.preview.preparedBodySha256},send,signal:task.controller.signal,
          fresh:async()=>{await fresh(task);if(!task.active()||current.current.session!==activeSession)throw Error('현재 회사·상품 자료가 변경되어 다음 파일을 요청하지 않았습니다.');},onProgress:groups=>{if(task.active())setSavedFileGroups(groups);}})
        :await send();
      await fresh(task);if(!task.active()||current.current.session!==activeSession)return;
      if(!rememberDraftDocument(activeSession,result.docId))throw new ProductDocumentBridgeError('원래 요청에서 확인한 문서번호와 다른 복구 응답입니다. 원래 문서의 결과만 다시 확인해주세요.',!['recoverDraft','recoverSavedDraftTarget'].includes(action),'PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY');
      verifySingleDocumentObservation(before.state,result);
      if(before.state?.draftProof&&(result.draftProof!.checkpointSequence<before.state.draftProof.checkpointSequence||result.draftProof!.observedAt<before.state.draftProof.observedAt))throw new ProductDocumentBridgeError('원래 새 초안보다 오래된 준비 기록입니다. 기존 결과를 유지했습니다.',action==='prepareDraft','PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY');
      current.current.state=result;current.current.uncertain=result.needsRecovery;current.current.approved={};setState(result);setUncertain(result.needsRecovery);setApproved({});
      if(action==='recoverSavedDraftTarget'){current.current.draftReadHint=null;setDraftReadHint(null);}
      setMissingCreate(false);setApprovedRetryPending(false);
      setClosedTargetNeeded(false);setClosedTargetApproved(false);
      current.current.existingRepairNeeded=false;current.current.existingRepairApproved=false;setExistingRepairNeeded(false);setExistingRepairApproved(false);
      if(result.draftProof?.existingDocumentRepairAttempted===true){current.current.existingRepairAttempted=true;setExistingRepairAttempted(true);}
      if(result.draftProof?.existingDocumentRepairRetryAttempted===true){current.current.existingRepairRetryAttempted=true;setExistingRepairRetryAttempted(true);}
      if(result.draftProof?.existingDocumentRepairContinuationResumed===true){current.current.repairContinuationResumed=true;setRepairContinuationResumed(true);}
      if(result.draftProof?.existingDocumentRepairContinuationAttempted===true){current.current.repairContinuationAttempted=true;setRepairContinuationAttempted(true);}
      if(result.error)setError(result.error.message);
    }catch(cause){if(task.alive()){
      if(cause instanceof ProductDocumentBridgeError&&cause.knownDocId!==undefined&&!rememberDraftDocument(activeSession,cause.knownDocId))cause=new ProductDocumentBridgeError('원래 요청에서 확인한 문서번호와 다른 조회 응답입니다. 저장 요청을 진행하지 않았습니다.',false,'PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY');
      rememberDraftReadFailure(cause,activeSession,action==='recoverDraft');
      const eligible=cause instanceof ProductDocumentBridgeError&&(cause.existingDocumentRepairEligible===true&&!current.current.existingRepairAttempted||cause.existingDocumentRepairRetryEligible===true&&current.current.existingRepairAttempted&&!current.current.existingRepairRetryAttempted);
      current.current.existingRepairNeeded=eligible;current.current.existingRepairApproved=false;setExistingRepairNeeded(eligible);setExistingRepairApproved(false);
      if(cause instanceof ProductDocumentBridgeError&&cause.draftState==='create-requested'){setMissingCreate(!cause.closedTargetRecovery);setApprovedRetryPending(cause.approvedCreateRetry===true);setClosedTargetNeeded(cause.closedTargetRecovery);setClosedTargetApproved(false);}
      if(dispatched&&(cause instanceof ProductDocumentBridgeError?cause.uncertain:true)){current.current.uncertain=true;setUncertain(true);}
      if(dispatched&&terminalReadError===cause&&task.active()&&current.current.session===activeSession&&current.current.intent
        &&cause instanceof ProductDocumentBridgeError&&cause.code==='PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE'&&!cause.uncertain&&cause.knownDocId!==undefined
        &&knownDraftDocument.current?.requestId===activeSession.packet.requestId&&knownDraftDocument.current.docId===cause.knownDocId){
        try{const saved=current.current.intent;assertProductDocumentPending(review,saved,activeSession);
          setFinishedReadError({token:reviewToken,session:activeSession,intent:saved,docId:cause.knownDocId,message:cause.message,reviewDigest:review.reviewDigest,
            identityDigest:activeSession.preview.identityDigest,packetDigest:activeSession.packetDigest,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
        }catch{/* A failed storage/source fence keeps the view locked. */}
      }
      setError(cause instanceof Error?cause.message:'새 견적 초안 준비 결과 확인 실패');
    }}finally{task.finish();}
  }
  function rememberDraftDocument(expected:ProductDocumentSession,docId:string|number|null){
    if(docId===null)return true;
    const prior=knownDraftDocument.current;
    if(prior?.requestId===expected.packet.requestId&&prior.docId!==docId)return false;
    knownDraftDocument.current={requestId:expected.packet.requestId,docId};return true;
  }
  function draftHintCurrent(hint:typeof draftReadHint,expected:ProductDocumentSession){
    return Boolean(hint&&hint.token===reviewToken&&hint.requestId===expected.packet.requestId&&hint.identityDigest===expected.preview.identityDigest
      &&hint.packetDigest===expected.packetDigest&&hint.originalBodySha256===expected.preview.originalBodySha256&&hint.preparedBodySha256===expected.preview.preparedBodySha256);
  }
  function rememberDraftReadFailure(cause:unknown,expected:ProductDocumentSession,isDraftRead=false){
    // Only the fully verified, pre-lifecycle reply supplies this hint. It is
    // presentation/read routing, never ownership proof or permission to write.
    if(!(cause instanceof ProductDocumentBridgeError)||cause.code!=='PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE'||cause.knownDocId===undefined||!cause.draftState)return;
    const hint={token:reviewToken,requestId:expected.packet.requestId,docId:cause.knownDocId,state:cause.draftState,
      identityDigest:expected.preview.identityDigest,packetDigest:expected.packetDigest,originalBodySha256:expected.preview.originalBodySha256,preparedBodySha256:expected.preview.preparedBodySha256,
      ...(isDraftRead&&cause.savedDraftTargetClosed?{savedDraftTargetClosed:true}:{}),
      ...(isDraftRead&&cause.draftState==='update-requested'&&cause.existingDocumentRepairRetryAttempted?{continuationSnapshot:cause.existingDocumentRepairContinuationAttempted,resumeSnapshot:cause.existingDocumentRepairContinuationResumed,nativeFileListObserved:cause.nativeFileListObserved}:{})};
    current.current.draftReadHint=hint;setDraftReadHint(hint);
    if(cause.savedDraftTargetClosed){setMissingCreate(false);setRetryApproved(false);setApprovedRetryPending(false);current.current.closedTargetNeeded=false;current.current.closedTargetApproved=false;setClosedTargetNeeded(false);setClosedTargetApproved(false);}
    if(cause.existingDocumentRepairContinuationResumed){current.current.repairContinuationResumed=true;setRepairContinuationResumed(true);}
    if(cause.existingDocumentRepairContinuationAttempted){current.current.repairContinuationAttempted=true;setRepairContinuationAttempted(true);}
    if(cause.existingDocumentRepairAttempted){current.current.existingRepairAttempted=true;setExistingRepairAttempted(true);}
    if(cause.existingDocumentRepairRetryAttempted){current.current.existingRepairRetryAttempted=true;setExistingRepairRetryAttempted(true);}
  }
  async function operatePrepared(action:PreparedDocumentAction,expected:ProductDocumentSession,challengeId?:string){
    if(!canEnter())return;const before=current.current;
    if(before.session!==expected||expected.preview.preparedLifecycleAvailable!==true||!before.intent||!before.draftMode||before.unsaved
      ||action==='reviewPreparedDraft'&&(before.uncertain||before.error||!before.state||before.state.error||!(before.state.state==='validated'&&!before.state.preparedLifecycle||before.state.state==='navigation-ready'&&before.state.preparedLifecycle))
      ||action==='confirmPreparedDraft'&&(before.error||before.uncertain||before.expired||!before.state?.preparedLifecycle||before.state.challenge?.id!==challengeId)
      ||action==='observePreparedDraft'&&(before.uncertain||!before.state?.preparedLifecycle||!['pending','accepted','rejected'].includes(before.state.state)))return;
    let confirmation;
    if(action==='confirmPreparedDraft'){try{confirmation=singleConsentConfirmation(before.state!.challenge!,Object.entries(before.approved).filter(([,yes])=>yes).map(([key])=>key));}
      catch(cause){setError(cause instanceof Error?cause.message:'현재 문서의 필수 약관을 확인해주세요.');return;}}
    if(action==='recoverPreparedDraft'){const previous=current.current.draftReadHint,next=previous?{...previous,savedDraftTargetClosed:undefined,continuationSnapshot:undefined,resumeSnapshot:undefined,nativeFileListObserved:undefined}:previous;current.current.draftReadHint=next;setDraftReadHint(next);}
    const task=begin();let dispatched=false,activeSession=expected;
    try{
      await fresh(task);if(!task.active()||current.current.session!==expected)return;
      const eventTime=draftOperationTime();
      if(action==='reviewPreparedDraft'&&eventTime-expected.packet.createdAt>=PRODUCT_DOCUMENT_REQUEST_TTL){
        const packet=await createProductDocumentPacket(review,{requestId:expected.packet.requestId,createdAt:eventTime,now:eventTime}),refreshed=await previewProductDocument(packet,task.controller.signal);
        await fresh(task);if(!task.active()||current.current.session!==expected)return;
        if(refreshed.preview.preparedLifecycleAvailable!==true||refreshed.preview.identityDigest!==expected.preview.identityDigest||refreshed.packetDigest!==expected.packetDigest)throw Error('준비한 원래 문서의 현재 회사·본문 연결을 다시 확인해주세요.');
        assertProductDocumentPending(review,before.intent,refreshed);activeSession=refreshed;current.current.session=refreshed;setSession(refreshed);
      }
      assertProductDocumentPending(review,before.intent,activeSession);dispatched=true;
      const result=await runPreparedProductDocument(activeSession,action,task.controller.signal,confirmation);
      await fresh(task);if(!task.active()||current.current.session!==activeSession)return;
      if(!rememberDraftDocument(activeSession,result.docId))throw new ProductDocumentBridgeError('원래 요청에서 확인한 문서번호와 다른 단계 응답입니다. 원래 문서의 결과만 다시 확인해주세요.',['reviewPreparedDraft','confirmPreparedDraft'].includes(action),'PRODUCT_PREPARED_REPLY_IDENTITY');
      verifySingleDocumentObservation(before.state,result);
      const previous=before.state?.lifecycleProof,next=result.lifecycleProof;
      if(!previous&&next&&before.state?.draftProof&&before.state.draftProof.checkpointSequence!==next.preparedCheckpointSequence)throw new ProductDocumentBridgeError('준비한 초안과 다른 등록 기록입니다. 원래 문서를 다시 확인해주세요.',['reviewPreparedDraft','confirmPreparedDraft'].includes(action),'PRODUCT_PREPARED_REPLY_IDENTITY');
      if(previous&&(!next||previous.preparedCheckpointSequence!==next.preparedCheckpointSequence||previous.qualifiedCheckpointSequence!==next.qualifiedCheckpointSequence
        ||previous.qualifiedAt!==next.qualifiedAt||next.checkpointSequence<previous.checkpointSequence||next.observedAt<previous.observedAt))throw new ProductDocumentBridgeError('준비한 원래 문서보다 오래되거나 다른 등록 기록입니다. 기존 결과를 유지했습니다.',['reviewPreparedDraft','confirmPreparedDraft'].includes(action),'PRODUCT_PREPARED_REPLY_IDENTITY');
      if(before.state?.state==='rejected'&&result.state!=='rejected')throw new ProductDocumentBridgeError('원래 반려 문서의 결과를 다른 상태로 바꿀 수 없습니다.',false,'PRODUCT_RECEIPT_CHANGED');
      current.current.state=result;current.current.uncertain=result.needsRecovery;current.current.approved={};current.current.expired=false;
      setState(result);setUncertain(result.needsRecovery);setApproved({});setExpired(false);if(result.error)setError(result.error.message);
      if(result.receipt?.evidence==='document-receipt'&&!result.needsRecovery){const attempt={packet:activeSession.packet,observation:preparedReceiptObservation(result)};current.current.unsaved=attempt;setUnsaved(attempt);await persist(attempt,task);}
    }catch(cause){if(task.alive()){
      if(cause instanceof ProductDocumentBridgeError&&cause.knownDocId!==undefined&&!rememberDraftDocument(activeSession,cause.knownDocId))cause=new ProductDocumentBridgeError('원래 요청에서 확인한 문서번호와 다른 조회 응답입니다. 저장 요청을 진행하지 않았습니다.',false,'PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY');
      rememberDraftReadFailure(cause,activeSession,action==='recoverPreparedDraft');
      const eligible=cause instanceof ProductDocumentBridgeError&&(cause.existingDocumentRepairEligible===true&&!current.current.existingRepairAttempted||cause.existingDocumentRepairRetryEligible===true&&current.current.existingRepairAttempted&&!current.current.existingRepairRetryAttempted);
      current.current.existingRepairNeeded=eligible;current.current.existingRepairApproved=false;setExistingRepairNeeded(eligible);setExistingRepairApproved(false);
      if(dispatched&&(cause instanceof ProductDocumentBridgeError?cause.uncertain:true)){current.current.uncertain=true;setUncertain(true);}
      if(cause instanceof ProductDocumentBridgeError&&cause.draftState==='create-requested'){setMissingCreate(!cause.closedTargetRecovery);setApprovedRetryPending(cause.approvedCreateRetry===true);setClosedTargetNeeded(cause.closedTargetRecovery);setClosedTargetApproved(false);}
      current.current.approved={};setApproved({});setError(cause instanceof Error?cause.message:'준비한 새 문서의 등록 확인 실패');
    }}finally{task.finish();}
  }
  const challenge=state?.challenge,terminal=Boolean(state&&['pending','accepted','rejected','validation-rejected','scope-blocked'].includes(state.state));
  const preparedFlow=Boolean(session?.preview.preparedLifecycleAvailable&&draftMode&&state?.preparedLifecycle);
  const currentDraftHint=session&&draftHintCurrent(draftReadHint,session)?draftReadHint:null;
  const canConfirm=Boolean((preparedFlow||session?.preview.liveVerified&&!draftMode&&!state?.draftOnly)&&challenge&&!error&&!expired&&!uncertain&&challenge.items.filter(item=>item.required).every(item=>approved[item.key]));
  const sameReview=Boolean(session&&session.packet.review.reviewDigest===review.reviewDigest
    &&session.packet.review.originalBodySha256===review.originalBodySha256&&session.packet.review.preparedBodySha256===review.preparedBodySha256
    &&productReceiptCanonical(session.packet.review.identity)===productReceiptCanonical(review.identity)&&productReceiptCanonical(session.packet.review.members)===productReceiptCanonical(review.members));
  // Native diagnostics are read-only. They never select fields, alter input,
  // accept terms or retry a submission. A released report stays visible only
  // in the exact current review; a new source/account/review cannot inherit it.
  const validationReport=sameReview&&state?.state==='validation-rejected'&&state.validationRejection&&state.docId!==null&&!uncertain
    ?{docId:state.docId,rejection:state.validationRejection}
    :!session&&releasedValidation?.token===reviewToken?releasedValidation:null;
  return <section aria-label="전체 상품 견적 전송" aria-busy={busy||!intentReady}>
    {busy&&<p role="status">현재 회사·원본 파일과 같은 견적서의 저장 결과를 확인하고 있습니다. 이 작업이 끝날 때까지 기다려주세요.</p>}
    <div className="quote-actions"><button type="button" className="btn primary" disabled={disabled||busy||!intentReady||Boolean(intentError)||Boolean(session)} onClick={()=>void connect()}>{intent?'이전 문서 전송 자료 확인':'전체 옵션 전송 자료 확인'}</button>
      {session&&!state&&!uncertain&&!unsaved&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>{if(!canEnter()||current.current.session!==session)return;current.current.session=null;setSession(null);setError('');}}>전송 자료 확인 닫기</button>}</div>
    {error&&<p role="alert">{error}</p>}
    {error&&/\/ http-(?:redirect|401|403|network|type-other)\./.test(error)&&<p role="status">
      <a href="https://supplier.coupang.com/sr/registration" target="_blank" rel="noreferrer">Supplier Hub 개별 상품 등록 화면 열기</a>
      {' · '}공식 화면의 로그인과 목록 조회가 정상인지 확인한 뒤 같은 문서의 읽기 검증을 계속하세요. 기존 요청·문서번호는 유지하며, 이 링크로 파일·본문을 전송하지 않습니다.
    </p>}
    {(finishedReadDismissible||finishedPreviewReadDismissible)&&<p role="status">읽기 확인이 오류로 끝났습니다. 이 화면을 닫아도 원래 요청과 문서 보관 기록은 유지되며, 다시 열면 같은 요청의 저장 결과를 확인합니다. 원본 편집은 계속 잠겨 있습니다.</p>}
    {intentError&&<p role="alert">{intentError}</p>}
    {validationReport&&<section aria-label="제출 전 검증 오류" className="panel-stack">
      <h5>수정할 입력 항목</h5>
      <p>문서 {String(validationReport.docId)} · 검증 {validationReport.rejection.step}단계 · 미제출</p>
      {validationReport.rejection.errors?.length?<div className="quotation-fields-bulk-table"><table>
        <caption>Supplier Hub 단계 검증 결과</caption><thead><tr><th scope="col">항목</th><th scope="col">수정이 필요한 이유</th></tr></thead>
        <tbody>{validationReport.rejection.errors.map((item,index)=><tr key={index}><td>{item.columnName||'항목명 미제공'}</td><td style={{whiteSpace:'pre-wrap'}}>{item.message||'오류 설명 미제공'}</td></tr>)}</tbody>
      </table></div>:<p>이 문서의 단계 검증 오류 상세가 제공되지 않았습니다. Supplier Hub에서 확인해주세요.</p>}
      <p>오류 내용을 확인하고 상품·견적서를 수정해주세요. 수정한 내용은 다시 검토한 뒤 전송합니다.</p>
    </section>}
    {intent&&!session&&<p role="status">이 상품의 이전 전송 요청이 보관되어 있습니다. 같은 요청의 저장 결과만 확인하며 새 등록을 시작하지 않습니다.</p>}
    {!session&&!intent&&!state&&!intentError&&intentReady&&<details><summary>원래 요청 연결 복구</summary>
      <p>저장 완료된 원래 문서의 요청번호를 확인해 이 웹의 연결만 복구합니다. 새 문서 생성이나 파일·본문 재전송은 하지 않습니다.</p>
      <div className="form-grid">
        <label className="field"><span>원래 요청번호</span><input aria-label="복구할 원래 요청번호" disabled={disabled||busy} value={reconnectRequest} onChange={event=>{if(canEnter())setReconnectInput({token:reviewToken,requestId:event.target.value,docId:reconnectDocument});}}/></label>
        <label className="field"><span>원래 문서번호</span><input aria-label="복구할 원래 문서번호" inputMode="numeric" disabled={disabled||busy} value={reconnectDocument} onChange={event=>{if(canEnter())setReconnectInput({token:reviewToken,requestId:reconnectRequest,docId:event.target.value});}}/></label>
      </div>
      <button type="button" className="btn ghost" disabled={disabled||busy||!reconnectRequest.trim()||!reconnectDocument.trim()} onClick={()=>void reconnectOriginal()}>원래 저장 문서 연결 복구</button>
      {reconnectReadTargetCurrent&&<section aria-label="원래 문서 읽기 탭 연결 복구">
        <p>원래 문서 {reconnectDocument}의 검증 탭이 닫혔습니다. 같은 문서의 현재 파일·본문을 새 전용 탭에서 읽어 확인합니다.</p>
        <button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void reconnectOriginal(true)}>원래 문서의 새 읽기 탭 연결 · 재전송 안 함</button>
      </section>}
      {originalAuditCurrent&&<section aria-label="원래 문서 저장 내용 대조">
        <button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void auditOriginalSavedDocument()}>원래 문서 본문·첨부 전체 대조 · 읽기 전용</button>
        {shownOriginalAudit&&<div role="status">
          <p>문서 {String(shownOriginalAudit.docId)} · 이미지 {shownOriginalAudit.imageCount}개 대조 · 서류 첨부 {shownOriginalAudit.legalCount}개 · 원래 본문 {shownOriginalAudit.bodyMatchesExpected?'일치':'불일치'}</p>
          <p>조회 결과만 확인했습니다. 파일 삭제·본문 저장·등록전송은 실행하지 않았습니다.</p>
          {shownOriginalAudit.legalEntries.length>0&&<table><caption>현재 서류 첨부 연결</caption><thead><tr><th>첨부</th><th>종류</th><th>인증 항목 연결</th></tr></thead><tbody>
            {shownOriginalAudit.legalEntries.map(row=><tr key={row.index}><td>{row.index+1}</td><td>{row.kind==='certificate'?'인증서':'기타 서류'}</td><td>{{unlinked:'연결 없음',linked:'연결됨',ambiguous:'여러 항목 연결',unknown:'확인 필요'}[row.association]}</td></tr>)}
          </tbody></table>}
          {shownOriginalAudit.differenceCount>0&&<details><summary>본문 차이 {shownOriginalAudit.differenceCount}개</summary>
            <table><caption>원래 견적과 다른 저장 항목</caption><thead><tr><th>옵션</th><th>항목</th><th>원래 값 상태</th><th>현재 값 상태</th></tr></thead><tbody>
              {shownOriginalAudit.differences.map((row,index)=><tr key={index}><td>{row.documentIndex===null?'공통':row.documentIndex+1}</td><td>{auditPathLabels[row.path]??'저장 항목'}{row.schemaIndex===null?'':` (${row.schemaIndex+1})`}</td><td>{auditValueLabels[row.expectedValueKind]}</td><td>{auditValueLabels[row.actualValueKind]}</td></tr>)}
            </tbody></table>
          </details>}
        </div>}
      </section>}
    </details>}
    {session&&<p>회사 {review.identity.company.name} · 포함 옵션 {session.packet.review.members.length}개 · 견적 문서 1개 · 전체 본문 대조 완료</p>}
    {session&&!session.preview.liveVerified&&session.preview.draftPreparationAvailable!==true&&!intent&&!state?.preparedLifecycle&&<p role="status">전체 문서의 실제 접수 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.</p>}
    {session&&!session.preview.liveVerified&&session.preview.draftPreparationAvailable!==true&&<p><a href="/downloads/yoofam-plus-supplier-hub-extension-2.1.65.zip" download>통합 확장 2.1.65 다운로드</a> · 새 견적 초안 준비에는 업데이트한 통합 확장이 필요합니다.</p>}
    {session?.preview.draftPreparationAvailable===true&&!state?.preparedLifecycle&&<section aria-label="새 견적 초안 준비">
      <p>{intent?'원래 요청과 문서의 파일·본문 저장 및 단계 검증 결과를 확인합니다.':'로그인한 Supplier Hub에 새 견적 초안 한 개를 만들고 저장한 이미지·본문과 단계 검증을 확인합니다.'} 약관 동의와 최종 제출은 진행하지 않습니다.</p>
      {currentDraftHint&&<p role="status">원래 문서 {String(currentDraftHint.docId)} · {currentDraftHint.state==='update-requested'?'파일·본문 저장 결과 미확인':currentDraftHint.state==='validation-requested'?'단계 검증 결과 미확인':'초안 상태 확인 필요'} · 같은 요청 유지</p>}
      {currentDraftHint?.continuationSnapshot!==undefined&&<p role="status">{currentDraftHint.continuationSnapshot?'이번 읽기 시점에 이어 저장 예약 기록이 확인됐습니다. 저장 완료를 뜻하지 않습니다.':'이번 읽기 시점에는 이어 저장 예약 기록이 확인되지 않았습니다. 이전 작업이 아직 진행 중일 수 있으므로 이것만으로 종료 여부를 확정할 수 없습니다.'}</p>}
      {currentDraftHint?.resumeSnapshot!==undefined&&<p role="status">{currentDraftHint.resumeSnapshot?session?.preview.existingDocumentRepairSegmentedAvailable===true&&currentDraftHint.nativeFileListObserved===true?'원래 재개 예약을 유지합니다. 확인된 파일은 보존하고 아직 요청하지 않은 자료만 이어 저장할 수 있습니다.':'미요청 파일 재개 예약이 서버 기록에 있습니다. 저장 결과를 조회하고 요청을 반복하지 마세요.':'이번 읽기에서는 미요청 파일 재개 예약이 서버 기록에 없습니다. 파일 요청 여부는 같은 문서의 저장 기록으로 확인합니다.'}</p>}
      {currentDraftHint?.nativeFileListObserved===false&&<p role="status">원래 문서의 파일·본문 저장 결과가 아직 확인되지 않아 이어 저장을 보류했습니다. 위 오류를 확인한 뒤 같은 요청의 저장 결과를 다시 조회해주세요. 원래 요청과 저장 예약은 유지합니다.</p>}
      {!state&&!uncertain&&!intent&&<button type="button" className="btn primary" disabled={disabled||busy||Boolean(intentError)} onClick={()=>void operateDraft('prepareDraft',session)}>새 견적 초안 만들기 · 제출 안 함</button>}
      {draftMode&&uncertain&&!state?.preparedLifecycle&&<><p role="status">초안 준비 응답을 확인하지 못했습니다. 같은 초안을 다시 만들지 않고 저장 결과만 조회합니다.</p><button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void(session.preview.preparedLifecycleAvailable&&!currentDraftHint?operatePrepared('recoverPreparedDraft',session):operateDraft('recoverDraft',session))}>같은 초안 저장 결과 확인 · 읽기 전용</button></>}
      {draftMode&&uncertain&&intent&&!state?.preparedLifecycle&&currentDraftHint?.savedDraftTargetClosed===true&&session.preview.savedDraftTargetRecoveryAvailable===true&&<section aria-label="원래 저장 문서 검증 탭 복구">
        <p>원래 저장 문서 {String(currentDraftHint.docId)}의 전용 검증 탭이 닫혔습니다. 새 전용 탭에서 현재 저장된 파일·본문을 확인합니다.</p>
        <button type="button" className="btn ghost" disabled={busy||disabled} onClick={()=>void operateDraft('recoverSavedDraftTarget',session)}>원래 저장 문서 검증 탭 복구 · 파일·본문 재전송 안 함</button>
      </section>}
      {draftMode&&uncertain&&existingRepairNeeded&&!existingRepairAttempted&&session.preview.existingDocumentRepairAvailable===true&&!state?.preparedLifecycle&&<section aria-label="같은 문서 1회 저장 복구">
        <p>원래 문서번호·견적 본문을 유지해 회사·상품과 빈 파일 목록을 다시 확인하고, 이 문서에 파일 저장과 본문 업데이트를 한 번 진행합니다. 새 문서는 만들지 않습니다. 이전 저장 결과는 미확정이므로 같은 문서의 저장 요청이 반복될 가능성이 있습니다.</p>
        <label><input type="checkbox" checked={existingRepairApproved} disabled={busy||disabled} onChange={event=>{
          if(!canEnter()||current.current.session!==session||!current.current.existingRepairNeeded||current.current.existingRepairAttempted)return;
          current.current.existingRepairApproved=event.target.checked;setExistingRepairApproved(event.target.checked);
        }}/>같은 문서의 파일 저장·동일 본문 업데이트 1회 복구를 승인합니다.</label>
        <button type="button" className="btn ghost" disabled={busy||disabled||!existingRepairApproved} onClick={()=>void operateDraft('repairExistingDraft',session)}>같은 문서 파일 저장·본문 복구 1회</button>
      </section>}
      {draftMode&&uncertain&&existingRepairAttempted&&!existingRepairNeeded&&!existingRepairRetryAttempted&&!state?.preparedLifecycle&&<p role="status">같은 문서의 1회 저장 복구를 요청했습니다. 다시 저장하지 않고 원래 문서의 결과만 확인합니다.</p>}
      {draftMode&&uncertain&&existingRepairNeeded&&existingRepairAttempted&&!existingRepairRetryAttempted&&session.preview.existingDocumentRepairRetryAvailable===true&&!state?.preparedLifecycle&&<section aria-label="같은 문서 추가 1회 저장 복구">
        <p>첫 복구의 저장 결과가 미확정입니다. 원래 요청·문서번호·견적 본문과 첫 복구 기록을 유지하고, 중복·회사·빈 파일 목록을 다시 확인한 뒤 같은 문서에 추가로 한 번만 저장합니다. 같은 파일의 저장 요청이 반복될 가능성이 있습니다.</p>
        <label><input type="checkbox" checked={existingRepairApproved} disabled={busy||disabled} onChange={event=>{
          if(!canEnter()||current.current.session!==session||!current.current.existingRepairNeeded||!current.current.existingRepairAttempted||current.current.existingRepairRetryAttempted)return;
          current.current.existingRepairApproved=event.target.checked;setExistingRepairApproved(event.target.checked);
        }}/>원래 문서의 파일 저장·동일 본문 업데이트 추가 1회 복구를 승인합니다.</label>
        <button type="button" className="btn ghost" disabled={busy||disabled||!existingRepairApproved} onClick={()=>void operateDraft('retryExistingDraftRepair',session)}>같은 문서 추가 1회 복구</button>
      </section>}
      {draftMode&&uncertain&&existingRepairRetryAttempted&&!repairContinuationAttempted&&currentDraftHint?.state==='update-requested'&&currentDraftHint.nativeFileListObserved===true&&session.preview.existingDocumentRepairContinuationAvailable===true&&<section aria-label="승인된 복구 이어 저장">
        <p>기존 저장 응답은 보존하고 아직 요청하지 않은 파일과 본문만 이어 저장합니다. 회사·중복·파일 목록을 다시 대조하며, 미확정 업로드나 본문 요청이 있으면 중단합니다.</p>
        <button type="button" className="btn ghost" disabled={busy||disabled} onClick={()=>void operateDraft('continueApprovedRepair',session)}>승인된 복구의 남은 저장 이어가기</button>
      </section>}
      {draftMode&&uncertain&&repairContinuationAttempted&&(!repairContinuationResumed||session.preview.existingDocumentRepairSegmentedAvailable===true)&&currentDraftHint?.nativeFileListObserved===true&&currentDraftHint.continuationSnapshot===true&&typeof currentDraftHint.resumeSnapshot==='boolean'&&(!currentDraftHint.resumeSnapshot||session.preview.existingDocumentRepairSegmentedAvailable===true)&&session.preview.existingDocumentRepairReservedResumeAvailable===true&&<section aria-label="원래 예약의 미요청 파일 이어 저장">
        <p>원래 요청과 저장 예약을 유지합니다. 서버 중복·파일 목록을 다시 대조해 아직 요청하지 않은 파일만 저장하며, 응답이 미확정인 업로드나 본문 요청은 반복하지 않습니다.</p>
        <button type="button" className="btn ghost" disabled={busy||disabled} onClick={()=>void operateDraft('resumeReservedRepair',session)}>원래 예약의 미요청 파일만 이어 저장</button>
      </section>}
      {draftMode&&repairContinuationAttempted&&<p role="status">원래 이어 저장 예약을 유지하고 있습니다. 요청한 파일과 본문은 다시 보내지 않습니다.</p>}
      {draftMode&&repairContinuationResumed&&<p role="status">미요청 파일 저장만 이어갑니다. 요청 결과가 미확정인 파일과 본문은 다시 보내지 않습니다.</p>}
      {busy&&savedFileGroups>0&&<p role="status">추가 파일 그룹 {savedFileGroups}개 저장 확인 · 다음 미요청 자료를 확인하고 있습니다.</p>}
      {draftMode&&uncertain&&existingRepairRetryAttempted&&!state?.preparedLifecycle&&<p role="status">{session.preview.existingDocumentRepairSegmentedAvailable===true?'원래 추가 복구 기록을 보존합니다. 미확정 요청은 결과를 조회하며, 아직 요청하지 않은 자료만 이어갑니다.':'같은 문서의 추가 1회 복구를 요청했습니다. 더 저장하지 않고 원래 문서의 결과만 확인합니다.'}</p>}
      {draftMode&&uncertain&&missingCreate&&!retryAttempted&&!approvedRetryPending&&session.preview.createRetryAvailable===true&&!state?.preparedLifecycle&&<section aria-label="문서 생성 1회 재시도">
        <p>문서 생성 응답이 확인되지 않았습니다. 기존 요청번호·견적 내용을 유지하며, 전송 직전 중간저장·제출요청 전체 목록이 원래 기록과 일치할 때에만 생성을 한 번 다시 요청합니다. 이전 요청이 뒤늦게 처리되면 중복될 수 있습니다.</p>
        <label><input type="checkbox" checked={retryApproved} disabled={busy||disabled} onChange={event=>setRetryApproved(event.target.checked)}/>중복 가능성을 확인했고 기존 요청으로 생성 1회 재시도에 동의합니다.</label>
        <button type="button" className="btn ghost" disabled={busy||disabled||!retryApproved} onClick={()=>void operateDraft('retryCreateDraft',session)}>기존 요청으로 생성 1회 재시도</button>
      </section>}
      {draftMode&&uncertain&&missingCreate&&approvedRetryPending&&!retryAttempted&&session.preview.createRetryContinuationAvailable===true&&!state?.preparedLifecycle&&<section aria-label="승인된 생성 재시도 이어가기">
        <p>원래 요청에 저장된 1회 재시도 승인을 이어갑니다. 같은 전송 탭의 생성 기록과 현재 중복 여부를 다시 확인하며, 생성 요청 기록이 있으면 반복하지 않습니다.</p>
        <button type="button" className="btn ghost" disabled={busy||disabled} onClick={()=>void operateDraft('resumeCreateRetryDraft',session)}>승인된 1회 생성 계속</button>
      </section>}
      {draftMode&&uncertain&&closedTargetNeeded&&!state?.preparedLifecycle&&<section aria-label="닫힌 전용 검증 탭 복구">
        <p>원래 검증 탭이 닫혀 이전 생성 표식을 읽을 수 없습니다. 원래 요청번호·견적 내용·1회 승인 기록을 유지하고 새 전용 탭을 연결합니다. 이 연결 단계에서는 문서를 만들거나 제출하지 않습니다. 이후 생성 전에 현재 중간저장·제출 목록을 다시 확인하며, 이전 요청이 뒤늦게 처리되면 중복될 가능성이 남습니다.</p>
        <label><input type="checkbox" checked={closedTargetApproved} disabled={busy||disabled} onChange={event=>setClosedTargetApproved(event.target.checked)}/>이전 생성 결과의 불확실성을 확인했고 새 전용 검증 탭 연결을 승인합니다.</label>
        <button type="button" className="btn ghost" disabled={busy||disabled||!closedTargetApproved} onClick={()=>void operateDraft('recoverClosedTarget',session)}>원래 요청의 새 검증 탭 연결 · 생성 안 함</button>
      </section>}
      {draftMode&&state?.draftOnly&&!state.preparedLifecycle&&!uncertain&&['prepared','target-created','created','updated'].includes(state.state)&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void operateDraft('prepareDraft',session)}>같은 초안 준비 계속 · 제출 안 함</button>}
      {draftMode&&state?.draftOnly&&!state.preparedLifecycle&&!uncertain&&<><p role="status">{state.docId!==null?`Supplier Hub 초안 문서 ${String(state.docId)}`:'새 초안 준비 기록 확인'} · 단계 검증 {state.draftProof!.validatedSteps.length}/4 · {validatedDraft?'초안 저장·검증 완료 · 미제출':state.state==='validation-rejected'?'제출 전 검증 반려':'초안 준비 확인 중'}</p><button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void(session.preview.preparedLifecycleAvailable?operatePrepared('recoverPreparedDraft',session):operateDraft('recoverDraft',session))}>같은 초안 저장 결과 확인 · 읽기 전용</button></>}
      {draftMode&&state?.draftOnly&&!state.preparedLifecycle&&state.state==='validation-rejected'&&!uncertain&&<button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void releaseValidationRejection(session)}>검증 반려 확인 · 수정 허용</button>}
    </section>}
    {session?.preview.preparedLifecycleAvailable&&validatedDraft&&<button type="button" className="btn primary" disabled={disabled||busy||Boolean(error)} onClick={()=>void operatePrepared('reviewPreparedDraft',session)}>준비한 새 견적서 등록전송</button>}
    {session&&preparedFlow&&<section aria-label="준비한 새 문서 등록전송">
      <p>현재 문서 {String(state!.docId)}의 원본 파일·저장값을 다시 확인했습니다.</p>
      {(uncertain||expired||Boolean(error))&&<p role="status">같은 문서의 저장 결과와 현재 단계를 먼저 확인해주세요. 새 문서를 만들거나 제출을 재시도하지 않습니다.</p>}
      {state?.state==='navigation-ready'&&!uncertain&&!error&&<button type="button" className="btn primary" disabled={disabled||busy} onClick={()=>void operatePrepared('reviewPreparedDraft',session)}>같은 문서 다음 단계 계속</button>}
      {(!state?.receipt||uncertain)&&<button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void operatePrepared('recoverPreparedDraft',session)}>준비한 문서 단계 확인 · 읽기 전용</button>}
      {state&&['pending','accepted'].includes(state.state)&&!uncertain&&<button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void operatePrepared('observePreparedDraft',session)}>접수 결과 조회</button>}
    </section>}
    {session?.preview.liveVerified&&!draftMode&&!state?.draftOnly&&<>
      {!state&&!uncertain&&!intent&&<button type="button" className="btn primary" disabled={disabled||busy||Boolean(intentError)} onClick={()=>void operate('start',session)}>전체 상품 견적 등록 시작</button>}
      {uncertain&&<><p role="status">응답이 확정되지 않았습니다. 같은 요청을 다시 보내지 않고 저장 결과를 조회합니다.</p><button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void operate('recover',session)}>같은 문서 저장 결과 확인</button></>}
      {state?.state==='validation-rejected'&&!uncertain&&<><p role="status">제출 전 단계 검증에서 반려되었습니다. 저장된 반려 기록을 다시 확인한 뒤 상품·견적서를 수정할 수 있습니다.</p><button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void releaseValidationRejection(session)}>검증 반려 확인 · 수정 허용</button></>}
      {state&&!terminal&&!uncertain&&(!challenge||expired)&&state.state!=='target-requested'&&<button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void operate(expired?'recover':'resume',session)}>현재 문서 단계 계속 확인</button>}
      {state&&['pending','accepted'].includes(state.state)&&!uncertain&&<button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void operate('observe',session)}>접수 결과 조회</button>}

    </>}
      {challenge&&(preparedFlow||session?.preview.liveVerified&&!draftMode&&!state?.draftOnly)&&<section aria-label="전체 문서 단계별 동의"><h5>{challenge.stage?stageLabels[challenge.stage]:'최종 제출'} 동의 확인</h5>
        {challenge.items.map(item=><article key={item.key}>{item.title&&<h6>{item.title}</h6>}<p style={{whiteSpace:'pre-wrap'}}>{item.text}</p>{item.termsText&&<div style={{whiteSpace:'pre-wrap'}}>{item.termsText}</div>}
          {item.required&&<label><input type="checkbox" checked={Boolean(approved[item.key])} disabled={disabled||busy||expired||uncertain} onChange={event=>{
            if(!canEnter()||current.current.expired||current.current.uncertain||current.current.state?.challenge?.id!==challenge.id)return;
            const next={...current.current.approved,[item.key]:event.target.checked};current.current.approved=next;setApproved(next);
          }}/>위 필수 동의 내용을 확인했습니다.</label>}</article>)}
        {!challenge.items.length&&<p>전체 옵션과 견적 내용을 확인한 뒤 최종 제출해주세요.</p>}
        <button type="button" className="btn primary" disabled={disabled||busy||!canConfirm} onClick={()=>void(preparedFlow?operatePrepared('confirmPreparedDraft',session!,challenge.id):operate('confirm',session!,challenge.id))}>현재 문서 동의 확인 · 계속</button>
      </section>}
    {unsaved&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void retrySave()}>확인 결과 저장 다시 시도</button>}
    {state?.receipt&&<p role="status">문서 {String(state.docId)} · 등록 파일 {String(state.receipt.qvtRequestId)} · {({pending:'접수 처리 중',accepted:'파일 처리 완료 · SKU 확인 전',rejected:'반려'})[state.state as 'pending']}</p>}
    {state?.receipt?.sourceStatus==='REJECTED'&&<SupplierHubRejectionDetails details={state.receipt.rejectionDetails}/>}
    {historyError&&<p role="alert">{historyError}</p>}
    {history.length>0&&<section aria-label="전체 상품 등록 파일 확인 이력"><h5>보관된 문서 확인 이력</h5>{history.map((row,index)=><article key={`${row.requestId}:${index}`}>
      <p>{row.company.name} · {'members' in row?`포함 옵션 ${row.members.length}개 · 문서 1개`:'개별 옵션 문서'} · {({SUBMITTED:'접수 처리 중',FINISHED:'파일 처리 완료 · SKU 확인 전',REJECTED:'반려'})[row.receipt.sourceStatus]}</p>
      <p>문서 {String(row.docId)} · 등록 파일 {String(row.receipt.qvtRequestId)}</p>
      {row.receipt.sourceStatus==='REJECTED'&&<SupplierHubRejectionDetails details={row.receipt.rejectionDetails}/>}
      {'recordType' in row&&row.recordType==='product-document'&&<SupplierHubNativeRegistration receipt={row} disabled={disabled||busy}/>}
    </article>)}</section>}
  </section>;
}
