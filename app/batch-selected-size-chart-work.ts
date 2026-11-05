import { createReferenceSizeChart } from '@/app/manual-size-chart';
import type { ProductContent } from '@/app/product-content';
import type { RegistrationLayout } from '@/app/registration-layout';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { renderDocument } from '@/app/document-image-render';
import { sameSizeChartValue, unchangedSizeChartSaveSnapshot, type SizeChartSaveSnapshot } from '@/app/size-chart-save';
import { readSizeChartSaveSnapshot, prepareSizeChartSaveAttempt, sendSizeChartSaveAttempt, recoverSizeChartSaveAttempt, type SizeChartSaveAttempt } from '@/app/size-chart-save-client';

type Source = { content: ProductContent; layout: RegistrationLayout };
type Controls = { expectedOwnerId: string; company: SupplierHubCompany; keys: Map<string,string>; signal: AbortSignal; fetcher: typeof fetch;
  assertCurrent: () => Promise<void>; source?: Source; trackMutationDispatch?: (mark: () => void) => () => void };
type State = { company: SupplierHubCompany; source: Source; active: boolean; attempt?: SizeChartSaveAttempt };
export type SelectedSizeChartWorkResult = { status: 'draft'|'blocked'|'skipped'; message: string; uncertain?: true; stop?: true };
const attempts = new WeakMap<Map<string,string>,Map<string,State>>();
const identity = (ownerId: string, productId: string) => ownerId + ':' + productId;
export function hasSelectedSizeChartAttempt(keys: Map<string,string>, ownerId: string, productId: string): boolean { return attempts.get(keys)?.has(identity(ownerId,productId)) ?? false; }
export class SelectedSizeChartSourceChanged extends Error {}
const changed = () => new SelectedSizeChartSourceChanged('사이즈표 작업 중 계정·회사·카테고리 또는 저장 원본이 변경되었습니다. 기존 입력과 파일을 유지하고 뒤의 작업을 멈췄습니다.');

/** Retain one exact PNG before dispatch. A later same-request invocation may
 * only read that attempt; it never authorizes another POST or rendering. */
