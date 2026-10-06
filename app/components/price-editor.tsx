'use client';
import { useRef, useState } from 'react';
import { calculatePrice, type PricePolicy } from '@/app/pricing';
import { OptionQuotationPrices } from '@/app/components/option-quotation-prices';
import { OptionPricePreview } from '@/app/components/option-price-preview';

function samePolicy(a: PricePolicy, b: PricePolicy) {
  return (['exchangeRate','supplyMargin','coupangMargin','minimumMargin','msrpMultiple','roundingUnit'] as const).every(key => Object.is(a[key], b[key]))
    && (a.roundingMode ?? 'up') === (b.roundingMode ?? 'up')
    && Boolean(a.useIntegratedRate) === Boolean(b.useIntegratedRate)
    && (!a.useIntegratedRate || Object.is(a.integratedRate, b.integratedRate));
}

export function PriceEditor({ sourcePrice, initial, onSave, productId, version, profileId, onQuotationSaved, refreshToken }: { sourcePrice: number; initial: PricePolicy; onSave: (policy: PricePolicy) => Promise<void>; productId?:string; version?:string; profileId?:string; onQuotationSaved?:()=>void; refreshToken?:string }) {
  const [policy, setPolicy] = useState(initial);
  const [savedPolicy, setSavedPolicy] = useState(initial);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [message, setMessage] = useState('');
  const [lastMinimum, setLastMinimum] = useState(initial.minimumMargin > 0 ? initial.minimumMargin : 3000);
  const dirty = !samePolicy(policy, savedPolicy);
  const changedElsewhere = !samePolicy(initial, savedPolicy);
  // Refresh clean forms while retaining an unsaved policy on background updates.
  if (changedElsewhere && !dirty && !busy) { setPolicy(initial); setSavedPolicy(initial); }
  let preview: ReturnType<typeof calculatePrice> | undefined; let error = '';
  try { preview = calculatePrice(sourcePrice, policy); } catch (e) { error = e instanceof Error ? e.message : '입력값 확인'; }
  const fields: ['exchangeRate'|'supplyMargin'|'coupangMargin'|'minimumMargin'|'msrpMultiple', string][] = [['exchangeRate','환율 (원/CNY)'],['supplyMargin','목표 공급 마진 (%)'],['coupangMargin','쿠팡 마진 (%)'],['minimumMargin','최소 공급 마진 (원)'],['msrpMultiple','시장가격 배수']];
  const won = (value: number) => value.toLocaleString('ko-KR', {maximumFractionDigits: 6}) + '원';
  return <form className="panel-stack" data-quotation-source-step="가격" data-workspace-dirty={dirty} data-workspace-saving={busy} onSubmit={async event=>{event.preventDefault();if (saving.current || busy || error) return;saving.current=true;setBusy(true);setMessage('');try {await onSave(policy);setSavedPolicy(policy);setMessage('가격을 저장했습니다. 견적서에 반영됩니다.');} catch(e) {setMessage(e instanceof Error ? e.message : '저장 실패');}finally{saving.current=false;setBusy(false);}}}>
    {changedElsewhere && dirty && <div role="status"><p>저장된 가격 정책이 변경되었습니다. 수정 중인 입력은 유지했습니다. 현재 입력을 저장하면 해당 정책으로 가격을 다시 계산합니다.</p><button type="button" className="btn ghost" disabled={busy} onClick={()=>{setPolicy(initial);setSavedPolicy(initial);setMessage('최신 저장 정책을 불러왔습니다.');}}>수정 취소·최신 가격 정책 불러오기</button></div>}
    <p>저장된 원가 ¥ {sourcePrice.toLocaleString('ko-KR',{maximumFractionDigits:6})} 기준입니다. {policy.useIntegratedRate ? '통합통관 환율과 포장검수 200원·바코드 100원·1.1배를 반영합니다. 그 밖의 운송비는 포함하지 않습니다.' : '운송비·관세·세금 등 부대비용은 포함하지 않습니다.'}</p>
    <label className="switch-row"><span>통합통관 환율 사용</span><input type="checkbox" checked={Boolean(policy.useIntegratedRate)} disabled={busy} onChange={event=>{setPolicy({...policy,useIntegratedRate:event.target.checked});setMessage('');}}/><i/></label>
    {policy.useIntegratedRate && <label className="field"><span>통합통관 적용환율 (CNY → KRW)</span><input type="number" step="any" required value={policy.integratedRate===null||policy.integratedRate===undefined||!Number.isFinite(policy.integratedRate)?'':policy.integratedRate} disabled={busy} onChange={event=>{setPolicy({...policy,integratedRate:event.target.value===''?null:Number(event.target.value)});setMessage('');}}/><small>확인한 별도 환율을 입력하세요. (위안가 × 통합통관 환율 + 200 + 100) × 1.1을 원 단위 반올림합니다.</small></label>}
    <div className="form-grid">{fields.filter(([key])=>key!=='exchangeRate'||!policy.useIntegratedRate).map(([key,label])=><label className="field" key={key}><span>{label}</span><input type="number" step="any" required value={Number.isNaN(policy[key])?'':policy[key]} disabled={busy} onChange={e=>{setPolicy({...policy,[key]:e.target.value===''?NaN:Number(e.target.value)});setMessage('');}} /></label>)}
      <label className="field"><span>가격 처리 단위</span><select value={policy.roundingUnit} disabled={busy} onChange={e=>{setPolicy({...policy,roundingUnit:Number(e.target.value)});setMessage('');}}>{[1,10,100,1000].map(unit=><option key={unit} value={unit}>{unit}원</option>)}</select></label><label className="field"><span>가격 처리 방식</span><select value={policy.roundingMode??'up'} disabled={busy} onChange={e=>setPolicy({...policy,roundingMode:e.target.value as 'up'|'nearest'})}><option value="up">올림 (기존 방식)</option><option value="nearest">반올림</option></select></label></div>
    <label className="switch-row"><span>최소 공급 마진 보장</span><input type="checkbox" checked={policy.minimumMargin>0} disabled={busy} onChange={event=>{if(event.target.checked)setPolicy({...policy,minimumMargin:lastMinimum});else {if(policy.minimumMargin>0)setLastMinimum(policy.minimumMargin);setPolicy({...policy,minimumMargin:0});}setMessage('');}}/><i/></label>
    {preview&&<><div className="price-formula"><div><small>공급가</small><strong>{won(preview.supplyPrice)}</strong></div><b>→</b><div><small>판매가</small><strong>{won(preview.salePrice)}</strong></div><b>→</b><div><small>MSRP</small><strong>{won(preview.msrp)}</strong></div></div><div className="margin-card"><span>{policy.useIntegratedRate?'통합통관 원가 기준 공급 마진':'부대비용 제외 공급 마진'}</span><strong>{won(preview.marginKrw)}</strong><em>{preview.actualMargin.toFixed(1)}%</em></div><small>{policy.useIntegratedRate?'통합통관 매입가':'원화 원가'} {won(preview.costKrw)} · 쿠팡 마진 {won(preview.salePrice-preview.supplyPrice)}</small></>}
    <p>목표 마진과 최소 마진을 적용한 뒤 선택한 단위로 반올림 또는 올림합니다. 반올림 시 실제 마진은 설정한 최소 금액보다 조금 낮아질 수 있습니다. 기본 설정 변경은 이미 저장된 상품에 자동 적용되지 않습니다.</p>
    {productId&&version&&<><div hidden={!dirty}><OptionPricePreview productId={productId} version={version} policy={policy}/></div><div hidden={dirty}><OptionQuotationPrices refreshToken={refreshToken} profileId={profileId} productId={productId} version={version} onSaved={onQuotationSaved}/></div></>}
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <button className="btn primary" disabled={busy||!!error}>{busy?'저장 중…':'이 가격 저장'}</button>
  </form>;
}
