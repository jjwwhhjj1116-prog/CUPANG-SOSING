'use client';
/* eslint-disable @next/next/no-img-element -- Images use authenticated same-origin file access. */
import {useEffect,useState} from 'react';
import {optionQuotationName,type ProductOptionsResponse} from '@/app/product-options';

type Props={productId:string;sourceUrl:string;imageKeys:string;onQuotation:(optionId:string)=>void;onEdit:()=>void};
export async function readOptionBoard(productId:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<ProductOptionsResponse>{
  const response=await fetcher(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store',signal});
  const body=await response.json() as ProductOptionsResponse & {error?:string};
  if(!response.ok)throw Error(body?.error||'옵션을 불러오지 못했습니다.');
  if(!body||body.options?.productId!==productId||body.options.schemaVersion!==1||!Array.isArray(body.options.rows)||!Array.isArray(body.pricing?.rows))throw Error('상품의 옵션 응답을 확인하지 못했습니다.');
  return body;
}
export function ProductOptionBoard({productId,sourceUrl,imageKeys,onQuotation,onEdit}:Props){
  const [data,setData]=useState<ProductOptionsResponse|null>(null);
  const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);const [query,setQuery]=useState('');
  useEffect(()=>{const controller=new AbortController();setData(null);setError('');
    readOptionBoard(productId,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'옵션 조회 실패');});
    return()=>controller.abort();
  },[productId,attempt]);
  let keys:string[]=[];try{const parsed:unknown=JSON.parse(imageKeys);if(Array.isArray(parsed))keys=parsed.filter((key):key is string=>typeof key==='string');}catch{/* No unverified image references. */}
  const rows=data?.options.rows.filter(row=>[row.id,row.supplierSku,row.originalName,row.translatedName,row.color,row.size].join(' ').toLowerCase().includes(query.trim().toLowerCase()))??[];
  let url:string|undefined;try{const parsed=new URL(sourceUrl);if(parsed.protocol==='https:'&&parsed.hostname==='detail.1688.com')url=parsed.href;}catch{/* Display text only. */}
  return <section className="option-board" aria-busy={!data&&!error}>
    <div className="option-board-source"><strong>1688 원본 URL</strong>{url?<a href={url} target="_blank" rel="noreferrer">{sourceUrl}</a>:<span>{sourceUrl||'미입력'}</span>}</div>
    <div className="registration-table-tools"><label className="search"><input type="search" aria-label="상품 옵션 검색" placeholder="옵션명 · SKU · 색상 · 사이즈" value={query} onChange={event=>setQuery(event.target.value)}/></label><span>총 {data?.options.rows.length??0}개 옵션 · 검색 {rows.length}개</span><button type="button" className="btn ghost" onClick={onEdit}>옵션·번들·가격 수정</button><button type="button" className="btn ghost" onClick={()=>setAttempt(value=>value+1)}>새로고침</button></div>
    {error?<p role="alert">{error}</p>:!data?<p role="status">저장된 옵션·가격을 불러오는 중…</p>:<div className="table-wrap"><table className="option-work-table"><thead><tr><th>옵션번호 / SKU</th><th>옵션명</th><th>옵션 이미지</th><th>구성 수량</th><th>재고 / 가격</th><th>견적 포함</th><th>견적서</th></tr></thead><tbody>{rows.map(row=>{
      const calculation=data.pricing.rows.find(item=>item.optionId===row.id);
      const imageKey=row.imageKey&&keys.includes(row.imageKey)?row.imageKey:null;
      return <tr key={row.id}><td>{row.id}<small>{row.supplierSku||'SKU 미입력'}</small></td><td><strong>{optionQuotationName(row)||'(옵션명 공란)'}</strong><small>{row.originalName}</small></td><td>{imageKey?<img src={`/api/files/${imageKey.split('/').map(encodeURIComponent).join('/')}`} alt={optionQuotationName(row)||'옵션 이미지'} width={64} height={64}/>:<small>개별 이미지 없음</small>}</td><td>{row.unitsPerPack}개</td><td>{row.stock==null?'재고 미확인':`재고 ${row.stock.toLocaleString('ko-KR')}개`}<small>{row.unitCostCny===null?'원가 미입력':`¥${row.unitCostCny} / 개`}</small>{calculation?.calculation?<><small>{calculation.calculation.supplyPrice.toLocaleString('ko-KR')}원 (공급가)</small><small>{calculation.calculation.salePrice.toLocaleString('ko-KR')}원 (판매가)</small></>:<small>{calculation?.error||'가격 미계산'}</small>}</td><td>{row.included?'포함':'제외'}</td><td><button type="button" className="btn ghost" onClick={()=>onQuotation(row.id)}>견적서 열기</button></td></tr>;
    })}</tbody></table>{!rows.length&&<p className="collection-empty">{data.options.rows.length?'검색 결과가 없습니다.':'저장된 옵션이 없습니다.'}</p>}</div>}
  </section>;
}
