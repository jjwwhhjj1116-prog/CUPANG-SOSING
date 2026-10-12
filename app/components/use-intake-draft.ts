'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { confirmIntakeDraftSave, intakeDraftBody, intakeDraftOwnerId, readIntakeDraftResponse } from '@/app/intake-draft';
import type { IntakeRow } from '@/app/intake-queue';

export function useIntakeDraft(workspaceOwnerId?: string) {
  const ownerId = intakeDraftOwnerId(workspaceOwnerId);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const operation = useRef<{ ownerId: string | null; epoch: number; mounted: boolean }>({ ownerId: null, epoch: 0, mounted: false });
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [goal, setGoal] = useState('price');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(true);
  const [loading, setLoading] = useState(true);
  const [autoPaused, setAutoPaused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('상품 대기열 초안을 불러오는 중…');
  const revision = useRef<number | null>(null);
  const currentInput = useRef<{ rows: IntakeRow[]; goal: string; generation: number }>({ rows: [], goal: 'price', generation: 0 });
  const request = useRef<AbortController | null>(null);
  const unconfirmed = useRef<{ body: ReturnType<typeof intakeDraftBody>; generation: number } | null>(null);
  useLayoutEffect(() => {
    request.current?.abort(); request.current = null;
    revision.current = null; unconfirmed.current = null;
    currentInput.current = { rows: [], goal: 'price', generation: 0 };
    const epoch = operation.current.epoch + 1;
    operation.current = { ownerId, epoch, mounted: true };
    setAccountEpoch(epoch); setRows([]); setGoal('price'); setDirty(false); setReady(false);
    setSaving(Boolean(ownerId)); setLoading(Boolean(ownerId)); setAutoPaused(!ownerId);
    setMessage(ownerId ? '상품 대기열 초안을 불러오는 중…' : '로그인 계정을 확인하지 못했습니다. 페이지를 새로고침해주세요.');
    return () => {
      operation.current.mounted = false; operation.current.epoch++;
      request.current?.abort(); request.current = null;
    };
  }, [ownerId]);
  const active = useCallback(() => Boolean(ownerId) && operation.current.mounted
    && operation.current.ownerId === ownerId && operation.current.epoch === accountEpoch, [ownerId, accountEpoch]);
  const load = useCallback(async () => {
    if (!active() || request.current || !ownerId) return;
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch('/api/intake-draft', { cache: 'no-store', signal: controller.signal });
      const result = await response.json() as { error?: string };
      if (controller.signal.aborted || !active()) return;
      if (!response.ok) throw Error(result?.error || '초안을 불러오지 못했습니다.');
      const draft = readIntakeDraftResponse(result, ownerId);
      revision.current = draft.revision; unconfirmed.current = null;
      currentInput.current = { rows: draft.rows, goal: draft.goal, generation: currentInput.current.generation + 1 };
      setRows(draft.rows); setGoal(draft.goal); setDirty(false); setReady(true); setAutoPaused(false);
      setMessage(draft.updatedAt ? `임시저장 복구 · ${new Date(draft.updatedAt).toLocaleString('ko-KR')}` : '입력을 마치면 대기열이 자동 저장됩니다.');
    } catch (cause) { if (!controller.signal.aborted && active()) { setAutoPaused(true); setMessage(cause instanceof Error ? cause.message : '초안 조회 실패'); } }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted && active()) { setSaving(false); setLoading(false); } }
  }, [active, ownerId]);
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => { if (current) void load(); });
    return () => { current = false; };
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const save = useCallback(async () => {
    if (!active() || !ownerId || request.current || revision.current === null) return;
    const controller = new AbortController(); request.current = controller; setSaving(true);
    // Old callbacks and queued timers still save the latest input. Capture its
    // values and generation together so a later edit cannot be acknowledged by
    // a request that stored an earlier snapshot.
    const snapshot = currentInput.current, started = snapshot.generation;
    let reconciling = false;
    const acknowledge = (savedGeneration: number, recovered = false) => {
      setAutoPaused(false);
      if (savedGeneration === currentInput.current.generation) setDirty(false);
      setMessage(savedGeneration !== currentInput.current.generation ? '이전 입력 저장 완료 · 최신 변경을 이어서 저장합니다.'
        : recovered ? '서버의 저장 결과를 확인해 복구했습니다.' : '자동저장 완료 · 접수 완료 행은 기존 수집 요청에 보관됩니다.');
    };
    const reconcile = async () => {
      const pending = unconfirmed.current;
      if (!pending) return null;
      const response = await fetch('/api/intake-draft', { cache: 'no-store', signal: controller.signal });
      const result = await response.json() as { error?: string };
      if (controller.signal.aborted || !active()) return null;
      if (!response.ok) throw Error(result?.error || '서버의 저장 결과를 조회하지 못했습니다.');
      const draft = readIntakeDraftResponse(result, ownerId);
      if (draft.revision === pending.body.expectedRevision) { unconfirmed.current = null; return null; }
      confirmIntakeDraftSave(result, pending.body);
      revision.current = draft.revision; unconfirmed.current = null;
      return pending;
    };
    try {
      if (unconfirmed.current) {
        reconciling = true;
        const recovered = await reconcile();
        reconciling = false;
        if (controller.signal.aborted || !active()) return;
        if (recovered && recovered.generation === started) { acknowledge(recovered.generation, true); return; }
      }
      const body = intakeDraftBody(snapshot.rows, snapshot.goal, revision.current, ownerId);
      unconfirmed.current = { body, generation: started };
      const response = await fetch('/api/intake-draft', { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (controller.signal.aborted || !active()) return;
      if (!response.ok) throw Error(result?.error || '임시저장 실패');
      const draft = confirmIntakeDraftSave(result, body);
      revision.current = draft.revision; unconfirmed.current = null;
      acknowledge(started);
    } catch (cause) {
      if (controller.signal.aborted || !active()) return;
      let failure = cause;
      if (unconfirmed.current && !reconciling) {
        try {
          const recovered = await reconcile();
          if (controller.signal.aborted || !active()) return;
          if (recovered) { acknowledge(recovered.generation, true); return; }
        } catch (error) { failure = error; }
      }
      if (!controller.signal.aborted && active()) { setAutoPaused(true); setMessage(`자동저장 일시중지 · ${failure instanceof Error ? failure.message : '임시저장 실패'}`); }
    }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted && active()) setSaving(false); }
  }, [active, ownerId]);
  useEffect(() => {
    if (!ready || !dirty || saving || autoPaused) return;
    const timer = window.setTimeout(() => { void save(); }, 1000);
    return () => window.clearTimeout(timer);
  }, [ready, dirty, saving, autoPaused, rows, goal, save]);
  return { rows, goal, ready, saving, loading, dirty, autoPaused, message, load: () => { if (active() && !request.current) { setSaving(true); setLoading(true); void load(); } }, save,
    setRows: (update: (rows: IntakeRow[]) => IntakeRow[]) => {
      if (!active()) return;
      const rows = update(currentInput.current.rows);
      currentInput.current = { ...currentInput.current, rows, generation: currentInput.current.generation + 1 };
      setDirty(true); setRows(rows);
    },
    setGoal: (goal: string) => {
      if (!active()) return;
      currentInput.current = { ...currentInput.current, goal, generation: currentInput.current.generation + 1 };
      setDirty(true); setGoal(goal);
    },
  };
}
