'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { planBatchSeoWork, refreshBatchSeoWorkTask, refreshBatchSeoWorkProgress,readBatchSeoSavedState, type BatchSeoPlan, type BatchSeoTask, type BatchSeoProduct } from '@/app/batch-seo-work';
import type { SeoWorkspaceView } from '@/app/seo-workspace';
import { SeoWorkspaceGenerator } from '@/app/components/seo-workspace-generator';
import {BatchOptionTranslationRetry} from '@/app/components/batch-option-translation-retry';

type Props = { products: BatchSeoProduct[]; onBusyChange?: (value: boolean) => void; onPendingChange?: (value: boolean) => void; onComplete: (products: BatchSeoProduct[]) => void };
export function BatchSeoWorkPanel(props: Props) {
  const [plan, setPlan] = useState<BatchSeoPlan | null>(null), [task, setTask] = useState<BatchSeoTask | null>(null), [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [decisions, setDecisions] = useState<Record<string, string>>({}), [generation, setGeneration] = useState(0);
  const [progressMessage,setProgressMessage]=useState('');
  const [uncertain, setUncertain] = useState(false), [observed, setObserved] = useState<SeoWorkspaceView | null>(null);
  const controls = useRef(props), alive = useRef(true), request = useRef<AbortController | null>(null), currentTask = useRef<BatchSeoTask | null>(null), currentPlan = useRef<BatchSeoPlan | null>(null);
  const childBusy = useRef(false), childPending = useRef(false), childUncertain = useRef(false), epoch = useRef(0), cohort = useRef(''), done = useRef<Record<string, string>>({}),liveObserved=useRef<SeoWorkspaceView|null>(null),completedProducts=useRef<BatchSeoProduct[]>([]);
  const productKey = JSON.stringify(props.products.map(product => [product.id, product.title]));
  useLayoutEffect(() => { controls.current = props; });
  function publish(b: boolean, p: boolean) { setBusy(b); setPending(p); controls.current.onBusyChange?.(b); controls.current.onPendingChange?.(p); }
  const current = () => alive.current && cohort.current === JSON.stringify(controls.current.products.map(product => [product.id, product.title]));
  const ownsChild = () => current() && currentTask.current === task && epoch.current === generation;
  const currentChild = () => ownsChild() && !request.current;
  const locked = () => !!request.current || childBusy.current || childPending.current || childUncertain.current;
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); controls.current.onBusyChange?.(false); controls.current.onPendingChange?.(false); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller; cohort.current = productKey; epoch.current++; currentTask.current = null; currentPlan.current = null; done.current = {};
    let listening = true;
    void Promise.resolve().then(async () => { if(!listening||controller.signal.aborted)return;publish(true, false); setTask(null); setPlan(null); setError(''); setProgressMessage('');setDecisions({}); childBusy.current = false; childPending.current = false; childUncertain.current = false;try {
      const value = await planBatchSeoWork(controls.current.products, controller.signal);
      if (!listening || !current() || controller.signal.aborted || request.current !== controller) return;
      currentPlan.current = value;completedProducts.current=value.products;setPlan(value);
      if (value.tasks[0]) { await refreshBatchSeoWorkTask(value.tasks[0], value, controller.signal); if (!listening || !current() || controller.signal.aborted) return; currentTask.current = value.tasks[0]; epoch.current++; setGeneration(epoch.current); setTask(value.tasks[0]); }
    } catch (cause) { if (listening && current() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'SEO 검토 목록을 읽지 못했습니다.'); }
    finally { if (request.current === controller) { request.current = null; if (listening && current()) publish(false, false); } } });
    return () => { listening = false; controller.abort(); if (request.current === controller) request.current = null; };
    // The explicit selected cohort owns all child callbacks.
  }, [productKey]);
  async function select(value: BatchSeoTask) {
    const valuePlan = currentPlan.current; if (!current() || locked() || !valuePlan || done.current[value.productId]) return;
    const controller = new AbortController(); request.current = controller; publish(true, false); setError('');
    try { await refreshBatchSeoWorkTask(value, valuePlan, controller.signal); if (!current() || controller.signal.aborted || request.current !== controller) return; currentTask.current = value; epoch.current++; setTask(value); setGeneration(epoch.current);liveObserved.current=null; setObserved(null); }
    catch (cause) { if (current() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '저장본 확인 실패'); }
    finally { if (request.current === controller) { request.current = null; if (current()) publish(false, false); } }
  }
  function settleTask(message: string) {
    if (!task||!ownsChild()||currentPlan.current!==plan) return; done.current = { ...done.current, [task.productId]: message }; setDecisions(done.current); currentTask.current = null; epoch.current++; setTask(null);liveObserved.current=null; setObserved(null); childPending.current = false; childUncertain.current = false; childBusy.current = false; setUncertain(false); publish(false, false);
  }
  async function saved(didSave=true,message='') {
    if (!currentChild() || !task || !plan) return; const selected = task, selectedEpoch = generation, controller = new AbortController(); request.current = controller; publish(true, true); setError('');
    try { const progress = await refreshBatchSeoWorkProgress(selected, plan, controller.signal, fetch, didSave); if (!current() || controller.signal.aborted || request.current !== controller || currentTask.current !== selected || epoch.current !== selectedEpoch) return;
      completedProducts.current=completedProducts.current.map(product=>product.id===selected.productId?{...product,updated_at:progress.view.productVersion}:product);
      setProgressMessage(message||(didSave?'저장한 초안의 남은 미완료 항목을 다시 확인했습니다.':'현재 미완료 항목을 다시 확인했습니다.'));
      if(!progress.task)settleTask(didSave?'검토한 초안을 명시적으로 저장하고 현재 SEO·옵션 저장본을 확인했습니다.':'현재 저장본에 추가로 번역할 SEO·옵션 항목이 없음을 확인했습니다.');
      else{
        const nextPlan={...plan,tasks:plan.tasks.map(item=>item.productId===selected.productId?progress.task!:item)};currentPlan.current=nextPlan;setPlan(nextPlan);
        currentTask.current=progress.task;epoch.current++;setTask(progress.task);setGeneration(epoch.current);childBusy.current=false;childPending.current=false;childUncertain.current=false;setUncertain(false);liveObserved.current=null;setObserved(null);
      }
    } catch (cause) { if (current() && !controller.signal.aborted) { childUncertain.current = true; setUncertain(true); setError(cause instanceof Error ? cause.message : '저장 확인 실패'); } }
    finally { if (request.current === controller) { request.current = null; if (current()) publish(false, childPending.current || childUncertain.current); } }
  }
  const optionOnly=Boolean(task&&task.seoMissingFields?.length===0&&(task.pendingOptionAttributes??0)>0);
  async function observe() {
    if (!current() || request.current || childBusy.current || !task || !plan) return; const selected = task, selectedEpoch = generation, controller = new AbortController(); request.current = controller; publish(true, true); setError('');
    try { const value = await readBatchSeoSavedState(selected, plan, controller.signal); if (current() && !controller.signal.aborted && currentTask.current === selected && epoch.current === selectedEpoch) {liveObserved.current=value;setObserved(value);} }
    catch (cause) { if (current() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '저장본 조회 실패'); }
    finally { if (request.current === controller) { request.current = null; if (current()) publish(false, true); } }
  }
  return <section className="panel-stack" aria-label="가격 전 SEO 검토" data-workspace-saving={busy} data-workspace-dirty={pending}>
    <h3>먼저 SEO 저장본 확인·검토</h3><p>이미 검토된 SEO와 직접 저장한 값·공란은 보존합니다. 미완성 상품만 아래에서 초안을 요청하고 미리보기 후 직접 저장하세요. 가격 확인은 이 단계의 검토 또는 명시적 건너뛰기 뒤 시작합니다.</p>
    <p>부분 미완성 상품의 기존 번역값도 새 초안과 다르면 미리보기에 표시됩니다. 통합 저장을 직접 누를 때만 변경됩니다.</p>
    {error && <p role="alert">{error}</p>}{plan?.messages.map(item => <p role="status" key={item.productId}>{item.message}</p>)}
    {progressMessage&&<p role="status">{progressMessage}</p>}
    {plan && <p>SEO 검토 필요 {plan.tasks.length}개 · 검토 결정 {Object.keys(decisions).length}개</p>}
    <div className="quote-actions">{plan?.tasks.map(item => <button type="button" className="btn ghost" key={item.productId} disabled={busy || pending || !!decisions[item.productId]} onClick={() => void select(item)}>{item.productTitle} · {decisions[item.productId] ?? item.missingFields.join(', ')}</button>)}</div>
    {task && <><h4>{task.productTitle}</h4>{optionOnly?<BatchOptionTranslationRetry key={`${task.productId}:${generation}`} task={task} plan={plan!}
      beforeRetry={async(signal,recovering)=>{if(!currentChild()||currentPlan.current!==plan)throw Error('현재 SEO·옵션 검토 대상이 변경되었습니다.');if(recovering)await readBatchSeoSavedState(task,plan!,signal);else await refreshBatchSeoWorkTask(task,plan!,signal);if(!currentChild()||currentPlan.current!==plan)throw Error('현재 SEO·옵션 검토 대상이 변경되었습니다.');}}
      onSettled={(didSave,message)=>void saved(didSave,message)}
      onBusyChange={value=>{if(ownsChild()){childBusy.current=value;publish(!!request.current||value,childPending.current||childUncertain.current);}}}
      onPendingChange={value=>{if(ownsChild()){childPending.current=value;publish(!!request.current||childBusy.current,value||childUncertain.current);}}}
      onUncertainChange={value=>{if(ownsChild()){childUncertain.current=value;setUncertain(value);publish(!!request.current||childBusy.current,childPending.current||value);}}}/>
      :<SeoWorkspaceGenerator key={`${task.productId}:${generation}`} workspaceOwnerId={plan!.ownerId} productId={task.productId} version={task.productVersion} brand={task.brand} active
      beforeGenerate={() => currentChild() && !request.current} onSaved={() => void saved()}
      onProcessingChange={value=>{if(ownsChild()){childBusy.current=value;publish(!!request.current||value,childPending.current||childUncertain.current);}}}
      onBusyChange={value => { if (ownsChild()) { childBusy.current = value; publish(!!request.current||value, childPending.current || childUncertain.current); } }}
      onPendingChange={value => { if (ownsChild()) { childPending.current = value; publish(!!request.current||childBusy.current, value || childUncertain.current); } }}
      onApplyUncertainChange={value => { if (ownsChild()) { childUncertain.current = value; setUncertain(value); publish(!!request.current||childBusy.current, childPending.current || value); } }}/>}
      <button type="button" className="btn ghost" disabled={busy || pending} onClick={() => { if (currentChild() && !locked()) settleTask('SEO·옵션은 나중에 검토하기로 선택했습니다. 완료로 처리하지 않았습니다.'); }}>{optionOnly?'이 상품 옵션은 나중에 검토':'이 상품 SEO는 나중에 검토'}</button></>}
    {uncertain && <section aria-label="SEO 저장 결과 직접 확인"><p role="status">저장 결과가 확정되지 않았습니다. 같은 저장을 다시 보내지 않습니다. 현재 저장본을 조회하고 직접 확인해주세요.</p><button type="button" className="btn ghost" disabled={busy} onClick={() => void observe()}>현재 SEO 저장본 조회</button>
      {observed && <><p>상품명: {observed.content.seo.title.value || '(공란)'}</p><p>검색태그: {observed.content.seo.keywords.value.join(', ') || '(공란)'}</p><p>설명: {observed.content.seo.description.value || '(공란)'}</p><small>저장 버전 {observed.productVersion}</small><button type="button" className="btn ghost" disabled={busy} onClick={() => { if (currentChild()&&liveObserved.current===observed&&currentPlan.current===plan&&observed.productId===currentTask.current?.productId) settleTask('현재 저장본을 직접 확인하고 SEO를 나중에 검토하기로 선택했습니다. 이전 요청 성공으로 처리하지 않았습니다.'); }}>이 저장본을 확인했으며 SEO는 나중에 검토</button></>}
    </section>}
    {plan && <button type="button" className="btn primary" disabled={busy || pending || plan.tasks.some(item => !decisions[item.productId])} onClick={() => { if (current()&&currentPlan.current===plan&&!locked()&&plan.tasks.every(item => done.current[item.productId])) controls.current.onComplete(completedProducts.current); }}>SEO 검토 결정 후 가격 확인 계속</button>}
  </section>;
}
