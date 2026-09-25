'use client';
import { useState } from 'react';
import { validateSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { SettingsPricePreview } from '@/app/components/settings-price-preview';

export function WorkspaceSettingsEditor({ value, onSave, onClose }: { value: WorkspaceSettings; onSave:(value: WorkspaceSettings)=>Promise<void>; onClose:()=>void }) {
  const [draft,setDraft]=useState(() => validateSettings(value));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const update=(key:keyof WorkspaceSettings,value:string|number|boolean)=>{setDraft(current=>({...current,[key]:value}));setError('');};
  const field=(key:keyof WorkspaceSettings,label:string,type='text')=><label className="field" key={key}><span>{label}</span><input type={type} step={type==='number'?'any':undefined} value={String(draft[key])} disabled={busy} onChange={event=>update(key,type==='number'?(event.target.value===''?NaN:Number(event.target.value)):event.target.value)}/></label>;
  const toggle=(key:keyof WorkspaceSettings,label:string)=><label className="switch-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(draft[key])} disabled={busy} onChange={event=>update(key,event.target.checked)}/><i/></label>;
  const select=(key:keyof WorkspaceSettings,label:string,options:string[])=><label className="field"><span>{label}</span><select value={String(draft[key])} disabled={busy} onChange={event=>update(key,event.target.value)}>{options.map(option=><option key={option}>{option}</option>)}</select></label>;
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
    <section className="settings-pricing"><h3>가격 설정</h3><div className="form-grid">{field('exchangeRate','적용환율 (CNY → KRW)','number')}{field('supplyMargin','공급 마진율 (%)','number')}{field('coupangMargin','쿠팡 마진율 (%)','number')}{field('msrpMultiple','시장가격(MSRP) 배수','number')}
    <label className="field"><span>가격 처리 단위</span><select value={draft.roundingUnit} disabled={busy} onChange={event=>update('roundingUnit',Number(event.target.value))}>{[1,10,100,1000].map(unit=><option key={unit} value={unit}>{unit}원</option>)}</select></label><label className="field"><span>가격 처리 방식</span><select value={draft.roundingMode} disabled={busy} onChange={event=>update('roundingMode',event.target.value as 'up'|'nearest')}><option value="up">올림 (기존 방식)</option><option value="nearest">반올림</option></select></label>{field('minimumMargin','최소 공급 마진액 (원)','number')}</div>
    <div className="switch-grid">{toggle('minimumMarginEnabled','최소 공급 마진 보장')}{toggle('bundleEnabled','번들링 사용')}</div><SettingsPricePreview settings={draft} disabled={busy}/><p>가격은 개별 상품의 가격 탭에서 미리 보고 저장합니다. 번들링 실행기는 아직 연결되지 않았습니다.</p></section>
    <section className="settings-images"><h3>이미지 작업 설정</h3><div className="switch-grid">{toggle('topImageEnabled','상단 이미지 사용')}{toggle('bottomImageEnabled','하단 이미지 사용')}{toggle('translateImages','이미지 번역')}{toggle('addCopyright','카피라이트 추가')}{toggle('removeBackground','대표 이미지 배경·텍스트 제거')}{toggle('hiddenAttributes','비노출속성 생성')}</div>
    <div className="form-grid">{banner('topImageKey','공통 상단 이미지')}{banner('bottomImageKey','공통 하단 이미지')}</div><p>10MB 이하 이미지. 설정 저장 후 새로 추가한 수집 요청에 적용됩니다. 기존 상품·접수한 요청은 유지되며 상품 상세 단계에서 개별 변경할 수 있습니다. 선택 해제는 원본 파일을 삭제하지 않습니다.</p><label className="field full"><span>이미지 번역 지침</span><textarea value={draft.translationPrompt} maxLength={10000} disabled={busy} onChange={event=>update('translationPrompt',event.target.value)} placeholder="표현 방식, 금지 표현, 단위 표기 등 번역 지침"/></label><p>이미지 번역·배경 제거 등 AI 작업에는 별도 실행기 연결이 필요합니다.</p></section>
    {error&&<p role="alert" className="collection-error">{error}</p>}<div className="modal-actions"><button className="btn ghost" type="button" disabled={busy} onClick={onClose}>취소</button><button className="btn primary" disabled={busy}>{busy?'저장 중…':'설정 저장'}</button></div>
  </form>;
}
