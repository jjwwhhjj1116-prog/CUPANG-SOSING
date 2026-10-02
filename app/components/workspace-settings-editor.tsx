'use client';
import { useState } from 'react';
import { validateSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { SettingsPricePreview } from '@/app/components/settings-price-preview';
import { applyObservedPricePreset } from '@/app/observed-price-preset';

export function WorkspaceSettingsEditor({ value, onSave, onClose }: { value: WorkspaceSettings; onSave:(value: WorkspaceSettings)=>Promise<void>; onClose:()=>void }) {
  const [draft,setDraft]=useState(() => validateSettings(value));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const update=(key:keyof WorkspaceSettings,value:string|number|boolean|null)=>{setDraft(current=>({...current,[key]:value}));setError('');};
  const field=(key:keyof WorkspaceSettings,label:string,type='text')=><label className="field" key={key}><span>{label}</span><input type={type} step={type==='number'?'any':undefined} value={draft[key]===null?'':String(draft[key])} disabled={busy} onChange={event=>update(key,type==='number'?(event.target.value===''?(key==='shelfLifeDays'?null:NaN):Number(event.target.value)):event.target.value)}/></label>;
  const toggle=(key:keyof WorkspaceSettings,label:string)=><label className="switch-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(draft[key])} disabled={busy} onChange={event=>update(key,event.target.checked)}/><i/></label>;
  const margin=(key:'supplyMargin'|'coupangMargin',label:string,formula:string)=><fieldset className="settings-margin"><legend>{label}</legend><label className="field"><span>{label}</span><input type="number" min={0} max={99.9} step="any" value={Number.isFinite(draft[key])?draft[key]:''} disabled={busy} onChange={event=>update(key,event.target.value===''?NaN:Number(event.target.value))}/></label><input aria-label={label+' 조절'} type="range" min={0} max={99} step={1} value={Number.isFinite(draft[key])?Math.min(99,Math.max(0,draft[key])):0} disabled={busy} onChange={event=>update(key,Number(event.target.value))}/><small>{formula}</small></fieldset>;
  const select=(key:keyof WorkspaceSettings,label:string,options:string[])=><label className="field"><span>{label}</span><select value={String(draft[key])} disabled={busy} onChange={event=>update(key,event.target.value)}><option value="">미입력</option>{options.map(option=><option key={option}>{option}</option>)}</select></label>;
  async function uploadBanner(key: 'topImageKey' | 'bottomImageKey', file: File) {
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/files', { method: 'POST', body: form });
      const result = await response.json() as { key?: string; error?: string };
      if (!response.ok || !result.key) throw new Error(result.error || '이미지를 업로드하지 못했습니다.');
      setDraft(current => ({ ...current, [key]: result.key!, [key === 'topImageKey' ? 'topImageEnabled' : 'bottomImageEnabled']: true }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '업로드 실패'); }
    finally { setBusy(false); }
  }
  const banner = (key: 'topImageKey' | 'bottomImageKey', label: string) => <div className="field">
    <span>{label}</span>
    {draft[key] && <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={'/api/files/' + draft[key].split('/').map(encodeURIComponent).join('/')} alt={label} style={{maxWidth:240,maxHeight:160,objectFit:'contain'}} />
      <button type="button" className="btn ghost" disabled={busy} onClick={()=>setDraft(current=>({...current,[key]:'',[key==='topImageKey'?'topImageEnabled':'bottomImageEnabled']:false}))}>선택 해제</button>
    </>}
    <input aria-label={label + ' 업로드'} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file&&!busy)void uploadBanner(key,file);}} />
  </div>;
  return <form className="settings-form couplus-settings" onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{await onSave(validateSettings(draft));}catch(e){setError(e instanceof Error?e.message:'설정을 저장하지 못했습니다.');}finally{setBusy(false);}}}>
    <section className="settings-registration"><h3>기본 등록 정보</h3><div className="form-grid">{field('brand','브랜드명 (쉼표로 구분)')}{field('manufacturer','제조사')}{field('importer','수입 및 판매원')}{select('tradeType','거래타입',['제조사','공식총판사','공식대리점','기타 도소매업자'])}{select('importType','수입여부',['수입대상아님','수입상품','병행수입상품'])}<label className="field"><span>과세여부</span><select value={draft.taxType} disabled={busy} onChange={event=>update('taxType',event.target.value)}><option value="">카테고리 기본값 사용</option>{['과세','면세','영세'].map(option=><option key={option} value={option}>{option}</option>)}</select><small>견적서의 자동값에 적용됩니다. 상품별 직접 수정값은 유지됩니다.</small></label>{field('serviceContact','A/S 책임자와 전화번호')}{field('boxSkuQuantity','박스 내 SKU 수량','number')}</div></section>
    <section className="settings-registration"><h3>상품고시 기본설정</h3><div className="form-grid">{field('washingMethod','세탁방법')}{field('handlingPrecautions','취급시 주의사항')}</div><div className="switch-grid">{toggle('manufactureDatePreviousMonth','제조년월 · 전월 자동 입력')}</div><small>세탁방법과 취급시 주의사항은 함께 묶어 초안에 반영합니다. 전월 자동 입력은 선택한 카테고리의 출시년월·제조년월 고시에 적용되며 상품추가 시점의 한국 날짜로 고정됩니다. 실제 상품 정보와 대조해 수정해주세요.</small></section>
    <section className="settings-registration"><h3>물류 기본설정</h3><div className="form-grid">{field('shelfLifeDays','유통기간 · 식품의 경우 소비기간 (일)','number')}{select('handlingReason','취급주의 사유',['해당사항없음','유리'])}</div><small>새 상품 견적서의 물류 정보에 반영됩니다. 유통기간이 해당되지 않는 상품은 0일을 사용합니다. 포장 무게와 포장 사이즈는 상품별로 확인해 입력해주세요.</small></section>
    <section className="settings-pricing"><h3>가격설정 방법</h3>
    <details className="collection-receipt"><summary>쿠플러스에서 사용하던 가격 설정 적용</summary><p>2026년 9월 24일 계정에서 확인한 설정입니다. 환율 350원 · 공급 마진 50% · 쿠팡 마진 40% · 10원 반올림 · MSRP 1.3배 · 최소 공급 마진 보장 3,000원.</p><p>현재 환율을 조회한 값이 아닙니다. 아래 가격 입력만 변경하며 설정 저장 후 새 수집 요청에 적용됩니다. 기존 상품과 이미 접수한 요청의 가격은 유지됩니다.</p><button type="button" className="btn ghost" disabled={busy} onClick={()=>{setDraft(current=>applyObservedPricePreset(current));setError('');}}>위 가격값을 입력란에 적용</button></details>
    <div className="form-grid">{field('exchangeRate','적용환율 (CNY → KRW)','number')}{margin('supplyMargin','공급 마진율 (%)','공급가 = 매입가 ÷ (1 − 공급마진율/100)')}{margin('coupangMargin','쿠팡 마진율 (%)','판매가 = 공급가 ÷ (1 − 쿠팡마진율/100)')}{field('msrpMultiple','시장가격(MSRP) 배수','number')}
    <label className="field"><span>가격 처리 단위</span><select value={draft.roundingUnit} disabled={busy} onChange={event=>update('roundingUnit',Number(event.target.value))}>{[1,10,100,1000].map(unit=><option key={unit} value={unit}>{unit}원</option>)}</select></label><label className="field"><span>가격 처리 방식</span><select value={draft.roundingMode} disabled={busy} onChange={event=>update('roundingMode',event.target.value as 'up'|'nearest')}><option value="up">올림 (기존 방식)</option><option value="nearest">반올림</option></select></label>{field('minimumMargin','최소 공급 마진액 (원)','number')}</div>
    <div className="switch-grid">{toggle('minimumMarginEnabled','최소 공급 마진 보장')}{toggle('bundleEnabled','번들링 사용')}</div><p>원화 원가 = 중국 원가 × 적용환율. 최소 마진 보장을 켜면 비율로 계산한 공급가와 원가 + 최소 공급 마진액 중 큰 금액을 선택한 뒤 설정 단위로 처리합니다. 판매가와 시장가격도 각각 설정 단위로 처리합니다.</p><SettingsPricePreview settings={draft} disabled={busy}/><p>설정 저장 후 새 상품 초안에 적용됩니다. 기존 상품은 가격 단계에서 별도로 수정합니다. 번들링 실행기는 아직 연결되지 않았습니다.</p></section>
    <section className="settings-images"><h3>이미지 작업 설정</h3>
      <div className="settings-image-option">
        {toggle('topImageEnabled','상단 이미지 사용')}<small>브랜드 이미지, 이벤트 이미지 등</small>
        {draft.topImageEnabled && banner('topImageKey','공통 상단 이미지')}
      </div>
      <div className="settings-image-option">
        {toggle('bottomImageEnabled','하단 이미지 사용')}<small>배송, 보상, 반품 유의사항 등</small>
        {draft.bottomImageEnabled && banner('bottomImageKey','공통 하단 이미지')}
      </div>
      <div className="settings-image-option">
        {toggle('translateImages','이미지 번역')}
        <label className="field full"><span>이미지 번역 프롬프트 설정</span><textarea value={draft.translationPrompt} maxLength={10000} disabled={busy} onChange={event=>update('translationPrompt',event.target.value)} placeholder="표현 방식, 금지 표현, 단위 표기 등 번역 지침"/></label>
      </div>
      <div className="settings-image-option">{toggle('addCopyright','카피라이트 추가')}</div>
      <div className="settings-image-option">{toggle('removeBackground','누끼이미지 자동적용')}<small>대표 이미지의 배경·텍스트 제거</small></div>
      <small>공통 이미지는 10MB 이하로 업로드하세요. 설정 저장 후 새 상품 초안에 적용됩니다. 이미지 사용을 꺼도 선택한 파일은 보관됩니다.</small>
    </section>
    <section className="settings-ai"><h3>AI 설정</h3>
      <div className="settings-image-option">{toggle('hiddenAttributes','비노출속성 자동 생성')}<small>선택한 카테고리의 비노출속성 초안 생성에 적용됩니다.</small></div>
      <p>이미지 번역·배경 제거 등 AI 작업에는 별도 실행기 연결이 필요합니다.</p>
    </section>
    {error&&<p role="alert" className="collection-error">{error}</p>}<div className="modal-actions"><button className="btn ghost" type="button" disabled={busy} onClick={onClose}>취소</button><button className="btn primary" disabled={busy}>{busy?'저장 중…':'설정 저장'}</button></div>
  </form>;
}
