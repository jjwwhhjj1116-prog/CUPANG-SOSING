'use client';
/* eslint-disable @next/next/no-img-element -- Private image URLs require the current authenticated session. */

import type { RegistrationContentSummary } from '@/app/registration-content-summary';
import type { SupplierHubReceiptSummary } from '@/app/supplier-hub-receipt';
import type { NativeReceiptSummary } from '@/app/supplier-hub-product-receipt';
import { productRemovalDecision, type ProductRemovalDecision } from '@/app/product-removal-policy';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {SourceInboxItem} from '@/app/source-inbox';
import {sourceRegistrationRows,type SourceRegistration} from '@/app/source-registration';
import {sourceArchiveReference,sameSourceArchiveReference,type SourceArchiveReference} from '@/app/source-inbox-archive-client';
export type RegistrationSourceSelectionReference=SourceArchiveReference;
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import { archiveDateBounds, type ArchiveRange } from '@/app/product-archive';
import {matchesRegistrationColumnFilter,registrationFilterChoices,type RegistrationColumnFilter} from '@/app/registration-column-filter';
import {RegistrationFilterPopover} from '@/app/components/registration-filter-popover';
import {registrationNumber} from '@/app/product-registration';
import {pendingRegistrationStages,registrationStageLabel,registrationStepIds,type RegistrationStageStatus} from '@/app/registration-stage-status';
import './registration-board.css';
export {registrationNumber} from '@/app/product-registration';

