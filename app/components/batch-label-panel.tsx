'use client';
import { useEffect, useRef, useState } from 'react';
import { runProductLabels, type ProductLabelCache } from '@/app/batch-labels';
import { renderDocument } from '@/app/document-image-render';

export function BatchLabelPanel({ products, onOpen }: { products: { id: string; title: string }[]; onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [stopping, setStopping] = useState(false);
  const alive = useRef(true), running = useRef(false), stop = useRef(false);
  const cache = useRef<ProductLabelCache>(new Map());
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; }; }, []);
  const report = (id: string, message: string) => { if (alive.current) setMessages(previous => ({ ...previous, [id]: message })); };
  async function run() {
    if (running.current) return;
    running.current = true; stop.current = false; setBusy(true); setStopping(false);
    try {
      for (const product of products) {
        if (stop.current || !alive.current) break;
        report(product.id, '최신 카테고리·견적 값 확인 중');
        try {
          const result = await runProductLabels(product.id, { cache: cache.current, render: renderDocument,
            shouldStop: () => stop.current || !alive.current,
            onProgress: progress => report(product.id, `${progress.completed}/${progress.total}개 라벨 연결 · ${progress.optionLabel}`) });
          if (!result) break;
          report(product.id, result.stopped ? `${result.completed}/${result.total}개 처리 후 중지 · 완료된 파일 보존` : `${result.completed}개 옵션 라벨 생성·견적 연결 완료 · 내용 검토 필요`);
        } catch (cause) {
          report(product.id, `${cause instanceof Error ? cause.message : '라벨 생성 실패'} 완료된 파일은 보존됩니다.`);
        }
      }
    } finally { running.current = false; if (alive.current) { setBusy(false); setStopping(false); } }
  }
  return <section className="modal-form" aria-label="선택 상품 라벨 일괄 생성">
    <p>선택한 {products.length}개 상품의 저장된 카테고리 견적 값으로 옵션별 표시사항 PNG를 만들고 견적에 첨부합니다. 기존 라벨은 유지합니다.</p>
    <p>AI 호출 없이 처리하며 파일 저장 공간을 사용합니다. 인증·법정 표시사항의 정확성과 이미지 내용은 상품별로 검토해야 합니다. Supplier Hub 전송은 실행하지 않습니다.</p>
    <ul className="batch-work-list">{products.map(product => <li key={product.id}><strong>{product.title}</strong><p role="status">{messages[product.id] ?? '실행 대기'}</p><button type="button" className="btn ghost" disabled={busy} onClick={() => onOpen(product.id)}>상품별 검토</button></li>)}</ul>
    <small>이 화면에서 다시 실행하면 내용이 같은 업로드 파일을 재사용합니다. 화면을 닫으면 재개 기록이 사라지므로 상품별 첨부를 확인하세요.</small>
    <div className="modal-actions"><button type="button" className="btn ghost" disabled={!busy || stopping} onClick={() => { stop.current = true; setStopping(true); }}>{stopping ? '진행 중인 저장을 마친 뒤 중지…' : '중지'}</button><button type="button" className="btn primary" disabled={busy || !products.length} onClick={() => void run()}>{busy ? '라벨 처리 중…' : '선택 상품 라벨 생성·연결'}</button></div>
  </section>;
}
