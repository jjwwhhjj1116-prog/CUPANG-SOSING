'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { planBatchImageWork, refreshBatchImageTask, type BatchImagePlan, type BatchImageTask } from '@/app/batch-image-work';
import { DetailImageBatchPanel } from '@/app/components/detail-image-batch-panel';

type Props = { products: { id: string; title: string }[]; autoPrepare?: boolean;
  onBusyChange?: (busy: boolean) => void; onPendingChange?: (pending: boolean) => void };
const stageName = { main: '대표 이미지', additional: '추가 이미지', detail: '상세 이미지' };

/** Work-start advances into a review queue, never into an unreviewed upload.
 * Prepare one option/stage at a time to keep canvas/PNG memory bounded. */
export function BatchImageWorkPanel(props: Props) {
  const [plan, setPlan] = useState<BatchImagePlan | null>(null), [active, setActive] = useState<BatchImageTask | null>(null);
  const [version, setVersion] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [initial, setInitial] = useState(true), [autoPrepare, setAutoPrepare] = useState(false);
  const [generation, setGeneration] = useState(0);
  const controls = useRef(props), alive = useRef(true), request = useRef<AbortController | null>(null);
  const childBusy = useRef(false), childPending = useRef(false), currentPlan = useRef<BatchImagePlan | null>(null);
  const selectedTask = useRef<BatchImageTask | null>(null), selectionVersion = useRef(0), selectionProducts = useRef('');
  const productKey = JSON.stringify(props.products.map(product => [product.id, product.title]));
  useLayoutEffect(() => { controls.current = props; }, [props]);
  const publishBusy = useCallback((value: boolean) => { childBusy.current = value; setBusy(value); controls.current.onBusyChange?.(value); }, []);
  const publishPending = useCallback((value: boolean) => { childPending.current = value; setPending(value); controls.current.onPendingChange?.(value); }, []);
  const locked = () => !!request.current || childBusy.current || childPending.current;
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); controls.current.onBusyChange?.(false); controls.current.onPendingChange?.(false); }; }, []);
  async function openTask(task: BatchImageTask, value: BatchImagePlan, start: boolean, controller: AbortController) {
    const view = await refreshBatchImageTask(task, value, controller.signal);
    if (!alive.current || controller.signal.aborted || request.current !== controller) return;
    selectedTask.current = task; selectionVersion.current++;
    selectionProducts.current = JSON.stringify(controls.current.products.map(product => [product.id, product.title]));
    setVersion(view.productVersion); setActive(task); setAutoPrepare(start); setGeneration(selectionVersion.current);
  }
  async function load(start: boolean) {
    if (locked()) return;
    const controller = new AbortController(); request.current = controller; publishBusy(true); setError('');
    try {
      const value = await planBatchImageWork(controls.current.products, controller.signal);
      if (!alive.current || controller.signal.aborted || request.current !== controller) return;
      currentPlan.current = value; selectedTask.current = null; setPlan(value); setActive(null);
      if (start && value.enabled && value.tasks[0]) await openTask(value.tasks[0], value, true, controller);
    } catch (cause) { if (alive.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '저장 이미지 목록을 읽지 못했습니다.'); }
    finally { if (request.current === controller) { request.current = null; if (alive.current) { publishBusy(false); setInitial(false); } } }
  }
  useEffect(() => {
    // Mounting this review mode reads saved settings/fields. OCR is permitted
    // only after the work-start action explicitly passed autoPrepare=true.
    // A changed product selection cannot keep an old task active or let its
    // late callbacks release this selection's busy/dirty guards.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      selectedTask.current = null; selectionVersion.current++; setActive(null); currentPlan.current = null;
      childBusy.current = false; childPending.current = false; publishPending(false);
      void load(controls.current.autoPrepare === true);
    });
    return () => { cancelled = true; request.current?.abort(); request.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey]);
  async function select(task: BatchImageTask) {
    const value = currentPlan.current;
    if (locked() || !value || !value.enabled) return;
    const controller = new AbortController(); request.current = controller; publishBusy(true); setError('');
    try { await openTask(task, value, true, controller); }
    catch (cause) { if (alive.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '현재 이미지 목록을 확인하지 못했습니다.'); }
    finally { if (request.current === controller) { request.current = null; if (alive.current) publishBusy(false); } }
  }
  const currentChild = () => alive.current && !request.current && selectedTask.current === active && selectionVersion.current === generation
    && selectionProducts.current === JSON.stringify(controls.current.products.map(product => [product.id, product.title]));
  return <section className="panel-stack" aria-label="선택 상품 이미지 번역 작업" data-workspace-saving={busy} data-workspace-dirty={pending}>
    <h3>대표·추가·상세 이미지 번역</h3>
    <p>포함 옵션의 저장된 이미지를 무료 OCR과 Google 번역으로 준비합니다. 각 옵션의 원본과 한국어 결과를 확인하고 선택한 결과만 적용하세요. 상단·하단 설정 배너와 제외 옵션은 유지합니다.</p>
    <p>이미지 문구 번역을 처리합니다. 배경 제거·광고 문구 생성은 상품별 이미지 편집에서 진행할 수 있습니다.</p>
    {initial && <p role="status">로그인 계정의 기본설정과 저장 이미지 목록을 확인하고 있습니다…</p>}
    {plan && !plan.enabled && <p role="status">기본설정에서 이미지 번역이 꺼져 있어 번역을 시작하지 않았습니다.</p>}
    {plan?.messages.map((item, index) => <p role="status" key={`${item.productId}:${index}`}>{props.products.find(product => product.id === item.productId)?.title ?? item.productId} · {item.message}</p>)}
    {error && <p role="alert">{error}</p>}
    {plan?.enabled && <p>{plan.tasks.length}개 옵션·단계 작업 · 검토한 결과는 견적서의 같은 옵션에 연결됩니다.</p>}
    <div className="quote-actions">{plan?.tasks.map((task, index) => <button type="button" className="btn ghost" key={`${task.productId}:${task.optionId}:${task.stage}`} disabled={busy || pending}
      aria-pressed={active === task} onClick={() => void select(task)}>{index + 1}. {task.productTitle} · {task.optionLabel} · {stageName[task.stage]} {task.imageCount}장</button>)}</div>
    <button type="button" className="btn ghost" disabled={busy || pending} onClick={() => void load(false)}>현재 설정·이미지 목록 다시 확인</button>
    {active && <DetailImageBatchPanel key={`${active.productId}:${active.optionId}:${active.stage}:${generation}`} productId={active.productId}
      optionId={active.optionId} profileId={active.profileId ?? undefined} stage={active.stage} version={version} active autoPrepare={autoPrepare}
      onBusyChange={value => { if (currentChild()) publishBusy(value); }} onPendingChange={value => { if (currentChild()) publishPending(value); }}
      onSavedView={view => { if (currentChild()) setVersion(view.productVersion); }} />}
    {pending && <p role="status">준비한 결과를 적용하거나 미적용 결과를 지우면 다른 옵션·단계로 이동할 수 있습니다. 저장 확인이 필요한 요청은 먼저 같은 이미지의 저장 상태를 확인해주세요.</p>}
  </section>;
}
