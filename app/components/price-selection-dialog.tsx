'use client';
import { useLayoutEffect, useRef } from 'react';

type Props = { kind: 'bundle' | 'addBundle' | 'remove'; count: number; value: string; busy: boolean; error?: string; quantityLocked?:boolean; confirmationBlocked?:boolean;
  onChange: (value: string) => void; onConfirm: () => void; onCancel: () => void; onRecover?:()=>void };

/** Controlled confirmation keeps a failed save's quantity and draft visible. */
export function PriceSelectionDialog({ kind, count, value, busy, error, quantityLocked=false,confirmationBlocked=false,onChange, onConfirm, onCancel,onRecover }: Props) {
  const root=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    if(typeof document==='undefined')return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const target=root.current?.querySelector<HTMLElement>(kind==='remove'?'button[type="button"]':'input');
    target?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[kind]);
  useLayoutEffect(()=>{
    const section=root.current;if(typeof document==='undefined'||!section)return;
    if(!section.contains(document.activeElement)||document.activeElement instanceof HTMLElement&&document.activeElement.hasAttribute('disabled')){
      const controls=Array.from(section.querySelectorAll<HTMLElement>('input, button, [tabindex]')).filter(control=>!control.hasAttribute('disabled')&&control.tabIndex>=0);
      (controls[0]??section).focus();
    }
  },[busy,quantityLocked,confirmationBlocked]);
  const title = kind === 'bundle' ? '번들 적용' : kind==='addBundle'?'번들 추가':'선택 옵션 삭제';
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
        {kind !== 'remove' ? <label className="field"><span>번들 수량을 입력하세요 (선택한 {count}개 옵션에 {kind==='addBundle'?'추가':'적용'}):</span>
          <input aria-label={kind==='addBundle'?'추가할 번들 수량':'적용할 번들 수량'} type="text" inputMode="numeric" value={value} disabled={busy||quantityLocked} autoFocus onChange={event => onChange(event.target.value)} />
        </label> : <p>선택한 {count}개 옵션을 삭제하시겠습니까?</p>}
        {error && <p role="alert">{error}</p>}
        {onRecover&&<button type="button" className="btn ghost" disabled={busy} onClick={onRecover}>입력 유지 · 번들 저장 결과 확인</button>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>취소</button>
          <button type="submit" className="btn primary" disabled={busy||confirmationBlocked}>{busy ? '저장 중…' : kind === 'bundle' ? '적용' : kind==='addBundle'?'추가':'삭제'}</button>
        </div>
      </form>
    </section>
  </div>;
}
