'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {SourceInboxItem} from '@/app/source-inbox';
import type {PageSource} from '@/extensions/supplier-hub/page-source.mjs';
import {validateReviewedSourceTransition} from '@/app/source-review-intake';

function sourceReviewState(item:SourceInboxItem){
 const source=structuredClone(item.reviewed??item.snapshot);
 const reviewed=new Map(item.reviewed?.options.map(option=>[option.key,option]));
 // Excluding an option only changes its selection. Keep every observed option
 // available, and restore saved edits by its immutable key rather than index.
 source.options=item.snapshot.options.map(option=>structuredClone(reviewed.get(option.key)??option));
 return {item,source,selected:(item.reviewed??item.snapshot).options.map(option=>option.key)};
}

function flushExtension(signal:AbortSignal):Promise<{ok:boolean;pending?:number;error?:string;errors?:string[]}>{
 return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(Error('작업을 취소했습니다.'));};
  const receive=(event:MessageEvent)=>{if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='YOOFAM_SOURCE_INBOX_RESULT'||event.data.requestId!==requestId)return;cleanup();resolve(event.data.result);};
  const timer=setTimeout(()=>{cleanup();resolve({ok:false,error:'확장 보관본을 불러오지 못했습니다. 최신 확장이 적용된 같은 Chrome 창에서 열어주세요.'});},20000);
  if(signal.aborted){abort();return;}window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
  window.postMessage({channel:'YOOFAM_SOURCE_INBOX',type:'FLUSH',requestId},location.origin);
 });
}
export function SourceInboxPanel({ownerId,disabled,onAdd,initialItem,onChanged,onReviewed}:{ownerId?:string;disabled:boolean;onAdd:(item:SourceInboxItem)=>void;initialItem?:SourceInboxItem;onChanged?:()=>void;onReviewed?:(saved:SourceInboxItem,before:SourceInboxItem)=>void}){
 const [items,setItems]=useState<SourceInboxItem[]>(initialItem?[initialItem]:[]),[loaded,setLoaded]=useState(!!initialItem),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[review,setReview]=useState<{item:SourceInboxItem;source:PageSource;selected:string[]}|null>(initialItem?sourceReviewState(initialItem):null);
 const alive=useRef(true),running=useRef<AbortController|null>(null);
 const scope=useMemo(()=>({ownerId}),[ownerId]),current=useRef({ownerId,review,scope});
 useLayoutEffect(()=>{current.current={ownerId,review,scope};},[ownerId,review,scope]);
 const expanded=useRef(false),reload=useRef<()=>void>(()=>{});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;running.current?.abort();};},[]);
 async function load(flush=false){
  if(running.current||!ownerId)return;const controller=new AbortController();running.current=controller;setBusy(true);setMessage('');
  try{
   let notice='';if(flush){const result=await flushExtension(controller.signal);if(!result?.ok)notice=result?.error||'확장 보관본을 확인해주세요.';else if(result.pending)notice=result.errors?.[0]||'일부 상품은 확장 보관함에 남아 있습니다.';}
   const response=await fetch('/api/source-inbox',{cache:'no-store',signal:controller.signal,redirect:'error'}),body=await response.json() as {ownerId?:string;error?:string;items?:SourceInboxItem[]};
   if(controller.signal.aborted||!alive.current)return;
   if(!response.ok||body.ownerId!==ownerId||!Array.isArray(body.items))throw Error(body.error||'현재 회원의 수집함을 확인하지 못했습니다.');
   setItems(body.items);setLoaded(true);setMessage(notice);
  }catch(error){if(!controller.signal.aborted&&alive.current)setMessage(error instanceof Error?error.message:'수집함 조회 실패');}
  finally{if(running.current===controller){running.current=null;if(alive.current)setBusy(false);}}
 }
 async function saveReview(){
  if(!review||running.current||!ownerId||!alive.current||current.current.ownerId!==ownerId||current.current.scope!==scope||current.current.review!==review)return;const controller=new AbortController(),before=review.item;running.current=controller;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/source-inbox',{method:'PUT',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:ownerId,id:review.item.id,expectedRevision:review.item.revision,review:{title:review.source.title,options:review.source.options.filter(row=>review.selected.includes(row.key)).map(row=>({key:row.key,name:row.name,supplierSku:row.supplierSku,unitPriceCny:row.unitPriceCny,currency:row.currency,minimumOrder:row.minimumOrder}))}})}),body=await response.json() as {ownerId?:string;error?:string;item?:SourceInboxItem};
   if(controller.signal.aborted||!alive.current||current.current.ownerId!==ownerId||current.current.scope!==scope||current.current.review!==review)return;
   if(!response.ok||body.ownerId!==ownerId||!body.item||!validateReviewedSourceTransition(before,body.item,ownerId))throw Error(body.error||'상품 검토 저장을 확인하지 못했습니다.');
   const saved=body.item;setItems(previous=>previous.map(item=>item.id===saved.id?saved:item));setReview(null);setMessage('검토한 상품정보를 저장했습니다. 카테고리를 선택해 초안을 작성하세요.');onReviewed?.(saved,before);onChanged?.();
  }catch(error){if(!controller.signal.aborted&&alive.current&&current.current.ownerId===ownerId&&current.current.scope===scope)setMessage(error instanceof Error?error.message:'상품 검토 저장 실패');}
  finally{if(running.current===controller){running.current=null;if(alive.current)setBusy(false);}}
 }
 async function archive(item:SourceInboxItem){
  if(running.current||!ownerId)return;const controller=new AbortController();running.current=controller;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/source-inbox',{method:'DELETE',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:ownerId,id:item.id,expectedRevision:item.revision})}),body=await response.json() as {ownerId?:string;id?:string;archived?:boolean;error?:string};
   if(controller.signal.aborted||!alive.current)return;
   if(!response.ok||body.ownerId!==ownerId||body.id!==item.id||body.archived!==true)throw Error(body.error||'수집함 제외 결과를 확인하지 못했습니다.');
   onChanged?.();setItems(previous=>previous.filter(value=>value.id!==item.id));setReview(previous=>previous?.item.id===item.id?null:previous);setMessage('수집함 목록에서 제외했습니다. 원문과 작업 상품은 유지됩니다. 다시 수집하면 목록에 복원됩니다.');
  }catch(error){if(!controller.signal.aborted&&alive.current)setMessage(error instanceof Error?error.message:'수집함 제외 실패');}
  finally{if(running.current===controller){running.current=null;if(alive.current)setBusy(false);}}
 }
 function editOption(index:number,patch:Partial<PageSource['options'][number]>){setReview(previous=>previous?{...previous,source:{...previous.source,options:previous.source.options.map((row,i)=>i===index?{...row,...patch}:row)}}:null);}
 useEffect(()=>{reload.current=()=>{if(expanded.current&&loaded&&!running.current)void load();};});
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.source===window&&event.origin===location.origin&&event.data?.channel==='YOOFAM_SOURCE_INBOX_UPDATED')reload.current();};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
 return <details open={initialItem?true:undefined} className="collection-panel source-inbox" onToggle={event=>{expanded.current=event.currentTarget.open;if(event.currentTarget.open&&!loaded&&!busy)void load();}}>
  <summary>1688 수집함{loaded?` · ${items.length}건`:''}</summary>
  <div className="collection-heading"><div><h2>1688에서 담은 상품</h2><p>상품 본문의 ‘YOOFAM 스튜디오 상품 수집’을 누르면 이 회원의 수집함에 보관됩니다. 사용할 수집본을 확인하고 카테고리를 선택한 뒤 각 단계에서 수정하세요.</p><small>최근 수집본 최대 40개를 표시합니다. 다시 수집한 자료는 별도로 보관하며 기존 작업 상품과 이전 검토값을 바꾸지 않습니다.</small></div><button type="button" className="btn ghost" disabled={busy||!ownerId} onClick={()=>void load(true)}>{busy?'불러오는 중…':'수집함 불러오기'}</button></div>
  <p className="collection-notice"><a href="/downloads/yoofam-plus-supplier-hub-extension-2.1.21.zip" download>판매량·상품 수집 통합 확장 2.1.21 다운로드</a> · YOOFAM 스튜디오와 1688 상품을 같은 Chrome 창에서 열어주세요.</p>
  {message&&<p role="status">{message}</p>}
  {loaded&&!items.length&&<p>아직 담은 상품이 없습니다.</p>}
  <ul className="collection-list">{items.map(item=><li key={item.id}><div><strong>{item.reviewed?.title??item.snapshot.title}</strong><small>{item.company.name} · 상품 {item.snapshot.offerId} · 옵션 {item.snapshot.options.length}개 · 이미지 {item.snapshot.images.length}개</small><small>수집본 {item.captureVersion??1}{typeof item.receivedAt==='string'&&Number.isFinite(Date.parse(item.receivedAt))&&<> · <time dateTime={item.receivedAt}>{new Date(item.receivedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time></>}</small><small>{item.issues.length?`확인 필요: ${item.issues.join(' · ')}`:'상품정보 준비됨 · 견적서 전송 전 검토 필요'}</small>{item.warnings?.map((warning,index)=><small key={index} className="collection-notice">{warning}</small>)}</div><button type="button" className="btn ghost" disabled={busy||disabled} onClick={()=>{setReview(sourceReviewState(item));setMessage('');}}>상품정보 확인</button><button type="button" className="btn primary" disabled={busy||disabled} onClick={()=>{try{onAdd(item);}catch(error){setMessage(error instanceof Error?error.message:'상품 추가 실패');}}}>카테고리 선택·초안 작성</button><button type="button" className="btn ghost" disabled={busy||disabled} onClick={()=>void archive(item)}>수집함에서 제외</button></li>)}</ul>
  {review&&<section className="source-inbox-review" aria-label="수집 상품정보 검토"><h3>수집 상품정보 확인</h3><p>공급자 SKU·위안 원가·통화는 원문에서 확인한 값을 입력하세요. 확인되지 않은 값은 임의로 채우지 않습니다. 최소 주문 수량은 미확인이면 공란으로 두고 초안을 작성할 수 있습니다. 공급자 SKU도 미확인이면 공란으로 보관하고 수집한 옵션별로 구분합니다. 초안 작성 후 가격 설정에서 확인하세요. 원본과 검토본은 따로 보관합니다.</p>
   <label>상품명<input value={review.source.title} maxLength={500} disabled={busy} onChange={event=>setReview(previous=>previous?{...previous,source:{...previous.source,title:event.target.value}}:null)}/></label>
   <div className="source-inbox-table"><table><thead><tr><th>사용</th><th>옵션명</th><th>공급자 SKU</th><th>원가</th><th>통화</th><th>최소 주문 수량</th></tr></thead><tbody>{review.source.options.map((row,index)=><tr key={row.key}>
    <td><input type="checkbox" aria-label={`${index+1}번째 수집 옵션 사용`} checked={review.selected.includes(row.key)} disabled={busy} onChange={event=>setReview(previous=>previous?{...previous,selected:event.target.checked?[...previous.selected,row.key]:previous.selected.filter(key=>key!==row.key)}:null)}/></td>
    <td><input aria-label={`${index+1}번째 옵션명`} value={row.name} maxLength={500} disabled={busy} onChange={event=>editOption(index,{name:event.target.value})}/></td>
    <td><input aria-label={`${index+1}번째 공급자 SKU`} placeholder="미확인 · 공란 가능" value={row.supplierSku??''} maxLength={200} disabled={busy} onChange={event=>editOption(index,{supplierSku:event.target.value||null})}/><small>원문 옵션 키: {row.key}</small></td>
    <td><input type="number" aria-label={`${index+1}번째 위안 원가`} min="0.001" step="any" value={row.unitPriceCny??''} disabled={busy} onChange={event=>editOption(index,{unitPriceCny:event.target.value===''?null:Number(event.target.value)})}/></td>
    <td><select aria-label={`${index+1}번째 통화`} value={row.currency??''} disabled={busy} onChange={event=>editOption(index,{currency:event.target.value==='CNY'?'CNY':null})}><option value="">확인 필요</option><option value="CNY">위안(CNY)</option></select></td>
    <td><input type="number" aria-label={`${index+1}번째 최소 주문 수량`} placeholder="미확인 · 공란 가능" min="1" step="1" value={row.minimumOrder??''} disabled={busy} onChange={event=>editOption(index,{minimumOrder:event.target.value===''?null:Number(event.target.value)})}/><small>공란은 미확인으로 보관합니다.</small></td>
   </tr>)}</tbody></table></div>
   {!review.source.options.length&&<p>옵션 원문이 없어 초안 작성을 시작할 수 없습니다. 옵션이 표시된 상품 본문에서 수집해야 합니다.</p>}
   <button type="button" className="btn primary" disabled={busy||!review.selected.length} onClick={()=>void saveReview()}>검토한 상품정보 저장</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setReview(null)}>닫기</button>
  </section>}
 </details>;
}
