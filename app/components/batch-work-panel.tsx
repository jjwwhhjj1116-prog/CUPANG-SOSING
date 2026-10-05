'use client';

import { useEffect, useRef, useState } from 'react';
import { runBatchProduct } from '@/app/batch-work';
import { BatchLabelPanel } from '@/app/components/batch-label-panel';
import { BatchTranslationPanel } from '@/app/components/batch-translation-panel';
type Item = {id:string;title:string;updated_at:string};
type Result = {status:'waiting'|'running'|'done'|'failed';message:string};
export function BatchWorkPanel({products,onOpen}:{products:Item[];onOpen:(id:string,step?:'대표 이미지'|'견적서'|'작업')=>void}) {
  const [busy,setBusy]=useState(false);const [results,setResults]=useState<Record<string,Result>>({});
  const [mode,setMode]=useState<'pricing'|'translation'|'labels'>('pricing');
  const stop=useRef(false);const keys=useRef(new Map<string,string>());
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{stop.current=true;controller.current?.abort();},[]);
  async function run() {
    if(controller.current)return;
    const active=new AbortController();controller.current=active;setBusy(true);stop.current=false;
    for(const product of products) {
      if(stop.current)break;
      setResults(previous=>({...previous,[product.id]:{status:'running',message:'저장 원본 이미지 초안 준비·가격 확인 중'}}));
      try {
        let preparation='';
        const workflow=await runBatchProduct(product.id,{fetcher:(input,init)=>fetch(input,init),signal:active.signal,keys:keys.current,newKey:()=>crypto.randomUUID(),prepareDrafts:true,onPreparation:result=>{preparation=result.message;}});
        if(!workflow)break;
        const pricingReady=workflow.stages.some(stage=>stage.id==='pricing'&&stage.status==='complete');
        const drafts=workflow.stages.filter(stage=>stage.status==='draft').length;
        const blocked=workflow.stages.filter(stage=>stage.status==='blocked').length;
        setResults(previous=>({...previous,[product.id]:{status:'done',message:`${preparation} ${pricingReady?'가격 확인됨':'가격 입력 확인 필요'} · 저장 초안 ${drafts}단계 · 검토·자료 필요 ${blocked}단계`}}));
      }catch(error){if(active.signal.aborted)break;setResults(previous=>({...previous,[product.id]:{status:'failed',message:error instanceof Error?error.message:'실행 실패'}}));}
    }
    controller.current=null;
    if(!active.signal.aborted)setBusy(false);
  }
  if(mode==='labels')return <div className="modal-form"><button type="button" className="btn ghost" onClick={()=>setMode('pricing')}>← 초안 준비 작업</button><BatchLabelPanel products={products} onOpen={onOpen}/></div>;
  if(mode==='translation')return <div className="modal-form"><button type="button" className="btn ghost" onClick={()=>setMode('pricing')}>← 초안 준비 작업</button><BatchTranslationPanel products={products} onOpen={onOpen}/></div>;
  return <div className="modal-form">
    <button type="button" className="btn blue" disabled={busy} onClick={()=>setMode('translation')}>완료된 번역 모아서 검토·적용</button>
    <button type="button" className="btn blue" disabled={busy} onClick={()=>setMode('labels')}>선택 상품 표시사항 PNG 일괄 생성·연결</button>
    <p>선택한 {products.length}개 상품의 저장된 원본으로 대표·추가·상세 이미지와 옵션 이미지 초안을 준비하고 가격을 확인합니다. 직접 수정한 값·공란·이미지 순서는 유지합니다.</p>
    <p>원본 이미지 초안과 표시사항을 검토·수정한 뒤 견적서에서 등록전송을 진행해주세요.</p>
    <ul className="batch-work-list">{products.map(product=><li key={product.id}><strong>{product.title}</strong><p role="status">{results[product.id]?.message??'실행 대기'}</p><button className="btn ghost" disabled={busy} onClick={()=>onOpen(product.id,'대표 이미지')}>이미지 초안 검토</button><button className="btn ghost" disabled={busy} onClick={()=>onOpen(product.id,'견적서')}>견적 초안 검토</button><button className="btn ghost" disabled={busy} onClick={()=>onOpen(product.id,'작업')}>상품별 작업 열기</button></li>)}</ul>
    <div className="modal-actions"><button className="btn ghost" disabled={!busy} onClick={()=>{stop.current=true;}}>현재 상품 후 중지</button><button className="btn primary" disabled={busy} onClick={()=>void run()}>{busy?'선택 상품 처리 중…':'선택 상품 초안 준비·가격 확인'}</button></div>
  </div>;
}
