'use client';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {SupplierHubProductTransport} from '@/app/components/supplier-hub-product-transport';
import {cancelConfiguredProductConsent} from '@/app/supplier-hub-product-client';
import {prepareTransmissionQueueCandidate,refreshTransmissionQueueCandidate,transmissionQueueAttributes,transmissionQueueReceipt,type TransmissionQueueCandidate,type TransmissionQueueTarget} from '@/app/supplier-hub-transmission-queue';
import type {NativeReceiptRecord,ProductReceiptRecord} from '@/app/supplier-hub-product-receipt';

type Props={products:(TransmissionQueueTarget&{updated_at?:string})[];profileId?:string;expectedCategoryId?:string;onLockChange:(source:boolean,close?:boolean)=>void;onReceiptSaved?:()=>void;onInspect?:(productId:string)=>void};
type Row={productId:string;candidate?:TransmissionQueueCandidate;error?:string};
type Run={context:object;token:object;candidates:TransmissionQueueCandidate[];index:number;active:boolean;stopped:boolean;receipts:ProductReceiptRecord[]};
export function SupplierHubTransmissionQueue(props:Props){
 const productsKey=JSON.stringify(props.products.map(({id,title,updated_at})=>({id,title,updated_at}))),products=useMemo(()=>JSON.parse(productsKey) as Props['products'],[productsKey]);
 const context=useMemo(()=>({products,profileId:props.profileId,expectedCategoryId:props.expectedCategoryId}),[products,props.profileId,props.expectedCategoryId]),live=useRef<{context:object|null;props:Props}>({context,props}),pending=useRef<AbortController|null>(null);
 const [snapshot,setSnapshot]=useState<{context:object;rows:Row[];finished:boolean}|null>(null),[run,setRun]=useState<Run|null>(null),runRef=useRef<Run|null>(null);
 const childLock=useRef({source:false,close:false});
 const reportLock=useCallback(()=>{if(live.current.context!==context)return;const value=runRef.current,scheduling=value?.context===context&&!value.stopped&&(value.active||value.index<value.candidates.length);
  live.current.props.onLockChange(Boolean(scheduling||childLock.current.source),Boolean(scheduling||childLock.current.close));
 },[context]);
 useLayoutEffect(()=>{live.current.props=props;});
 useLayoutEffect(()=>{const lifetime=live.current;lifetime.context=context;runRef.current=null;childLock.current={source:false,close:false};reportLock();return()=>{
  if(lifetime.context!==context)return;lifetime.context=null;pending.current?.abort();pending.current=null;
  const value=runRef.current;if(value?.context===context)for(const candidate of value.candidates)cancelConfiguredProductConsent(candidate.session.packet.requestId);
  runRef.current=null;lifetime.props.onLockChange(false,false);
 };},[context,reportLock]);
 useEffect(()=>{
  const controller=new AbortController();pending.current=controller;
  const active=()=>live.current.context===context&&pending.current===controller&&!controller.signal.aborted;
  void(async()=>{
   const products=context.products,rows:Row[]=[];
   if(!products.length||products.length>100||new Set(products.map(product=>product.id)).size!==products.length){if(active())setSnapshot({context,rows:products.map(product=>({productId:product.id,error:'서로 다른 상품을 1~100개 선택해주세요.'})),finished:true});return;}
   for(const product of products){
    try{const candidate=await prepareTransmissionQueueCandidate({...product,expectedCategoryId:context.expectedCategoryId},context.profileId,controller.signal);if(!active())return;rows.push({productId:product.id,candidate});}
    catch(cause){if(!active())return;rows.push({productId:product.id,error:cause instanceof Error?cause.message:'저장한 전송 자료를 확인하지 못했습니다.'});}
    if(active())setSnapshot({context,rows:[...rows],finished:false});
   }
   if(active())setSnapshot({context,rows,finished:true});
  })();
  return()=>{controller.abort();if(pending.current===controller)pending.current=null;};
 },[context]);
 const rows=snapshot?.context===context?snapshot.rows:[],loading=snapshot?.context!==context||!snapshot.finished,currentRun=run?.context===context?run:null;
 const candidates=rows.flatMap(row=>row.candidate?[row.candidate]:[]),remaining=currentRun?currentRun.candidates.slice(currentRun.index):candidates;
 let attributes:ReturnType<typeof transmissionQueueAttributes>|undefined,readinessError='';
 if(!loading&&remaining.length)try{attributes=transmissionQueueAttributes(remaining);}catch(cause){readinessError=cause instanceof Error?cause.message:'같은 회원 회사의 전송 자료를 다시 확인해주세요.';}
 const activeCandidate=currentRun?.active?currentRun.candidates[currentRun.index]:null;
 const runToken=currentRun?.token,queuedStart=useMemo(()=>activeCandidate&&runToken?{session:activeCandidate.session,token:runToken}:undefined,[activeCandidate,runToken]);
 function start(){
  if(live.current.context!==context||runRef.current!==currentRun||loading||!attributes||readinessError||runRef.current?.context===context&&runRef.current.active||!remaining.length)return;
  const previous=runRef.current,value:Run={context,token:{},candidates:remaining,index:0,active:true,stopped:false,receipts:previous?.context===context?previous.receipts:[]};
  runRef.current=value;childLock.current={source:false,close:false};setRun(value);reportLock();
 }
 function stop(){
  const value=runRef.current;if(live.current.context!==context||value!==currentRun||value?.context!==context||value.stopped)return;
  for(const candidate of value.candidates.slice(value.index+1))cancelConfiguredProductConsent(candidate.session.packet.requestId);
  const next={...value,stopped:true};runRef.current=next;setRun(next);reportLock();
 }
 function saved(candidate:TransmissionQueueCandidate,token:object,record?:NativeReceiptRecord){
  const value=runRef.current;if(live.current.context!==context||value?.context!==context||value.token!==token||!value.active||value.candidates[value.index]!==candidate)return;
  if(record?.format==='yoofam-product-document-receipt-v1'&&record.requestId===candidate.session.packet.requestId&&record.productId===candidate.productId&&record.receipt.state==='pending'){
   try{live.current.props.onReceiptSaved?.();}catch{/* The original pending result is already stored. */}return;
  }
  const receipt=transmissionQueueReceipt(candidate,record);if(!receipt)return;
  const index=value.index+1,next={...value,index,active:!value.stopped&&index<value.candidates.length,receipts:[...value.receipts,receipt]};
  runRef.current=next;childLock.current={source:false,close:false};setRun(next);reportLock();
  try{live.current.props.onReceiptSaved?.();}catch{/* Stored terminal receipt remains confirmed. */}
 }
 return <section className="panel-stack" aria-label="선택 상품 순차 전송" aria-busy={loading}>
  <h3>선택 상품 순차 전송</h3><p>기존 전송 이력이 없는 상품의 견적서·첨부 파일을 확인합니다. 한 상품의 완료·반려 결과를 보관한 뒤 다음 상품을 진행합니다.</p>
  <p>통합 확장 2.1.92에서 저장된 동의가 현재 회원·회사·약관과 일치하면 자동 적용합니다. 새로 확인할 동의는 해당 문서에서 직접 확인해주세요.</p>
  {loading&&<p role="status">전송 자료 확인 중 · {rows.length}/{props.products.length}건 · 전송은 시작하지 않았습니다.</p>}
  {readinessError&&<p role="alert">{readinessError}</p>}
  <div className="quote-actions">{!currentRun?.active&&<button type="button" className="btn rose" {...attributes} disabled={loading||!attributes||!!readinessError} onClick={start}>{currentRun?.receipts.length?'남은 상품 등록전송 시작':'선택 상품 등록전송 시작'}</button>}
   {currentRun?.active&&!currentRun.stopped&&<button type="button" className="btn ghost" onClick={stop}>다음 상품부터 중지</button>}</div>
  {currentRun&&<p role="status">결과 보관 {currentRun.receipts.length}건 · {currentRun.active?`현재 상품 ${currentRun.index+1}/${currentRun.candidates.length} 확인 중`:remaining.length?'남은 상품은 시작 버튼을 눌러 진행합니다.':'선택 상품 전송 확인을 마쳤습니다.'}{currentRun.stopped?' · 다음 상품 진행 중지':''}</p>}
  <ol>{props.products.map(product=>{const row=rows.find(row=>row.productId===product.id),receipt=currentRun?.receipts.find(record=>record.productId===product.id);return <li key={product.id}><strong>{product.title}</strong> · {receipt?receipt.receipt.state==='accepted'?'파일 처리 완료 · SKU 확인 전':'파일 반려':row?.error??(activeCandidate?.productId===product.id?'현재 문서 진행 중':row?.candidate?'전송 자료 확인 완료':'자료 확인 대기')}
   {row?.error&&props.onInspect&&<button type="button" className="quotation-field-text-button" disabled={Boolean(currentRun?.active)} onClick={()=>{if(live.current.context===context&&!runRef.current?.active)live.current.props.onInspect?.(product.id);}}>견적서 수정하기</button>}</li>;})}</ol>
  {activeCandidate&&currentRun&&<SupplierHubProductTransport key={activeCandidate.session.packet.requestId} review={activeCandidate.review} disabled={false} queuedStart={queuedStart}
   refresh={signal=>refreshTransmissionQueueCandidate(activeCandidate,signal)} onLockChange={(source,close=source)=>{const value=runRef.current;if(live.current.context!==context||value?.token!==currentRun.token||value.candidates[value.index]!==activeCandidate)return;childLock.current={source,close};reportLock();}}
   onReceiptSaved={record=>saved(activeCandidate,currentRun.token,record)}/>}
 </section>;
}
