'use client';
/* eslint-disable @next/next/no-img-element -- Private image URLs require the current authenticated session. */

import { useState } from 'react';
import { archiveDateBounds, type ArchiveRange } from '@/app/product-archive';

type BoardProduct = {id:string;title:string;source_url:string;created_at:string;image_keys:string;options_count:number;registration_status:string;seo_status:string;quote_status:string;supply_price:number;sale_price:number};
export function filterRegistrationProducts<T extends BoardProduct>(products:T[],query:string,from:string|null,to:string|null) {
  return products.filter(product=>{
    const time=Date.parse(product.created_at);
    return `${product.title} ${product.source_url}`.toLowerCase().includes(query.trim().toLowerCase())
      &&(!from||(Number.isFinite(time)&&time>=Date.parse(from)))&&(!to||(Number.isFinite(time)&&time<Date.parse(to)));
  });
}
const steps=[['SEO','SEO 설정'],['가격','가격 설정'],['대표 이미지','대표 이미지'],['추가 이미지','추가 이미지'],['상세 이미지','상세 이미지'],['옵션','옵션 / 사이즈표'],['표시사항','한글 표시사항'],['견적서','견적서']];
const dateTime=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'});
function thumbnail(value:string) {try{const keys=JSON.parse(value);return Array.isArray(keys)&&typeof keys[0]==='string'?`/api/files/${keys[0].split('/').map(encodeURIComponent).join('/')}`:null;}catch{return null;}}
function sourceUrl(value:string) {try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}

export function RegistrationBoard<T extends BoardProduct>({products,selected,onSelected,onOpen,onOptions,loading,error,onArchive}:{products:T[];selected:Set<string>;onSelected:(value:Set<string>)=>void;onOpen:(product:T,step?:string)=>void;onOptions?:(product:T)=>void;loading:boolean;error:string;onArchive:()=>void}) {
  const [range,setRange]=useState<ArchiveRange>('all');const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const [status,setStatus]=useState('전체'); const [query,setQuery]=useState('');const [page,setPage]=useState(0);const [pageSize,setPageSize]=useState(10);
  let bounds:{startUtc:string|null;endUtc:string|null}={startUtc:null,endUtc:null};let dateError='';
  try{bounds=archiveDateBounds(range,from,to);}catch(cause){dateError=cause instanceof Error?cause.message:'날짜를 확인해주세요.';}
  const filtered=dateError?[]:filterRegistrationProducts(products,query,bounds.startUtc,bounds.endUtc).filter(product=>status==='전체'||(status==='작업 중'?!['전송 가능','전송완료'].includes(product.registration_status):product.registration_status===status));
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize));const currentPage=Math.min(page,pages-1);
  const rows=filtered.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const toggle=(ids:string[],include:boolean)=>{const next=new Set(selected);for(const id of ids){if(include)next.add(id);else next.delete(id);}onSelected(next);};
  return <section className="registration-board" aria-label="상품별 등록 현황">
    <div className="registration-datebar" role="group" aria-label="등록일 필터">
      {([['today','오늘'],['7days','7일'],['month','이번 달'],['all','전체']] as const).map(([id,label])=><label key={id}><input type="radio" name="registration-range" checked={range===id} onChange={()=>{setRange(id);setPage(0);}}/>{label}</label>)}
      <span>등록일 · 한국시간</span><input type="date" aria-label="등록 시작일" value={from} onChange={event=>{setFrom(event.target.value);setRange('custom');setPage(0);}}/><span>~</span><input type="date" aria-label="등록 종료일" value={to} min={from||undefined} onChange={event=>{setTo(event.target.value);setRange('custom');setPage(0);}}/>
      <button type="button" className="btn ghost" onClick={onArchive}>전체 보관함</button>
    </div>
    {dateError&&<p role="alert">{dateError}</p>}
    <div className="registration-table-tools"><select aria-label="등록 상태 필터" value={status} onChange={event=>{setStatus(event.target.value);setPage(0);}}>{['전체','작업 중','검토 대기','전송 가능'].map(value=><option key={value}>{value}</option>)}</select><label className="search"><input type="search" aria-label="상품 검색" placeholder="상품명 · 원본 URL 검색" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label><label>페이지당 <select aria-label="페이지당 상품 수" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(0);}}>{[10,25,50].map(count=><option key={count}>{count}</option>)}</select></label><span>{filtered.length}건 · 선택 {selected.size}건</span><small>최근 불러온 최대 200건 · 전체 기록은 상품 관리</small></div>
    <div className="table-wrap"><table className="couplus-work-table"><thead><tr><th><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={rows.length>0&&rows.every(product=>selected.has(product.id))} onChange={event=>toggle(rows.map(product=>product.id),event.target.checked)}/></th><th>등록번호 / 등록일</th><th>상품이미지</th><th>상품명 · 원본 URL</th>{steps.map(([,label])=><th key={label}>{label}</th>)}<th>등록 상태</th><th>관리</th></tr></thead><tbody>
    {rows.map(product=>{const image=thumbnail(product.image_keys);return <tr key={product.id}>
      <td><input type="checkbox" aria-label={`${product.title} 선택`} checked={selected.has(product.id)} onChange={event=>toggle([product.id],event.target.checked)}/></td>
      <td><span className="registration-id">SF-{product.id.slice(0,8).toUpperCase()}</span><time dateTime={product.created_at}>{Number.isFinite(Date.parse(product.created_at))?dateTime.format(new Date(product.created_at)):'날짜 미확인'}</time></td>
      <td><button type="button" className="registration-thumbnail" onClick={()=>onOpen(product,'대표 이미지')} aria-label={`${product.title} 대표 이미지 열기`}>{image?<img src={image} width={56} height={56} alt="상품 이미지"/>:<span>이미지<br/>없음</span>}</button></td>
      <td className="registration-product"><button type="button" className="registration-title" onClick={()=>onOpen(product)}>{product.title}</button><button type="button" className="registration-options" onClick={()=>onOptions?onOptions(product):onOpen(product,'옵션')}>옵션 {product.options_count}개</button><a href={sourceUrl(product.source_url)} target="_blank" rel="noreferrer">{product.source_url||'원본 URL 미입력'}</a><small>공급 {product.supply_price.toLocaleString('ko-KR')}원 · 판매 {product.sale_price.toLocaleString('ko-KR')}원</small></td>
      {steps.map(([step,label])=><td key={step}><button type="button" className="registration-cell-button" aria-label={`${product.title} ${label} 열기`} onClick={()=>onOpen(product,step)}>{step==='SEO'?product.seo_status==='완료'?'저장값 확인':'대기':step==='견적서'?product.quote_status==='완료'?'저장값 확인':'대기':step==='가격'?'가격 보기':'편집'}</button></td>)}
      <td><span className="registration-state">{product.registration_status}</span></td><td><button type="button" className="btn ghost" aria-label={`${product.title} 상세`} onClick={()=>onOpen(product)}>열기</button></td>
    </tr>;})}
    </tbody></table>{!rows.length&&<div className="empty"><strong>{loading?'상품을 불러오는 중입니다.':error?'상품 조회 오류를 확인해주세요.':'조건에 맞는 상품이 없습니다.'}</strong><small>상품을 추가하거나 조회 기간·검색어를 변경하세요.</small></div>}</div>
    <footer className="registration-pagination"><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>이전</button><span>{currentPage+1} / {pages}</span><button type="button" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>다음</button></footer>
  </section>;
}
