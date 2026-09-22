'use client';

import { useEffect, useRef, useState } from 'react';
import type { AutomationWorkflow } from '@/app/automation/model';
type Item = {id:string;title:string;updated_at:string};
type Result = {status:'waiting'|'running'|'done'|'failed';message:string};
export function BatchWorkPanel({products,onOpen}:{products:Item[];onOpen:(id:string)=>void}) {
  const [busy,setBusy]=useState(false);const [results,setResults]=useState<Record<string,Result>>({});
  const stop=useRef(false);const keys=useRef(new Map<string,string>());
  useEffect(()=>()=>{stop.current=true;},[]);
  async function run() {
    if(busy)return;setBusy(true);stop.current=false;
    for(const product of products) {
      if(stop.current)break;
      setResults(previous=>({...previous,[product.id]:{status:'running',message:'저장된 입력 확인·가격 계산 중'}}));
      try {
        const currentResponse=await fetch(`/api/products/${product.id}`,{cache:'no-store'});
        if(!currentResponse.ok)throw new Error('상품 최신 상태를 읽지 못했습니다.');
        const current=await currentResponse.json() as {product:Item};
        const identity=product.id+'@'+current.product.updated_at;
        if(!keys.current.has(identity))keys.current.set(identity,crypto.randomUUID());
        const response=await fetch(`/api/products/${product.id}/automation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'run',expectedVersion:current.product.updated_at,idempotencyKey:keys.current.get(identity)})});
        const body=await response.json() as {workflow:AutomationWorkflow;error?:string};
        if(!response.ok)throw new Error(body.error||'작업을 저장하지 못했습니다.');
        const complete=body.workflow.stages.filter(stage=>stage.status==='complete').length;
        const drafts=body.workflow.stages.filter(stage=>stage.status==='draft').length;
        const blocked=body.workflow.stages.filter(stage=>stage.status==='blocked').length;
        setResults(previous=>({...previous,[product.id]:{status:'done',message:`실행 산출물 ${complete}단계 · 저장 초안 ${drafts}단계 · 연결·자료 필요 ${blocked}단계`}}));
      }catch(error){setResults(previous=>({...previous,[product.id]:{status:'failed',message:error instanceof Error?error.message:'실행 실패'}}));}
    }
    setBusy(false);
  }
  return <div className="modal-form">
    <p>선택한 {products.length}개 상품을 차례로 확인합니다. 현재 이 버튼이 실행하는 작업은 무료 가격 계산입니다. 유료 번역과 운영 등록은 각 상품 화면에서 별도로 검토합니다.</p>
    <ul className="batch-work-list">{products.map(product=><li key={product.id}><strong>{product.title}</strong><p role="status">{results[product.id]?.message??'실행 대기'}</p><button className="btn ghost" disabled={busy} onClick={()=>onOpen(product.id)}>상품별 작업 열기</button></li>)}</ul>
    <div className="modal-actions"><button className="btn ghost" disabled={!busy} onClick={()=>{stop.current=true;}}>현재 상품 후 중지</button><button className="btn primary" disabled={busy} onClick={()=>void run()}>{busy?'선택 상품 처리 중…':'선택 상품 무료 단계 실행'}</button></div>
  </div>;
}
