'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import type {NativeAssetSourcePlan} from '@/app/native-asset-source-plan';
import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import {readCurrentNativeAssetSource,reviewCurrentNativeSupplierHubProductDocument} from '@/app/supplier-hub-native-product-document';
import {SupplierHubProductTransport} from '@/app/components/supplier-hub-product-transport';

type Props={productId:string;profileId?:string;view:QuotationFieldsView;disabled:boolean;onReceiptSaved?:()=>void;onLockChange?:(locked:boolean)=>void};
const roles={MAIN:'대표',ADDITIONAL:'추가',SIZECHART:'사이즈표',LABEL:'표시사항',DETAIL:'상세'};
const text=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value):'';
const node=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function SupplierHubNativeSourceReview(props:Props){
 const key=JSON.stringify([props.productId,props.profileId??null,props.view.productVersion,props.view.contentRevision,props.view.optionRevision,props.view.revision,props.view.inputFingerprint,props.disabled]);
 return <NativeSourceScope key={key} {...props}/>;
}
/** A file-native review has its own immutable body and source fingerprint. No
 * public-URL prepare POST or source collection is triggered by entering it. */
function NativeSourceScope(props:Props){
 const {productId,profileId,disabled,onReceiptSaved,onLockChange}=props;
 const [plan,setPlan]=useState<NativeAssetSourcePlan|null>(null),planRef=useRef<NativeAssetSourcePlan|null>(null);
 const [review,setReview]=useState<SupplierHubProductDocumentReview|null>(null),reviewRef=useRef<SupplierHubProductDocumentReview|null>(null);
 const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),lockRef=useRef(false),[error,setError]=useState('');
 const current=useRef({props,mounted:true}),pending=useRef<AbortController|null>(null);
 useLayoutEffect(()=>{current.current={props,mounted:true};});
 const lockCallback=useRef(onLockChange);useLayoutEffect(()=>{lockCallback.current=onLockChange;},[onLockChange]);
 useLayoutEffect(()=>{onLockChange?.(busy||locked);},[busy,locked,onLockChange]);
 useLayoutEffect(()=>()=>{current.current.mounted=false;pending.current?.abort();pending.current=null;lockCallback.current?.(false);},[]);
 const transportLock=useCallback((value:boolean)=>{lockRef.current=value;setLocked(value);},[]);
 const allowed=()=>current.current.mounted&&!current.current.props.disabled&&!pending.current&&!lockRef.current;
 function begin(){const controller=new AbortController();pending.current=controller;setBusy(true);setError('');return{controller,active:()=>current.current.mounted&&!current.current.props.disabled&&pending.current===controller&&!controller.signal.aborted,
  finish:()=>{if(pending.current===controller){pending.current=null;if(current.current.mounted)setBusy(false);}}};}
 async function load(){
  if(!allowed())return;const task=begin();reviewRef.current=null;setReview(null);
  try{const value=await readCurrentNativeAssetSource({productId,profileId,quotationView:current.current.props.view,signal:task.controller.signal,fetcher:fetch});if(task.active()){planRef.current=value;setPlan(value);}}
  catch(cause){if(task.active()){planRef.current=null;setPlan(null);setError(cause instanceof Error?cause.message:'현재 견적서 파일을 확인하지 못했습니다.');}}
  finally{task.finish();}
 }
 const readRef=useRef(load);useLayoutEffect(()=>{readRef.current=load;});
 useEffect(()=>{if(!disabled)void readRef.current();},[disabled]);
 async function prepare(){
  const selected=planRef.current;if(!allowed()||!selected?.metadataValid||!selected.sourcePlanSha256||selected.issues.some(issue=>issue.level==='error'))return;
  const task=begin();reviewRef.current=null;setReview(null);
  try{const value=await reviewCurrentNativeSupplierHubProductDocument({productId,profileId,quotationView:current.current.props.view,sourcePlan:selected,signal:task.controller.signal,fetcher:fetch});
   if(task.active()&&planRef.current===selected){reviewRef.current=value;setReview(value);}}
  catch(cause){if(task.active())setError(cause instanceof Error?cause.message:'현재 견적 문서를 확인하지 못했습니다.');}
  finally{task.finish();}
 }
 const errors=plan?.issues.filter(issue=>issue.level==='error')??[],notices=plan?.issues.filter(issue=>issue.level==='review')??[];
 return <section className="quotation-fields-notice" aria-label="상품 견적서 전송 자료" aria-busy={busy}>
  <div className="quote-actions"><button type="button" className="btn ghost" disabled={disabled||busy||locked} onClick={()=>void load()}>저장한 견적 자료 다시 확인</button>
   {!review&&<button type="button" className="btn primary" disabled={disabled||busy||locked||!plan?.metadataValid||errors.length>0} onClick={()=>void prepare()}>견적서·첨부 파일 확인</button>}</div>
  {busy&&<p role="status">현재 저장한 견적서와 첨부 파일을 확인하고 있습니다…</p>}{error&&<p role="alert">{error}</p>}
  {plan?.identity&&<><p>{plan.identity.company.name} · {plan.identity.categoryPath.join(' > ')} · 포함 옵션 {plan.identity.members.length}개</p>
   {errors.length>0&&<ul>{errors.map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>}
   {notices.length>0&&<details><summary>견적서 검토 안내 {notices.length}개</summary><ul>{notices.map((issue,index)=><li key={index}>{issue.message}</li>)}</ul></details>}
   <div className="quotation-fields-bulk-table"><table><caption>옵션별 첨부 파일</caption><thead><tr><th>옵션</th><th>대표·추가·상세·사이즈표·표시사항</th></tr></thead><tbody>{plan.identity.members.map(member=><tr key={member.optionId}><td>{member.optionLabel}</td><td>{Object.entries(roles).map(([type,label])=>{
    const count=plan.images.filter(file=>file.imageType===type&&file.references.some(ref=>ref.optionId===member.optionId&&ref.documentIndex===member.documentIndex)).length;return count?`${label} ${count}개`:null;
   }).filter(Boolean).join(' · ')||'첨부 파일 없음'}</td></tr>)}</tbody></table></div>
   {!!plan.nativeLegalAttachmentPlan?.files.length&&<p>법적 필수서류 원본 {plan.nativeLegalAttachmentPlan.files.length}개</p>}
  </>}
  {review&&plan&&review.identity.fingerprint===plan.sourcePlanSha256&&<section aria-label="포함 옵션 전체 견적 문서"><h4>포함 옵션 {review.members.length}개 · 견적 문서 1개</h4>
   <p>상품명·금액·첨부 파일을 확인한 뒤 등록전송을 진행하세요.</p>
   <div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션</th><th>상품명</th><th>모델명</th><th>공급가</th><th>판매가</th><th>권장소비자가</th></tr></thead><tbody>{review.members.map(member=>{
    const document=review.body.jsonDocument[member.documentIndex],product=node(document.productPage),prices=node(product.commonAttributes);return <tr key={member.optionId}><td>{member.optionLabel}</td><td>{text(node(document.startPage).productName)}</td><td>{text(product.modelNumber)}</td><td>{text(prices.purchasePrice)}</td><td>{text(prices.coupangSalePrice)}</td><td>{text(prices.msrp)}</td></tr>;
   })}</tbody></table></div>
   <SupplierHubProductTransport key={review.reviewDigest} review={review} disabled={disabled||busy} onLockChange={transportLock} onReceiptSaved={onReceiptSaved} refresh={async signal=>{
    if(!current.current.mounted||current.current.props.disabled||reviewRef.current!==review||planRef.current!==plan)throw Error('현재 견적서 검토가 변경되었습니다.');
    return reviewCurrentNativeSupplierHubProductDocument({productId,profileId,quotationView:current.current.props.view,sourcePlan:plan,signal,fetcher:fetch});
   }}/>
   <button type="button" className="btn ghost" disabled={disabled||busy||locked} onClick={()=>{if(!allowed()||reviewRef.current!==review)return;reviewRef.current=null;setReview(null);}}>전체 문서 확인 닫기</button>
  </section>}
 </section>;
}