type BoardProduct = {registration_number?:string;removal_policy?:ProductRemovalDecision|null;hub_receipt?:SupplierHubReceiptSummary|null;hub_single_receipt?:NativeReceiptSummary|null;content_summary?:RegistrationContentSummary|null;source_image_key?:string|null;id:string;title:string;source_url:string;created_at:string;image_keys:string;options_count:number;registration_status:string;seo_status:string;quote_status:string;supply_price:number|null;sale_price:number|null;source_capture?:SourceInboxItem};
export function filterRegistrationProducts<T extends BoardProduct>(products:T[],query:string,from:string|null,to:string|null) {
  return products.filter(product=>{
    const time=Date.parse(product.created_at);
    return `${registrationNumber(product)} ${product.id} ${product.title} ${product.content_summary?.seoTitle??''} ${product.source_url}`.toLowerCase().includes(query.trim().toLowerCase())
      &&(!from||(Number.isFinite(time)&&time>=Date.parse(from)))&&(!to||(Number.isFinite(time)&&time<Date.parse(to)));
  });
}
export function registrationStepLabel(product: BoardProduct, step: string) {
  if(product.source_capture&&step==='SEO'){const state=registrationStepStatus(product,step).state;if(state==='running')return '번역 중';if(state==='failed')return '번역 오류';}
  return registrationStageLabel(registrationStepStatus(product,step).state);
}
export function registrationStepStatus(product:BoardProduct,step:string):RegistrationStageStatus {
  if(product.source_capture&&step==='SEO'){
    const item=product.source_capture,value=item.titlePreparation;
    if(value&&value.fingerprint===item.fingerprint&&value.revision===item.revision&&value.sourceTitle===item.snapshot.title&&value.state!=='completed')return {state:value.state==='failed'?'failed':'running',detail:value.message+' · 전체 SEO 작업은 대기 상태입니다.'};
  }
  const id=registrationStepIds[step];
  return !product.source_capture&&id&&product.content_summary?.stages?.[id]||pendingRegistrationStages()[id??'seo'];
}
export function registrationStepDetail(product:BoardProduct,step:string):string {
  const status=registrationStepStatus(product,step);
  if(product.source_capture)return `${status.detail} 수집 원문 보관됨 · 클릭하여 카테고리를 선택하세요.`;
  const summary=product.content_summary;
  if(step==='SEO')return `${status.detail} · 저장 상품명 ${summary?.seo?'입력됨':'미입력'}`;
  const roles:Record<string,'main'|'additional'|'detail'|'label'>={'대표 이미지':'main','추가 이미지':'additional','상세 이미지':'detail','표시사항':'label'};
  if(roles[step])return `${status.detail} · ${summary?summary[roles[step]]+'장':'연결 개수 확인 필요'}`;
  return status.detail;
}
const steps=[['SEO','SEO설정'],['가격','가격설정'],['대표 이미지','대표이미지'],['추가 이미지','추가이미지'],['상세 이미지','상세이미지'],['옵션','사이즈표'],['표시사항','한글표시사항'],['견적서','견적서']];
type RegistrationColumn = {id:string;label:string;step?:string;width:number};
const columns:RegistrationColumn[]=[
  {id:'id',label:'등록번호',width:112},
  {id:'image',label:'상품이미지',width:72},
  {id:'product',label:'상품명',width:238},
  {id:'source',label:'구매링크',width:62},
  ...steps.map(([step,label])=>({id:step,label,step,width:step==='표시사항'?88:['대표 이미지','추가 이미지','상세 이미지'].includes(step)?78:72})),
  {id:'status',label:'등록상태',width:112},
  {id:'management',label:'관리',width:64},
];
const dateTime=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'});
export function registrationThumbnail(product:BoardProduct) {
  if(product.source_capture)return (product.source_capture.reviewed??product.source_capture.snapshot).images.find(image=>/^https:\/\/[^/]*alicdn\.com\//.test(image.url))?.url??null;
  try{
    const keys:unknown=JSON.parse(product.image_keys);
    if(!Array.isArray(keys))return null;
    const key=[product.content_summary?.mainImageKey,product.source_image_key].find(value=>typeof value==='string'&&value.length>0&&keys.includes(value));
    return key?`/api/files/${key.split('/').map(encodeURIComponent).join('/')}`:null;
  }catch{return null;}
}
export function registrationTitle(product:BoardProduct) {return (product.content_summary?.seoTitle??product.title)||'상품명 미입력';}
export function registrationTransmissionLabel(product:BoardProduct) {return product.hub_receipt&&product.hub_single_receipt?'전송 이력 있음':product.hub_single_receipt?.label??product.hub_receipt?.label??'등록대기';}
function transmissionState(product:BoardProduct){const label=registrationTransmissionLabel(product);return /반려|오류|실패/.test(label)?'failed':label==='SKU ID 확인'?'complete':/검증 중/.test(label)?'running':'pending';}
export function registrationColumnText(product:BoardProduct,columnId:string):string {
  if(columnId==='id')return product.source_capture?`수집 · ${product.source_capture.snapshot.offerId}`:registrationNumber(product);
  if(columnId==='product')return registrationTitle(product);
  if(columnId==='source')return product.source_url;
  if(columnId==='image')return registrationThumbnail(product)??'';
  if(columnId==='status')return registrationTransmissionLabel(product);
  if(columnId==='management')return product.source_capture?'수집 목록에서 삭제':productRemovalDecision(product).blocked?'삭제 보호':'삭제';
  const roles:Record<string,'main'|'additional'|'detail'|'label'>={'대표 이미지':'main','추가 이미지':'additional','상세 이미지':'detail','표시사항':'label'};
  if(roles[columnId]&&product.content_summary)return product.content_summary[roles[columnId]]+'장';
  const column=columns.find(item=>item.id===columnId);return column?.step?registrationStepLabel(product,column.step):'';
}

type RegistrationSort={column:string;direction:'ascending'|'descending'}|null;
const registrationCollator=new Intl.Collator('ko-KR',{numeric:true,sensitivity:'base'});
export function sortRegistrationProducts<T extends BoardProduct>(products:T[],sort:RegistrationSort):T[]{
  const column=sort&&columns.find(column=>column.id===sort.column);
  if(!sort||!column||['image','management'].includes(column.id))return products;
  const value=(product:T):string|number=>{
    if(column.id==='id')return registrationNumber(product);
    if(column.id==='product')return registrationTitle(product);
    if(column.id==='source')return product.source_url;
    if(column.id==='status')return registrationTransmissionLabel(product);
    const roles:Record<string,'main'|'additional'|'detail'|'label'>={'대표 이미지':'main','추가 이미지':'additional','상세 이미지':'detail','표시사항':'label'};
    if(roles[column.id]&&product.content_summary)return product.content_summary[roles[column.id]];
    return registrationStepLabel(product,column.step??'');
  };
  return products.map((product,index)=>({product,index})).sort((a,b)=>{
    const first=value(a.product),second=value(b.product);
    const comparison=typeof first==='number'&&typeof second==='number'?first-second:registrationCollator.compare(String(first),String(second));
    return comparison*(sort.direction==='ascending'?1:-1)||a.index-b.index;
  }).map(row=>row.product);
}

function sourceUrl(value:string) {try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}

export function RegistrationBoard<T extends BoardProduct>({products,sources=[],sourceOwnerId,sourceCompany,sourceArchiveDisabled=false,onPrepareSource,onReviewSource,onArchiveSource,onSourceSelectionChange,selected,onSelected,onOpen,onOptions,onDelete,loading,error,onArchive}:{products:T[];sources?:SourceInboxItem[];sourceOwnerId?:string;sourceCompany?:SupplierHubCompany|null;sourceArchiveDisabled?:boolean;onPrepareSource?:(item:SourceInboxItem)=>void;onReviewSource?:(item:SourceInboxItem)=>void;onArchiveSource?:(item:SourceInboxItem)=>Promise<void>;onSourceSelectionChange?:(references:RegistrationSourceSelectionReference[])=>void;selected:Set<string>;onSelected:(value:Set<string>)=>void;onOpen:(product:T,step?:string)=>void;onOptions?:(product:T)=>void;onDelete?:(product:T)=>Promise<void>;loading:boolean;error:string;onArchive:()=>void}) {
  type Entry=BoardProduct & (T|SourceRegistration);
  const entries:Entry[]=[...sourceRegistrationRows(sources),...products];
  const openEntry=(product:Entry,step?:string)=>{if(product.source_capture){if(step==='옵션')onReviewSource?.(product.source_capture);else onPrepareSource?.(product.source_capture);}else if(onOptions)onOptions(product as T);else if(step===undefined)onOpen(product as T);else onOpen(product as T,step);};
  const [range,setRange]=useState<ArchiveRange>('all');const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const [status,setStatus]=useState('전체'); const [query,setQuery]=useState('');const [page,setPage]=useState(0);const [pageSize,setPageSize]=useState(10);
  const [visibleColumns,setVisibleColumns]=useState(()=>columns.map(column=>column.id));
  const [pinnedColumn,setPinnedColumn]=useState('');
  const [sort,setSort]=useState<RegistrationSort>(null);
  const [columnFilters,setColumnFilters]=useState<Record<string,RegistrationColumnFilter>>({});
  const [filterPopup,setFilterPopup]=useState<{columnId:string;position:{left:number;top:number};trigger:HTMLElement}|null>(null);
  const [fixedHeight,setFixedHeight]=useState(true);
  const sourceScope=useMemo(()=>({ownerId:sourceOwnerId,company:sourceCompany?.code,name:sourceCompany?.name}),[sourceOwnerId,sourceCompany?.code,sourceCompany?.name]);
  const [deletingState,setDeletingState]=useState<{scope:object;id:string}|null>(null);const [deleteError,setDeleteError]=useState(''),[deleteNotice,setDeleteNotice]=useState('');
  const deleting=deletingState?.scope===sourceScope?deletingState.id:null,setDeleting=(id:string|null)=>setDeletingState(id===null?null:{scope:sourceScope,id});
  const deleteInFlight=useRef(false);
  const [sourceSelection,setSourceSelection]=useState<{scope:object;refs:SourceArchiveReference[]}>({scope:sourceScope,refs:[]});
  const sourceReferences=new Map(entries.flatMap(entry=>{const ref=entry.source_capture&&sourceArchiveReference(entry.source_capture,sourceOwnerId,sourceCompany);return ref?[[entry.id,ref] as const]:[];}));
  const selectedSources=entries.filter(entry=>entry.source_capture&&sourceSelection.scope===sourceScope&&sourceSelection.refs.some(ref=>sameSourceArchiveReference(ref,sourceReferences.get(entry.id))));
  const selectedSourceReferences=selectedSources.flatMap(entry=>{const reference=sourceReferences.get(entry.id);return reference?[reference]:[];});
  const sourceSelectionKey=JSON.stringify(selectedSourceReferences);
  const publishedSourceSelection=useRef<string|null>(null);
  useLayoutEffect(()=>{
    if(!onSourceSelectionChange){publishedSourceSelection.current=null;return;}
    if(publishedSourceSelection.current===sourceSelectionKey)return;
    publishedSourceSelection.current=sourceSelectionKey;
    onSourceSelectionChange(selectedSourceReferences.map(reference=>({...reference,company:{...reference.company}})));
  });
  const alive=useRef(false),latest=useRef({sourceScope,entries,sourceReferences,selectedSources,sourceArchiveDisabled,onArchiveSource});
  useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useLayoutEffect(()=>{latest.current={sourceScope,entries,sourceReferences,selectedSources,sourceArchiveDisabled,onArchiveSource};});
  const displayedColumns=columns.filter(column=>visibleColumns.includes(column.id));
  const pinned=(column:string)=>pinnedColumn===column?' registration-pinned':'';
  let bounds:{startUtc:string|null;endUtc:string|null}={startUtc:null,endUtc:null};let dateError='';
  try{bounds=archiveDateBounds(range,from,to);}catch(cause){dateError=cause instanceof Error?cause.message:'날짜를 확인해주세요.';}
  const baseFiltered=dateError?[]:filterRegistrationProducts(entries,query,bounds.startUtc,bounds.endUtc).filter(product=>status==='전체'||(status==='작업 중'?!['전송 가능','전송완료'].includes(product.registration_status):['검토 대기','전송 가능'].includes(status)?product.registration_status===status:registrationTransmissionLabel(product)===status));
  const imageCounts=['대표 이미지','추가 이미지','상세 이미지','표시사항'];
  const matches=(product:Entry,except?:string)=>columns.every(column=>column.id===except||matchesRegistrationColumnFilter(registrationColumnText(product,column.id),columnFilters[column.id],imageCounts.includes(column.id)));
  const filtered=sortRegistrationProducts(baseFiltered.filter(product=>matches(product)),sort);
  const popupColumn=filterPopup&&columns.find(column=>column.id===filterPopup.columnId);
  const popupChoices=popupColumn?registrationFilterChoices(baseFiltered.filter(product=>matches(product,popupColumn.id)).map(product=>registrationColumnText(product,popupColumn.id))):[];
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize));const currentPage=Math.min(page,pages-1);
  const rows=filtered.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const toggle=(ids:string[],include:boolean)=>{
    if(deleteInFlight.current||!alive.current||latest.current.sourceScope!==sourceScope)return;
    const productIds=ids.filter(id=>products.some(product=>product.id===id)),next=new Set(selected);for(const id of productIds){if(include)next.add(id);else next.delete(id);}if(productIds.length)onSelected(next);
    if(sourceArchiveDisabled)return;
    const refs=ids.flatMap(id=>sourceReferences.has(id)?[sourceReferences.get(id)!]:[]);
    setSourceSelection(previous=>{const retained=previous.scope===sourceScope?previous.refs:[],targets=new Set(refs.map(ref=>ref.id));
      return{scope:sourceScope,refs:[...retained.filter(ref=>!targets.has(ref.id)),...(include?refs:[])]};});
  };
  const changeSort=(column:string)=>{setSort(current=>current?.column!==column?{column,direction:'ascending'}:current.direction==='ascending'?{column,direction:'descending'}:null);setPage(0);};
  const archiveEntries=async(targets:Entry[],requireSelected=false)=>{
    if(deleteInFlight.current||!alive.current||latest.current.sourceScope!==sourceScope||sourceArchiveDisabled||!onArchiveSource||!targets.length)return;
    const refs=targets.map(target=>sourceReferences.get(target.id));if(refs.some(ref=>!ref))return;
    if(!window.confirm(targets.length===1?`“${registrationTitle(targets[0])}” 수집 상품을 목록에서 삭제할까요? 원문은 보존되며 다시 수집하면 복원됩니다. 기존 작업 상품은 변경하지 않습니다.`:`선택한 수집 상품 ${targets.length}건을 목록에서 삭제할까요? 원문은 보존되며 다시 수집하면 복원됩니다. 기존 작업 상품은 변경하지 않습니다.`))return;
    if(!alive.current||latest.current.sourceScope!==sourceScope||latest.current.sourceArchiveDisabled)return;
    deleteInFlight.current=true;setDeleting(targets[0].id);setDeleteError('');setDeleteNotice('');let completed=0;
    try{
      for(const [index,target] of targets.entries()){
        const live=latest.current,reference=refs[index];
        if(!alive.current||live.sourceScope!==sourceScope)return;
        if(live.sourceArchiveDisabled||!live.onArchiveSource||!sameSourceArchiveReference(reference,live.sourceReferences.get(target.id))
          ||requireSelected&&!live.selectedSources.some(item=>item.id===target.id))throw Error('선택한 수집본 또는 작업 상태가 변경되었습니다. 목록을 확인한 뒤 다시 선택해주세요.');
        await live.onArchiveSource(target.source_capture!);
        if(!alive.current||latest.current.sourceScope!==sourceScope)return;
        completed++;
        setSourceSelection(previous=>previous.scope===sourceScope?{scope:sourceScope,refs:previous.refs.filter(ref=>!sameSourceArchiveReference(ref,reference))}:previous);
      }
      setDeleteNotice(`수집 상품 ${completed}건을 목록에서 삭제했습니다. 원문은 보존되며 다시 수집하면 복원됩니다.`);
    }catch(error){if(alive.current&&latest.current.sourceScope===sourceScope)setDeleteError(`${completed?`${completed}건 삭제됨 · `:''}${error instanceof Error?error.message:'수집 상품 삭제 결과를 확인하지 못했습니다.'}`);}
    finally{deleteInFlight.current=false;if(alive.current&&latest.current.sourceScope===sourceScope)setDeleting(null);}
  };
  const deleteProduct=async(product:Entry)=>{
    if(product.source_capture){
      await archiveEntries([product]);return;
    }
    if(deleteInFlight.current||!onDelete||productRemovalDecision(product).blocked||!window.confirm(`“${registrationTitle(product)}” 상품을 삭제된 상품으로 이동할까요? 저장된 이미지와 편집 내용은 복원할 수 있습니다.`))return;
    deleteInFlight.current=true;
    setDeleting(product.id);setDeleteError('');
    try{await onDelete(product as T);}catch(cause){setDeleteError(cause instanceof Error?cause.message:'상품을 삭제하지 못했습니다. 다시 시도해주세요.');}
    finally{deleteInFlight.current=false;setDeleting(null);}
  };
  return <section className="registration-board" aria-label="상품별 등록 현황">
    <div className="registration-datebar" role="group" aria-label="등록일 필터">
      {([['today','오늘'],['7days','7일'],['month','이번 달'],['all','전체']] as const).map(([id,label])=><label key={id}><input type="radio" name="registration-range" checked={range===id} onChange={()=>{setRange(id);setPage(0);}}/>{label}</label>)}
      <span>등록일 · 한국시간</span><input type="date" aria-label="등록 시작일" value={from} onChange={event=>{setFrom(event.target.value);setRange('custom');setPage(0);}}/><span>~</span><input type="date" aria-label="등록 종료일" value={to} min={from||undefined} onChange={event=>{setTo(event.target.value);setRange('custom');setPage(0);}}/>
      <button type="button" className="btn ghost" onClick={onArchive}>전체 보관함</button>
    </div>
    {dateError&&<p role="alert">{dateError}</p>}
    {deleteError&&<p role="alert" className="collection-error">{deleteError}</p>}
    {deleteNotice&&<p role="status">{deleteNotice}</p>}
    <div className="registration-table-tools registration-view-tools registration-toolbar" role="group" aria-label="상품 목록 도구">
      <select className="registration-status-filter" aria-label="등록 상태 필터" value={status} onChange={event=>{setStatus(event.target.value);setPage(0);}}>{[...new Set(['전체','등록대기','작업 중','검토 대기','전송 가능','파일 검증 중','견적서 접수','SKU ID 확인','파일 반려','상품 반려',...entries.map(registrationTransmissionLabel)])].map(value=><option key={value}>{value}</option>)}</select>
      <label className="search"><input type="search" aria-label="상품 검색" placeholder="Search" title="상품명 · 등록번호 · 원본 URL 검색" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg></label>
      <label className="registration-page-size"><span>Items per page</span><select aria-label="페이지당 상품 수" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(0);}}>{[10,25,50,100].map(count=><option key={count}>{count}</option>)}</select></label>
      <details className="registration-column-picker" data-dismissable-menu><summary>선택 컬럼 보기</summary><div role="group" aria-label="표시할 컬럼">
        <button type="button" className="btn ghost" onClick={()=>setVisibleColumns(columns.map(column=>column.id))}>전체 표시</button>
        {columns.map(column=><label key={column.id}><input type="checkbox" aria-label={`${column.label} 컬럼 표시`} checked={visibleColumns.includes(column.id)} onChange={event=>{setVisibleColumns(current=>event.target.checked?[...current,column.id]:current.filter(value=>value!==column.id));setFilterPopup(null);}}/>{column.label}</label>)}
      </div></details>
      <label className="registration-pin-picker"><select aria-label="고정할 열 선택" value={pinnedColumn} onChange={event=>setPinnedColumn(event.target.value)}><option value="">고정할 열 선택</option>{displayedColumns.map(column=><option key={column.id} value={column.id}>{column.label}</option>)}</select></label>
      <button type="button" className="registration-bulk-delete" aria-label="선택한 수집 상품 삭제" title={selectedSources.length?`선택한 수집 상품 ${selectedSources.length}건 삭제`:'삭제할 수집 상품을 선택하세요'} disabled={deleting!==null||sourceArchiveDisabled||!onArchiveSource||!selectedSources.length} onClick={()=>archiveEntries(selectedSources,true)}>삭제</button>
      <fieldset><legend>높이 고정</legend><label><input type="radio" name="registration-height" checked={fixedHeight} onChange={()=>setFixedHeight(true)}/>Y</label><label><input type="radio" name="registration-height" checked={!fixedHeight} onChange={()=>setFixedHeight(false)}/>N</label></fieldset>
      {!!Object.keys(columnFilters).length&&<button type="button" className="btn ghost registration-filter-clear" onClick={()=>{setColumnFilters({});setFilterPopup(null);setPage(0);}}>열 필터 모두 해제 · {Object.keys(columnFilters).length}개</button>}
    </div>
    <div className={`table-wrap registration-scroll${fixedHeight?' registration-height-fixed':''}`} tabIndex={0} aria-label="상품 등록 작업 표"><table className="couplus-work-table" style={{minWidth:Math.max(480,36+displayedColumns.reduce((width,column)=>width+column.width,0))}}><colgroup><col style={{width:36}}/>{displayedColumns.map(column=><col key={column.id} style={{width:column.width}}/>)}</colgroup><thead><tr><th><input type="checkbox" aria-label="현재 페이지 전체 선택" disabled={deleting!==null} checked={rows.some(product=>!product.source_capture||sourceReferences.has(product.id))&&rows.filter(product=>!product.source_capture||sourceReferences.has(product.id)).every(product=>product.source_capture?selectedSources.some(item=>item.id===product.id):selected.has(product.id))} onChange={event=>toggle(rows.filter(product=>!product.source_capture||sourceReferences.has(product.id)).map(product=>product.id),event.target.checked)}/></th>{displayedColumns.map(column=><th key={column.id} data-column={column.id} className={pinned(column.id)} aria-sort={['image','management'].includes(column.id)?undefined:sort?.column===column.id?sort.direction:'none'}><div className="registration-header-tools">{['image','management'].includes(column.id)?<span>{column.label}</span>:<button type="button" className="registration-sort" aria-label={`${column.label} 정렬`} title={sort?.column===column.id?sort.direction==='ascending'?'오름차순 · 클릭하여 내림차순':'내림차순 · 클릭하여 정렬 해제':'클릭하여 오름차순'} onClick={()=>changeSort(column.id)}><span>{column.label}</span><svg aria-hidden="true" width="9" height="12" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path className={sort?.column===column.id&&sort.direction==='ascending'?'active':''} d="M2 5 5 2l3 3"/><path className={sort?.column===column.id&&sort.direction==='descending'?'active':''} d="m2 9 3 3 3-3"/></svg></button>}<button type="button" className={`registration-filter-trigger${columnFilters[column.id]?' active':''}`} aria-label={`${column.label} 열 필터`} aria-expanded={filterPopup?.columnId===column.id} title={columnFilters[column.id]?'필터 적용 중':'이 열 필터'} onClick={event=>{const trigger=event.currentTarget,rect=trigger.getBoundingClientRect();setFilterPopup(current=>current?.columnId===column.id?null:{columnId:column.id,trigger,position:{left:Math.max(8,Math.min(rect.left,window.innerWidth-328)),top:Math.max(8,Math.min(rect.bottom+6,window.innerHeight-440))}});}}><svg aria-hidden="true" width="10" height="12" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M1 2h10L7.2 6.5v5L4.8 10v-3.5Z"/></svg></button></div></th>)}</tr></thead><tbody>
    {rows.map(product=>{const image=registrationThumbnail(product);const title=registrationTitle(product);const removal=productRemovalDecision(product);return <tr key={product.id}>
      <td><input type="checkbox" aria-label={`${title} 선택`} checked={product.source_capture?selectedSources.some(item=>item.id===product.id):selected.has(product.id)} disabled={deleting!==null||!!product.source_capture&&(sourceArchiveDisabled||!sourceReferences.has(product.id))} title={product.source_capture?'작업개시 시 선택한 수집본의 카테고리를 확인하고 상품 초안을 준비합니다. 삭제도 같은 선택을 사용합니다.':undefined} onChange={event=>toggle([product.id],event.target.checked)}/></td>
      {displayedColumns.map(column=><td key={column.id} data-column={column.id} className={`${column.id==='product'?'registration-product':''}${pinned(column.id)}`}>
        {column.id==='id'&&<><span className="registration-id">{product.source_capture?product.source_capture.snapshot.offerId:registrationNumber(product)}</span>{product.source_capture&&<small style={{display:'block'}}>수집본 {product.source_capture.captureVersion??1}</small>}<time dateTime={product.created_at}>{Number.isFinite(Date.parse(product.created_at))?dateTime.format(new Date(product.created_at)):'날짜 미확인'}</time></>}
        {column.id==='image'&&<button type="button" className="registration-thumbnail" onClick={()=>openEntry(product,'대표 이미지')} aria-label={`${title} 대표 이미지 열기`}>{image?<img src={image} width={56} height={56} alt="상품 이미지"/>:<span>이미지<br/>없음</span>}</button>}
        {column.id==='product'&&<><button type="button" className="registration-title" onClick={()=>openEntry(product)}>{title}</button><button type="button" className="registration-options" onClick={()=>openEntry(product,'옵션')}>옵션 {product.options_count}개</button>{product.source_capture&&<small>수집 완료 · 카테고리를 선택하세요</small>}{product.content_summary?.missingImages&&<small className="collection-error">이미지 연결 확인 필요</small>}</>}
        {column.id==='source'&&(sourceUrl(product.source_url)?<a className="registration-source-link" href={sourceUrl(product.source_url)} target="_blank" rel="noopener noreferrer" aria-label={`${title} 구매링크 새 창에서 열기`} title={product.source_url}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/></svg></a>:<span className="registration-source-empty">{product.source_url?'링크 확인 필요':'미입력'}</span>)}
        {column.step&&<button type="button" className={`registration-cell-button registration-stage-badge registration-stage-${registrationStepStatus(product,column.step).state}`} data-stage-state={registrationStepStatus(product,column.step).state} title={registrationStepDetail(product,column.step)} aria-label={`${title} ${column.label} 열기`} onClick={()=>openEntry(product,column.step)}>{registrationStepLabel(product,column.step)}</button>}
        {column.id==='status'&&<><span className="registration-state" data-state={transmissionState(product)} title={product.hub_receipt||product.hub_single_receipt?'보관된 Supplier Hub 전송 결과':'Supplier Hub 전송·접수 여부 검증 필요'}>{registrationTransmissionLabel(product)}</span>{product.hub_receipt&&<div aria-label="최근 전송 결과"><small>{product.hub_receipt.company.name} · SKU {product.hub_receipt.issuedSkus}/{product.hub_receipt.includedOptions}개</small>{product.hub_receipt.quotationId&&<small>견적서 ID: {product.hub_receipt.quotationId}</small>}<time dateTime={new Date(product.hub_receipt.observedAt).toISOString()}>{dateTime.format(new Date(product.hub_receipt.observedAt))}</time><small>{product.hub_single_receipt?`견적서 파일 전송 기준 · ${product.hub_receipt.label}`:'최근 전송한 견적서 기준'}</small></div>}
          {product.hub_single_receipt&&<div aria-label={product.hub_single_receipt.format==='yoofam-product-document-receipt-summary-v1'?'전체 상품 문서 전송 결과':'개별 문서 전송 결과'}><small>{product.hub_single_receipt.company.name} · {product.hub_single_receipt.format==='yoofam-product-document-receipt-summary-v1'?`포함 옵션 ${product.hub_single_receipt.optionCount}개 · 문서 1개`:`개별 전송 기록 ${product.hub_single_receipt.optionCount}개`}</small><small>{product.hub_single_receipt.label}</small><small>문서 ID: {String(product.hub_single_receipt.docId)}</small><small>등록 파일 ID: {String(product.hub_single_receipt.qvtRequestId)}</small><time dateTime={new Date(product.hub_single_receipt.observedAt).toISOString()}>{dateTime.format(new Date(product.hub_single_receipt.observedAt))}</time><small>SKU 확인 전 · 해당 전송 초안 기준</small></div>}
        </>}
        {column.id==='management'&&<div className="registration-management">{(product.source_capture?onArchiveSource:onDelete)?<button type="button" className="registration-delete" aria-label={`${title} 삭제`} title={product.source_capture?'수집 목록에서 삭제 · 원문 보존':removal.blocked?removal.reason:deleting===product.id?'삭제 중':'삭제'} disabled={deleting!==null||(product.source_capture?sourceArchiveDisabled||!sourceReferences.has(product.id):removal.blocked)} onClick={()=>deleteProduct(product)}>삭제</button>:<button type="button" className="btn ghost" aria-label={`${title} 상세`} onClick={()=>product.source_capture?openEntry(product):onOpen(product as T)}>열기</button>}</div>}
      </td>)}
    </tr>;})}
    </tbody></table>{!rows.length&&<div className="empty"><strong>{loading?'상품을 불러오는 중입니다.':error?'상품 조회 오류를 확인해주세요.':'조건에 맞는 상품이 없습니다.'}</strong><small>상품을 추가하거나 조회 기간·검색어를 변경하세요.</small></div>}</div>
    <footer className="registration-pagination"><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>이전</button><span>{currentPage+1} / {pages}</span><button type="button" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>다음</button></footer>
    {popupColumn&&filterPopup&&<RegistrationFilterPopover key={popupColumn.id} label={popupColumn.label} choices={popupChoices} allValues={registrationFilterChoices(entries.map(product=>registrationColumnText(product,popupColumn.id))).map(choice=>choice.value)} filter={columnFilters[popupColumn.id]} position={filterPopup.position} trigger={filterPopup.trigger}
      onClose={()=>setFilterPopup(null)} onSort={direction=>{setSort({column:popupColumn.id,direction});setPage(0);setFilterPopup(null);}}
      onApply={filter=>{setColumnFilters(current=>{const next={...current};if(filter)next[popupColumn.id]=filter;else delete next[popupColumn.id];return next;});setPage(0);setFilterPopup(null);}}/>}
  </section>;
}
