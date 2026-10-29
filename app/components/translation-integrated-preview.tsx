'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SeoGuidanceComposition } from '@/app/seo-guidance-composition';
import type { SeoAppliedReceipt } from '@/app/seo-apply-focus';

type Preview = { scope?: 'all' | 'options'; productId: string; productVersion: string; contentRevision: number; optionRevision: number; fingerprint: string; preview: { name: string; before: string; after: string }[]; skipped: string[] };
type Props = {
  purpose?: 'seo-generation';
  scope?: 'all' | 'options'; productId: string; version: string; jobId: string; disabled: boolean; onSaved?: () => void; beforeApply?: () => boolean;
  seoComposition?: SeoGuidanceComposition;
  onBusyChange?: (busy: boolean) => void;
  onUncertainChange?: (uncertain: boolean) => void;
  onApplied?: (receipt: SeoAppliedReceipt) => void;
};
export function TranslationIntegratedPreview(props: Props) {
  return <TranslationIntegratedPreviewContent key={JSON.stringify([props.productId, props.version, props.jobId, props.scope ?? 'all', props.seoComposition ?? null,props.purpose??null])} {...props} />;
}
function TranslationIntegratedPreviewContent({ productId, version, jobId, disabled, onSaved, beforeApply, scope = 'all', seoComposition, onBusyChange, onUncertainChange, onApplied,purpose }: Props) {
  const [plan, setPlan] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [done, setDone] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true), liveDisabled = useRef(disabled);
  const busyCallback=useRef(onBusyChange);
  const ownedBusyCallback=useRef<Props['onBusyChange']>(undefined);
  const uncertain=useRef(false),uncertainCallback=useRef(onUncertainChange);
  useLayoutEffect(()=>{uncertainCallback.current=onUncertainChange;},[onUncertainChange]);
  useLayoutEffect(()=>{busyCallback.current=onBusyChange;},[onBusyChange]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); ownedBusyCallback.current?.(false); ownedBusyCallback.current=undefined; }; }, []);
  useLayoutEffect(() => { liveDisabled.current = disabled; }, [disabled]);
  useEffect(() => () => { active.current?.abort(); }, []);
  async function run(action: 'preview' | 'apply') {
    if (!mounted.current || liveDisabled.current || done || active.current || (action === 'apply' && !plan)) return;
    if(action==='apply'&&uncertain.current)return;
    if (action === 'apply' && beforeApply && !beforeApply()) return;
    const controller = new AbortController(),publishBusy=busyCallback.current; active.current = controller; ownedBusyCallback.current=publishBusy; publishBusy?.(true); setBusy(true); setMessage('');
    let response:Response|undefined;
    try {
      if(purpose==='seo-generation'&&(scope!=='all'||seoComposition))throw Error('AI SEO 생성은 상품명·검색태그·설명만 검토하여 적용합니다.');
      response = await fetch(`/api/products/${encodeURIComponent(productId)}/${purpose==='seo-generation'?'seo-generation':'translation-apply'}`, { method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, jobId, ...(scope === 'options' ? { scope } : {linkQuotationSeoDefaults:true}), ...(seoComposition ? {seoComposition} : {}), expectedVersion: version, ...(action === 'apply' ? { fingerprint: plan!.fingerprint } : {}) }) });
      const raw: unknown = await response.json();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('응답 형식이 올바르지 않습니다.');
      const result = raw as Record<string, unknown>;
      if (controller.signal.aborted || !mounted.current) return;
      if (!response.ok) throw Error(typeof result.error === 'string' ? result.error : '통합 적용 요청을 확인해주세요.');
      if(purpose==='seo-generation'&&(result.purpose!=='seo-generation'||result.scope!=='all'))throw Error('AI SEO 생성 적용 목적이 일치하지 않습니다.');
      if ((result.scope ?? 'all') !== scope) throw Error('저장 범위 응답이 일치하지 않습니다. 다시 검토해주세요.');
      if (action === 'preview') {
        if (result.productId !== productId || result.productVersion !== version || typeof result.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(result.fingerprint) || !Array.isArray(result.preview)
          || !Array.isArray(result.skipped) || !result.skipped.every((text: unknown) => typeof text === 'string')
          || ![result.contentRevision,result.optionRevision].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
          || !result.preview.every((row: Preview['preview'][number]) => row && ['name','before','after'].every(key => typeof row[key as keyof typeof row] === 'string'))) throw Error('미리보기 응답을 확인하지 못했습니다. 다시 조회해주세요.');
        setPlan(result as Preview);
      } else {
        if (result.productId !== productId || typeof result.productVersion !== 'string' || !Number.isFinite(Date.parse(result.productVersion))
          || !Number.isFinite(Date.parse(version)) || Date.parse(result.productVersion) <= Date.parse(version) || result.contentRevision !== plan!.contentRevision + 1
          || result.optionRevision !== plan!.optionRevision + 1 || result.applied !== plan!.preview.length) throw Error('통합 저장 응답이 일치하지 않습니다. 저장본을 다시 조회해주세요.');
        uncertain.current=false;uncertainCallback.current?.(false);setDone(true); setPlan(null); setMessage(`${purpose==='seo-generation'?'AI 생성 SEO':scope === 'options' ? '옵션' : 'SEO·표시사항·옵션'} ${result.applied}개 항목을 함께 저장했습니다.`);
        // Local navigation must never turn a confirmed save into an uncertain save.
        try { onApplied?.({scope,productId,jobId,previousVersion:version,productVersion:result.productVersion,
          contentRevision:result.contentRevision as number,optionRevision:result.optionRevision as number}); } catch { /* The saved result remains confirmed. */ }
        onSaved?.();
      }
    } catch (error) { if (!controller.signal.aborted&&mounted.current) { if(action==='apply'&&(!response||response.ok||response.status>=500)){uncertain.current=true;uncertainCallback.current?.(true);}setPlan(null); setMessage(error instanceof Error ? error.message : '저장 여부를 다시 조회해주세요.'); } }
    finally { if (active.current === controller) { active.current = null; ownedBusyCallback.current=undefined; if(mounted.current)publishBusy?.(false); } if (!controller.signal.aborted&&mounted.current) setBusy(false); }
  }
  return <fieldset disabled={disabled || busy || done} data-workspace-saving={busy} data-quotation-source-step="SEO" aria-label={purpose==='seo-generation'?'AI SEO 생성 적용':scope === 'options' ? '옵션 번역 적용' : 'SEO 표시사항 옵션 통합 적용'}>
    <legend>{purpose==='seo-generation'?'AI SEO 초안 검토·저장':scope === 'options' ? '옵션 번역 검토·저장' : 'SEO · 표시사항 · 옵션 함께 저장'}</legend>
    <p>{purpose==='seo-generation'?'완료된 같은 AI SEO 상품명·검색태그·설명만 적용합니다.':'완료된 같은 번역 결과를 한 번에 적용합니다.'} {seoComposition?.replaceTitle||seoComposition?.replaceKeywords?'선택한 상품명·검색태그 교체를 제외한 직접 수정값과 공란은 보존합니다.':'직접 수정한 값과 공란은 보존합니다.'} 이미지와 Supplier Hub 전송은 포함하지 않습니다.</p>
    {scope==='all'&&<p>저장한 한국어 상품명은 비어 있는 모델명과 초기 품명 및 모델명에도 연결합니다. 직접 수정한 입력과 공란은 유지합니다.</p>}
    {seoComposition && <p>상품명·검색태그에는 검토한 사용자 구성안을 적용합니다. 판매자 속성 번역과 인증·제조국 원문은 구성안에서 바꾸지 않습니다.</p>}
    <button type="button" className="btn blue" onClick={() => void run('preview')}>{purpose==='seo-generation'?'AI SEO 적용 미리보기 · 무료':scope === 'options' ? '옵션 적용 미리보기 · 무료' : '통합 적용 미리보기 · 무료'}</button>
    {message && <p role="status">{message}</p>}
    {plan && <><table><thead><tr><th>항목</th><th>현재 값</th><th>저장할 값</th></tr></thead><tbody>{plan.preview.map((row, index) => <tr key={index}><th>{row.name}</th><td style={{ whiteSpace: 'pre-wrap' }}>{row.before || '(공란)'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{row.after}</td></tr>)}</tbody></table>
      {!plan.preview.length && <p>새로 적용할 항목이 없습니다.</p>}
      {!!plan.skipped.length && <details><summary>보존하거나 연결하지 않은 항목</summary><ul>{plan.skipped.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
      <button type="button" className="btn blue" disabled={!plan.preview.length} onClick={() => void run('apply')}>검토한 {plan.preview.length}개 항목 {purpose==='seo-generation'?'SEO 저장':scope === 'options' ? '옵션 저장' : '통합 저장'}</button></>}
  </fieldset>;
}
