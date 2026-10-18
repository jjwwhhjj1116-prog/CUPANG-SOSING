'use client';
import {useEffect,useRef,useState} from 'react';
import {registrationNumber} from '@/app/product-registration';
import {parseRemovedProductsPage,type RemovedProductSummary} from '@/app/product-removal-pagination';

type RemovalSnapshot={ownerId?:string;attempt:number;pageIndex:number;cursor:string|null;operation:object;rows?:RemovedProductSummary[];nextCursor?:string|null;error?:string;restoringId?:string};
export function ProductRemovalDialog({workspaceOwnerId,onRestored,onBusyChange}:{workspaceOwnerId?:string;onRestored:()=>Promise<void>;onBusyChange?:(busy:boolean)=>void}){
  const [attempt,setAttempt]=useState(0),[snapshot,setSnapshot]=useState<RemovalSnapshot|null>(null);
  const [navigation,setNavigation]=useState<{ownerId?:string;cursors:(string|null)[];index:number}>(()=>({ownerId:workspaceOwnerId,cursors:[null],index:0}));
  const pageIndex=navigation.ownerId===workspaceOwnerId?navigation.index:0,cursor=navigation.ownerId===workspaceOwnerId?navigation.cursors[pageIndex]:null;
  const current=snapshot&&snapshot.ownerId===workspaceOwnerId&&snapshot.attempt===attempt&&snapshot.pageIndex===pageIndex&&snapshot.cursor===cursor?snapshot:null;
  const rows=current?.rows??null,error=current?.error??'',busy=current?.restoringId??null;
  const active=useRef<AbortController|null>(null),mounted=useRef(false),listing=useRef<object|null>(null);
  useEffect(()=>{mounted.current=true;const controller=new AbortController();
    const operation={};listing.current=operation;
    void(async()=>{try{
      const response=await fetch('/api/products/removed'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{cache:'no-store',signal:controller.signal});const body=await response.json() as {products?:unknown;error?:string}|null;if(controller.signal.aborted||listing.current!==operation)return;
      if(!body||typeof body!=='object')throw Error('삭제된 상품 응답을 확인하지 못했습니다.');
      if(!response.ok)throw Error(body.error||'삭제된 상품을 불러오지 못했습니다.');
      const page=parseRemovedProductsPage(body,workspaceOwnerId);
      setSnapshot({ownerId:workspaceOwnerId,attempt,pageIndex,cursor,operation,rows:page.products,nextCursor:page.nextCursor});
    }catch(cause){if(!controller.signal.aborted&&listing.current===operation)setSnapshot({ownerId:workspaceOwnerId,attempt,pageIndex,cursor,operation,error:cause instanceof Error?cause.message:'조회 실패'});}})();
    return()=>{mounted.current=false;if(listing.current===operation)listing.current=null;controller.abort();active.current?.abort();active.current=null;onBusyChange?.(false);};
  },[attempt,workspaceOwnerId,onBusyChange,pageIndex,cursor]);
  function refresh(){if(active.current)return;listing.current=null;setNavigation({ownerId:workspaceOwnerId,cursors:[null],index:0});setAttempt(value=>value+1);}
  function movePage(next:number){
    if(active.current||!current||listing.current!==current.operation||rows===null||next<0||next>pageIndex&&!current.nextCursor)return;
    listing.current=null;
    setNavigation(previous=>({ownerId:workspaceOwnerId,cursors:next>pageIndex?[...(previous.ownerId===workspaceOwnerId?previous.cursors.slice(0,pageIndex+1):[null]),current.nextCursor!]:previous.cursors,index:next}));
  }
  async function restore(product:RemovedProductSummary){
    if(active.current||!mounted.current||!current||listing.current!==current.operation||!rows?.some(row=>row.id===product.id))return;
    const operation=current.operation;
    const controller=new AbortController();active.current=controller;
    setSnapshot(current=>current&&current.ownerId===workspaceOwnerId&&current.attempt===attempt?{...current,restoringId:product.id,error:undefined}:current);onBusyChange?.(true);
    try{
      const response=await fetch(`/api/products/${encodeURIComponent(product.id)}`,{method:'DELETE',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'restore',expectedVersion:product.updated_at,expectedRemovedAt:product.removed_at})});const body=await response.json() as {productId?:unknown;restored?:unknown;error?:string}|null;if(controller.signal.aborted||listing.current!==operation)return;
      if(!body||typeof body!=='object')throw Error('복원 결과를 확인하지 못했습니다. 목록을 다시 불러와주세요.');
      if(!response.ok)throw Error(body.error||'상품을 복원하지 못했습니다. 목록을 다시 확인해주세요.');
      if(body.productId!==product.id||body.restored!==true)throw Error('복원 결과를 확인하지 못했습니다. 목록을 다시 불러와주세요.');
      setSnapshot(current=>current&&current.ownerId===workspaceOwnerId&&current.attempt===attempt?{...current,rows:current.rows?.filter(row=>row.id!==product.id)}:current);await onRestored();
    }catch(cause){if(!controller.signal.aborted&&listing.current===operation)setSnapshot(current=>current&&current.ownerId===workspaceOwnerId&&current.attempt===attempt?{...current,error:cause instanceof Error?cause.message:'복원 실패'}:current);}
    finally{if(active.current===controller){active.current=null;onBusyChange?.(false);if(mounted.current)setSnapshot(current=>current&&current.ownerId===workspaceOwnerId&&current.attempt===attempt?{...current,restoringId:undefined}:current);}}
  }
  return <section aria-busy={rows===null&&!error||busy!==null}>
    <button type="button" className="btn ghost" disabled={busy!==null} onClick={refresh}>새로고침</button>
    {error&&<p role="alert">{error}</p>}
    {rows===null&&!error&&<p role="status">삭제된 상품을 불러오는 중…</p>}
    {rows?.length===0&&<p>{pageIndex===0&&!current?.nextCursor?'삭제된 상품이 없습니다.':'이 페이지에 남은 삭제 상품이 없습니다. 이전 페이지 또는 새로고침으로 다시 확인하세요.'}</p>}
    {rows&&rows.length>0&&<table className="registration-table"><thead><tr><th>등록번호</th><th>상품명</th><th>삭제일</th><th>관리</th></tr></thead><tbody>{rows.map(product=><tr key={product.id}><td>{registrationNumber(product)}</td><td>{product.title||'상품명 미입력'}</td><td>{new Date(product.removed_at).toLocaleString('ko-KR')}</td><td><button type="button" className="btn ghost" disabled={busy!==null} onClick={()=>void restore(product)}>{busy===product.id?'복원 중…':'복원'}</button></td></tr>)}</tbody></table>}
    <nav aria-label="삭제된 상품 페이지"><button type="button" className="btn ghost" disabled={busy!==null||rows===null||pageIndex===0} onClick={()=>movePage(pageIndex-1)}>이전</button><span>{pageIndex+1} 페이지 · {rows?.length??0}개</span><button type="button" className="btn ghost" disabled={busy!==null||rows===null||!current?.nextCursor} onClick={()=>movePage(pageIndex+1)}>다음</button></nav>
  </section>;
}
