'use client';
import { useEffect, useRef, useState } from 'react';

type Preview = { scope?: 'all' | 'options'; productId: string; productVersion: string; contentRevision: number; optionRevision: number; fingerprint: string; preview: { name: string; before: string; after: string }[]; skipped: string[] };
type Props = {
  scope?: 'all' | 'options'; productId: string; version: string; jobId: string; disabled: boolean; onSaved?: () => void;
};
export function TranslationIntegratedPreview(props: Props) {
  return <TranslationIntegratedPreviewContent key={JSON.stringify([props.productId, props.version, props.jobId, props.scope ?? 'all'])} {...props} />;
}
function TranslationIntegratedPreviewContent({ productId, version, jobId, disabled, onSaved, scope = 'all' }: Props) {
  const [plan, setPlan] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [done, setDone] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  async function run(action: 'preview' | 'apply') {
    if (disabled || done || active.current || (action === 'apply' && !plan)) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/translation-apply`, { method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, jobId, ...(scope === 'options' ? { scope } : {}), expectedVersion: version, ...(action === 'apply' ? { fingerprint: plan!.fingerprint } : {}) }) });
      const raw: unknown = await response.json();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('응답 형식이 올바르지 않습니다.');
      const result = raw as Record<string, unknown>;
      if (controller.signal.aborted) return;
      if (!response.ok) throw Error(typeof result.error === 'string' ? result.error : '통합 적용 요청을 확인해주세요.');
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
        setDone(true); setPlan(null); setMessage(`${scope === 'options' ? '옵션' : 'SEO·표시사항·옵션'} ${result.applied}개 항목을 함께 저장했습니다.`); onSaved?.();
      }
    } catch (error) { if (!controller.signal.aborted) { setPlan(null); setMessage(error instanceof Error ? error.message : '저장 여부를 다시 조회해주세요.'); } }
    finally { if (active.current === controller) active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <fieldset disabled={disabled || busy || done} aria-label={scope === 'options' ? '옵션 번역 적용' : 'SEO 표시사항 옵션 통합 적용'}>
    <legend>{scope === 'options' ? '옵션 번역 검토·저장' : 'SEO · 표시사항 · 옵션 함께 저장'}</legend>
    <p>완료된 같은 번역 결과를 한 번에 적용합니다. 직접 수정한 값과 공란은 보존합니다. 이미지와 Supplier Hub 전송은 포함하지 않습니다.</p>
    <button type="button" className="btn blue" onClick={() => void run('preview')}>{scope === 'options' ? '옵션 적용 미리보기 · 무료' : '통합 적용 미리보기 · 무료'}</button>
    {message && <p role="status">{message}</p>}
    {plan && <><table><thead><tr><th>항목</th><th>현재 값</th><th>저장할 값</th></tr></thead><tbody>{plan.preview.map((row, index) => <tr key={index}><th>{row.name}</th><td style={{ whiteSpace: 'pre-wrap' }}>{row.before || '(공란)'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{row.after}</td></tr>)}</tbody></table>
      {!plan.preview.length && <p>새로 적용할 항목이 없습니다.</p>}
      {!!plan.skipped.length && <details><summary>보존하거나 연결하지 않은 항목</summary><ul>{plan.skipped.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
      <button type="button" className="btn blue" disabled={!plan.preview.length} onClick={() => void run('apply')}>검토한 {plan.preview.length}개 항목 {scope === 'options' ? '옵션 저장' : '통합 저장'}</button></>}
  </fieldset>;
}
