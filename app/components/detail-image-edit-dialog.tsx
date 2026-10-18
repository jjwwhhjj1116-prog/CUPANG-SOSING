'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Props = { children: ReactNode; open: boolean; identity: string; onClose: () => void; canClose: () => boolean; blocked?: boolean; modal?: boolean };

/** Keep the editor at the same React/DOM position when changing its presentation.
 * The existing editor owns drafts, pending writes, recovery and source identity. */
export function DetailImageEditDialog({ children, open, identity, onClose, canClose, blocked = false, modal = true }: Props) {
  const visible = modal && open;
  const [clock, setClock] = useState(() => ({ identity, visible, token: {} }));
  if (clock.identity !== identity || clock.visible !== visible) setClock({ identity, visible, token: {} });
  const token = clock.identity === identity && clock.visible === visible ? clock.token : null;
  const layer = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const live = useRef({ token, visible, blocked, canClose, onClose });
  useLayoutEffect(() => { live.current = { token, visible, blocked, canClose, onClose }; }, [token, visible, blocked, canClose, onClose]);
  function requestClose() {
    const current = live.current;
    if (!token || current.token !== token || !current.visible || current.blocked || !current.canClose()) return;
    current.onClose();
  }
  useLayoutEffect(() => {
    if (!visible || !token || typeof document === 'undefined' || !layer.current || !surface.current) return;
    const dialog = surface.current, root = layer.current, before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const isolated: { element: HTMLElement; inert: boolean }[] = [];
    // Isolate siblings at every ancestor, including the registration navigation.
    // Setting inert on an ancestor would also disable this nested editor.
    for (let branch: HTMLElement | null = root; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) if (sibling !== branch && sibling instanceof HTMLElement) {
        isolated.push({ element: sibling, inert: sibling.inert }); sibling.inert = true;
      }
      if (branch.parentElement === document.body) break;
    }
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex],[contenteditable="true"]'))
      .filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled') && !element.closest('[hidden],[inert]') && element.getClientRects().length > 0);
    const focusFirst = () => { const first = controls()[0]; (first ?? dialog).focus({ preventScroll: true }); };
    if (closeButton.current && !closeButton.current.disabled) closeButton.current.focus({ preventScroll: true }); else focusFirst();
    const close = () => {
      const current = live.current;
      if (current.token === token && current.visible && !current.blocked && current.canClose()) current.onClose();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const list = controls(), first = list[0], last = list.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); dialog.focus({ preventScroll: true }); }
      else if (event.shiftKey && (!list.includes(active as HTMLElement) || active === first)) { event.preventDefault(); last?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (!list.includes(active as HTMLElement) || active === last)) { event.preventDefault(); first.focus({ preventScroll: true }); }
    };
    const focusin = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) focusFirst(); };
    const outsidePointer = (event: Event) => { if (!root.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); } };
    document.addEventListener('keydown', keydown, true); document.addEventListener('focusin', focusin, true);
    document.addEventListener('pointerdown', outsidePointer, true); document.addEventListener('click', outsidePointer, true);
    return () => {
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin, true);
      document.removeEventListener('pointerdown', outsidePointer, true); document.removeEventListener('click', outsidePointer, true);
      for (const entry of isolated) entry.element.inert = entry.inert;
      if (document.body.style.overflow === 'hidden') document.body.style.overflow = overflow;
      if (before?.isConnected && !before.closest('[hidden],[inert]')) before.focus({ preventScroll: true });
    };
  }, [visible, token]);
  useLayoutEffect(() => {
    if (!visible || !token || typeof document === 'undefined' || !surface.current) return;
    const dialog = surface.current, focused = document.activeElement;
    // Disabling the focused control can silently move focus to BODY without a
    // focusin event. Repair that transition without stealing usable editor focus.
    if (!dialog.contains(focused) || focused instanceof HTMLElement && focused.hasAttribute('disabled')) dialog.focus({ preventScroll: true });
  }, [visible, token, blocked]);
  return <div ref={layer} hidden={modal && !open} data-detail-image-edit-layer={visible ? 'true' : undefined}
    data-free-image-editor="true" data-workspace-saving={visible ? 'true' : undefined}
    onMouseDown={visible ? event => { event.stopPropagation(); if (event.target === event.currentTarget) requestClose(); } : undefined}
    onClick={visible ? event => event.stopPropagation() : undefined}
    style={visible ? { position: 'fixed', inset: 0, zIndex: 1700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(15,23,42,.65)' } : undefined}>
    <div ref={surface} role={visible ? 'dialog' : undefined} aria-modal={visible ? true : undefined} aria-label={visible ? '이미지 편집' : undefined} tabIndex={visible ? -1 : undefined}
      style={visible ? { width: 'min(1140px,100%)', maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto', overscrollBehavior: 'contain', borderRadius: 8, background: '#fff', boxShadow: '0 18px 60px #0f172a44' } : undefined}>
      <header hidden={!visible} style={{ position: 'sticky', top: 0, zIndex: 2, display: visible ? 'flex' : 'none', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
        <h3 style={{ margin: 0 }}>이미지 편집</h3><button ref={closeButton} type="button" className="icon-close" aria-label="이미지 편집 닫기" disabled={blocked} onClick={requestClose}>×</button>
      </header>
      <div style={visible ? { padding: 20 } : undefined}>{children}</div>
    </div>
  </div>;
}
