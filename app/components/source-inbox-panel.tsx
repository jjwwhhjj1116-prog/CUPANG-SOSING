'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {sourceInboxCaptureSummary,type SourceInboxItem} from '@/app/source-inbox';
import type {PageSource} from '@/extensions/supplier-hub/page-source.mjs';
import {validateReviewedSourceTransition} from '@/app/source-review-intake';
import {sameSourceUrl} from '@/app/source-registration';

function sourceReviewState(item:SourceInboxItem){
 const source=structuredClone(item.reviewed??item.snapshot);
 const reviewed=new Map(item.reviewed?.options.map(option=>[option.key,option]));
 // Excluding an option only changes its selection. Keep every observed option
 // available, and restore saved edits by its immutable key rather than index.
 source.options=item.snapshot.options.map(option=>structuredClone(reviewed.get(option.key)??option));
 return {item,source,selected:(item.reviewed??item.snapshot).options.map(option=>option.key)};
}

const descriptionDiagnostics={
 'not-needed':'현재 본문에 상세이미지가 있어 별도 상세문서 조회가 필요하지 않았습니다.',
 'reference-missing':'현재 상품의 상세문서 주소를 찾지 못했습니다.',
 'reference-invalid':'현재 상품과 일치하는 상세문서 주소를 확인하지 못했습니다.',
 unavailable:'상세문서에서 추가 자료를 확인하지 못했습니다.',
 captured:'연결된 상세문서에서 상세이미지를 수집했습니다.',
};

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
export function SourceInboxPanel({ownerId,disabled,onAdd,initialItem,onChanged,onReviewed,existingProducts=[]}:{ownerId?:string;disabled:boolean;onAdd:(item:SourceInboxItem)=>void;initialItem?:SourceInboxItem;onChanged?:()=>void;onReviewed?:(saved:SourceInboxItem,before:SourceInboxItem)=>void;existingProducts?:readonly {source_url:string}[]}){
 const [items,setItems]=useState<SourceInboxItem[]>(initialItem?[initialItem]:[]),[loaded,setLoaded]=useState(!!initialItem),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[review,setReview]=useState<{item:SourceInboxItem;source:PageSource;selected:string[]}|null>(initialItem?sourceReviewState(initialItem):null);
 const alive=useRef(true),running=useRef<AbortController|null>(null);
 const scope=useMemo(()=>({ownerId}),[ownerId]),current=useRef({ownerId,review,scope});
 useLayoutEffect(()=>{current.current={ownerId,review,scope};},[ownerId,review,scope]);
 const expanded=useRef(false),dirty=useRef(false),reload=useRef<()=>void>(()=>{});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;running.current?.abort();};},[]);
 async function load(flush=false){
  if(running.current||!ownerId||current.current.scope!==scope)return;const controller=new AbortController();running.current=controller;dirty.current=false;setBusy(true);setMessage('');
  const active=()=>!controller.signal.aborted&&alive.current&&current.current.ownerId===ownerId&&current.current.scope===scope;
  const read=async()=>{
   const timer=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetch('/api/source-inbox',{cache:'no-store',signal:controller.signal,redirect:'error'}),body=await response.json().catch(()=>{throw Error('수집함을 불러오지 못했습니다.');}) as {ownerId?:string;error?:string;items?:SourceInboxItem[]};
    if(!active())return false;
    if(!response.ok||body.ownerId!==ownerId||!Array.isArray(body.items)||body.items.some(item=>item.ownerId!==ownerId))throw Error(body.error||'현재 회원의 수집함을 확인하지 못했습니다.');
    setItems(body.items);setLoaded(true);return true;
   }finally{clearTimeout(timer);}
  };
  try{
   // A saved capture is already on the server. Show that read immediately;
   // an absent extension must not delay it behind the 20-second FLUSH wait.
   if(!await read())return;
   if(flush){
    setMessage('서버 수집함을 불러왔습니다. 확장 보관본을 확인하고 있습니다.');
    const result=await flushExtension(controller.signal);if(!active())return;
    if(!result?.ok)setMessage(result?.error||'확장 보관본을 확인해주세요.');
    else{await read();if(active())setMessage(result.pending?result.errors?.[0]||'일부 상품은 확장 보관함에 남아 있습니다.':'서버에 저장된 최신 수집함을 불러왔습니다.');}
   }
  }catch(error){if(alive.current&&current.current.scope===scope)setMessage(controller.signal.aborted?'수집함 응답이 지연되고 있습니다. 이전 목록에 최신 수집본이 없을 수 있습니다. 다시 불러와주세요.':(error instanceof Error?error.message:'수집함 조회 실패')+' 이전 목록에 최신 수집본이 없을 수 있습니다.');}
  finally{if(running.current===controller){running.current=null;if(alive.current&&current.current.scope===scope){setBusy(false);if(dirty.current&&expanded.current)void load();}}}
 }
 async function saveReview(){
  if(!review||running.current||!ownerId||!alive.current||current.current.ownerId!==ownerId||current.current.scope!==scope||current.current.review!==review)return;const controller=new AbortController(),before=review.item;running.current=controller;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/source-inbox',{method:'PUT',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:ownerId,id:review.item.id,expectedRevision:review.item.revision,review:{title:review.source.title,options:review.source.options.filter(row=>review.selected.includes(row.key)).map(row=>({key:row.key,name:row.name,supplierSku:row.supplierSku,unitPriceCny:row.unitPriceCny,currency:row.currency,minimumOrder:row.minimumOrder}))}})}),body=await response.json() as {ownerId?:string;error?:string;item?:SourceInboxItem};
   if(controller.signal.aborted||!alive.current||current.current.ownerId!==ownerId||current.current.scope!==scope||current.current.review!==review)return;
   if(!response.ok||body.ownerId!==ownerId||!body.item||!validateReviewedSourceTransition(before,body.item,ownerId))throw Error(body.error||'상품 검토 저장을 확인하지 못했습니다.');
   const saved=body.item;setItems(previous=>previous.map(item=>item.id===saved.id?saved:item));setReview(null);setMessage('검토한 상품정보를 저장했습니다. 카테고리를 선택해 초안을 작성하세요.');onReviewed?.(saved,before);onChanged?.();
  }catch(error){if(!controller.signal.aborted&&alive.current&&current.current.ownerId===ownerId&&current.current.scope===scope)setMessage(error instanceof Error?error.message:'상품 검토 저장 실패');}
  finally{if(running.current===controller){running.current=null;if(alive.current&&current.current.scope===scope){setBusy(false);if(dirty.current&&expanded.current)void load();}}}
 }
 async function archive(item:SourceInboxItem){
  if(running.current||!ownerId)return;const controller=new AbortController();running.current=controller;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/source-inbox',{method:'DELETE',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:ownerId,id:item.id,expectedRevision:item.revision})}),body=await response.json() as {ownerId?:string;id?:string;archived?:boolean;error?:string};
   if(controller.signal.aborted||!alive.current)return;
   if(!response.ok||body.ownerId!==ownerId||body.id!==item.id||body.archived!==true)throw Error(body.error||'수집함 제외 결과를 확인하지 못했습니다.');
   onChanged?.();setItems(previous=>previous.filter(value=>value.id!==item.id));setReview(previous=>previous?.item.id===item.id?null:previous);setMessage('수집함 목록에서 제외했습니다. 원문과 작업 상품은 유지됩니다. 다시 수집하면 목록에 복원됩니다.');
  }catch(error){if(!controller.signal.aborted&&alive.current)setMessage(error instanceof Error?error.message:'수집함 제외 실패');}
  finally{if(running.current===controller){running.current=null;if(alive.current&&current.current.scope===scope){setBusy(false);if(dirty.current&&expanded.current)void load();}}}
 }
 function editOption(index:number,patch:Partial<PageSource['options'][number]>){setReview(previous=>previous?{...previous,source:{...previous.source,options:previous.source.options.map((row,i)=>i===index?{...row,...patch}:row)}}:null);}
 useEffect(()=>{reload.current=()=>{dirty.current=true;if(expanded.current&&!running.current)void load();};});
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.source===window&&event.origin===location.origin&&event.data?.channel==='YOOFAM_SOURCE_INBOX_UPDATED')reload.current();};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
  const captureSummary=review?sourceInboxCaptureSummary(review.item.snapshot):null;
 return <details open={initialItem?true:undefined} className="collection-panel source-inbox" onToggle={event=>{expanded.current=event.currentTarget.open;if(event.currentTarget.open&&(!loaded||dirty.current)&&!busy)void load();}}>
  <summary>1688 수집함{loaded?` · ${items.length}건`:''}</summary>
  <div className="collection-heading"><div><h2>1688에서 담은 상품</h2><p>상품 본문의 ‘YOOFAM 스튜디오 상품 수집’을 누르면 이 회원의 수집함에 보관됩니다. 사용할 수집본을 확인하고 카테고리를 선택한 뒤 각 단계에서 수정하세요.</p><small>최근 수집본 최대 40개를 표시합니다. 다시 수집한 자료는 별도로 보관하며 기존 작업 상품과 이전 검토값을 바꾸지 않습니다.</small></div><button type="button" className="btn ghost" disabled={busy||!ownerId} onClick={()=>void load(true)}>{busy?'불러오는 중…':'수집함 불러오기'}</button></div>
  <p className="collection-notice"><a href="/downloads/yoofam-plus-supplier-hub-extension-2.1.67.zip" download>판매량·상품 수집 통합 확장 2.1.67 다운로드</a> · YOOFAM 스튜디오와 1688 상품을 같은 Chrome 창에서 열어주세요.</p>
  {message&&<p role="status">{message}</p>}
  {loaded&&!items.length&&<p>아직 담은 상품이 없습니다.</p>}
  <ul className="collection-list">{items.map(item=>{const hasProduct=existingProducts.some(product=>sameSourceUrl(product.source_url,item.snapshot.sourceUrl));return <li key={item.id}><div><strong>{item.reviewed?.title??item.snapshot.title}</strong><small>{item.company.name} · 상품 {item.snapshot.offerId} · 옵션 {item.snapshot.options.length}개 · 이미지 {item.snapshot.images.length}개</small><small>수집본 {item.captureVersion??1}{typeof item.receivedAt==='string'&&Number.isFinite(Date.parse(item.receivedAt))&&<> · <time dateTime={item.receivedAt}>{new Date(item.receivedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time></>}</small><small>{item.issues.length?`확인 필요: ${item.issues.join(' · ')}`:'상품정보 준비됨 · 견적서 전송 전 검토 필요'}</small>{hasProduct&&<small>같은 URL의 기존 작업을 유지하고, 선택한 수집본으로 별도 상품을 작성합니다.</small>}{item.warnings?.map((warning,index)=><small key={index} className="collection-notice">{warning}</small>)}</div><button type="button" className="btn ghost" disabled={busy||disabled} onClick={()=>{setReview(sourceReviewState(item));setMessage('');}}>상품정보 확인</button><button type="button" className="btn primary" disabled={busy||disabled} onClick={()=>{try{onAdd(item);}catch(error){setMessage(error instanceof Error?error.message:'상품 추가 실패');}}}>{hasProduct?'카테고리 선택·별도 초안 작성':'카테고리 선택·초안 작성'}</button><button type="button" className="btn ghost" disabled={busy||disabled} onClick={()=>void archive(item)}>수집함에서 제외</button></li>;})}</ul>
  {review&&<section className="source-inbox-review" aria-label="수집 상품정보 검토"><h3>수집 상품정보 확인</h3><p>공급자 SKU·위안 원가·통화는 원문에서 확인한 값을 입력하세요. 확인되지 않은 값은 임의로 채우지 않습니다. 최소 주문 수량은 미확인이면 공란으로 두고 초안을 작성할 수 있습니다. 공급자 SKU도 미확인이면 공란으로 보관하고 수집한 옵션별로 구분합니다. 초안 작성 후 가격 설정에서 확인하세요. 원본과 검토본은 따로 보관합니다.</p>
    {captureSummary&&<details aria-label="수집 진단"><summary>수집 진단{captureSummary.diagnostics?` · 수집기 ${captureSummary.diagnostics.collectorVersion}`:captureSummary.status==='missing'?' · 기록 없음':' · 기록 확인 불가'}</summary>
     <p>저장된 원문: 제품속성 {captureSummary.attributes}개 · 포장정보 {captureSummary.packaging}/{captureSummary.options}옵션 · 상세이미지 {captureSummary.detailImages}장</p>
     {captureSummary.diagnostics?<>
      <p>수집 당시 문서 영역: 탭 {captureSummary.diagnostics.sections.tabCount}개 · 상품정보 탭 {captureSummary.diagnostics.sections.knownTabCount}개 · 본문 패널 {captureSummary.diagnostics.sections.panelCount}개 · 연결 확인 {captureSummary.diagnostics.sections.linkedKnownPanelCount}개 · 연결 미확인 {captureSummary.diagnostics.sections.unlinkedKnownTabCount}개</p>
      {captureSummary.diagnostics.bodyTitles&&<p>일반 본문 제목: 속성 {captureSummary.diagnostics.bodyTitles.attributes}개 · 포장 {captureSummary.diagnostics.bodyTitles.packaging}개 · 상세 {captureSummary.diagnostics.bodyTitles.detail}개</p>}
      <p>상세문서 연결: {descriptionDiagnostics[captureSummary.diagnostics.description]}</p>
     </>:<p>{captureSummary.status==='missing'?'이 수집본에는 수집기 버전·진단 기록이 없습니다.':'수집 진단 기록의 형식을 확인할 수 없습니다.'}</p>}
     <small>선택한 수집본의 기록입니다. 항목 수와 진단 기록만으로 모든 상품정보가 수집되었음을 확인할 수는 없습니다.</small>
    </details>}
   <section aria-label="수집한 제품속성·포장정보"><h4>제품속성·포장정보</h4>
    <p>판매자가 기재한 수집 원문입니다. 누락된 항목은 미확인으로 표시하며 자동 추정값과 구분합니다.</p>
    {review.item.snapshot.attributes.length>0?<details><summary>제품속성 {review.item.snapshot.attributes.length}개 보기</summary><dl>{review.item.snapshot.attributes.map((pair,index)=><div key={index}><dt>{pair.name}</dt><dd style={{whiteSpace:'pre-wrap'}}>{pair.value}</dd></div>)}</dl></details>:<p>제품속성 원문: 수집되지 않음</p>}
    <div className="source-inbox-table"><table><thead><tr><th>원문 옵션</th><th>포장 무게(g)</th><th>포장 크기 가로×세로×높이(mm)</th></tr></thead><tbody>{review.item.snapshot.options.map(option=><tr key={option.key}><td>{option.name}</td><td>{option.packaging?.weightG??'미확인'}</td><td>{[option.packaging?.widthMm,option.packaging?.lengthMm,option.packaging?.heightMm].map(value=>value??'미확인').join(' × ')}</td></tr>)}</tbody></table></div>
    <p>이미지: 대표 {review.item.snapshot.images.filter(image=>image.role==='main').length}개 · 추가 {review.item.snapshot.images.filter(image=>image.role==='additional').length}개 · 상세 {review.item.snapshot.images.filter(image=>image.role==='detail').length}개</p>
    {review.item.snapshot.description?<details><summary>상품 설명 원문 보기</summary><p style={{whiteSpace:'pre-wrap'}}>{review.item.snapshot.description}</p></details>:<p>상품 설명 원문: 수집되지 않음</p>}
   </section>
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
