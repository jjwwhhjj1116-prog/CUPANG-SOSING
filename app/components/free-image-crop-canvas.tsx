'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { FreeImageCropRect } from '@/app/free-image-crop';

type Props = {
  sourceUrl: string; width: number; height: number; scopeKey: string; enabled: boolean; disabled: boolean;
  crop: FreeImageCropRect | null; onBegin: () => string | null;
  onComplete: (id: string, crop: FreeImageCropRect) => void; onCancel: (id: string) => void;
};
type Rect = { left: number; top: number; width: number; height: number };
type Point = { x: number; y: number };
type Gesture = {
  id: string; pointerId: number; generation: number; scopeKey: string; sourceUrl: string;
  width: number; height: number; rect: Rect; start: Point; end: Point; surface: SVGSVGElement;
  onComplete: Props['onComplete']; onCancel: Props['onCancel'];
};
function rectOf(surface: SVGSVGElement): Rect {
  const r = surface.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
}
function pointAt(x: number, y: number, rect: Rect, width: number, height: number): Point | null {
  if (![x, y, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  return { x: Math.max(0, Math.min(width - 1, Math.floor((x - rect.left) * width / rect.width))),
    y: Math.max(0, Math.min(height - 1, Math.floor((y - rect.top) * height / rect.height))) };
}
const sameRect = (a: Rect, b: Rect) => (Object.keys(a) as (keyof Rect)[]).every(key => a[key] === b[key]);
const boxOf = (a: Point, b: Point): FreeImageCropRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 });
function validBox(box: FreeImageCropRect | null, width: number, height: number): box is FreeImageCropRect {
  return !!box && [box.x, box.y, box.width, box.height].every(Number.isSafeInteger) && box.x >= 0 && box.y >= 0
    && box.width > 0 && box.height > 0 && box.x <= width - box.width && box.y <= height - box.height;
}

/** Selection stays in original pixels; moving the surface or changing the
 * source cancels a pending drag instead of moving it onto another image. */
