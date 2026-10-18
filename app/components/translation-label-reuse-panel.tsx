'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readTranslationLabelReuse, saveTranslationLabelReuse, translationLabelReuseSelection, TranslationLabelReuseSaveError } from '@/app/translation-label-reuse-client';
import type { TranslationLabelReuseView } from '@/app/translation-label-reuse';
import type { LabelField } from '@/app/product-content';

type Props = { productId: string; version: string; jobId: string; profileId?: string; disabled?: boolean; onSaved?: () => void; onBusyChange?: (value: boolean) => void };
export function TranslationLabelReusePanel(props: Props) { return <Panel key={JSON.stringify([props.productId, props.version, props.jobId, props.profileId ?? null])} {...props}/>; }
function Panel({ productId, version, jobId, profileId, disabled = false, onSaved, onBusyChange }: Props) {
  const [view, setView] = useState<TranslationLabelReuseView | null>(null), [mapping, setMapping] = useState<Record<number, LabelField | ''>>({});
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState('');
  const mounted = useRef(true), request = useRef<AbortController | null>(null), terminal = useRef<'done' | 'uncertain' | null>(null), controls = useRef({ disabled, onSaved, onBusyChange });
  useLayoutEffect(() => { controls.current = { disabled, onSaved, onBusyChange }; }, [disabled, onSaved, onBusyChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); controls.current.onBusyChange?.(false); }; }, []);
  function start() {
    if (!mounted.current || controls.current.disabled || request.current || terminal.current) return null;
    const controller = new AbortController(); request.current = controller; setBusy(true); setMessage(''); controls.current.onBusyChange?.(true); return controller;
  }
  function current(controller: AbortController) { return mounted.current && request.current === controller && !controller.signal.aborted; }
  function finish(controller: AbortController) { if (request.current !== controller) return; request.current = null; if (mounted.current) { setBusy(false); controls.current.onBusyChange?.(false); } }
  async function load() {
    const controller = start(); if (!controller) return;
    try { const next = await readTranslationLabelReuse(productId, jobId, version, controller.signal, profileId); if (!current(controller)) return;
      setView(next); setMapping(Object.fromEntries(next.suggestions.map(item => [item.sourceIndex, item.field])));
    } catch (cause) { if (current(controller)) { setView(null); setMessage(cause instanceof Error ? cause.message : '상품 속성 번역을 불러오지 못했습니다.'); } }
    finally { finish(controller); }
  }
  const selected = Object.entries(mapping).filter(([, field]) => field).map(([index, field]) => ({ sourceIndex: Number(index), field: field as LabelField }));
  let preview: ReturnType<typeof translationLabelReuseSelection> = [], issue = '';
  if (view && selected.length) try { preview = translationLabelReuseSelection(view, selected); } catch (cause) { issue = cause instanceof Error ? cause.message : '연결 항목을 확인해주세요.'; }
  async function save() {
    if (!view || !preview.length || issue) return;
    const controller = start(); if (!controller) return;
    try { const result = await saveTranslationLabelReuse(view, selected, controller.signal, profileId); if (!current(controller)) return;
      terminal.current = 'done'; setView(result.view); setDone(true); setMessage(`상품 속성 번역 ${result.applied}개를 표시사항에 저장했습니다. 라벨 이미지는 저장한 값으로 다시 생성해주세요.`); controls.current.onSaved?.();
    } catch (cause) { if (current(controller)) { const unknown = cause instanceof TranslationLabelReuseSaveError && cause.mayHaveSaved; if (unknown) terminal.current = 'uncertain'; setUncertain(unknown); setMessage(cause instanceof Error ? cause.message : '표시사항 저장 결과를 확인하지 못했습니다.'); } }
    finally { finish(controller); }
  }
  async function recover() {
    if (!mounted.current || controls.current.disabled || request.current || terminal.current !== 'uncertain' || !view) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setMessage('최신 표시사항 저장 결과를 확인하는 중…'); controls.current.onBusyChange?.(true);
    try {
      const next = await readTranslationLabelReuse(productId, jobId, undefined, controller.signal, profileId); if (!current(controller)) return;
      if (next.sourceReference !== view.sourceReference || next.categoryId !== view.categoryId || JSON.stringify(next.categoryPath) !== JSON.stringify(view.categoryPath) || JSON.stringify(next.attributes) !== JSON.stringify(view.attributes)) throw Error('저장 결과의 수집 원문 연결이 바뀌었습니다. 최신 상품에서 번역 연결을 다시 확인해주세요.');
      if (next.productVersion === version) {
        const unchanged = next.contentRevision === view.contentRevision && next.inputFingerprint === view.inputFingerprint;
        terminal.current = null; setUncertain(false); setView(next); setMapping(Object.fromEntries(next.suggestions.map(item => [item.sourceIndex, item.field])));
        setMessage(unchanged ? '현재 저장본에 변경이 없습니다. 원문과 선택 항목을 다시 확인한 뒤 직접 저장할 수 있습니다.' : '최신 표시사항을 조회했습니다. 원문과 연결할 항목을 다시 확인한 뒤 직접 저장해주세요.');
      } else {
        const applied = preview.length > 0 && preview.every(item => next.fields.find(target => target.field === item.field)?.before === item.after);
        terminal.current = 'done'; setUncertain(false); setDone(true); setView(next);
        setMessage(applied ? '선택한 번역값이 현재 표시사항에 저장되어 있습니다. 최신 상품 자료를 불러옵니다.' : '현재 표시사항이 변경되었습니다. 최신 상품 자료에서 연결할 항목을 다시 확인해주세요.');
        controls.current.onSaved?.();
      }
    } catch (cause) { if (current(controller)) setMessage(cause instanceof Error ? cause.message : '표시사항 저장 결과를 확인하지 못했습니다.'); }
    finally { finish(controller); }
  }
  const locked = disabled || busy || done || uncertain;
  return <details className="panel-stack" data-workspace-saving={busy} aria-label="저장된 상품 속성 번역 연결"><summary>번역한 상품 속성을 한글 표시사항에 연결</summary>
    <p>수집 때 완료한 번역을 다시 사용합니다. 원문과 현재 카테고리를 확인해 연결하며, 번역 서비스를 다시 호출하지 않습니다. 직접 수정한 값과 공란은 보존합니다.</p>
    <button type="button" className="btn" disabled={locked} onClick={() => void load()}>{view ? '저장된 번역·현재 표시사항 다시 조회' : '저장된 상품 속성 번역 불러오기'}</button>
    {message && <p role="status">{message}</p>}
    {uncertain && <><p role="alert">저장 결과를 확인하기 전에는 같은 저장을 반복하지 않습니다.</p><button type="button" className="btn" disabled={disabled || busy} onClick={() => void recover()}>최신 상품·표시사항 저장 결과 다시 조회</button></>}
    {view && <><p>카테고리: {view.categoryPath.join(' > ')}</p><fieldset disabled={locked}>
      {view.attributes.map(attribute => <label key={attribute.sourceIndex}>{attribute.name} · {attribute.value}<small style={{ display: 'block', whiteSpace: 'pre-wrap' }}>원문: {attribute.sourceName} · {attribute.sourceValue}</small>
        <select aria-label={`${attribute.name} 저장 번역 표시사항 연결`} value={mapping[attribute.sourceIndex] ?? ''} onChange={event => { if (locked || controls.current.disabled || request.current || terminal.current) return; setMapping(previous => ({ ...previous, [attribute.sourceIndex]: event.target.value as LabelField | '' })); }}><option value="">연결하지 않음</option>
          {view.fields.map(target => <option key={target.field} value={target.field} disabled={!target.eligible}>{target.label}{target.eligible ? '' : ` · ${target.reason || '직접 수정값 보존'}`}</option>)}</select></label>)}
      {issue && <p role="alert">{issue}</p>}{!!preview.length && <table><thead><tr><th>표시사항</th><th>현재값</th><th>적용할 번역값</th></tr></thead><tbody>{preview.map(item => <tr key={item.field}><th>{item.name}</th><td style={{ whiteSpace: 'pre-wrap' }}>{item.before || '(공란)'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{item.after}</td></tr>)}</tbody></table>}
      {selected.length > 0 && !preview.length && !issue && <p>선택한 번역값이 현재 표시사항과 같습니다.</p>}
      <button type="button" className="btn blue" disabled={locked || !preview.length || !!issue} onClick={() => void save()}>검토한 번역값 표시사항에 저장</button>
    </fieldset>{!!view.skipped.length && <details><summary>자동 연결에서 제외된 항목</summary><ul>{view.skipped.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</>}
  </details>;
}
