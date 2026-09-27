'use client';
import { useEffect, useState } from 'react';
import { calculateOptionPrices, optionQuotationName, type ProductOptionsResponse, type ProductOptions } from '@/app/product-options';
import type { PricePolicy } from '@/app/pricing';

export function OptionPricePreview({productId,version,policy}:{productId:string;version:string;policy:PricePolicy}) {
 const [attempt,setAttempt]=useState(0);
 const key=JSON.stringify([productId,version,attempt]);
 const [snapshot,setSnapshot]=useState<{key:string;options?:ProductOptions;error?:string}|null>(null);
 const current=snapshot?.key===key?snapshot:null;
 useEffect(()=>{
  const controller=new AbortController();
  void (async()=>{try{
   const response=await fetch(`/api/products/${encodeURIComponent(productId)}/options`,{cache:'no-store',signal:controller.signal});
   const body=await response.json() as ProductOptionsResponse & {error?:string};
   if(controller.signal.aborted)return;
   if(!response.ok)throw Error(body.error||'옵션을 불러오지 못했습니다.');
   if(body.productVersion!==version||body.options?.productId!==productId||!Array.isArray(body.options.rows))throw Error('상품과 옵션이 변경되었습니다. 상품을 다시 열어주세요.');
   setSnapshot({key,options:body.options});
  }catch(cause){if(!controller.signal.aborted)setSnapshot({key,error:cause instanceof Error?cause.message:'옵션 조회 실패'});}})();
  return()=>controller.abort();
 },[productId,version,key]);
 const rows=current?.options?.rows;
 const calculations=rows?calculateOptionPrices(rows,policy):[];
 const money=(value:number)=>value.toLocaleString('ko-KR',{maximumFractionDigits:6})+'원';
 return <section aria-label="옵션별 가격 미리보기" aria-busy={!current}>
  <h4>옵션·번들별 가격 미리보기</h4>
  <p>현재 입력한 가격 정책과 저장된 옵션 기준입니다. 옵션 편집 중인 값은 먼저 저장해주세요. 견적서에서 직접 수정한 가격은 이 계산보다 우선합니다.</p>
  {!current&&<p role="status">옵션 원가를 불러오는 중…</p>}
  {current?.error&&<p role="alert">{current.error}</p>}
  {current&&<button type="button" className="btn ghost" onClick={()=>setAttempt(value=>value+1)}>옵션 가격 다시 조회</button>}
  {rows?.length===0&&<p>저장된 옵션이 없습니다. 위 대표 원가 계산을 사용합니다.</p>}
  {!!rows?.length&&<div className="table-wrap"><table><thead><tr><th>옵션</th><th>구성 수량</th><th>판매단위 원가 CNY</th><th>원화 원가</th><th>공급가</th><th>공급 마진</th><th>판매가</th><th>쿠팡 마진</th><th>권장소비자가</th></tr></thead><tbody>{rows.map((row,index)=>{
   const result=calculations[index], price=result.calculation;
   return <tr key={row.id}><th scope="row">{optionQuotationName(row)||row.id}</th><td>{row.unitsPerPack}</td>{!row.included?<td colSpan={7}>견적 제외</td>:result.error?<td colSpan={7} role="alert">{result.error}</td>:price&&<><td>¥ {result.sourceCostCny}</td><td>{money(price.costKrw)}</td><td>{money(price.supplyPrice)}</td><td>{money(price.marginKrw)}<small> ({price.actualMargin.toFixed(2)}%)</small></td><td>{money(price.salePrice)}</td><td>{money(price.salePrice-price.supplyPrice)}<small> ({(price.salePrice>0?(price.salePrice-price.supplyPrice)/price.salePrice*100:0).toFixed(2)}%)</small></td><td>{money(price.msrp)}</td></>}</tr>;
  })}</tbody></table></div>}
 </section>;
}
