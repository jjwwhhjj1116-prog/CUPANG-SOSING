'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import {createProductDocumentPacket} from '../../extensions/supplier-hub/product-document.mjs';
import {previewProductDocument,runProductDocument,readNativeReceiptHistory,saveProductReceiptObservation,
  type ProductDocumentSession,type ProductDocumentState,ProductDocumentBridgeError} from '@/app/supplier-hub-product-client';
import {singleConsentConfirmation,verifySingleDocumentObservation,type SingleDocumentAction} from '@/app/supplier-hub-single-client';
import type {NativeReceiptRecord} from '@/app/supplier-hub-product-receipt';

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
  const current=useRef({props,mounted:true,session,state,uncertain,expired,approved,unsaved}),pending=useRef<AbortController|null>(null),historyPending=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{current.current={props,mounted:true,session,state,uncertain,expired,approved,unsaved};});
  useLayoutEffect(()=>{onLockChange(busy||Boolean(session)||Boolean(unsaved));},[busy,session,unsaved,onLockChange]);
  useLayoutEffect(()=>()=>{current.current.mounted=false;pending.current?.abort();historyPending.current?.abort();current.current.props.onLockChange(false);},[]);
  useEffect(()=>{
    const controller=new AbortController();historyPending.current=controller;
    void readNativeReceiptHistory({productId:review.identity.productId},controller.signal,fetch).then(rows=>{
      if(current.current.mounted&&!controller.signal.aborted&&current.current.props.review===review){setHistory(rows);setHistoryError('');}
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
  const canEnter=()=>current.current.mounted&&!current.current.props.disabled&&!pending.current&&current.current.props.review===review;
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
    try{await fresh(task);if(!task.active())return;const packet=await createProductDocumentPacket(review),result=await previewProductDocument(packet,task.controller.signal);
      await fresh(task);if(!task.active())return;current.current.session=result;setSession(result);
    }catch(cause){if(task.active())setError(cause instanceof Error?cause.message:'전체 견적 전송 자료 확인 실패');}finally{task.finish();}
  }
  async function persist(attempt:NonNullable<typeof unsaved>,task:ReturnType<typeof begin>){
    try{const result=await saveProductReceiptObservation(attempt,task.controller.signal,fetch);if(!task.active()||current.current.unsaved!==attempt)return;
      historyPending.current?.abort();historyPending.current=null;setHistory(rows=>[result,...rows.filter(row=>row.requestId!==result.requestId)]);setHistoryError('');
      current.current.unsaved=null;setUnsaved(null);try{current.current.props.onReceiptSaved?.();}catch{/* Stored receipt remains confirmed. */}
    }catch(cause){if(task.active())setError(cause instanceof Error?cause.message:'확인한 접수 결과를 보관하지 못했습니다. 결과는 화면에 유지했습니다.');}
  }
  async function retrySave(){if(!canEnter()||!current.current.unsaved)return;const task=begin();try{await persist(current.current.unsaved,task);}finally{task.finish();}}
  async function operate(action:SingleDocumentAction,expected:ProductDocumentSession,challengeId?:string){
    if(!canEnter())return;const before=current.current;
    if(before.session!==expected||!expected.preview.liveVerified||before.unsaved||before.uncertain&&action!=='recover'
      ||action==='start'&&(before.state||before.uncertain)||action==='confirm'&&(before.expired||before.state?.challenge?.id!==challengeId)
      ||action==='recover'&&!before.uncertain&&!before.expired)return;
    let confirmation;
    if(action==='confirm'){try{confirmation=singleConsentConfirmation(before.state!.challenge!,Object.entries(before.approved).filter(([,yes])=>yes).map(([key])=>key));}
      catch(cause){setError(cause instanceof Error?cause.message:'필수 약관을 확인해주세요.');return;}}
    const task=begin();let dispatched=false;
    try{await fresh(task);if(!task.active()||current.current.session!==expected)return;
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
  const challenge=state?.challenge,terminal=Boolean(state&&['pending','accepted','rejected','scope-blocked'].includes(state.state));
  const canConfirm=Boolean(session?.preview.liveVerified&&challenge&&!expired&&!uncertain&&challenge.items.filter(item=>item.required).every(item=>approved[item.key]));
  return <section aria-label="전체 상품 견적 전송" aria-busy={busy}>
    <div className="quote-actions"><button type="button" className="btn primary" disabled={disabled||busy||Boolean(session)} onClick={()=>void connect()}>전체 옵션 전송 자료 확인</button>
      {session&&!state&&!uncertain&&!unsaved&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>{if(!canEnter()||current.current.session!==session)return;current.current.session=null;setSession(null);setError('');}}>전송 자료 확인 닫기</button>}</div>
    {error&&<p role="alert">{error}</p>}
    {session&&<p>회사 {review.identity.company.name} · 포함 옵션 {session.packet.review.members.length}개 · 견적 문서 1개 · 전체 본문 대조 완료</p>}
    {session&&!session.preview.liveVerified&&<p role="status">전체 문서의 실제 접수 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.</p>}
    {session?.preview.liveVerified&&<>
      {!state&&!uncertain&&<button type="button" className="btn primary" disabled={disabled||busy} onClick={()=>void operate('start',session)}>전체 상품 견적 등록 시작</button>}
      {uncertain&&<><p role="status">응답이 확정되지 않았습니다. 같은 요청을 다시 보내지 않고 저장 결과를 조회합니다.</p><button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void operate('recover',session)}>같은 문서 저장 결과 확인</button></>}
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
    {historyError&&<p role="alert">{historyError}</p>}
    {history.length>0&&<section aria-label="전체 상품 등록 파일 확인 이력"><h5>보관된 문서 확인 이력</h5>{history.map((row,index)=><article key={`${row.requestId}:${index}`}>
      <p>{row.company.name} · {'members' in row?`포함 옵션 ${row.members.length}개 · 문서 1개`:'개별 옵션 문서'} · {({SUBMITTED:'접수 처리 중',FINISHED:'파일 처리 완료 · SKU 확인 전',REJECTED:'반려'})[row.receipt.sourceStatus]}</p>
      <p>문서 {String(row.docId)} · 등록 파일 {String(row.receipt.qvtRequestId)}</p>
    </article>)}</section>}
  </section>;
}