export async function runSelectedSizeChartWork(productId: string, controls: Controls, deps: { render?: typeof renderDocument } = {}): Promise<SelectedSizeChartWorkResult> {
  let states = attempts.get(controls.keys); if (!states) { states = new Map(); attempts.set(controls.keys,states); }
  const key = identity(controls.expectedOwnerId,productId), pendingKey = key + ':pending:sizeChart', pendingMessage = '사이즈표 저장 결과 확인 필요';
  let state = states.get(key);
  if (state?.active) return { status: 'blocked', uncertain: true, message: '같은 사이즈표 작업을 확인하고 있습니다. 새 생성·저장은 시작하지 않았습니다.' };
  const retained = !!state;
  if (!state) { if (!controls.source) throw changed(); state = { company: structuredClone(controls.company), source: controls.source, active: false }; states.set(key,state); }
  const currentState = state; currentState.active = true;
  let scopeFailure: unknown, dispatched = false, sending = false, recoveredDuringSend = false, stopTracking: (() => void) | undefined;
  async function current() {
    controls.signal.throwIfAborted(); if (scopeFailure) throw scopeFailure;
    try { await controls.assertCurrent(); } catch (cause) { scopeFailure = cause; throw cause; }
    controls.signal.throwIfAborted();
  }
  const fetcher: typeof fetch = async (input,init) => { await current(); if(sending&&String(input).includes('/size-chart-save')&&String(input).includes('uploadId='))recoveredDuringSend=true; const response = await controls.fetcher(input,init); await current();
    if(response.status===409&&(init?.method??'GET').toUpperCase()==='GET'&&typeof input==='string'&&input.split('?')[0]===`/api/products/${encodeURIComponent(productId)}/size-chart-save`)throw changed();
    return response; };
  const io = { signal: controls.signal, current: () => !scopeFailure && !controls.signal.aborted, fetcher };
  const release = () => { if (states!.get(key) === currentState) states!.delete(key); if (controls.keys.get(pendingKey) === pendingMessage) controls.keys.delete(pendingKey); };
  const uncertain = (): SelectedSizeChartWorkResult => ({ status: 'blocked', uncertain: true, message: '사이즈표 저장 결과를 아직 확정하지 못했습니다. 같은 작업의 결과 확인은 조회로만 진행하며 원래 PNG와 저장 번호를 유지했습니다. 자동으로 다시 저장하지 않습니다.' });
  async function confirmed(snapshot: SizeChartSaveSnapshot) {
    await current(); const profileId = currentState.attempt!.profileId, suffix = profileId ? '?profileId=' + encodeURIComponent(profileId) : '';
    const response = await fetcher(`/api/products/${encodeURIComponent(productId)}/quotation-fields${suffix}`,{signal:controls.signal,cache:'no-store',credentials:'same-origin',redirect:'error'}), view = await response.json() as QuotationFieldsView;
    await current();
    if (!response.ok || response.redirected || view.productVersion !== snapshot.productVersion || view.contentRevision !== snapshot.content.revision
      || view.optionRevision !== snapshot.options.revision || view.revision !== snapshot.quotationRevision || view.inputFingerprint !== snapshot.inputFingerprint
      || view.categoryContext.categoryId !== snapshot.categoryId || !sameSizeChartValue(view.imageKeys,snapshot.imageKeys)) throw changed();
    release(); return { status: 'draft' as const, message: currentState.attempt!.input.chart && sameSizeChartValue(currentState.attempt!.input.chart,createReferenceSizeChart())
      ? '참고용 Free Size 안내표와 PNG를 저장하고 견적서 연결을 확인했습니다. 실제 측정값을 만들거나 기존 옵션별 이미지 선택을 바꾸지 않았습니다.'
      : '저장된 수동 사이즈표의 PNG와 견적서 연결을 확인했습니다. 기존 옵션별 이미지 선택을 유지했습니다.' };
  }
  try {
    await current(); if (!sameSizeChartValue(currentState.company,controls.company)) throw changed();
    if (currentState.attempt?.posted) {
      try { const recovered = await recoverSizeChartSaveAttempt(currentState.attempt,io); await current();
        if (recovered.state === 'committed') return { ...await confirmed(recovered.snapshot), stop: true };
      } catch (cause) { if (scopeFailure) throw scopeFailure; controls.signal.throwIfAborted(); if (cause instanceof SelectedSizeChartSourceChanged) throw cause; }
      return uncertain();
    }
    const { content, layout } = currentState.source, profileId = layout.categoryContext.source === 'profile' ? layout.categoryContext.profileId : null;
    const before = await readSizeChartSaveSnapshot(productId,profileId,io); await current();
    if (before.ownerId !== controls.expectedOwnerId || before.productVersion !== layout.productVersion || before.categoryId !== layout.categoryContext.categoryId
      || !sameSizeChartValue(before.content,content)) throw changed();
    if (before.content.assets.size.value.length) { release(); return {status:'draft',message:'저장된 사이즈표 이미지를 유지했습니다.'}; }
    if (!before.content.manualSizeChart && before.content.assets.size.provenance === 'manual') { release(); return {status:'blocked',message:'직접 비운 사이즈표 선택을 유지했습니다. 사이즈표 편집에서 확인해주세요.'}; }
    if (!before.content.manualSizeChart && !layout.sizeChartRequired) { release(); return {status:'skipped',message:'선택 항목인 사이즈표 원본이 없어 생략했습니다.'}; }
    const chart = before.content.manualSizeChart ?? createReferenceSizeChart();
    currentState.attempt = await prepareSizeChartSaveAttempt(before,chart,profileId,io,deps.render); await current();
    let latest: SizeChartSaveSnapshot;
    try { latest = await readSizeChartSaveSnapshot(productId,profileId,io); } catch { if (scopeFailure) throw scopeFailure; controls.signal.throwIfAborted(); throw changed(); }
    if (!unchangedSizeChartSaveSnapshot(before,latest)) throw changed();
    controls.keys.set(pendingKey,pendingMessage);
    dispatched = !controls.trackMutationDispatch;
    stopTracking = controls.trackMutationDispatch?.(() => { dispatched = true; });
    try {
      sending = true; await sendSizeChartSaveAttempt(currentState.attempt,io); sending = false; await current();
      const recovered = await recoverSizeChartSaveAttempt(currentState.attempt,io); await current();
      if (recovered.state !== 'committed') return uncertain();
      return {...await confirmed(recovered.snapshot),...(recoveredDuringSend?{stop:true as const}:{})};
    } catch (cause) { if (!dispatched) { release(); throw cause; } await current(); if (cause instanceof SelectedSizeChartSourceChanged) throw cause; return uncertain(); }
  } catch (cause) {
    if (!currentState.attempt?.posted || !retained && !dispatched) release();
    if (scopeFailure) throw scopeFailure; throw cause;
  } finally { stopTracking?.(); currentState.active = false; }
}
