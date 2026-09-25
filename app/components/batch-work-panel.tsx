'use client';

import { useEffect, useRef, useState } from 'react';
import { runBatchProduct } from '@/app/batch-work';
import { BatchTranslationPanel } from '@/app/components/batch-translation-panel';
type Item = {id:string;title:string;updated_at:string};
type Result = {status:'waiting'|'running'|'done'|'failed';message:string};
export function BatchWorkPanel({products,onOpen}:{products:Item[];onOpen:(id:string)=>void}) {
  const [busy,setBusy]=useState(false);const [results,setResults]=useState<Record<string,Result>>({});
  const [mode,setMode]=useState<'pricing'|'translation'>('pricing');
  const stop=useRef(false);const keys=useRef(new Map<string,string>());
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{stop.current=true;controller.current?.abort();},[]);
  async function run() {
    if(controller.current)return;
    const active=new AbortController();controller.current=active;setBusy(true);stop.current=false;
    for(const product of products) {
      if(stop.current)break;
      setResults(previous=>({...previous,[product.id]:{status:'running',message:'저장된 입력 확인·가격 계산 중'}}));
      try {
        const workflow=await runBatchProduct(product.id,{fetcher:fetch,signal:active.signal,keys:keys.current,newKey:()=>crypto.randomUUID()});
        if(!workflow)break;
        const complete=workflow.stages.filter(stage=>stage.status==='complete').length;
        const drafts=workflow.stages.filter(stage=>stage.status==='draft').length;
        const blocked=workflow.stages.filter(stage=>stage.status==='blocked').length;
        setResults(previous=>({...previous,[product.id]:{status:'done',message:`실행 산출물 ${complete}단계 · 저장 초안 ${drafts}단계 · 연결·자료 필요 ${blocked}단계`}}));
      }catch(error){if(active.signal.aborted)break;setResults(previous=>({...previous,[product.id]:{status:'failed',message:error instanceof Error?error.message:'실행 실패'}}));}
    }
    controller.current=null;
    if(!active.signal.aborted)setBusy(false);
  }
  if(mode==='translation')return <div className="modal-form"><button type="button" className="btn ghost" onClick={()=>setMode('pricing')}>← 가격 계산 작업</button><BatchTranslationPanel products={products} onOpen={onOpen}/></div>;
  return <div className="modal-form">
    <button type="button" className="btn blue" disabled={busy} onClick={()=>setMode('translation')}>완료된 번역 모아서 검토·적용</button>
    <p>선택한 {products.length}개 상품을 차례로 확인합니다. 현재 이 버튼이 실행하는 작업은 무료 가격 계산입니다. 유료 번역과 운영 등록은 각 상품 화면에서 별도로 검토합니다.</p>
    <ul className="batch-work-list">{products.map(product=><li key={product.id}><strong>{product.title}</strong><p role="status">{results[product.id]?.message??'실행 대기'}</p><button className="btn ghost" disabled={busy} onClick={()=>onOpen(product.id)}>상품별 작업 열기</button></li>)}</ul>
    <div className="modal-actions"><button className="btn ghost" disabled={!busy} onClick={()=>{stop.current=true;}}>현재 상품 후 중지</button><button className="btn primary" disabled={busy} onClick={()=>void run()}>{busy?'선택 상품 처리 중…':'선택 상품 무료 단계 실행'}</button></div>
  </div>;
}
