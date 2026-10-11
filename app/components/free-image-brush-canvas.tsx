'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { MAX_FREE_IMAGE_BRUSH_POINTS, type FreeImageBrush, type FreeImageBrushPoint } from '@/app/free-image-brush';

export type FreeImageBrushStroke = { id: string; background: string; brush: FreeImageBrush };
type Props = {
  sourceUrl: string; width: number; height: number; scopeKey: string;
  enabled: boolean; disabled: boolean; size: number; color: string; maxPoints: number;
  strokes: readonly FreeImageBrushStroke[];
  onBegin: () => string | null;
  onComplete: (id: string, points: FreeImageBrushPoint[]) => void;
  onCancel: (id: string) => void;
};
type Rect = { left: number; top: number; width: number; height: number };
type Gesture = {
  id: string; pointerId: number; generation: number; scopeKey: string; sourceUrl: string;
  width: number; height: number; size: number; color: string; maxPoints: number;
  surface: SVGSVGElement; rect: Rect; points: FreeImageBrushPoint[];
  onComplete: Props['onComplete']; onCancel: Props['onCancel'];
};
type Draft = { size: number; color: string; points: FreeImageBrushPoint[] };
const copyPoints = (points: readonly FreeImageBrushPoint[]) => points.map(point => ({ ...point }));
const rectOf = (surface: SVGSVGElement): Rect => {
  const rect = surface.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
};
function pointAt(clientX: number, clientY: number, rect: Rect, width: number, height: number) {
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  return { x: Math.max(0, Math.min(width - 1, Math.round((clientX - rect.left) * width / rect.width))),
    y: Math.max(0, Math.min(height - 1, Math.round((clientY - rect.top) * height / rect.height))) };
}
function sameRect(left: Rect, right: Rect) { return Object.keys(left).every(key => left[key as keyof Rect] === right[key as keyof Rect]); }
function strokeShape(id: string, brush: FreeImageBrush, color: string) {
  if (!brush.points.length) return null;
  if (brush.points.length === 1) return <circle key={id} cx={brush.points[0].x} cy={brush.points[0].y} r={brush.size / 2} fill={color} />;
  return <path key={id} d={brush.points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')}
    fill="none" stroke={color} strokeWidth={brush.size} strokeLinecap="round" strokeLinejoin="round" />;
}

/** The image and SVG share the same fitted rectangle; coordinates are native
 * pixels. A scroll/resize during drawing cancels rather than rebinding a path. */
export function FreeImageBrushCanvas(props: Props) {
  const [draft, setDraft] = useState<Draft | null>(null), [generation, setGeneration] = useState(0), [notice, setNotice] = useState('');
  const livePropsRef = useRef(props), gestureRef = useRef<Gesture | null>(null), generationRef = useRef(0), mountedRef = useRef(true);
  function detachGesture() {
    const gesture = gestureRef.current; if (!gesture) return null;
    gestureRef.current = null; generationRef.current++;
    try { if (gesture.surface.hasPointerCapture(gesture.pointerId)) gesture.surface.releasePointerCapture(gesture.pointerId); } catch { /* A detached surface may have already lost capture. */ }
    return gesture;
  }
  function cancelGesture(message = '') {
    const gesture = detachGesture(); if (!gesture) return;
    gesture.onCancel(gesture.id);
    if (mountedRef.current) { setDraft(null); setGeneration(generationRef.current); if (message) setNotice(message); }
  }
  useLayoutEffect(() => {
    livePropsRef.current = props;
    const gesture = gestureRef.current;
    if (!gesture || props.enabled && !props.disabled && props.scopeKey === gesture.scopeKey && props.sourceUrl === gesture.sourceUrl
      && props.width === gesture.width && props.height === gesture.height && props.size === gesture.size && props.color === gesture.color && props.maxPoints === gesture.maxPoints) return;
    const canceled = detachGesture(); canceled?.onCancel(canceled.id);
    const nextGeneration = generationRef.current;
    void Promise.resolve().then(() => {
      if (mountedRef.current && generationRef.current === nextGeneration && !gestureRef.current) { setDraft(null); setGeneration(nextGeneration); }
    });
  }, [props]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; const gesture = detachGesture(); gesture?.onCancel(gesture.id); };
  }, []);
  function currentGesture(event: PointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current, current = livePropsRef.current;
    if (!mountedRef.current || generationRef.current !== generation || !gesture || gesture.generation !== generation
      || gesture.pointerId !== event.pointerId || gesture.surface !== event.currentTarget) return null;
    if (!current.enabled || current.disabled || current.scopeKey !== gesture.scopeKey || current.sourceUrl !== gesture.sourceUrl
      || current.width !== gesture.width || current.height !== gesture.height || !sameRect(gesture.rect, rectOf(event.currentTarget))) {
      cancelGesture('이미지 표시 영역이 변경되어 미완성 브러시 획을 취소했습니다.'); return null;
    }
    return gesture;
  }
  function appendPoint(gesture: Gesture, clientX: number, clientY: number) {
    const point = pointAt(clientX, clientY, gesture.rect, gesture.width, gesture.height);
    if (!point) { cancelGesture(); return false; }
    const last = gesture.points.at(-1);
    if (last?.x === point.x && last.y === point.y) return true;
    if (gesture.points.length >= gesture.maxPoints) { cancelGesture('브러시 점 수 한도를 넘겨 미완성 획을 취소했습니다. 더 짧은 획으로 그려주세요.'); return false; }
    gesture.points.push(point); return true;
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    const current = livePropsRef.current;
    if (!mountedRef.current || gestureRef.current || generationRef.current !== generation || current.scopeKey !== props.scopeKey
      || !current.enabled || current.disabled || event.button !== 0 || event.isPrimary === false
      || !Number.isSafeInteger(current.width) || !Number.isSafeInteger(current.height) || current.width < 1 || current.height < 1
      || !Number.isSafeInteger(current.size) || current.size < 1 || current.size > 200 || !/^#[a-f0-9]{6}$/iu.test(current.color)
      || !Number.isSafeInteger(current.maxPoints) || current.maxPoints < 1) return;
    const rect = rectOf(event.currentTarget), point = pointAt(event.clientX, event.clientY, rect, current.width, current.height); if (!point) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { return; }
    const id = current.onBegin();
    if (!id) { try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* No gesture was accepted. */ } return; }
    gestureRef.current = { id, pointerId: event.pointerId, generation, scopeKey: current.scopeKey, sourceUrl: current.sourceUrl,
      width: current.width, height: current.height, size: current.size, color: current.color, maxPoints: Math.min(MAX_FREE_IMAGE_BRUSH_POINTS, current.maxPoints),
      rect, surface: event.currentTarget, points: [point], onComplete: current.onComplete, onCancel: current.onCancel };
    event.preventDefault(); setNotice(''); setDraft({ size: current.size, color: current.color, points: [{ ...point }] });
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const gesture = currentGesture(event); if (!gesture) return;
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) { cancelGesture(); return; }
    event.preventDefault();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [event]) if (!appendPoint(gesture, sample.clientX, sample.clientY)) return;
    setDraft({ size: gesture.size, color: gesture.color, points: copyPoints(gesture.points) });
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const gesture = currentGesture(event); if (!gesture || !appendPoint(gesture, event.clientX, event.clientY)) return;
    event.preventDefault(); const completed = detachGesture(); if (!completed) return;
    setDraft(null); setGeneration(generationRef.current); completed.onComplete(completed.id, copyPoints(completed.points));
  }
  function pointerCanceled(event: PointerEvent<SVGSVGElement>) { if (currentGesture(event)) cancelGesture(); }
  return <><div style={{ position: 'relative', width: '100%', maxWidth: Math.min(props.width, 420 * props.width / props.height), aspectRatio: `${props.width}/${props.height}`, overflow: 'hidden' }}>
    <img src={props.sourceUrl} alt="문구 번역 원본" width={props.width} height={props.height} style={{ display: 'block', width: '100%', height: '100%' }} />
    <svg role="img" aria-label="브러시 편집 원본" data-testid="free-image-brush-surface" viewBox={`0 0 ${props.width} ${props.height}`} preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: props.enabled && !props.disabled ? 'none' : 'auto', cursor: props.enabled && !props.disabled ? 'crosshair' : 'default' }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCanceled} onLostPointerCapture={pointerCanceled}>
      <rect x={0} y={0} width={props.width} height={props.height} fill="transparent" pointerEvents="all" />
      {props.strokes.map(stroke => strokeShape(stroke.id, stroke.brush, stroke.background))}
      {draft && strokeShape('pending-brush', { size: draft.size, points: draft.points }, draft.color)}
    </svg>
  </div>{notice && <p role="status">{notice}</p>}</>;
}
