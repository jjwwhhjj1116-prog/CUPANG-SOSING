'use client';
import {useEffect,useRef,useState} from 'react';

type RemovedProduct={id:string;owner_id:string;title:string;source_url:string;updated_at:string;removed_at:string};
type RemovalSnapshot={ownerId?:string;attempt:number;rows?:RemovedProduct[];error?:string;restoringId?:string};
export function ProductRemovalDialog({workspaceOwnerId,onRestored,onBusyChange}:{workspaceOwnerId?:string;onRestored:()=>Promise<void>;onBusyChange?:(busy:boolean)=>void}){
  const [attempt,setAttempt]=useState(0),[snapshot,setSnapshot]=useState<RemovalSnapshot|null>(null);
  const current=snapshot&&snapshot.ownerId===workspaceOwnerId&&snapshot.attempt===attempt?snapshot:null;
  const rows=current?.rows??null,error=current?.error??'',busy=current?.restoringId??null;
  const active=useRef<AbortController|null>(null),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;const controller=new AbortController();
    void(async()=>{try{
      const response=await fetch('/api/products?removed=only',{cache:'no-store',signal:controller.signal});const body=await response.json() as {products?:unknown;error?:string}|null;if(controller.signal.aborted)return;
      if(!body||typeof body!=='object')throw Error('삭제된 상품 응답을 확인하지 못했습니다.');
      if(!response.ok)throw Error(body.error||'삭제된 상품을 불러오지 못했습니다.');
      if(!Array.isArray(body.products)||body.products.some((row:RemovedProduct)=>!row||typeof row.id!=='string'||!row.id||typeof row.title!=='string'||typeof row.updated_at!=='string'||!row.updated_at||typeof row.removed_at!=='string'||!row.removed_at||(workspaceOwnerId&&row.owner_id!==workspaceOwnerId)))throw Error('현재 계정의 삭제된 상품을 확인하지 못했습니다. 페이지를 새로고침해주세요.');
      setSnapshot({ownerId:workspaceOwnerId,attempt,rows:body.products});
    }catch(cause){if(!controller.signal.aborted)setSnapshot({ownerId:workspaceOwnerId,attempt,error:cause instanceof Error?cause.message:'조회 실패'});}})();
    return()=>{mounted.current=false;controller.abort();active.current?.abort();active.current=null;onBusyChange?.(false);};
  },[attempt,workspaceOwnerId,onBusyChange]);
  async function restore(product:RemovedProduct){
    if(active.current||!mounted.current||!rows?.some(row=>row.id===product.id))return;
    const controller=new AbortController();active.current=controller;
    setSnapshot(current=>current&&current.ownerId===workspaceOwnerId&&current.attempt===attempt?{...current,restoringId:product.id,error:undefined}:current);onBusyChange?.(true);
    try{
      const response=await fetch(`/api/products/${encodeURIComponent(product.id)}`,{method:'DELETE',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'restore',expectedVersion:product.updated_at,expectedRemovedAt:product.removed_at})});const body=await response.json() as {productId?:unknown;restored?:unknown;error?:string}|null;if(controller.signal.aborted)return;
      if(!body||typeof body!=='object')throw Error('복원 결과를 확인하지 못했습니다. 목록을 다시 불러와주세요.');
      if(!response.ok)throw Error(body.error||'상품을 복원하지 못했습니다. 목록을 다시 확인해주세요.');
      if(body.productId!==product.id||body.restored!==true)throw Error('복원 결과를 확인하지 못했습니다. 목록을 다시 불러와주세요.');
      setSnapshot(current=>current&&current.ownerId===workspaceOwnerId&&current.attempt===attempt?{...current,rows:current.rows?.filter(row=>row.id!==product.id)}:current);await onRestored();
    }catch(cause){if(!controller.signal.aborted)setSnapshot(current=>current&&current.ownerId===workspaceOwnerId&&current.attempt===attempt?{...current,error:cause instanceof Error?cause.message:'복원 실패'}:current);}
    finally{if(active.current===controller){active.current=null;onBusyChange?.(false);if(mounted.current)setSnapshot(current=>current&&current.ownerId===workspaceOwnerId&&current.attempt===attempt?{...current,restoringId:undefined}:current);}}
  }
  return <section aria-busy={rows===null&&!error||busy!==null}>
    <button type="button" className="btn ghost" disabled={busy!==null} onClick={()=>setAttempt(value=>value+1)}>새로고침</button>
    {error&&<p role="alert">{error}</p>}
    {rows===null&&!error&&<p role="status">삭제된 상품을 불러오는 중…</p>}
    {rows?.length===0&&<p>삭제된 상품이 없습니다.</p>}
    {rows&&rows.length>0&&<table className="registration-table"><thead><tr><th>등록번호</th><th>상품명</th><th>삭제일</th><th>관리</th></tr></thead><tbody>{rows.map(product=><tr key={product.id}><td>YP-{product.id.slice(0,8).toUpperCase()}</td><td>{product.title||'상품명 미입력'}</td><td>{new Date(product.removed_at).toLocaleString('ko-KR')}</td><td><button type="button" className="btn ghost" disabled={busy!==null} onClick={()=>void restore(product)}>{busy===product.id?'복원 중…':'복원'}</button></td></tr>)}</tbody></table>}
  </section>;
}
