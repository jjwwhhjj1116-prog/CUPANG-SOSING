'use client';

import { useState } from 'react';
import { calculatePrice } from '@/app/pricing';
import type { WorkspaceSettings } from '@/app/workspace-settings';

export function SettingsPricePreview({ settings, disabled }: { settings: WorkspaceSettings; disabled: boolean }) {
  const [cost, setCost] = useState('10');
  let preview: ReturnType<typeof calculatePrice> | undefined;
  let error = '';
  try {
    if (!cost.trim()) throw new Error('미리보기 원가를 입력해주세요.');
    preview = calculatePrice(Number(cost), { ...settings, minimumMargin: settings.minimumMarginEnabled ? settings.minimumMargin : 0 });
  } catch (cause) { error = cause instanceof Error ? cause.message : '가격 입력값을 확인해주세요.'; }
  const won = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '원';
  const parts = preview ? [
    { label: '상품 원가', value: preview.costKrw, color: '#fa986d' },
    { label: '공급 마진', value: preview.marginKrw, color: '#66b78a' },
    { label: '쿠팡 마진', value: preview.salePrice - preview.supplyPrice, color: '#2cb9de' },
  ] : [];
  return <div className="panel-stack" aria-label="기본 가격 미리보기">
    <label className="field"><span>미리보기 원가 (CNY)</span><input inputMode="decimal" value={cost} disabled={disabled} onChange={event => setCost(event.target.value)} /></label>
    <small>판매 단위 원가를 입력하세요. 미리보기 원가는 저장되지 않으며 기존 상품 가격은 바뀌지 않습니다.</small>
    {preview && <>
      <div className="price-formula"><div><small>공급가</small><strong>{won(preview.supplyPrice)}</strong></div><b>→</b><div><small>판매가</small><strong>{won(preview.salePrice)}</strong></div><b>→</b><div><small>MSRP 초안</small><strong>{won(preview.msrp)}</strong></div></div>
      <div aria-hidden="true" style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden' }}>{parts.map(part => <span key={part.label} style={{ width: `${part.value / preview.salePrice * 100}%`, background: part.color }} />)}</div>
      <ul aria-label="판매가 기준 가격 구성">{parts.map(part => <li key={part.label}>{part.label}: {won(part.value)} · 판매가의 {(part.value / preview.salePrice * 100).toFixed(1)}%</li>)}</ul>
      <small>실제 공급 마진율: {preview.actualMargin.toFixed(1)}% (공급가 기준). 가격 구성 비율은 반올림·최소 마진 적용 후 판매가 기준입니다. 운송비 등 부대비용은 포함하지 않습니다.</small>
    </>}
    {error && <p role="status">{error}</p>}
  </div>;
}
