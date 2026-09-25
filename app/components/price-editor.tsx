'use client';
import { useState } from 'react';
import { calculatePrice, type PricePolicy } from '@/app/pricing';

function samePolicy(a: PricePolicy, b: PricePolicy) {
  return (['exchangeRate','supplyMargin','coupangMargin','minimumMargin','msrpMultiple','roundingUnit'] as const).every(key => Object.is(a[key], b[key]))
    && (a.roundingMode ?? 'up') === (b.roundingMode ?? 'up');
}

export function PriceEditor({ sourcePrice, initial, onSave }: { sourcePrice: number; initial: PricePolicy; onSave: (policy: PricePolicy) => Promise<void> }) {
  const [policy, setPolicy] = useState(initial);
  const [savedPolicy, setSavedPolicy] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = !samePolicy(policy, savedPolicy);
  const changedElsewhere = !samePolicy(initial, savedPolicy);
  // Refresh clean forms while retaining an unsaved policy on background updates.
  if (changedElsewhere && !dirty && !busy) { setPolicy(initial); setSavedPolicy(initial); }
  let preview: ReturnType<typeof calculatePrice> | undefined; let error = '';
  try { preview = calculatePrice(sourcePrice, policy); } catch (e) { error = e instanceof Error ? e.message : '입력값 확인'; }
  const fields: [keyof PricePolicy, string][] = [['exchangeRate','환율 (원/CNY)'],['supplyMargin','목표 공급 마진 (%)'],['coupangMargin','쿠팡 마진 (%)'],['minimumMargin','최소 공급 마진 (원)'],['msrpMultiple','시장가격 배수']];
  const won = (value: number) => Math.round(value).toLocaleString('ko-KR') + '원';
  return <form className="panel-stack" data-workspace-dirty={dirty} data-workspace-saving={busy} onSubmit={async event=>{event.preventDefault();if (busy || error) return;setBusy(true);setMessage('');try {await onSave(policy);setSavedPolicy(policy);setMessage('가격을 저장했습니다. 견적서에 반영됩니다.');} catch(e) {setMessage(e instanceof Error ? e.message : '저장 실패');}finally{setBusy(false);}}}>
    {changedElsewhere && dirty && <div role="status"><p>저장된 가격 정책이 변경되었습니다. 수정 중인 입력은 유지했습니다. 현재 입력을 저장하면 해당 정책으로 가격을 다시 계산합니다.</p><button type="button" className="btn ghost" disabled={busy} onClick={()=>{setPolicy(initial);setSavedPolicy(initial);setMessage('최신 저장 정책을 불러왔습니다.');}}>수정 취소·최신 가격 정책 불러오기</button></div>}
    <p>저장된 원가 ¥ {sourcePrice.toFixed(2)} 기준입니다. 운송비·관세·세금 등 부대비용은 포함하지 않습니다.</p>
    <div className="form-grid">{fields.map(([key,label])=><label className="field" key={key}><span>{label}</span><input type="number" step="any" required value={Number.isNaN(policy[key])?'':policy[key]} disabled={busy} onChange={e=>{setPolicy({...policy,[key]:e.target.value===''?NaN:Number(e.target.value)});setMessage('');}} /></label>)}
      <label className="field"><span>가격 처리 단위</span><select value={policy.roundingUnit} disabled={busy} onChange={e=>{setPolicy({...policy,roundingUnit:Number(e.target.value)});setMessage('');}}>{[1,10,100,1000].map(unit=><option key={unit} value={unit}>{unit}원</option>)}</select></label><label className="field"><span>가격 처리 방식</span><select value={policy.roundingMode??'up'} disabled={busy} onChange={e=>setPolicy({...policy,roundingMode:e.target.value as 'up'|'nearest'})}><option value="up">올림 (기존 방식)</option><option value="nearest">반올림</option></select></label></div>
    {preview&&<><div className="price-formula"><div><small>공급가</small><strong>{won(preview.supplyPrice)}</strong></div><b>→</b><div><small>판매가</small><strong>{won(preview.salePrice)}</strong></div><b>→</b><div><small>MSRP</small><strong>{won(preview.msrp)}</strong></div></div><div className="margin-card"><span>부대비용 제외 공급 마진</span><strong>{won(preview.marginKrw)}</strong><em>{preview.actualMargin.toFixed(1)}%</em></div></>}
    <p>선택한 단위로 가격을 처리합니다. 반올림 결과가 원가와 최소 공급 마진 합계보다 낮으면 해당 금액 이상으로 올림합니다. 기본 설정 변경은 이미 저장된 상품에 자동 적용되지 않습니다.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <button className="btn primary" disabled={busy||!!error}>{busy?'저장 중…':'이 가격 저장'}</button>
  </form>;
}
