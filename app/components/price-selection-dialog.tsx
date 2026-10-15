'use client';
import { useLayoutEffect, useRef } from 'react';

type Props = { kind: 'bundle' | 'remove'; count: number; value: string; busy: boolean; error?: string;
  onChange: (value: string) => void; onConfirm: () => void; onCancel: () => void };

/** Controlled confirmation keeps a failed save's quantity and draft visible. */
export function PriceSelectionDialog({ kind, count, value, busy, error, onChange, onConfirm, onCancel }: Props) {
  const root=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    if(typeof document==='undefined')return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const target=root.current?.querySelector<HTMLElement>(kind==='bundle'?'input':'button[type="button"]');
    target?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[kind]);
  const title = kind === 'bundle' ? '번들 적용' : '선택 옵션 삭제';
  return <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: '#0006', display: 'grid', placeItems: 'center', padding: 20 }}>
    <section ref={root} role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} tabIndex={-1} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); }
      if(event.key==='Tab'){
        const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('input, button, [tabindex]')??[]).filter(control=>!control.hasAttribute('disabled')&&control.tabIndex>=0);
        const first=controls[0],last=controls.at(-1);
        if(!first){event.preventDefault();root.current?.focus();}
        else if(event.shiftKey&&(!controls.includes(document.activeElement as HTMLElement)||document.activeElement===first)){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&(!controls.includes(document.activeElement as HTMLElement)||document.activeElement===last)){event.preventDefault();first.focus();}
      }
    }} style={{ width: 'min(420px,100%)', background: 'white', borderRadius: 12, padding: 24, boxShadow: '0 12px 40px #0003' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <form onSubmit={event => { event.preventDefault(); onConfirm(); }}>
        {kind === 'bundle' ? <label className="field"><span>번들 수량을 입력하세요 (선택한 {count}개 옵션에 적용):</span>
          <input aria-label="적용할 번들 수량" type="text" inputMode="numeric" value={value} disabled={busy} autoFocus onChange={event => onChange(event.target.value)} />
        </label> : <p>선택한 {count}개 옵션을 삭제하시겠습니까?</p>}
        {error && <p role="alert">{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>취소</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? '저장 중…' : kind === 'bundle' ? '적용' : '삭제'}</button>
        </div>
      </form>
    </section>
  </div>;
}
