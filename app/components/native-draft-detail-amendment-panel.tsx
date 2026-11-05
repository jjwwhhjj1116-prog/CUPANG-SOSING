'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {amendmentSame,type NativeDraftDetailAmendmentDescriptor,type NativeDraftDetailAmendmentObservation,type NativeDraftDetailAmendmentRequest} from '../../extensions/supplier-hub/native-draft-detail-amendment.mjs';
import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import {runNativeDraftDetailAmendment,nativeDraftDetailAmendmentLifecycle} from '@/app/native-draft-detail-amendment-client';
import {assertNativeDraftDetailAmendmentCurrent,claimNativeDraftDetailAmendmentPending,readNativeDraftDetailAmendmentPending,type NativeDraftDetailAmendmentPending} from '@/app/native-draft-detail-amendment-pending';
import {ProductDocumentBridgeError,preparedReceiptObservation,saveProductReceiptObservation,type ProductDocumentSession,type ProductDocumentState} from '@/app/supplier-hub-product-client';
import {singleConsentConfirmation,verifySingleDocumentObservation} from '@/app/supplier-hub-single-client';
import {MemberRegistrationConsentsPanel} from '@/app/components/member-registration-consents-panel';
import {SupplierHubRejectionDetails} from '@/app/components/supplier-hub-rejection-details';

type Props={review:SupplierHubProductDocumentReview;pending:NativeDraftDetailAmendmentPending;initialObservation?:NativeDraftDetailAmendmentObservation;disabled:boolean;refresh:(signal:AbortSignal)=>Promise<SupplierHubProductDocumentReview>;onLockChange:(source:boolean,close?:boolean)=>void;onReceiptSaved?:()=>void};
const matches=(value:NativeDraftDetailAmendmentObservation,review:SupplierHubProductDocumentReview)=>Boolean(value.latest&&value.latest.reviewDigest===review.reviewDigest&&value.latest.sourcePlanSha256===review.identity.fingerprint&&value.latest.originalBodySha256===review.originalBodySha256&&value.latest.preparedBodySha256===review.preparedBodySha256);
const labels={productPage:'상품 정보',imagePage:'이미지',logisticsPage:'최종 제출'};
/** The saved parent reservation remains immutable. Every write belongs to the
 * extension's separately anchored, same-document DETAIL-only child ledger. */