export function FreeImageCropCanvas(props: Props) {
  const [draft, setDraft] = useState<FreeImageCropRect | null>(null), [generation, setGeneration] = useState(0), [notice, setNotice] = useState('');
  const liveProps = useRef(props), gestureRef = useRef<Gesture | null>(null), generationRef = useRef(0), mounted = useRef(true);
  function detach() {
    const gesture = gestureRef.current; if (!gesture) return null;
    gestureRef.current = null; generationRef.current++;
    try { if (gesture.surface.hasPointerCapture(gesture.pointerId)) gesture.surface.releasePointerCapture(gesture.pointerId); } catch { /* Detached SVG. */ }
    return gesture;
  }
  function cancel(message = '') {
    const gesture = detach(); if (!gesture) return;
    gesture.onCancel(gesture.id);
    if (mounted.current) { setDraft(null); setGeneration(generationRef.current); if (message) setNotice(message); }
  }
  useLayoutEffect(() => {
    liveProps.current = props; const gesture = gestureRef.current;
    if (!gesture || props.enabled && !props.disabled && props.scopeKey === gesture.scopeKey && props.sourceUrl === gesture.sourceUrl
      && props.width === gesture.width && props.height === gesture.height) return;
    const aborted = detach(); aborted?.onCancel(aborted.id); const next = generationRef.current;
    void Promise.resolve().then(() => { if (mounted.current && generationRef.current === next && !gestureRef.current) { setDraft(null); setGeneration(next); } });
  }, [props]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; const gesture = detach(); gesture?.onCancel(gesture.id); }; }, []);
  function current(event: PointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current, p = liveProps.current;
    if (!mounted.current || generationRef.current !== generation || !gesture || gesture.generation !== generation
      || gesture.pointerId !== event.pointerId || gesture.surface !== event.currentTarget) return null;
    if (!p.enabled || p.disabled || p.scopeKey !== gesture.scopeKey || p.sourceUrl !== gesture.sourceUrl || p.width !== gesture.width || p.height !== gesture.height
      || !sameRect(gesture.rect, rectOf(event.currentTarget))) { cancel('이미지 표시 영역이 변경되어 잘라내기 선택을 취소했습니다.'); return null; }
    return gesture;
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    const p = liveProps.current;
    if (!mounted.current || gestureRef.current || generationRef.current !== generation || p.scopeKey !== props.scopeKey || !p.enabled || p.disabled
      || event.button !== 0 || event.isPrimary === false || !Number.isSafeInteger(p.width) || !Number.isSafeInteger(p.height) || p.width < 1 || p.height < 1) return;
    const rect = rectOf(event.currentTarget), start = pointAt(event.clientX, event.clientY, rect, p.width, p.height); if (!start) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { return; }
    const id = p.onBegin(); if (!id) { try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* No accepted gesture. */ } return; }
    gestureRef.current = { id, pointerId: event.pointerId, generation, scopeKey: p.scopeKey, sourceUrl: p.sourceUrl, width: p.width, height: p.height,
      rect, start, end: start, surface: event.currentTarget, onComplete: p.onComplete, onCancel: p.onCancel };
    event.preventDefault(); setNotice(''); setDraft(boxOf(start, start));
  }
  function update(gesture: Gesture, event: PointerEvent<SVGSVGElement>) {
    const end = pointAt(event.clientX, event.clientY, gesture.rect, gesture.width, gesture.height);
    if (!end) { cancel(); return false; } gesture.end = end; return true;
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const gesture = current(event); if (!gesture) return;
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) { cancel(); return; }
    if (!update(gesture, event)) return; event.preventDefault(); setDraft(boxOf(gesture.start, gesture.end));
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const gesture = current(event); if (!gesture || !update(gesture, event)) return;
    event.preventDefault(); const completed = detach(); if (!completed) return;
    setDraft(null); setGeneration(generationRef.current); completed.onComplete(completed.id, boxOf(completed.start, completed.end));
  }
  function pointerCanceled(event: PointerEvent<SVGSVGElement>) { if (current(event)) cancel(); }
  const selected = validBox(draft, props.width, props.height) ? draft : validBox(props.crop, props.width, props.height) ? props.crop : { x: 0, y: 0, width: props.width, height: props.height };
  const enabled = props.enabled && !props.disabled;
  return <><div style={{ position: 'relative', width: '100%', maxWidth: Math.min(props.width, 420 * props.width / props.height), aspectRatio: `${props.width}/${props.height}`, overflow: 'hidden' }}>
    <img src={props.sourceUrl} alt="잘라내기 원본" width={props.width} height={props.height} style={{ display: 'block', width: '100%', height: '100%' }} />
    <svg role="img" aria-label="이미지 잘라내기 선택" data-testid="free-image-crop-surface" viewBox={`0 0 ${props.width} ${props.height}`} preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: enabled ? 'none' : 'auto', cursor: enabled ? 'crosshair' : 'default' }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCanceled} onLostPointerCapture={pointerCanceled}>
      <rect x={0} y={0} width={props.width} height={props.height} fill="transparent" pointerEvents="all" />
      <g fill="#000000" opacity={0.45} pointerEvents="none">
        <rect x={0} y={0} width={props.width} height={selected.y} />
        <rect x={0} y={selected.y + selected.height} width={props.width} height={props.height - selected.y - selected.height} />
        <rect x={0} y={selected.y} width={selected.x} height={selected.height} />
        <rect x={selected.x + selected.width} y={selected.y} width={props.width - selected.x - selected.width} height={selected.height} />
      </g>
      <rect x={selected.x} y={selected.y} width={selected.width} height={selected.height} fill="none" stroke="#38bdf8" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
    </svg>
  </div><p>드래그로 남길 영역을 선택하거나 픽셀 값을 입력하세요. 미리보기에서 잘라낸 결과를 확인한 뒤 적용합니다.</p>{notice && <p role="status">{notice}</p>}</>;
}
