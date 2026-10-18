'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import {singlePackageCurrent,singlePackagePacket,previewSingleDocument,runSingleDocument,verifySingleDocumentObservation,readSingleCatalogContext,singleConsentConfirmation,SingleDocumentBridgeError,
  readSingleReceiptHistory,saveSingleReceiptObservation,singleReceiptSaveAttempt,
  type SinglePackageView,type SingleDocumentSession,type SingleDocumentState,type SingleDocumentAction,type SingleReceiptSaveAttempt} from '@/app/supplier-hub-single-client';
import type {SingleReceiptRecord} from '@/app/supplier-hub-single-receipt';

type Props={productId:string;profileId?:string;view:QuotationFieldsView;disabled:boolean;onReceiptSaved?:()=>void};
const sourceKey=({productId,profileId,view}:Omit<Props,'disabled'>)=>JSON.stringify([productId,profileId,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint]);
const stages={productPage:'상품 정보',imagePage:'이미지',logisticsPage:'최종 제출'};
export function SupplierHubSingleReview(props:Props){return <SingleReviewContent key={JSON.stringify([sourceKey(props),props.disabled])} {...props}/>;}
function SingleReviewContent({productId,profileId,view,disabled,onReceiptSaved}:Props){
  const [data,setData]=useState<SinglePackageView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [optionId,setOptionId]=useState(''),[session,setSession]=useState<SingleDocumentSession|null>(null),[state,setState]=useState<SingleDocumentState|null>(null);
  const [approved,setApproved]=useState<Record<string,boolean>>({}),[uncertain,setUncertain]=useState(false),[expired,setExpired]=useState(false);
  const [history,setHistory]=useState<SingleReceiptRecord[]>([]),[historyLoading,setHistoryLoading]=useState(true),[historyError,setHistoryError]=useState('');
  const [saveError,setSaveError]=useState(''),[saveAttempt,setSaveAttempt]=useState<SingleReceiptSaveAttempt|null>(null);
  const key=sourceKey({productId,profileId,view}),current=useRef({key,view,disabled,mounted:true,onReceiptSaved}),pending=useRef<AbortController|null>(null),generation=useRef(0);
  const historyPending=useRef<AbortController|null>(null),receiptAttempt=useRef<SingleReceiptSaveAttempt|null>(null);
  const latest=useRef({data,optionId,session,state,approved,uncertain,expired});
  useLayoutEffect(()=>{latest.current={data,optionId,session,state,approved,uncertain,expired};});
  function invalidate(message=''){
    generation.current++;pending.current?.abort();pending.current=null;historyPending.current?.abort();historyPending.current=null;receiptAttempt.current=null;
    latest.current={data:null,optionId:'',session:null,state:null,approved:{},uncertain:false,expired:false};
    setData(null);setOptionId('');setSession(null);setState(null);setApproved({});setUncertain(false);setExpired(false);setBusy(false);if(message)setError(message);
    setHistory([]);setHistoryLoading(false);setHistoryError(message);setSaveAttempt(null);setSaveError('');
  }
  useLayoutEffect(()=>{current.current={key,view,disabled,mounted:true,onReceiptSaved};},[key,view,disabled,onReceiptSaved]);
  useLayoutEffect(()=>()=>{current.current.mounted=false;current.current.disabled=true;generation.current++;pending.current?.abort();pending.current=null;historyPending.current?.abort();historyPending.current=null;receiptAttempt.current=null;},[]);
  useEffect(()=>{
    const controller=new AbortController();historyPending.current=controller;
    const active=()=>current.current.mounted&&current.current.key===key&&!controller.signal.aborted&&historyPending.current===controller;
    void readSingleReceiptHistory({productId,profileId},controller.signal,fetch).then(records=>{if(active()){setHistory(records);setHistoryError('');}}).catch(cause=>{if(active()){setHistory([]);setHistoryError(cause instanceof Error?cause.message:'보관된 확인 결과를 조회하지 못했습니다.');}}).finally(()=>{if(active()){historyPending.current=null;setHistoryLoading(false);}});
    return()=>{controller.abort();if(historyPending.current===controller)historyPending.current=null;};
  },[key,productId,profileId]);
  useEffect(()=>{
    const challenge=state?.challenge;if(!challenge)return;
    const timer=setTimeout(()=>{
      if(!current.current.mounted||latest.current.state?.challenge?.id!==challenge.id)return;
      const inFlight=Boolean(pending.current);generation.current++;pending.current?.abort();pending.current=null;
      latest.current={...latest.current,approved:{},expired:true,uncertain:latest.current.uncertain||inFlight};
      setApproved({});setExpired(true);setUncertain(previous=>previous||inFlight);setBusy(false);setError('동의 확인 시간이 만료됐습니다. 현재 문서의 동의 내용을 다시 확인해주세요.');
    },Math.max(0,challenge.expiresAt-Date.now()));
    return()=>clearTimeout(timer);
  },[state?.challenge]);
  const canEnter=()=>current.current.mounted&&!current.current.disabled&&current.current.key===key&&!pending.current;
  function begin(){const controller=new AbortController(),sequence=++generation.current;pending.current=controller;setBusy(true);setError('');return {controller,active:()=>current.current.mounted&&!current.current.disabled&&current.current.key===key&&!controller.signal.aborted&&generation.current===sequence&&pending.current===controller,finish:()=>{if(pending.current===controller){pending.current=null;if(current.current.mounted)setBusy(false);}}};}
  async function persist(attempt:SingleReceiptSaveAttempt,task:ReturnType<typeof begin>){
    if(!task.active()||receiptAttempt.current!==attempt)return;
    try{
      const record=await saveSingleReceiptObservation(attempt,task.controller.signal,fetch);if(!task.active()||receiptAttempt.current!==attempt)return;
      historyPending.current?.abort();historyPending.current=null;setHistoryLoading(false);
      setHistory(previous=>[record,...previous.filter(row=>row.requestId!==record.requestId||row.docId!==record.docId)]);
      receiptAttempt.current=null;setSaveAttempt(null);setSaveError('');setHistoryError('');
      try{current.current.onReceiptSaved?.();}catch{/* Receipt storage is already confirmed; a list refresh cannot turn it into a failed save. */}
    }catch(cause){if(task.active()&&receiptAttempt.current===attempt){
      if(cause instanceof SingleDocumentBridgeError&&cause.code==='SINGLE_RECEIPT_ACCOUNT'){invalidate(cause.message);return;}
      setSaveError(cause instanceof Error?cause.message:'확인 결과를 보관하지 못했습니다.');
    }}
  }
  async function retrySave(){
    if(!canEnter())return;const attempt=receiptAttempt.current,connected=latest.current.session;
    if(!attempt||!connected||attempt.packet.requestId!==connected.packet.requestId||attempt.observation!==saveAttempt?.observation)return;
    const task=begin();try{await persist(attempt,task);}finally{task.finish();}
  }
  async function read(prepare=false){
    if(!canEnter())return;const saved=latest.current.data;
    if(prepare&&(!saved||!saved.review.canPrepare||saved.prepared||!singlePackageCurrent(saved,current.current.view,productId)))return;
    const task=begin();
    try{
      const url=`/api/products/${encodeURIComponent(productId)}/supplier-hub-single-package${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`;
      const response=await fetch(url,{cache:'no-store',signal:task.controller.signal,...(prepare?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'prepare',expectedFingerprint:saved!.fingerprint})}:{})});
      const result=await response.json() as SinglePackageView&{error?:string};if(!task.active())return;
      if(!response.ok)throw Error(result.error||'개별 견적 자료를 확인하지 못했습니다.');
      if(!singlePackageCurrent(result,current.current.view,productId))throw Error('저장한 상품·카테고리가 바뀌었습니다. 최신 견적 입력을 확인해주세요.');
      latest.current={...latest.current,data:result,session:null,state:null,approved:{},uncertain:false,expired:false};
      setData(result);setSession(null);setState(null);setApproved({});setUncertain(false);setExpired(false);
      if(!result.options.some(row=>row.optionId===latest.current.optionId)){latest.current.optionId='';setOptionId('');}
    }catch(cause){if(task.active()){setData(null);setSession(null);setState(null);setError(cause instanceof Error?cause.message:'개별 견적 자료 확인 실패');latest.current={...latest.current,data:null,session:null,state:null};}}
    finally{task.finish();}
  }
  async function account(task:ReturnType<typeof begin>,selected:SinglePackageView,connected?:SingleDocumentSession){
    const value=await readSingleCatalogContext(task.controller.signal,fetch);if(!task.active())throw Error('현재 작업이 변경되었습니다.');
    if(value.company.code!==selected.company.code||value.company.name!==selected.company.name||connected&&(value.ownerId!==connected.packet.ownerId||value.company.code!==connected.packet.company.code||value.company.name!==connected.packet.company.name)){
      invalidate('현재 회원 회사가 변경되었습니다. 원래 회사의 자료를 다시 확인해주세요.');throw Error('현재 회원 회사가 변경되었습니다.');
    }
    return value;
  }
  async function connect(){
    if(!canEnter())return;const saved=latest.current.data,selected=latest.current.optionId;
    if(!saved?.prepared||!saved.review.canPrepare||!singlePackageCurrent(saved,current.current.view,productId)||saved.options.filter(row=>row.optionId===selected).length!==1||latest.current.session)return;
    const task=begin();
    try{
      const member=await account(task,saved),packet=await singlePackagePacket(saved,member.ownerId,selected);if(!task.active())return;
      const result=await previewSingleDocument(packet,task.controller.signal);if(!task.active())return;
      const after=await account(task,saved);if(member.ownerId!==after.ownerId){invalidate('현재 로그인 계정이 변경되었습니다. 자료를 다시 확인해주세요.');return;}
      if(!task.active())return;latest.current={...latest.current,session:result};setSession(result);
    }catch(cause){if(task.active())setError(cause instanceof Error?cause.message:'개별 전송 자료 확인 실패');}
    finally{task.finish();}
  }
  async function operate(action:SingleDocumentAction,expectedChallengeId?:string){
    if(!canEnter())return;const before=latest.current,connected=before.session,saved=before.data;
    if(!connected||connected.preview.liveVerified!==true||!saved||!singlePackageCurrent(saved,current.current.view,productId)||connected.packet.optionId!==before.optionId)return;
    if(before.uncertain&&action!=='recover'||action==='recover'&&!before.uncertain&&!before.expired||action==='start'&&(before.state!==null||before.uncertain)
      ||action==='confirm'&&(before.expired||!before.state?.challenge||before.state.challenge.id!==expectedChallengeId)
      ||action==='resume'&&(!before.state||['pending','accepted','rejected','registered','scope-blocked'].includes(before.state.state)))return;
    let confirmation;
    if(action==='confirm'){
      try{confirmation=singleConsentConfirmation(before.state!.challenge!,Object.entries(before.approved).filter(([,value])=>value).map(([name])=>name));}
      catch(cause){setError(cause instanceof Error?cause.message:'필수 동의를 확인해주세요.');return;}
    }
    const task=begin();let dispatched=false;
    try{
      await account(task,saved,connected);if(!task.active()||latest.current.session!==connected)return;
      dispatched=true;const result=await runSingleDocument(connected,action,task.controller.signal,confirmation);if(!task.active())return;
      await account(task,saved,connected);if(!task.active()||latest.current.session!==connected)return;
      verifySingleDocumentObservation(before.state,result);
      latest.current={...latest.current,state:result,approved:{},uncertain:result.needsRecovery,expired:false};
      setState(result);setApproved({});setUncertain(result.needsRecovery);setExpired(false);
      if(result.error)setError(result.error.message);
      const attempt=singleReceiptSaveAttempt(connected,result);
      if(attempt){receiptAttempt.current=attempt;setSaveAttempt(attempt);setSaveError('');await persist(attempt,task);}
    }catch(cause){if(task.active()){
      const missing=dispatched&&(cause instanceof SingleDocumentBridgeError?cause.uncertain:true);
      if(missing){latest.current={...latest.current,uncertain:true,approved:{}};setUncertain(true);setApproved({});}
      setError(cause instanceof Error?cause.message:'개별 견적 응답 확인 실패');
    }}finally{task.finish();}
  }
  const challenge=state?.challenge,required=challenge?.items.filter(item=>item.required)??[],canConfirm=Boolean(session?.preview.liveVerified&&challenge&&!expired&&!uncertain&&required.every(item=>approved[item.key]));
  return <section className="quotation-fields-notice" aria-label="개별 견적서 전송 자료" aria-busy={busy||historyLoading}>
    <div className="quote-actions"><button type="button" className="btn ghost" disabled={disabled||busy||Boolean(session)} onClick={()=>void read()}>개별 견적 자료 검토</button>
      <button type="button" className="btn primary" disabled={disabled||busy||!data?.review.canPrepare||data.prepared||Boolean(session)} onClick={()=>void read(true)}>이미지 전송 자료 준비</button></div>
    {error&&<p role="alert">{error}</p>}
    <section aria-label="보관된 개별 등록 파일 확인 이력"><h4>보관된 등록 파일 확인 이력</h4>
      {historyLoading&&<p role="status">확인 이력을 불러오는 중입니다.</p>}
      {historyError&&<p role="alert">{historyError}</p>}
      {!historyLoading&&!historyError&&!history.length&&<p>보관된 확인 결과가 없습니다.</p>}
      {history.map((row,index)=>{
        const sameVersion=row.source.productVersion===view.productVersion&&row.source.contentRevision===view.contentRevision&&row.source.optionRevision===view.optionRevision
          &&row.source.quotationRevision===view.revision&&row.profileId===view.categoryContext.profileId&&row.categoryId===view.categoryContext.categoryId;
        const label=sameVersion?view.resolved.rows.find(option=>option.optionId===row.optionId)?.optionLabel:undefined;
        const optionLabel=!sameVersion?'이전 옵션 전송 기록':typeof label==='string'&&label.trim()&&label.trim()!==row.optionId?label:'옵션 전송 기록';
        const observedIso=new Date(row.receipt.observedAt).toISOString();
        return <article key={`${row.requestId}:${String(row.docId)}:${index}`}><p>{row.company.name} · {optionLabel} · {sameVersion?'현재 상품 저장 버전':'이전 상품 저장 버전'}</p>
          <p>{({SUBMITTED:'접수 처리 중',FINISHED:'등록 파일 처리 완료 · SKU 확인 전',REJECTED:'반려'})[row.receipt.sourceStatus]}</p>
          <dl><dt>문서 ID</dt><dd>{String(row.docId)}</dd><dt>등록 파일 ID</dt><dd>{String(row.receipt.qvtRequestId)}</dd><dt>확인 시각</dt><dd><time dateTime={observedIso}>{new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(row.receipt.observedAt)}</time></dd></dl>
          {row.receipt.sourceStatus==='REJECTED'&&<p>반려 상세는 Supplier Hub에서 확인해주세요.</p>}
        </article>;
      })}
      {history.length>0&&<p>보관된 결과는 확인 이력입니다. 새 동의나 등록 요청을 실행하지 않습니다.</p>}
    </section>
    {saveError&&<section aria-label="확인 결과 저장 안내"><p role="alert">{saveError} 확인한 등록 파일 결과는 화면에 유지했습니다.</p>
      <button type="button" className="btn ghost" disabled={disabled||busy||!saveAttempt} onClick={()=>void retrySave()}>확인 결과 저장 다시 시도</button></section>}
    {data&&<><p>{data.company.name} · {data.payload.categoryPath} · 포함 옵션 {data.options.length}개</p>
      <p>{data.prepared?'저장한 값과 이미지 파일의 전송 자료가 준비됐습니다.':'저장한 값과 이미지 파일을 확인한 뒤 자료를 준비하세요.'} {state?.state==='registered'?'해당 문서의 접수·SKU 증거를 확인했습니다.':'이 자료 준비만으로 Supplier Hub 접수가 완료되는 것은 아닙니다.'}</p>
      {data.review.issues.length>0&&<ul>{data.review.issues.map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>}
      <div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션</th><th>대표·추가·상세·사이즈표·표시사항 이미지</th></tr></thead><tbody>{data.options.map(option=><tr key={option.optionId??'common'}><td>{option.optionLabel}</td><td>{data.manifest.filter(item=>item.optionId===option.optionId).map(item=>`${({main:'대표',additional:'추가',detail:'상세',label:'표시사항',size:'사이즈표'})[item.role as 'main']??item.role} ${item.files.length}개`).join(' · ')}</td></tr>)}</tbody></table></div>
      {data.prepared&&<div className="quote-actions"><label className="field"><span>개별 전송 옵션</span><select aria-label="개별 전송 옵션" value={optionId} disabled={disabled||busy||Boolean(session)} onChange={event=>{if(!canEnter()||latest.current.session)return;latest.current.optionId=event.target.value;setOptionId(event.target.value);}}><option value="">옵션 1개를 선택하세요</option>{data.options.filter(option=>typeof option.optionId==='string').map(option=><option key={option.optionId!} value={option.optionId!}>{option.optionLabel}</option>)}</select></label>
        <button type="button" className="btn ghost" disabled={disabled||busy||!optionId||Boolean(session)} onClick={()=>void connect()}>개별 전송 자료 확인</button></div>}
    </>}
    {session&&session.preview.liveVerified!==true&&<p role="status">개별 문서의 실제 등록 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.</p>}
    {session?.preview.liveVerified===true&&<>
      {!state&&!uncertain&&<button type="button" className="btn primary" disabled={disabled||busy} onClick={()=>void operate('start')}>선택 옵션의 개별 견적 등록 시작</button>}
      {uncertain&&<><p role="status">요청 결과가 확정되지 않았습니다. 같은 요청을 다시 보내지 말고 저장 결과를 확인하세요.</p><button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void operate('recover')}>개별 요청 저장 결과 확인</button></>}
      {state&&!uncertain&&['pending','accepted','rejected','registered'].includes(state.state)&&<section aria-label="개별 등록 파일 처리 결과">
        <p role="status">{({pending:'접수 처리 중',accepted:'등록 파일 처리 완료 · SKU 확인 전',rejected:'반려',registered:'견적서 접수·SKU 확인'})[state.state as 'pending']}</p>
        <dl><dt>문서 ID</dt><dd>{String(state.docId)}</dd>{state.receipt?.qvtRequestId!==undefined&&<><dt>등록 파일 ID</dt><dd>{String(state.receipt.qvtRequestId)}</dd></>}</dl>
        {state.state==='rejected'&&<p>반려 상세는 Supplier Hub에서 확인해주세요.</p>}
      </section>}
      {state&&!uncertain&&!['pending','accepted','rejected','registered','scope-blocked'].includes(state.state)&&(!challenge||expired)&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void operate(expired?'recover':'resume')}>{expired?'동의 내용 다시 확인':'개별 견적 단계 계속 확인'}</button>}
      {state&&!uncertain&&['pending','accepted','registered'].includes(state.state)&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void operate('observe')}>개별 접수 결과 조회</button>}
      {challenge&&<section aria-label="현재 문서의 단계별 동의"><h4>{challenge.stage?stages[challenge.stage]:'최종 제출'} 동의 확인</h4><p>문서 {String(challenge.docId)} · 이 단계의 내용을 확인한 뒤 진행하세요.</p>
        {challenge.items.map(item=><article key={item.key}>{item.title&&<h5>{item.title}</h5>}<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.text}</p>{item.termsText&&<div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.termsText}</div>}
          {item.required&&<label><input type="checkbox" checked={Boolean(approved[item.key])} disabled={disabled||busy||expired||uncertain} onChange={event=>{if(!canEnter()||latest.current.expired||latest.current.uncertain||latest.current.state?.challenge?.id!==challenge.id)return;const next={...latest.current.approved,[item.key]:event.target.checked};latest.current.approved=next;setApproved(next);}}/>위 필수 동의 내용을 확인했습니다.</label>}</article>)}
        {!challenge.items.length&&<p>앞선 단계의 동의를 완료한 문서입니다. 최종 제출을 직접 확인해주세요.</p>}
        <button type="button" className="btn primary" disabled={disabled||busy||!canConfirm} onClick={()=>void operate('confirm',challenge.id)}>{challenge.stage==='productPage'||challenge.stage==='imagePage'?'현재 단계 동의 확인 · 계속':'현재 문서 최종 제출 확인'}</button>
      </section>}
    </>}
  </section>;
}
