'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createManagedPurchaseInfoEntry,validateManagedPurchaseInfo,managedPurchaseInfoComplete,invalidateManagedPurchaseInfoEntry,MANAGED_PURCHASE_INFO_ROWS,type ManagedPurchaseInfoEntry,type ManagedPurchaseInfoView} from '@/app/managed-purchase-info';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import './managed-purchase-info-panel.css';

type Props={skuId:string;company:SupplierHubCompany;accountContext:string;onClose:()=>void;onSaved:()=>void;onBusyChange?:(busy:boolean)=>void};
type Attempt={before:ManagedPurchaseInfoView;purchaseInfo:ManagedPurchaseInfoEntry[]};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const value=(entry:ManagedPurchaseInfoEntry,name:string,section?:string)=>String((section?object(entry[section])?.[name]:entry[name])??'');
const href=(raw:unknown)=>{try{const url=new URL(String(raw));return url.protocol==='https:'||url.protocol==='http:'?url.href:undefined;}catch{return undefined;}};
const requestChecks=[['default','기본검수'],['barcode','바코드라벨'],['sticker','원산지 스티커'],['masking','상표 제거'],['airpacking','에어포장'],['sewing','원산지 라벨봉제'],['stamp','원산지 도장'],['tag','원산지 택(태그)']] as const;
const labelFields=['제품명','수입원/판매원','제조원','제조국','내용량','원료명및성분명(재질)','상품유형','사용시주의사항','사용기준','custom'] as const;
const customsChoices=[['integrated','통합통관'],['client','화주단독통관'],['kupass','쿠패스단독통관']] as const;
const deliveryChoices=[['coupang-shipment','쿠팡 쉽먼트택배','coupang','box'],['customer-box','화주 택배','customer','box'],['customer-pallet','화주 파렛트','customer','pallet']] as const;
export function ManagedPurchaseInfoPanel({skuId,company,accountContext,onClose,onSaved,onBusyChange}:Props){
 const scope=JSON.stringify([skuId,company.code,company.name,accountContext]),live=useRef({scope,onClose,onSaved,onBusyChange}),mounted=useRef(true),active=useRef<AbortController|null>(null),pending=useRef<Attempt|null>(null);
 const [saved,setSaved]=useState<ManagedPurchaseInfoView|null>(null),savedRef=useRef<ManagedPurchaseInfoView|null>(null),[draft,setDraft]=useState<ManagedPurchaseInfoEntry[]>([]),draftRef=useRef<ManagedPurchaseInfoEntry[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[completed,setCompleted]=useState(false);
 const endpoint=`/api/managed-products/${encodeURIComponent(skuId)}/purchase-info?expectedAccountContext=${encodeURIComponent(accountContext)}`;
 useLayoutEffect(()=>{live.current={scope,onClose,onSaved,onBusyChange};},[scope,onClose,onSaved,onBusyChange]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.abort();live.current.onBusyChange?.(false);};},[]);
 const current=()=>mounted.current&&live.current.scope===scope;
 function verify(view:ManagedPurchaseInfoView){
  if(!view||view.skuId!==skuId||view.accountContext!==accountContext||view.company?.code!==company.code||view.company.name!==company.name
   ||!Number.isSafeInteger(view.revision)||view.revision<0||!/^[a-f0-9]{64}$/.test(view.inputFingerprint)||!/^[a-f0-9]{64}$/.test(view.sourceVersion)
   ||typeof view.product?.title!=='string'||typeof view.product.barcode!=='string'||typeof view.product.image!=='string'
   ||view.updatedAt!==null&&!Number.isFinite(Date.parse(view.updatedAt))||view.purchaseInfoComplete!==managedPurchaseInfoComplete(view.purchaseInfo))throw Error('현재 회사와 SKU의 구매정보 저장본을 확인하지 못했습니다.');
  validateManagedPurchaseInfo(view.purchaseInfo);validateManagedPurchaseInfo(view.originalPurchaseInfo);
 }
 async function read(signal:AbortSignal){const response=await fetch(endpoint,{signal,cache:'no-store'}),body=await response.json() as ManagedPurchaseInfoView&{error?:string};signal.throwIfAborted();if(!response.ok)throw Error(body.error||'구매정보를 읽지 못했습니다.');verify(body);return body;}
 function adopt(view:ManagedPurchaseInfoView){savedRef.current=view;draftRef.current=structuredClone(view.purchaseInfo);setSaved(view);setDraft(draftRef.current);}
 useEffect(()=>{const controller=new AbortController();active.current=controller;queueMicrotask(()=>{if(current()){setLoading(true);setError('');}});void(async()=>{try{const body=await read(controller.signal);if(current()&&!controller.signal.aborted){adopt(body);pending.current=null;setUncertain(false);setCompleted(false);}}catch(cause){if(current()&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'구매정보 읽기 실패');}finally{if(active.current===controller){active.current=null;if(current()&&!controller.signal.aborted)setLoading(false);}}})();return()=>controller.abort();
 // A new owner/company/SKU always starts with its own server snapshot.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[scope]);
 function edit(index:number,name:string,next:string|boolean,section?:string){
  if(!current()||active.current||pending.current||completed||!savedRef.current)return;
  const entries=structuredClone(draftRef.current),entry=entries[index];if(!entry)return;
  const previous=section?object(entry[section])?.[name]:entry[name];
  if(typeof next==='string'?String(previous??'')===next:previous===next)return;
  if(section){const existing=entry[section];if(existing!==undefined&&!object(existing)){setError('기존 요청정보 형식은 보존했습니다. 원문을 확인해주세요.');return;}entry[section]={...(object(existing)??{}),[name]:next};entry.요청사항='등록대기';}
  else{entry[name]=next;if(name==='구매링크'){entry.구매링크init=next;entry.매칭상태='매칭필요';}else if(name==='옵션1_중국어'||name==='옵션2_중국어')entry.매칭상태='매칭필요';else if(name==='상품명')entry.상품명init=next;}
  try{entries[index]=invalidateManagedPurchaseInfoEntry(draftRef.current[index],entry);}catch(cause){setError(cause instanceof Error?cause.message:'입력값을 확인해주세요.');return;}
  draftRef.current=entries;setDraft(entries);setError('');setMessage('');
 }
 function changeRows(update:(entries:ManagedPurchaseInfoEntry[])=>ManagedPurchaseInfoEntry[]){if(!current()||active.current||pending.current||completed||!savedRef.current)return;const next=update(structuredClone(draftRef.current));draftRef.current=next;setDraft(next);setError('');setMessage('');}
 function confirm(before:ManagedPurchaseInfoView,after:ManagedPurchaseInfoView,entries:ManagedPurchaseInfoEntry[]){verify(after);
  if(after.revision!==before.revision+1||after.sourceVersion!==before.sourceVersion||!same(after.product,before.product)||!same(after.originalPurchaseInfo,before.originalPurchaseInfo)
   ||!same(after.purchaseInfo,entries)||after.updatedAt===null||before.updatedAt!==null&&Date.parse(after.updatedAt)<=Date.parse(before.updatedAt))throw Error('저장 결과가 요청한 구매정보와 다릅니다. 입력은 유지했습니다.');
 }
 async function save(){
  if(!current()||active.current||completed||!savedRef.current)return;
  const before=savedRef.current,attempt=pending.current??{before,purchaseInfo:structuredClone(draftRef.current)};
  if(!pending.current&&same(attempt.purchaseInfo,before.purchaseInfo))return;
  try{validateManagedPurchaseInfo(attempt.purchaseInfo);}catch(cause){setError(cause instanceof Error?cause.message:'구매정보 입력을 확인해주세요.');return;}
  const controller=new AbortController();active.current=controller;live.current.onBusyChange?.(true);setBusy(true);setError('');setMessage('');
  try{
   if(pending.current){const latest=await read(controller.signal);if(!current())return;if(same(latest,attempt.before)){pending.current=null;setUncertain(false);setMessage('저장되지 않은 원본을 확인했습니다. 입력을 확인한 뒤 저장해주세요.');return;}confirm(attempt.before,latest,attempt.purchaseInfo);adopt(latest);pending.current=null;setUncertain(false);setCompleted(true);setMessage('저장한 구매정보를 확인했습니다.');live.current.onSaved();return;}
   pending.current=attempt;setUncertain(true);
   const response=await fetch(endpoint.split('?')[0],{method:'PUT',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedAccountContext:accountContext,expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,purchaseInfo:attempt.purchaseInfo})});
   if(!response.ok){if(response.status<500&&response.status!==429){pending.current=null;setUncertain(false);}let reason='구매정보 저장 결과를 확인해주세요.';try{reason=(await response.json() as {error?:string}).error||reason;}catch{}throw Error(reason);}
   const body=await response.json() as ManagedPurchaseInfoView;controller.signal.throwIfAborted();confirm(before,body,attempt.purchaseInfo);
   const latest=await read(controller.signal);if(!same(body,latest))throw Error('저장 응답과 최신 구매정보가 다릅니다. 입력을 유지했습니다.');if(!current())return;
   adopt(latest);pending.current=null;setUncertain(false);setCompleted(true);setMessage('구매정보를 저장했습니다.');live.current.onSaved();
  }catch(cause){if(current()&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'저장 결과를 확인하지 못했습니다.');}
  finally{if(active.current===controller){active.current=null;if(current()&&!controller.signal.aborted){setBusy(false);live.current.onBusyChange?.(!!pending.current);}}}
 }
 function close(){if(!current()||active.current)return;pending.current=null;live.current.onBusyChange?.(false);live.current.onClose();}
 const dirty=!!saved&&!same(saved.purchaseInfo,draft),locked=loading||busy||uncertain||completed||!saved;
 const input=(index:number,name:string,section?:string,label=name,type='text')=><label>{label}<input aria-label={`구매정보 ${index+1} ${label}`} type={type} min={type==='number'?0:undefined} value={value(draft[index],name,section)} disabled={locked||!!section&&draft[index][section]!==undefined&&!object(draft[index][section])} onChange={event=>edit(index,name,event.target.value,section)}/></label>;
 return <div className="managed-purchase-overlay"><section className="managed-purchase-dialog" role="dialog" aria-modal="true" aria-label="구매정보" data-workspace-dirty={dirty} data-workspace-saving={busy||uncertain}>
  <header><div><h3>구매정보</h3><p>{company.name} ({company.code}) · SKU {skuId}</p><strong>{saved?.product.title}</strong></div><button type="button" className="icon-close" aria-label="구매정보 닫기" disabled={busy||loading} onClick={close}>×</button></header>
  {loading&&<p role="status">구매정보를 읽고 있습니다.</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!loading&&saved&&<><div className="table-wrap"><table className="managed-purchase-table"><thead><tr>{['제품정보','상품매칭','구매링크','옵션1_중국어','옵션2_중국어','구성수량','기본요청사항','관리'].map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{draft.map((entry,index)=><tr key={index}>
   {/* eslint-disable-next-line @next/next/no-img-element -- Display the imported original thumbnail without an image-provider transformation. */}
   <td>{href(entry.등록이미지)&&<img src={href(entry.등록이미지)} alt="" referrerPolicy="no-referrer"/>}{input(index,'상품명')}<small>{String(entry.바코드??'')}</small></td><td><span className="status-pill">{String(entry.매칭상태??'')}</span></td>
   <td>{input(index,'구매링크')}{href(entry.구매링크)&&<a href={href(entry.구매링크)} target="_blank" rel="noopener noreferrer">구매링크 열기</a>}</td><td>{input(index,'옵션1_중국어')}</td><td>{input(index,'옵션2_중국어')}</td><td>{input(index,'판매구성수량',undefined,'판매구성수량','number')}</td><td><span>{String(entry.요청사항??'')}</span></td><td><button type="button" className="btn ghost" aria-label={`구매정보 ${index+1} 삭제`} disabled={locked} onClick={()=>changeRows(entries=>entries.filter((_,slot)=>slot!==index))}>삭제</button></td>
  </tr>)}</tbody></table></div>
  {!draft.length&&<p>등록된 구매정보가 없습니다. 추가 버튼으로 입력하세요.</p>}
  <button type="button" className="btn ghost" disabled={locked||draft.length>=MANAGED_PURCHASE_INFO_ROWS} onClick={()=>changeRows(entries=>entries.length>=MANAGED_PURCHASE_INFO_ROWS?entries:[...entries,createManagedPurchaseInfoEntry(savedRef.current!.product)])}>+ 추가</button>
  {draft.map((entry,index)=><details key={index} className="managed-purchase-request"><summary>구매정보 {index+1} · 기본요청사항·한글표시사항</summary><div className="managed-purchase-form">
   <fieldset disabled={locked}><legend>기본요청사항</legend><div className="managed-purchase-fields">{input(index,'구매요청수량',undefined,'구매요청수량','number')}{input(index,'신고영문명')}{input(index,'HSCODE')}{input(index,'협의단가',undefined,'협의단가(CNY)','number')}{input(index,'협의총금액',undefined,'총금액(CNY)','number')}{input(index,'협의ID',undefined,'협의1688 ID')}
    <label className="managed-purchase-bundle"><input type="checkbox" aria-label={`구매정보 ${index+1} 묶음구성여부`} checked={entry.묶음구성여부===true} disabled={locked} onChange={event=>edit(index,'묶음구성여부',event.target.checked)}/>묶음구성여부</label>{entry.묶음구성여부===true&&input(index,'묶음구성수량',undefined,'묶음구성수량','number')}
    <label>통관형태<select aria-label={`구매정보 ${index+1} customsType`} value={value(entry,'customsType','요청내역')} disabled={locked||entry.요청내역!==undefined&&!object(entry.요청내역)} onChange={event=>edit(index,'customsType',event.target.value,'요청내역')}><option value="">선택</option>{!customsChoices.some(([v])=>v===value(entry,'customsType','요청내역'))&&value(entry,'customsType','요청내역')&&<option value={value(entry,'customsType','요청내역')}>{value(entry,'customsType','요청내역')}</option>}{customsChoices.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
    <label>도착지 및 출고형태<select aria-label={`구매정보 ${index+1} deliveryType`} value={value(entry,'deliveryType','요청내역')} disabled={locked||entry.요청내역!==undefined&&!object(entry.요청내역)} onChange={event=>{const next=deliveryChoices.find(([id])=>id===event.target.value);if(!next||next[0]===value(entry,'deliveryType','요청내역'))return;changeRows(entries=>{const current=entries[index],requestInfo=object(current.요청내역);if(current.요청내역!==undefined&&!requestInfo)return entries;current.요청내역={...(requestInfo??{}),deliveryType:next[0],destination:next[2],exportType:next[3]};current.요청사항='등록대기';return entries;});}}><option value="">선택</option>{!deliveryChoices.some(([v])=>v===value(entry,'deliveryType','요청내역'))&&value(entry,'deliveryType','요청내역')&&<option value={value(entry,'deliveryType','요청내역')}>{value(entry,'deliveryType','요청내역')}</option>}{deliveryChoices.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label></div>
    <div className="managed-purchase-checks">{requestChecks.map(([name,label])=><label key={name}><input type="checkbox" aria-label={`구매정보 ${index+1} ${label}`} checked={object(entry.요청내역)?.[name]===true} disabled={locked||entry.요청내역!==undefined&&!object(entry.요청내역)} onChange={event=>edit(index,name,event.target.checked,'요청내역')}/>{label}</label>)}</div>
    {['reqcontent','reqcontentPurchase'].map((name,n)=><label key={name}>{n?'기타요청사항 - 구매요청사항':'기타요청사항 - 물류요청사항'}<textarea aria-label={`구매정보 ${index+1} ${name}`} value={value(entry,name,'요청내역')} disabled={locked||entry.요청내역!==undefined&&!object(entry.요청내역)} onChange={event=>edit(index,name,event.target.value,'요청내역')}/></label>)}
   </fieldset><fieldset disabled={locked}><legend>한글표시사항</legend><div className="managed-purchase-fields">{labelFields.map(name=><div key={name}>{input(index,name,'한글표시사항',name==='custom'?'기타 표시사항':name)}</div>)}</div><div className="managed-purchase-checks">{[['kc인증','KC인증마크 표시'],['식품용','식품용']].map(([name,label])=><label key={name}><input type="checkbox" aria-label={`구매정보 ${index+1} ${label}`} checked={object(entry.한글표시사항)?.[name]===true} disabled={locked||entry.한글표시사항!==undefined&&!object(entry.한글표시사항)} onChange={event=>edit(index,name,event.target.checked,'한글표시사항')}/>{label}</label>)}</div></fieldset>
  </div></details>)}
  <p>링크·옵션 수정은 매칭필요로, 요청·표시사항 수정은 등록대기로 표시합니다. 저장한 입력은 상품 DB 원문과 가격을 변경하지 않습니다.</p>
  </>}
  <footer><button type="button" className="btn ghost" disabled={busy||loading} onClick={close}>{uncertain||completed?'닫기':'취소'}</button><button type="button" className="btn primary" disabled={busy||loading||completed||!saved||!dirty&&!uncertain} onClick={()=>void save()}>{uncertain?'저장 결과 확인':'저장'}</button></footer>
 </section></div>;
}
