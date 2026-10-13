'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runProductNineLabels, pendingProductNineLabelBatch, productNineLabelBatchHeld, recoverProductNineLabelBatch, releaseProductNineLabelBatch, type ProductNineLabelBatchCache } from '@/app/product-label-batch';
import { renderDocument } from '@/app/document-image-render';

export function BatchLabelPanel({ products, onOpen, onBusyChange }: { products: { id: string; title: string }[]; onOpen: (id: string) => void; onBusyChange?:(busy:boolean)=>void }) {
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [stopping, setStopping] = useState(false);
  const [pending,setPending]=useState<string|null>(null),[held,setHeld]=useState(false);
  const alive = useRef(true), running = useRef(false), stop = useRef(false);
  const cache = useRef<ProductNineLabelBatchCache>(new Map()), callback=useRef(onBusyChange),recovery=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{callback.current=onBusyChange;},[onBusyChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; recovery.current?.abort();callback.current?.(false); }; }, []);
  const report = (id: string, message: string) => { if (alive.current) setMessages(previous => ({ ...previous, [id]: message })); };
  const publishPending=()=>{const nextHeld=productNineLabelBatchHeld(cache.current);callback.current?.(nextHeld);if(alive.current){setPending(pendingProductNineLabelBatch(cache.current));setHeld(nextHeld);}};
  async function run() {
    if (running.current) return;
    if(pendingProductNineLabelBatch(cache.current))return;
    running.current = true; stop.current = false; callback.current?.(true);setBusy(true); setStopping(false);
    try {
      for (const product of products) {
        if (stop.current || !alive.current) break;
        report(product.id, '저장된 한글 표시사항 9항목 확인 중');
        try {
          const result = await runProductNineLabels(product.id, { cache: cache.current, render: renderDocument,
            shouldStop: () => stop.current || !alive.current,
            onProgress: progress => report(product.id, `${progress.completed}/${progress.total}개 라벨 연결 · ${progress.optionLabel}`) });
          if (!result) break;
          report(product.id, result.uncertain?'현재 옵션의 저장 응답을 읽기로 확인해주세요. 다음 옵션은 저장하지 않았습니다.':result.stopped ? `${result.completed}/${result.total}개 처리 후 중지 · 완료된 파일 보존` : `${result.completed}개 옵션 라벨 생성·견적 연결 완료 · 내용 검토 필요`);
          if(result.stopped)break;
        } catch (cause) {
          report(product.id, `${cause instanceof Error ? cause.message : '라벨 생성 실패'} 완료된 파일은 보존됩니다.`);
        }
      }
    } finally { running.current = false;if(stop.current)releaseProductNineLabelBatch(cache.current);publishPending(); if (alive.current) { setBusy(false); setStopping(false); } }
  }
  async function recover(){
    if(running.current||!pending)return;
    const controller=new AbortController();recovery.current=controller;running.current=true;stop.current=false;callback.current?.(true);setBusy(true);setStopping(false);
    try{const status=await recoverProductNineLabelBatch(pending,cache.current,async(url,init)=>fetch(url,{...init,signal:controller.signal}));
      if(alive.current&&!controller.signal.aborted)report(pending,status==='applied'?'현재 옵션의 저장 완료를 확인했습니다. 남은 작업은 생성·연결 버튼으로 이어가세요.':status==='ready'?'현재 파일과 연결을 확인했습니다. 남은 연결은 생성·연결 버튼으로 이어가세요.':'표시사항이나 포함 옵션이 변경되었습니다. 이전 파일은 보관하고 상품별로 다시 검토해주세요.');
    }catch(error){if(alive.current)report(pending,controller.signal.aborted?'읽기 확인을 중지했습니다. 파일과 미확정 요청은 보관했습니다.':error instanceof Error?error.message:'현재 연결을 읽지 못했습니다.');}
    finally{recovery.current=null;running.current=false;if(stop.current)releaseProductNineLabelBatch(cache.current);publishPending();if(alive.current){setBusy(false);setStopping(false);}}
  }
  function stopRun(){stop.current=true;setStopping(true);if(recovery.current)recovery.current.abort();if(!running.current){releaseProductNineLabelBatch(cache.current);publishPending();setStopping(false);if(pending)report(pending,'미확정 요청과 파일은 보관했습니다. 상품별 검토 또는 현재 연결 읽기 확인으로 이어가세요.');}}
  return <section className="modal-form" aria-label="선택 상품 라벨 일괄 생성" data-workspace-saving={busy||held}>
    <p>선택한 {products.length}개 상품의 6단계에 저장된 한글 표시사항 9항목으로 포함 옵션마다 PNG를 만들고 견적에 연결합니다. 개별 수정값과 공란을 반영하며 원본 파일을 보관합니다.</p>
    <p>AI 호출 없이 처리하며 파일 저장 공간을 사용합니다. 인증·법정 표시사항의 정확성과 이미지 내용은 상품별로 검토해야 합니다. Supplier Hub 전송은 실행하지 않습니다.</p>
    <ul className="batch-work-list">{products.map(product => <li key={product.id}><strong>{product.title}</strong><p role="status">{messages[product.id] ?? '실행 대기'}</p><button type="button" className="btn ghost" disabled={busy||held} onClick={() => onOpen(product.id)}>상품별 검토</button></li>)}</ul>
    <small>이 화면에서 다시 실행하면 내용이 같은 업로드 파일을 재사용합니다. 화면을 닫으면 재개 기록이 사라지므로 상품별 첨부를 확인하세요.</small>
    <div className="modal-actions"><button type="button" className="btn ghost" disabled={!busy&&!held || stopping} onClick={stopRun}>{stopping ? '진행 중인 저장을 마친 뒤 중지…' : '중지'}</button>{pending&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void recover()}>현재 연결 읽기 확인</button>}<button type="button" className="btn primary" disabled={busy||!!pending || !products.length} onClick={() => void run()}>{busy ? '라벨 처리 중…' : '선택 상품 라벨 생성·연결'}</button></div>
  </section>;
}
