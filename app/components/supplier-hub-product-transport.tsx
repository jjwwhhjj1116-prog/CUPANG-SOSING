'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import {createProductDocumentPacket} from '../../extensions/supplier-hub/product-document.mjs';
import {previewProductDocument,runProductDocument,readNativeReceiptHistory,saveProductReceiptObservation,
  type ProductDocumentSession,type ProductDocumentState,ProductDocumentBridgeError} from '@/app/supplier-hub-product-client';
import {singleConsentConfirmation,verifySingleDocumentObservation,type SingleDocumentAction} from '@/app/supplier-hub-single-client';
import type {NativeReceiptRecord} from '@/app/supplier-hub-product-receipt';
import {SupplierHubRejectionDetails} from '@/app/components/supplier-hub-rejection-details';
import {readProductDocumentPending,productDocumentPendingKey,productDocumentPendingCurrent,assertProductDocumentPending,claimProductDocumentPending,
  readProductDocumentRejections,productDocumentRejectionKey,assertProductDocumentNotRejected,
  pendingProductRejection,clearRejectedProductDocumentPending,clearValidationRejectedProductDocumentPending,type ProductDocumentPending} from '@/app/supplier-hub-product-pending';

type Props={review:SupplierHubProductDocumentReview;disabled:boolean;refresh:(signal:AbortSignal)=>Promise<SupplierHubProductDocumentReview>;
  onLockChange:(locked:boolean)=>void;onReceiptSaved?:()=>void};
