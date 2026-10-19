'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runBatchProduct } from '@/app/batch-work';
import { BatchLabelPanel } from '@/app/components/batch-label-panel';
import { BatchTranslationPanel } from '@/app/components/batch-translation-panel';
import { BatchImageWorkPanel } from '@/app/components/batch-image-work-panel';
import { BatchLabelDraftPanel } from '@/app/components/batch-label-draft-panel';
import { BatchSeoWorkPanel } from '@/app/components/batch-seo-work-panel';
type Item = {id:string;title:string;updated_at:string};
type Result = {status:'waiting'|'running'|'done'|'failed';message:string};
export function BatchWorkPanel({products,onOpen,onBusyChange}:{products:Item[];onOpen:(id:string,step?:'대표 이미지'|'견적서'|'작업')=>void;onBusyChange?:(busy:boolean)=>void}) {
  const [busy,setBusy]=useState(false);const [results,setResults]=useState<Record<string,Result>>({});
  const [mode,setMode]=useState<'pricing'|'translation'|'labels'|'images'|'labelDrafts'|'seo'>('pricing');
  const [seoProducts,setSeoProducts]=useState<Item[]>(products),[seoBusy,setSeoBusy]=useState(false),[seoPending,setSeoPending]=useState(false);
  const seoBusyRef=useRef(false),seoPendingRef=useRef(false),seoSession=useRef<object|null>(null);
  const [labelProducts,setLabelProducts]=useState<Item[]>(products),[draftProducts,setDraftProducts]=useState<Item[]>(products);
  const [draftBusy,setDraftBusy]=useState(false),[draftPending,setDraftPending]=useState(false);
  const draftBusyRef=useRef(false),draftPendingRef=useRef(false);
  const [imageProducts,setImageProducts]=useState<Item[]>(products),[imageAutoPrepare,setImageAutoPrepare]=useState(false);
  const [imagesBusy,setImagesBusy]=useState(false),[imagesPending,setImagesPending]=useState(false);
  const imagesBusyRef=useRef(false),imagesPendingRef=useRef(false);
  const [labelsBusy,setLabelsBusy]=useState(false),labelsBusyRef=useRef(false),busyCallback=useRef(onBusyChange);
  useLayoutEffect(()=>{busyCallback.current=onBusyChange;},[onBusyChange]);
  const changeLabelsBusy=(value:boolean)=>{labelsBusyRef.current=value;setLabelsBusy(value);busyCallback.current?.(value);};
  const changeImagesBusy=(value:boolean)=>{imagesBusyRef.current=value;setImagesBusy(value);busyCallback.current?.(value||imagesPendingRef.current);};
  const changeImagesPending=(value:boolean)=>{imagesPendingRef.current=value;setImagesPending(value);busyCallback.current?.(value||imagesBusyRef.current);};
  const changeDraftBusy=(value:boolean)=>{draftBusyRef.current=value;setDraftBusy(value);busyCallback.current?.(value||draftPendingRef.current);};
  const changeDraftPending=(value:boolean)=>{draftPendingRef.current=value;setDraftPending(value);busyCallback.current?.(value||draftBusyRef.current);};
  const changeSeoBusy=(value:boolean)=>{seoBusyRef.current=value;setSeoBusy(value);busyCallback.current?.(value||seoPendingRef.current);};
  const changeSeoPending=(value:boolean)=>{seoPendingRef.current=value;setSeoPending(value);busyCallback.current?.(value||seoBusyRef.current);};
  const stop=useRef(false);const keys=useRef(new Map<string,string>());
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{stop.current=true;controller.current?.abort();busyCallback.current?.(false);},[]);
  const navigationLocked=()=>!!controller.current||labelsBusyRef.current||imagesBusyRef.current||imagesPendingRef.current||draftBusyRef.current||draftPendingRef.current||seoBusyRef.current||seoPendingRef.current;
  function startSeo(){if(navigationLocked()||seoSession.current)return;seoSession.current={};changeSeoBusy(true);setSeoProducts(products.map(product=>({...product})));setMode('seo');}
  async function run(selected:Item[]=products) {
    if(navigationLocked())return;
    const active=new AbortController();controller.current=active;setBusy(true);busyCallback.current?.(true);stop.current=false;
    const preparedProducts:Item[]=[];
    for(const product of selected) {
      if(stop.current)break;
      setResults(previous=>({...previous,[product.id]:{status:'running',message:'저장 원본 이미지 초안 준비·가격 확인 중'}}));
      try {
        let preparation='';
        const workflow=await runBatchProduct(product.id,{fetcher:(input,init)=>fetch(input,init),signal:active.signal,keys:keys.current,newKey:()=>crypto.randomUUID(),prepareDrafts:true,onPreparation:result=>{preparation=result.message;}});
        if(!workflow)break;
        preparedProducts.push(product);
        const pricingReady=workflow.stages.some(stage=>stage.id==='pricing'&&stage.status==='complete');
        const drafts=workflow.stages.filter(stage=>stage.status==='draft').length;
        const blocked=workflow.stages.filter(stage=>stage.status==='blocked').length;
        setResults(previous=>({...previous,[product.id]:{status:'done',message:`${preparation} ${pricingReady?'가격 확인됨':'가격 입력 확인 필요'} · 저장 초안 ${drafts}단계 · 검토·자료 필요 ${blocked}단계`}}));
      }catch(error){if(active.signal.aborted)break;setResults(previous=>({...previous,[product.id]:{status:'failed',message:error instanceof Error?error.message:'실행 실패'}}));}
    }
    controller.current=null;
    busyCallback.current?.(false);
    if(!active.signal.aborted){setBusy(false);if(!stop.current&&preparedProducts.length){setImageProducts(preparedProducts);setImageAutoPrepare(true);setMode('images');}}
  }
  const productResults=<ul className="batch-work-list">{products.map(product=><li key={product.id}><strong>{product.title}</strong><p role="status">{results[product.id]?.message??'실행 대기'}</p><button className="btn ghost" disabled={busy||imagesBusy||imagesPending||draftBusy||draftPending||seoBusy||seoPending} onClick={()=>{if(!navigationLocked())onOpen(product.id,'대표 이미지');}}>이미지 초안 검토</button><button className="btn ghost" disabled={busy||imagesBusy||imagesPending||draftBusy||draftPending||seoBusy||seoPending} onClick={()=>{if(!navigationLocked())onOpen(product.id,'견적서');}}>견적 초안 검토</button><button className="btn ghost" disabled={busy||imagesBusy||imagesPending||draftBusy||draftPending||seoBusy||seoPending} onClick={()=>{if(!navigationLocked())onOpen(product.id,'작업');}}>상품별 작업 열기</button></li>)}</ul>;
  if(mode==='seo'){const session=seoSession.current;return <div className="modal-form" data-workspace-saving={seoBusy} data-workspace-dirty={seoPending}><button type="button" className="btn ghost" disabled={seoBusy||seoPending} onClick={()=>{if(!navigationLocked()&&seoSession.current===session){seoSession.current=null;setMode('pricing');}}}>← 초안 준비 작업</button>{productResults}<BatchSeoWorkPanel products={seoProducts}
    onBusyChange={value=>{if(seoSession.current===session)changeSeoBusy(value);}} onPendingChange={value=>{if(seoSession.current===session)changeSeoPending(value);}}
    onComplete={selected=>{if(!session||seoSession.current!==session||navigationLocked())return;seoSession.current=null;setMode('pricing');void run(selected.map(product=>({...product,updated_at:product.updated_at??products.find(row=>row.id===product.id)!.updated_at})));}}/></div>;}
  if(mode==='images')return <div className="modal-form" data-workspace-saving={imagesBusy} data-workspace-dirty={imagesPending}><button type="button" className="btn ghost" disabled={imagesBusy||imagesPending} onClick={()=>{if(!imagesBusyRef.current&&!imagesPendingRef.current)setMode('pricing');}}>← 초안 준비 작업</button><button type="button" className="btn blue" disabled={imagesBusy||imagesPending} onClick={()=>{if(imagesBusyRef.current||imagesPendingRef.current)return;setDraftProducts(imageProducts);setMode('labelDrafts');}}>다음: 한글표시사항 초안 작성</button>{productResults}<BatchImageWorkPanel products={imageProducts} autoPrepare={imageAutoPrepare} onBusyChange={changeImagesBusy} onPendingChange={changeImagesPending}/></div>;
  if(mode==='labelDrafts')return <div className="modal-form" data-workspace-saving={draftBusy} data-workspace-dirty={draftPending}><button type="button" className="btn ghost" disabled={draftBusy||draftPending} onClick={()=>{if(!draftBusyRef.current&&!draftPendingRef.current)setMode('pricing');}}>← 초안 준비 작업</button>{productResults}<BatchLabelDraftPanel products={draftProducts} autoGenerateDraft onBusyChange={changeDraftBusy} onPendingChange={changeDraftPending}/><button type="button" className="btn blue" disabled={draftBusy||draftPending} onClick={()=>{if(draftBusyRef.current||draftPendingRef.current)return;setLabelProducts(draftProducts);setMode('labels');}}>다음: 저장한 표시사항 PNG 일괄 생성·연결</button></div>;
  if(mode==='labels')return <div className="modal-form" data-workspace-saving={labelsBusy}><button type="button" className="btn ghost" disabled={labelsBusy} onClick={()=>{if(!labelsBusyRef.current)setMode('pricing');}}>← 초안 준비 작업</button><BatchLabelPanel products={labelProducts} onOpen={onOpen} onBusyChange={changeLabelsBusy}/></div>;
  if(mode==='translation')return <div className="modal-form"><button type="button" className="btn ghost" onClick={()=>setMode('pricing')}>← 초안 준비 작업</button><BatchTranslationPanel products={products} onOpen={onOpen}/></div>;
  return <div className="modal-form">
    <button type="button" className="btn blue" disabled={busy} onClick={()=>setMode('translation')}>완료된 번역 모아서 검토·적용</button>
    <button type="button" className="btn blue" disabled={busy} onClick={()=>{setDraftProducts(products);setMode('labelDrafts');}}>선택 상품 표시사항 초안 작성·검토</button>
    <button type="button" className="btn blue" disabled={busy} onClick={()=>{setLabelProducts(products);setMode('labels');}}>선택 상품 표시사항 PNG 일괄 생성·연결</button>
    <button type="button" className="btn blue" disabled={busy} onClick={()=>{setImageProducts(products);setImageAutoPrepare(false);setMode('images');}}>대표·추가·상세 이미지 모아서 번역</button>
    <p>선택한 {products.length}개 상품의 SEO 저장본을 먼저 확인합니다. 미완성 SEO는 검토하거나 나중에 검토하기로 선택한 뒤, 저장된 원본으로 이미지 초안을 준비하고 가격을 확인합니다. 직접 수정한 값·공란·이미지 순서는 유지합니다.</p>
    <p>초안·가격 확인 후 기본설정에서 이미지 번역이 켜져 있으면 무료 이미지 번역을 준비합니다. 결과를 검토·수정한 뒤 견적서에서 등록전송을 진행해주세요.</p>
    {productResults}
    <div className="modal-actions"><button className="btn ghost" disabled={!busy} onClick={()=>{stop.current=true;}}>현재 상품 후 중지</button><button className="btn primary" disabled={busy} onClick={startSeo}>{busy?'선택 상품 처리 중…':'선택 상품 초안 준비·가격 확인'}</button></div>
  </div>;
}
