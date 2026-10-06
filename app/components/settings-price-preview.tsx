'use client';

import { useState } from 'react';
import { calculatePrice } from '@/app/pricing';
import { initialBundleQuantity } from '@/app/bundle-policy';
import type { WorkspaceSettings } from '@/app/workspace-settings';

/** Couplus displays the configured percentages here, not compound price shares. */
export function SettingsPriceRatio({ settings }: { settings: WorkspaceSettings }) {
  const { supplyMargin, coupangMargin } = settings;
  const valid = [supplyMargin, coupangMargin].every(value => Number.isFinite(value) && value >= 0 && value <= 100)
    && supplyMargin + coupangMargin <= 100;
  const parts = [
    { label: '상품 원가', value: 100 - supplyMargin - coupangMargin, color: '#fa986d' },
    { label: '공급 마진', value: supplyMargin, color: '#78be95' },
    { label: '쿠팡 마진', value: coupangMargin, color: '#2cb9de' },
  ];
  return <div className="settings-price-ratio" aria-label="설정 마진 비율">
    <div className="settings-price-ratio-labels">{parts.map(part => <span key={part.label}>{part.label}</span>)}</div>
    <div className="settings-price-ratio-bar">{valid && parts.map(part => <span key={part.label} role="progressbar" aria-label={part.label + ' 설정 비율'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={part.value} style={{ width: `${part.value}%`, background: part.color }}>{part.value > 0 && `${part.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`}</span>)}</div>
    <small>{valid ? '입력한 설정 비율입니다. 실제 계산 결과는 세부 미리보기에서 확인하세요.' : '0~100 사이의 마진 합계가 100 이하일 때 비율막대를 표시합니다. 가격 계산과 저장 기준은 유지됩니다.'}</small>
  </div>;
}

export function SettingsPricePreview({ settings, disabled }: { settings: WorkspaceSettings; disabled: boolean }) {
  const [cost, setCost] = useState('10');
  let preview: ReturnType<typeof calculatePrice> | undefined;
  let quantity = 1;
  let error = '';
  try {
    if (!cost.trim()) throw new Error('미리보기 원가를 입력해주세요.');
    const policy = { ...settings, minimumMargin: settings.minimumMarginEnabled ? settings.minimumMargin : 0 };
    quantity = initialBundleQuantity(Number(cost), policy, settings);
    preview = calculatePrice(Number(cost), policy, quantity);
  } catch (cause) { error = cause instanceof Error ? cause.message : '가격 입력값을 확인해주세요.'; }
  const won = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '원';
  const parts = preview ? [
    { label: '상품 원가', value: preview.costKrw, color: '#fa986d' },
    { label: '공급 마진', value: preview.marginKrw, color: '#66b78a' },
    { label: '쿠팡 마진', value: preview.salePrice - preview.supplyPrice, color: '#2cb9de' },
  ] : [];
  return <div className="panel-stack" aria-label="기본 가격 미리보기">
    <label className="field"><span>미리보기 원가 (CNY)</span><input inputMode="decimal" value={cost} disabled={disabled} onChange={event => setCost(event.target.value)} /></label>
    <small>1688의 단품 원가를 입력하세요. 미리보기 원가는 저장되지 않으며 기존 상품 가격은 바뀌지 않습니다.</small>
    {preview && <>
      <p aria-label="신규 상품 판매 구성 수량">판매 구성 수량: <strong>{quantity}개</strong>{quantity > 1 && ' · 번들 기준으로 계산한 새 상품 초안의 수량입니다.'}</p>
      <div className="price-formula"><div><small>공급가</small><strong>{won(preview.supplyPrice)}</strong></div><b>→</b><div><small>판매가</small><strong>{won(preview.salePrice)}</strong></div><b>→</b><div><small>MSRP 초안</small><strong>{won(preview.msrp)}</strong></div></div>
      <div aria-hidden="true" style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden' }}>{parts.map(part => <span key={part.label} style={{ width: `${part.value / preview.salePrice * 100}%`, background: part.color }} />)}</div>
      <ul aria-label="판매가 기준 가격 구성">{parts.map(part => <li key={part.label}>{part.label}: {won(part.value)} · 판매가의 {(part.value / preview.salePrice * 100).toFixed(1)}%</li>)}</ul>
      <small>실제 공급 마진율: {preview.actualMargin.toFixed(1)}% (공급가 기준). 가격 구성 비율은 반올림·최소 마진 적용 후 판매가 기준입니다. {settings.useIntegratedRate ? '통합통관 매입가에 포장검수·바코드·1.1배를 포함하고 그 밖의 운송비는 포함하지 않습니다.' : '운송비 등 부대비용은 포함하지 않습니다.'}</small>
    </>}
    {error && <p role="status">{error}</p>}
  </div>;
}