const stageLabels={productPage:'상품 정보',imagePage:'이미지',logisticsPage:'최종 제출'};
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
  const current=useRef({props,mounted:true,session,state,uncertain,expired,approved,unsaved,intent,intentReady,intentError}),pending=useRef<AbortController|null>(null),historyPending=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{current.current={props,mounted:true,session,state,uncertain,expired,approved,unsaved,intent,intentReady,intentError};});
  useLayoutEffect(()=>{onLockChange(busy||Boolean(session)||Boolean(unsaved)||Boolean(intent)||Boolean(intentError));},[busy,session,unsaved,intent,intentError,onLockChange]);
  useLayoutEffect(()=>()=>{current.current.mounted=false;pending.current?.abort();historyPending.current?.abort();current.current.props.onLockChange(false);},[]);
  useEffect(()=>{
    const load=(changed=false)=>{if(!current.current.mounted||current.current.props.review!==review)return;
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
  const canEnter=()=>current.current.mounted&&!current.current.props.disabled&&!pending.current&&current.current.props.review===review&&current.current.intentReady&&!current.current.intentError;
  function begin(){const controller=new AbortController();pending.current=controller;setBusy(true);setError('');current.current.props.onLockChange(true);
    return {controller,alive:()=>current.current.mounted&&current.current.props.review===review&&!controller.signal.aborted&&pending.current===controller,
      active:()=>current.current.mounted&&current.current.props.review===review&&!current.current.props.disabled&&!controller.signal.aborted&&pending.current===controller,
      finish:()=>{if(pending.current===controller){pending.current=null;if(current.current.mounted)setBusy(false);}}};}
  async function fresh(task:ReturnType<typeof begin>){
    const result=await current.current.props.refresh(task.controller.signal);
    if(!task.active()||result.reviewDigest!==review.reviewDigest||result.originalBodySha256!==review.originalBodySha256
      ||result.preparedBodySha256!==review.preparedBodySha256)throw Error('저장한 상품·옵션·회사 또는 견적서가 바뀌었습니다. 전체 문서를 다시 확인해주세요.');
  }
  async function connect(){
    if(!canEnter()||current.current.session||current.current.unsaved)return;const task=begin();
    try{await fresh(task);if(!task.active())return;const saved=readProductDocumentPending(review);
      if(saved)assertProductDocumentPending(review,saved);
      else assertProductDocumentNotRejected(review);
      // Only the TTL envelope is refreshed. The original operation UUID,
      // reviewed body and browser identity must remain exact for read recovery.
      const packet=await createProductDocumentPacket(review,saved?{requestId:saved.requestId,createdAt:Date.now(),now:Date.now()}:{}),result=await previewProductDocument(packet,task.controller.signal);
      await fresh(task);if(!task.active())return;if(saved)assertProductDocumentPending(review,saved,result);
      else {assertProductDocumentNotRejected(review);if(readProductDocumentPending(review)!==null)throw Error('다른 탭에서 이 상품의 전송을 시작했습니다. 원래 문서의 결과를 확인해주세요.');}
      current.current.intent=saved;setIntent(saved);current.current.session=result;current.current.uncertain=Boolean(saved);setSession(result);setUncertain(Boolean(saved));
    }catch(cause){if(task.active())setError(cause instanceof Error?cause.message:'전체 견적 전송 자료 확인 실패');}finally{task.finish();}
  }
  async function persist(attempt:NonNullable<typeof unsaved>,task:ReturnType<typeof begin>){
    try{const result=await saveProductReceiptObservation(attempt,task.controller.signal,fetch);if(!task.active()||current.current.unsaved!==attempt)return;
      historyPending.current?.abort();historyPending.current=null;setHistory(rows=>[result,...rows.filter(row=>row.requestId!==result.requestId)]);setHistoryError('');
      const saved=current.current.intent;if(saved&&result.receipt.sourceStatus==='REJECTED'){
        await clearRejectedProductDocumentPending(review,saved,result,task.controller.signal);if(!task.active())return;current.current.intent=null;setIntent(null);
      }
      current.current.unsaved=null;setUnsaved(null);try{current.current.props.onReceiptSaved?.();}catch{/* Stored receipt remains confirmed. */}
    }catch(cause){if(task.active())setError(cause instanceof Error?cause.message:'확인한 접수 결과를 보관하지 못했습니다. 결과는 화면에 유지했습니다.');}
  }
  async function retrySave(){if(!canEnter()||!current.current.unsaved)return;const task=begin();try{await persist(current.current.unsaved,task);}finally{task.finish();}}
  async function releaseValidationRejection(expected:ProductDocumentSession){
    if(!canEnter())return;const before=current.current,saved=before.intent,original=before.state;
    if(before.session!==expected||!saved||original?.state!=='validation-rejected'||before.uncertain||before.unsaved||!expected.preview.liveVerified)return;
    const task=begin();
    const active=()=>task.active()&&current.current.session===expected&&current.current.state===original&&current.current.intent===saved&&!current.current.uncertain&&!current.current.unsaved;
    try{
      await fresh(task);if(!active())return;assertProductDocumentPending(review,saved,expected);
      const result=await runProductDocument(expected,'recover',task.controller.signal);await fresh(task);if(!active())return;
      verifySingleDocumentObservation(original,result);
      if(result.state!=='validation-rejected'||result.docId!==original.docId||JSON.stringify(result.validationRejection)!==JSON.stringify(original.validationRejection))throw Error('원래 문서의 제출 전 검증 반려를 확인하지 못했습니다. 같은 문서의 저장 결과를 다시 확인해주세요.');
      const removed=await clearValidationRejectedProductDocumentPending(review,saved,expected,result,task.controller.signal,async()=>{
        await fresh(task);return active();
      });
      if(!removed||!active())return;
      current.current.intent=null;current.current.session=null;current.current.state=null;current.current.approved={};current.current.expired=false;current.current.intentError='';
      setIntent(null);setSession(null);setState(null);setApproved({});setExpired(false);setIntentError('');
      setError('제출 전 단계 검증 반려를 확인했습니다. 상품·견적서를 수정한 뒤 전체 전송 자료를 다시 확인해주세요.');
    }catch(cause){if(task.alive())setError(cause instanceof Error?cause.message:'검증 반려 기록을 확인하지 못했습니다. 원래 전송 요청을 보관했습니다.');}finally{task.finish();}
  }
  async function operate(action:SingleDocumentAction,expected:ProductDocumentSession,challengeId?:string){
    if(!canEnter())return;const before=current.current;
    if(before.session!==expected||!expected.preview.liveVerified||before.unsaved||before.state?.state==='validation-rejected'&&!before.uncertain||before.uncertain&&action!=='recover'
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
  const challenge=state?.challenge,terminal=Boolean(state&&['pending','accepted','rejected','validation-rejected','scope-blocked'].includes(state.state));
  const canConfirm=Boolean(session?.preview.liveVerified&&challenge&&!expired&&!uncertain&&challenge.items.filter(item=>item.required).every(item=>approved[item.key]));
  return <section aria-label="전체 상품 견적 전송" aria-busy={busy||!intentReady}>
    <div className="quote-actions"><button type="button" className="btn primary" disabled={disabled||busy||!intentReady||Boolean(intentError)||Boolean(session)} onClick={()=>void connect()}>{intent?'이전 문서 전송 자료 확인':'전체 옵션 전송 자료 확인'}</button>
      {session&&!state&&!uncertain&&!unsaved&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>{if(!canEnter()||current.current.session!==session)return;current.current.session=null;setSession(null);setError('');}}>전송 자료 확인 닫기</button>}</div>
    {error&&<p role="alert">{error}</p>}
    {intentError&&<p role="alert">{intentError}</p>}
    {intent&&!session&&<p role="status">이 상품의 이전 전송 요청이 보관되어 있습니다. 같은 요청의 저장 결과만 확인하며 새 등록을 시작하지 않습니다.</p>}
    {session&&<p>회사 {review.identity.company.name} · 포함 옵션 {session.packet.review.members.length}개 · 견적 문서 1개 · 전체 본문 대조 완료</p>}
    {session&&!session.preview.liveVerified&&<p role="status">전체 문서의 실제 접수 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.</p>}
    {session?.preview.liveVerified&&<>
      {!state&&!uncertain&&!intent&&<button type="button" className="btn primary" disabled={disabled||busy||Boolean(intentError)} onClick={()=>void operate('start',session)}>전체 상품 견적 등록 시작</button>}
      {uncertain&&<><p role="status">응답이 확정되지 않았습니다. 같은 요청을 다시 보내지 않고 저장 결과를 조회합니다.</p><button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void operate('recover',session)}>같은 문서 저장 결과 확인</button></>}
      {state?.state==='validation-rejected'&&!uncertain&&<><p role="status">제출 전 단계 검증에서 반려되었습니다. 저장된 반려 기록을 다시 확인한 뒤 상품·견적서를 수정할 수 있습니다.</p><button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void releaseValidationRejection(session)}>검증 반려 확인 · 수정 허용</button></>}
      {state&&!terminal&&!uncertain&&(!challenge||expired)&&state.state!=='target-requested'&&<button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void operate(expired?'recover':'resume',session)}>현재 문서 단계 계속 확인</button>}
      {state&&['pending','accepted'].includes(state.state)&&!uncertain&&<button type="button" className="btn ghost" disabled={disabled||busy||Boolean(unsaved)} onClick={()=>void operate('observe',session)}>접수 결과 조회</button>}
      {challenge&&<section aria-label="전체 문서 단계별 동의"><h5>{challenge.stage?stageLabels[challenge.stage]:'최종 제출'} 동의 확인</h5>
        {challenge.items.map(item=><article key={item.key}>{item.title&&<h6>{item.title}</h6>}<p style={{whiteSpace:'pre-wrap'}}>{item.text}</p>{item.termsText&&<div style={{whiteSpace:'pre-wrap'}}>{item.termsText}</div>}
          {item.required&&<label><input type="checkbox" checked={Boolean(approved[item.key])} disabled={disabled||busy||expired||uncertain} onChange={event=>{
            if(!canEnter()||current.current.expired||current.current.uncertain||current.current.state?.challenge?.id!==challenge.id)return;
            const next={...current.current.approved,[item.key]:event.target.checked};current.current.approved=next;setApproved(next);
          }}/>위 필수 동의 내용을 확인했습니다.</label>}</article>)}
        {!challenge.items.length&&<p>전체 옵션과 견적 내용을 확인한 뒤 최종 제출해주세요.</p>}
        <button type="button" className="btn primary" disabled={disabled||busy||!canConfirm} onClick={()=>void operate('confirm',session,challenge.id)}>현재 문서 동의 확인 · 계속</button>
      </section>}
    </>}
    {unsaved&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void retrySave()}>확인 결과 저장 다시 시도</button>}
    {state?.receipt&&<p role="status">문서 {String(state.docId)} · 등록 파일 {String(state.receipt.qvtRequestId)} · {({pending:'접수 처리 중',accepted:'파일 처리 완료 · SKU 확인 전',rejected:'반려'})[state.state as 'pending']}</p>}
    {state?.receipt?.sourceStatus==='REJECTED'&&<SupplierHubRejectionDetails details={state.receipt.rejectionDetails}/>}
    {historyError&&<p role="alert">{historyError}</p>}
    {history.length>0&&<section aria-label="전체 상품 등록 파일 확인 이력"><h5>보관된 문서 확인 이력</h5>{history.map((row,index)=><article key={`${row.requestId}:${index}`}>
      <p>{row.company.name} · {'members' in row?`포함 옵션 ${row.members.length}개 · 문서 1개`:'개별 옵션 문서'} · {({SUBMITTED:'접수 처리 중',FINISHED:'파일 처리 완료 · SKU 확인 전',REJECTED:'반려'})[row.receipt.sourceStatus]}</p>
      <p>문서 {String(row.docId)} · 등록 파일 {String(row.receipt.qvtRequestId)}</p>
      {row.receipt.sourceStatus==='REJECTED'&&<SupplierHubRejectionDetails details={row.receipt.rejectionDetails}/>}
    </article>)}</section>}
  </section>;
}