export function NativeDraftDetailAmendmentPanel(props:Props){
 const {review,pending:retained,disabled,initialObservation,onLockChange}=props;
 const viewToken=useMemo(()=>({review,retained,disabled}),[review,retained,disabled]);
 const [record,setRecord]=useState(retained),[savedObservation,setSavedObservation]=useState<{review:SupplierHubProductDocumentReview;value:NativeDraftDetailAmendmentObservation}|null>(null);
 const observation=savedObservation?.review===review?savedObservation.value:null;
 const setObservation=(value:NativeDraftDetailAmendmentObservation|null)=>setSavedObservation(value?{review,value}:null);
 const [busy,setBusy]=useState(true),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[approved,setApproved]=useState<Record<string,boolean>>({});
 const [lifecycle,setLifecycle]=useState<{session:ProductDocumentSession;state:ProductDocumentState}|null>(null),[unsaved,setUnsaved]=useState<{packet:ProductDocumentSession['packet'];observation:ProductDocumentState}|null>(null);
 const controller=useRef<AbortController|null>(null),epoch=useRef<object|null>(null),current=useRef({props,record,observation,lifecycle,unsaved,approved,uncertain}),operation=useRef(operate);
 useLayoutEffect(()=>{current.current={props,record,observation,lifecycle,unsaved,approved,uncertain};});
 useLayoutEffect(()=>{operation.current=operate;});
 useLayoutEffect(()=>{epoch.current=viewToken;return()=>{if(epoch.current===viewToken)epoch.current=null;};},[viewToken]);
 const editable=Boolean(observation?.anchor&&observation.capabilities.appendDetail&&!observation.needsRecovery&&!observation.error&&['editing','previewed'].includes(observation.state));
 useLayoutEffect(()=>{onLockChange(busy||uncertain||Boolean(unsaved)||Boolean(error)||!editable,busy||uncertain||Boolean(unsaved));},[busy,uncertain,unsaved,error,editable,onLockChange]);
 useEffect(()=>{
  const token=viewToken;
  void Promise.resolve().then(()=>{if(epoch.current!==token)return;setSavedObservation(null);setLifecycle(null);setApproved({});setUncertain(false);setError('');setBusy(true);if(!disabled)void operation.current('inspect',token,initialObservation);else setBusy(false);});
  return()=>{if(epoch.current===token)epoch.current=null;controller.current?.abort();controller.current=null;};
  // A new saved review must re-inspect the retained child; it cannot inherit a preview.
 },[viewToken,disabled,initialObservation]);
 useLayoutEffect(()=>()=>onLockChange(false,false),[onLockChange]);

 async function operate(action:Exclude<NativeDraftDetailAmendmentRequest['action'],'begin'>,token=epoch.current,initial?:NativeDraftDetailAmendmentObservation){
  const before=current.current;
  if(!token||epoch.current!==token||before.props.disabled||controller.current||before.unsaved)return;
  const active=new AbortController();controller.current=active;setBusy(true);setError('');before.props.onLockChange(true,true);
  const alive=()=>epoch.current===token&&current.current.props.review===review&&!current.current.props.disabled&&!active.signal.aborted&&controller.current===active;
  const fresh=async()=>{const next=await before.props.refresh(active.signal);if(!alive()||next.reviewDigest!==review.reviewDigest||next.originalBodySha256!==review.originalBodySha256||next.preparedBodySha256!==review.preparedBodySha256||!amendmentSame(next.identity,review.identity))throw Error('저장한 상품·옵션·회사 또는 견적서가 바뀌었습니다. 수정 자료를 다시 확인해주세요.');};
  let dispatched=false;
  try{
   let saved=readNativeDraftDetailAmendmentPending(review);if(!saved||!amendmentSame(saved,before.record))throw Error('원래 문서의 수정 준비 기록이 변경되었습니다.');
   if(action!=='inspect'&&(!('anchor'in saved)||!before.observation||before.uncertain&&action!=='recover'&&action!=='observe'))throw Error('같은 수정 기록의 현재 결과를 먼저 확인해주세요.');
   if(['preview','apply','review','confirm'].includes(action))await fresh();if(!alive())return;
   let request:NativeDraftDetailAmendmentRequest;
   if(!('anchor'in saved))request={action:'inspect',amendmentId:saved.amendmentId,lookup:saved.lookup};
   else if(action==='preview')request={action,amendmentId:saved.amendmentId,anchor:saved.anchor,nextReview:review};
   else if(action==='apply'){
    const prior=before.observation!;assertNativeDraftDetailAmendmentCurrent(saved,prior,review);
    if(!['previewed','files-saved','updated'].includes(prior.state)||!matches(prior,review)||!prior.previewDigest||!prior.capabilities.appendDetail||prior.needsRecovery||prior.error)throw Error('최신 상세 수정 자료를 먼저 확인해주세요.');
    request={action,amendmentId:saved.amendmentId,anchor:saved.anchor,nextReview:review,previewDigest:prior.previewDigest};
   }else if(action==='confirm'){
    const challenge=before.lifecycle?.state.challenge;if(!challenge||!before.observation||!matches(before.observation,review)||before.observation.needsRecovery)throw Error('현재 수정 문서의 동의 내용을 다시 확인해주세요.');
    request={action,amendmentId:saved.amendmentId,anchor:saved.anchor,confirmation:singleConsentConfirmation(challenge,challenge.items.filter(item=>item.required&&before.approved[item.key]).map(item=>item.key))};
   }else{
    if(action==='review'&&(!before.observation||!matches(before.observation,review)||!['validated','submission'].includes(before.observation.state)||before.observation.needsRecovery||before.observation.error))throw Error('최신 수정 문서의 저장·단계 검증을 먼저 확인해주세요.');
    request={action,amendmentId:saved.amendmentId,anchor:saved.anchor};
   }
   dispatched=!initial;const result=initial??await runNativeDraftDetailAmendment(request,active.signal);if(!alive())return;
   if(result.anchor&&'lookup'in saved){saved=await claimNativeDraftDetailAmendmentPending({format:'yoofam-native-draft-detail-amendment-descriptor-v1',amendmentId:saved.amendmentId,anchor:result.anchor},active.signal);if(!alive())return;setRecord(saved);current.current.record=saved;}
   if(result.anchor)assertNativeDraftDetailAmendmentCurrent(saved as NativeDraftDetailAmendmentDescriptor,result);
   const previous=before.observation;
   if(previous&&(result.sequence<previous.sequence||result.observedAt<previous.observedAt||result.sequence===previous.sequence&&!amendmentSame([result.state,result.latest,result.validatedSteps,result.previewDigest],[previous.state,previous.latest,previous.validatedSteps,previous.previewDigest])))throw Error('이전보다 오래된 수정 기록입니다. 같은 문서를 다시 조회해주세요.');
   if(['preview','apply','review','confirm'].includes(action))await fresh();if(!alive())return;
   let nextLifecycle:null|{session:ProductDocumentSession;state:ProductDocumentState}=null;
   if('lifecycle'in result&&result.lifecycle){
    nextLifecycle=await nativeDraftDetailAmendmentLifecycle(review,saved as NativeDraftDetailAmendmentDescriptor,result,action==='observe'?'observePreparedDraft':action==='confirm'?'confirmPreparedDraft':action==='recover'?'recoverPreparedDraft':'reviewPreparedDraft',active.signal);
    if(!alive())return;verifySingleDocumentObservation(before.lifecycle?.state??null,nextLifecycle.state);
   }
   setObservation(result);current.current.observation=result;setLifecycle(nextLifecycle);current.current.lifecycle=nextLifecycle;setApproved({});setUncertain(false);current.current.uncertain=false;
   if(result.error)setError(result.error.message);
   if(nextLifecycle?.state.receipt){
    const attempt={packet:nextLifecycle.session.packet,observation:preparedReceiptObservation(nextLifecycle.state)};
    setUnsaved(attempt);current.current.unsaved=attempt;
    try{await saveProductReceiptObservation(attempt,active.signal);if(alive()){setUnsaved(null);current.current.unsaved=null;before.props.onReceiptSaved?.();}}
    catch{if(alive())setError('접수 결과의 앱 저장을 확인하지 못했습니다. 같은 확인 결과만 다시 저장해주세요.');}
   }
  }catch(cause){if(alive()){const unknown=before.uncertain||dispatched&&!['inspect','preview','recover','observe'].includes(action)||cause instanceof ProductDocumentBridgeError&&cause.uncertain;setUncertain(unknown);current.current.uncertain=unknown;setError(cause instanceof Error?cause.message:'같은 문서의 수정 결과를 확인하지 못했습니다.');}}
  finally{if(controller.current===active){controller.current=null;if(epoch.current===token)setBusy(false);}}
 }
 function launch(action:Exclude<NativeDraftDetailAmendmentRequest['action'],'begin'>){if(epoch.current===viewToken&&current.current.observation===observation&&(!current.current.uncertain||['inspect','recover','observe'].includes(action)))void operate(action,viewToken);}
 async function retrySave(){const before=current.current,attempt=before.unsaved,token=epoch.current;if(!attempt||!token||controller.current||before.props.disabled)return;const active=new AbortController();controller.current=active;setBusy(true);try{const saved=readNativeDraftDetailAmendmentPending(review);if(!saved||!('anchor'in saved)||!before.observation)throw Error('수정 문서의 현재 기록을 확인해주세요.');assertNativeDraftDetailAmendmentCurrent(saved,before.observation,review);await saveProductReceiptObservation(attempt,active.signal);if(epoch.current===token&&!active.signal.aborted){setUnsaved(null);current.current.unsaved=null;setError('');before.props.onReceiptSaved?.();}}catch{if(epoch.current===token)setError('같은 접수 확인 결과의 앱 저장을 완료하지 못했습니다.');}finally{if(controller.current===active){controller.current=null;if(epoch.current===token)setBusy(false);}}}
 const challenge=lifecycle?.state.challenge,expired=Boolean(challenge&&Date.now()>=challenge.expiresAt),canPreview=editable&&!uncertain&&!unsaved;
 const canApply=observation&&['previewed','files-saved','updated'].includes(observation.state)&&Boolean(observation.previewDigest)&&matches(observation,review)&&observation.capabilities.appendDetail&&!observation.needsRecovery&&!observation.error&&!uncertain&&!unsaved;
 const canRegister=observation?.state==='validated'&&matches(observation,review)&&observation.validatedSteps.length===4&&!observation.needsRecovery&&!observation.error&&!uncertain&&!unsaved;
 const recoverLifecycle=Boolean(observation?.latest&&['submission','pending','accepted','rejected','registered'].includes(observation.state));
 const doc='anchor'in record?record.anchor.docId:record.lookup.docId;
 return <section aria-label="저장된 문서 상세 수정" aria-busy={busy}><h5>저장된 문서 {String(doc)} 상세 수정</h5>
  <p>원래 문서와 전송 요청을 유지합니다. 5단계 상세이미지를 수정하고 최종 저장한 뒤 수정 자료를 확인해주세요. 대표·추가이미지와 다른 견적 항목이 바뀌면 반영이 중단됩니다.</p>
  {editable&&<p role="status">상세 편집 가능 · 문서 반영 전</p>}
  {observation?.state==='not-found'&&<p role="status">원래 수정 준비 응답을 찾지 못했습니다. 같은 수정 요청번호를 보존하고 결과만 다시 조회합니다.</p>}
  {error&&<p role="alert">{error}</p>}
  {canPreview&&<button type="button" className="btn ghost" disabled={props.disabled||busy} onClick={()=>launch('preview')}>수정 자료 확인</button>}
  {canApply&&<button type="button" className="btn primary" disabled={props.disabled||busy} onClick={()=>launch('apply')}>같은 문서에 수정 반영</button>}
  {canRegister&&<button type="button" className="btn primary" disabled={props.disabled||busy} onClick={()=>launch('review')}>최신 수정 문서 등록전송</button>}
  {lifecycle?.state.state==='navigation-ready'&&!uncertain&&!error&&<button type="button" className="btn primary" disabled={props.disabled||busy} onClick={()=>launch('review')}>같은 수정 문서 다음 단계 계속</button>}
  {!unsaved&&<button type="button" className="btn ghost" disabled={props.disabled||busy} onClick={()=>launch(observation?.needsRecovery||uncertain||recoverLifecycle?'recover':'inspect')}>같은 수정 문서 결과 확인 · 읽기 전용</button>}
  {lifecycle&&['pending','accepted'].includes(lifecycle.state.state)&&!uncertain&&!unsaved&&<button type="button" className="btn ghost" disabled={props.disabled||busy} onClick={()=>launch('observe')}>접수 결과 조회</button>}
  {challenge&&!uncertain&&!unsaved&&<section aria-label="최신 수정 문서 단계별 동의"><h5>{challenge.stage?labels[challenge.stage]:'최종 제출'} 동의 확인</h5>
   {!expired&&<MemberRegistrationConsentsPanel ownerId={review.identity.ownerId} company={review.identity.company} challenge={challenge}/>}
   {challenge.items.map(item=><article key={item.key}>{item.title&&<h6>{item.title}</h6>}<p style={{whiteSpace:'pre-wrap'}}>{item.text}</p>{item.termsText&&<div style={{whiteSpace:'pre-wrap'}}>{item.termsText}</div>}{item.required&&<label><input type="checkbox" checked={Boolean(approved[item.key])} disabled={props.disabled||busy||expired} onChange={event=>{if(!controller.current&&epoch.current&&current.current.lifecycle?.state.challenge?.id===challenge.id)setApproved(value=>({...value,[item.key]:event.target.checked}));}}/>위 필수 동의 내용을 확인했습니다.</label>}</article>)}
   <button type="button" className="btn primary" disabled={props.disabled||busy||expired||challenge.items.some(item=>item.required&&!approved[item.key])} onClick={()=>{if(current.current.lifecycle?.state.challenge?.id===challenge.id)launch('confirm');}}>현재 수정 문서 동의 확인 · 계속</button>
  </section>}
  {unsaved&&<button type="button" className="btn ghost" disabled={props.disabled||busy} onClick={()=>void retrySave()}>확인 결과 저장 다시 시도</button>}
  {lifecycle?.state.receipt&&<p role="status">문서 {String(lifecycle.state.docId)} · 등록 파일 {String(lifecycle.state.receipt.qvtRequestId)} · {lifecycle.state.state==='accepted'?'파일 처리 완료 · SKU 확인 전':lifecycle.state.state==='rejected'?'반려':'접수 처리 중'}</p>}
  {lifecycle?.state.receipt?.rejectionDetails&&<SupplierHubRejectionDetails details={lifecycle.state.receipt.rejectionDetails}/>}
 </section>;
}
