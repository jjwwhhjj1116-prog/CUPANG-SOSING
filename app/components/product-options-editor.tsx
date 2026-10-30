'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { calculateOptionPrices, emptyOptionInput, optionInputs, optionFieldNames, OPTION_LIMIT, type OptionField, type OptionInput, type ProductOptionsResponse } from '@/app/product-options';
import { optionImageSaveRows, mergeSavedOptionImages } from '@/app/option-image-save';
import { productImageKeys } from '@/app/product-content';
import { applyOptionBulk, duplicateOption, moveOption, optionBulkPriceBase, parseCouplusBundleQuantity, previewOptionBulk, type BulkOptionAction, type BulkOptionPreview } from '@/app/option-editor-tools';
import { pricePolicy, type PricePolicy } from '@/app/pricing';
import { StageTwoPricePolicyFields } from '@/app/components/stage-two-price-policy-fields';
import { recalculateStageTwoRows, stageTwoQuotationDraft, verifyStageTwoPricingReceipt, unchangedStageTwoPricingReceipt, type StageTwoPricingRequest, type StageTwoPricingReceipt } from '@/app/stage-two-pricing';
import { mergeOptionDraft, refreshOptionPriceBase } from '@/app/option-price-refresh';
import { configuredBundlePolicy, type BundlePolicy } from '@/app/bundle-policy';
import {OptionMainImageEditor} from '@/app/components/option-main-image-editor';
import type {FreeImageQuotationRequest} from '@/app/free-image-translation-client';
import { confirmOptionTranslationSave } from '@/app/option-translation';
import { OptionPriceTable, OptionPriceSummary, PricePolicyRatio } from '@/app/components/option-price-table';
import { OptionQuotationPrices, type OptionPriceController } from '@/app/components/option-quotation-prices';
import { effectiveGridPrices } from '@/app/option-price-grid';
import { quotationValueIssues, type QuotationFieldsView } from '@/app/quotation-schema';
import { validOptionRegistrationNumbers } from '@/app/product-registration';
import { PriceSelectionDialog } from '@/app/components/price-selection-dialog';
import { createBundleAddDraft, verifyBundleAddReceipt, type BundleAddition, type BundleAddReceipt } from '@/app/option-bundles';
import { verifyOptionPriceView } from '@/app/option-price-save';
import { applyOptionNameChanges } from '@/app/option-seo-names';
import {recalculateStageTwoOptionCost} from '@/app/stage-two-option-recalculation';
import {readCategoryJsonResponse} from '@/app/load-category-profiles';

type Props = { product: { id: string; title: string; image_keys: string; updated_at?: string; registration_number?: string }; profileId?:string;refreshToken?:string;onSaved?: () => void; onReviewPackaging?: (optionId: string | null) => void; imageView?: boolean; imageProcessingBusy?: boolean; processingConfigured?:boolean|null;pricingView?: boolean; seoView?: boolean; focusedOptionId?: string; initialBulkAction?: 'remove';
  mainImageUploadControl?:ReactNode;editableQuotationPrices?:boolean;pricePolicyLocked?:boolean;beforePriceCommit?:()=>boolean;onPriceBusyChange?:(busy:boolean,operation:object)=>void;
  onTranslate?: (sourceKey:string,role:'main',sourceLanguage:'zh'|'en',quotationTarget:FreeImageQuotationRequest)=>void;
  onEdit?: (sourceKey:string,role:'main',quotationTarget:FreeImageQuotationRequest)=>void;
  onProcess?: (sourceKey:string,role:'main',quotationTarget:FreeImageQuotationRequest,quotationView?:QuotationFieldsView)=>void };
const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const originNames = { manual: '직접 입력', collected: '수집 원문', translated: '번역 결과', unverified: '미확인' };
async function fetchOptions(endpoint: string, signal?: AbortSignal, parent?: string): Promise<ProductOptionsResponse> {
  const response = await fetch(endpoint, { signal, cache: 'no-store' });
  const body = await readCategoryJsonResponse<ProductOptionsResponse & { error?: string }>(response,'옵션 편집 조회 [GET /api/products/:id/options]');
  if (!response.ok || !body.options) throw new Error(body.error || '옵션을 불러오지 못했습니다.');
  verifyOptionsRegistrationDisplay(body,decodeURIComponent(endpoint.split('/')[3]),parent);
  return body;
}
function verifyOptionsRegistrationDisplay(body: ProductOptionsResponse, productId: string, parent?: string) {
  if(body.options?.productId!==productId || !Array.isArray(body.options.rows) || body.options.rows.some(row=>typeof row?.id!=='string') || !validOptionRegistrationNumbers(body.optionRegistrationNumbers,body.options.rows,parent)) throw Error('상품의 옵션 등록번호 응답을 확인하지 못했습니다. 입력은 유지했습니다.');
}
export function ProductOptionsEditor(props: Props) {
  const [mainOpened,setMainOpened]=useState(props.imageView===true);
  useEffect(()=>{if(!props.imageView)return;let active=true;void Promise.resolve().then(()=>{if(active)setMainOpened(true);});return()=>{active=false;};},[props.imageView]);
  return <><div hidden={props.imageView}><OptionsEditor key={props.product.id} {...props} imageView={false}/></div><div hidden={!props.imageView}>{(mainOpened||props.imageView)&&<OptionMainImageEditor key={`${props.product.id}:${props.profileId??''}`} productId={props.product.id} version={props.product.updated_at} profileId={props.profileId} refreshToken={props.refreshToken} focusedOptionId={props.focusedOptionId} onSaved={props.onSaved} disabled={props.imageProcessingBusy} translationEnabled={props.imageView===true} saveOnSelect={props.imageView===true} processingConfigured={props.processingConfigured} uploadControl={props.mainImageUploadControl} onTranslate={props.onTranslate} onEdit={props.onEdit} onProcess={props.onProcess}/>}</div></>;
}
function OptionsEditor({ product, onSaved, onReviewPackaging, pricingView = false, imageView = false, seoView = false, focusedOptionId, initialBulkAction,
  profileId,refreshToken,editableQuotationPrices=false,pricePolicyLocked=false,imageProcessingBusy=false,beforePriceCommit,onPriceBusyChange }: Props) {
  const registrationParent=useRef(product.registration_number);
  useEffect(()=>{registrationParent.current=product.registration_number;},[product.registration_number]);
  const [saved, setSaved] = useState<ProductOptionsResponse | null>(null);
  const [rows, setRowsState] = useState<OptionInput[]>([]),rowsRef=useRef<OptionInput[]>([]);
  const setRows=useCallback((next:OptionInput[]|((previous:OptionInput[])=>OptionInput[]))=>{const value=typeof next==='function'?next(rowsRef.current):next;rowsRef.current=value;setRowsState(value);},[]);
  const savedRef=useRef<ProductOptionsResponse|null>(null);
  const gridScope=JSON.stringify([product.id,profileId??null,editableQuotationPrices]),generation=useMemo(()=>({gridScope}),[gridScope]),gridEpoch=useRef(generation),policyScope=useRef(generation);
  const combined=useRef<AbortController|null>(null);
  const [policyDraft,setPolicyDraft]=useState<PricePolicy|null>(null),policyDraftRef=useRef<PricePolicy|null>(null);
  const [recalculate,setRecalculate]=useState(false),recalculateRef=useRef(false);
  const [policyError,setPolicyError]=useState(''),[manualPriceDirty,setManualPriceDirty]=useState(false);
  const changeManualPriceDirty=useCallback((value:boolean)=>setManualPriceDirty(value),[]);
  type AtomicAttempt={scope:string;generation:object;base:ProductOptionsResponse;quotation:QuotationFieldsView;request:StageTwoPricingRequest};
  const atomicAttempt=useRef<AtomicAttempt|null>(null),[atomicUncertain,setAtomicUncertain]=useState(false);
  const storePolicy=(value:PricePolicy)=>{policyDraftRef.current=value;setPolicyDraft(value);};
  const policyDirty=saved!==null&&policyDraft!==null&&JSON.stringify(policyDraft)!==JSON.stringify(saved.pricing.policy);

  const quotationLocked=useRef(false);
  type SelectionDialog = { kind:'bundle'|'addBundle'|'remove'; ids:string[]; generation:object; base:ProductOptionsResponse; rowsBase:string; priceBase:string; value:string; quotation?:QuotationFieldsView };
  type BundleAttempt = {scope:string;state:'unknown'|'retry';base:ProductOptionsResponse;quotation:QuotationFieldsView;quantity:number;additions:BundleAddition[];selectedIds:string[]};
  const bundleAttempt=useRef<BundleAttempt|null>(null),[bundleUncertain,setBundleUncertain]=useState(false),[bundleRetry,setBundleRetry]=useState(false);
  const bundleScope=useRef(generation);
  const [selectionDialog,setSelectionDialog]=useState<SelectionDialog|null>(null),dialogRef=useRef<SelectionDialog|null>(null);
  const [selectionError,setSelectionError]=useState(''),[selectionBusy,setSelectionBusy]=useState(false),selectionRequest=useRef<object|null>(null);
  const storeSelectionDialog=(value:SelectionDialog|null)=>{dialogRef.current=value;setSelectionDialog(value);};
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [conflict, setConflict] = useState(false);
  const [snapshotVersion, setSnapshotVersion] = useState(product.updated_at);
  const [refreshNotice, setRefreshNotice] = useState('');
  const [imageOptionId, setImageOptionId] = useState(focusedOptionId || '');
  const [editedNames,setEditedNames]=useState<Set<string>>(()=>new Set());
  const editorRoot=useRef<HTMLDivElement>(null);
  const activeRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>{activeRequest.current?.abort();},[]);
  useLayoutEffect(()=>{dialogRef.current=null;selectionRequest.current=null;let active=true;void Promise.resolve().then(()=>{if(!active)return;setSelectionDialog(null);setSelectionBusy(false);setSelectionError('');});return()=>{active=false;};},[generation]);
  useLayoutEffect(()=>{gridEpoch.current=generation;if(policyScope.current!==generation&&!atomicAttempt.current){policyScope.current=generation;recalculateRef.current=false;setRecalculate(false);}if(atomicAttempt.current){setAtomicUncertain(true);setBusy(false);onPriceBusyChange?.(true,generation);}return()=>{const active=activeRequest.current;active?.abort();if(activeRequest.current===active)activeRequest.current=null;if(combined.current===active)combined.current=null;onPriceBusyChange?.(false,generation);};},[generation,onPriceBusyChange]);
  useLayoutEffect(()=>{const attempt=atomicAttempt.current;if(!attempt||product.updated_at===attempt.base.productVersion)return;const request=activeRequest.current;request?.abort();if(activeRequest.current===request)activeRequest.current=null;if(combined.current===request)combined.current=null;setBusy(false);setAtomicUncertain(true);onPriceBusyChange?.(true,generation);},[product.updated_at,generation,onPriceBusyChange]);
  useLayoutEffect(()=>{if(bundleScope.current===generation)return;bundleScope.current=generation;if(bundleAttempt.current){if(bundleAttempt.current.state==='retry'){bundleAttempt.current=null;setBundleRetry(false);setBundleUncertain(false);}else{setBundleUncertain(true);setBusy(false);onPriceBusyChange?.(true,generation);}}},[generation,onPriceBusyChange]);
  const endpoint = `/api/products/${encodeURIComponent(product.id)}/options`;
  const quotationEndpoint=endpoint.replace(/\/options$/u,'/quotation-fields')+(profileId?`?profileId=${encodeURIComponent(profileId)}`:'');
  const stageTwoEndpoint=endpoint.replace(/\/options$/u,'/stage-two-pricing')+(profileId?`?profileId=${encodeURIComponent(profileId)}`:'');
  const bundleEndpoint=endpoint.replace(/\/options$/u,'/option-bundles')+(profileId?`?profileId=${encodeURIComponent(profileId)}`:'');
  const applyLoaded = useCallback((body: ProductOptionsResponse) => { policyDraftRef.current=body.pricing.policy;setPolicyDraft(body.pricing.policy);recalculateRef.current=false;setRecalculate(false);setPolicyError('');verifyOptionsRegistrationDisplay(body,product.id,registrationParent.current);savedRef.current=body;setSaved(body); setRows(optionInputs(body.options)); setEditedNames(new Set()); setSnapshotVersion(body.productVersion); setSelected(new Set(focusedOptionId && body.options.rows.some(row=>row.id===focusedOptionId) ? [focusedOptionId] : [])); setError(''); setMessage(''); setConflict(false); }, [focusedOptionId,setRows,product.id]);
  useEffect(() => {
    const controller = new AbortController();
    fetchOptions(endpoint, controller.signal,registrationParent.current).then(body => { if (!controller.signal.aborted) applyLoaded(body); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '옵션을 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, applyLoaded]);
  useEffect(()=>{
    if(loading || !focusedOptionId)return;
    const target=editorRoot.current?.querySelector<HTMLElement>('[data-option-target="true"]');
    target?.scrollIntoView({block:'center'});
    target?.querySelector<HTMLElement>(pricingView?'input[type="number"]':'select')?.focus({preventScroll:true});
  },[loading,pricingView,focusedOptionId]);
  const currentPolicy=policyDraft??saved?.pricing.policy;
  const calculations = useMemo(() => currentPolicy ? calculateOptionPrices(rows,currentPolicy) : [], [rows,currentPolicy]);
  const dirty = saved !== null && (policyDirty||recalculate||manualPriceDirty||JSON.stringify(rows) !== JSON.stringify(optionInputs(saved.options)) || seoView && editedNames.size>0);
  const imageDirty = rows.some(row => saved?.options.rows.some(option => option.id === row.id && option.imageKey !== row.imageKey));
  const otherDirty = saved !== null && JSON.stringify(rows.map(row=>({...row,imageKey:null}))) !== JSON.stringify(optionInputs(saved.options).map(row=>({...row,imageKey:null})));
  // Route to the stage that can save each draft, even when its editor is hidden.
  const sourceMarkers = <><span hidden data-quotation-source-step={seoView?'SEO':'가격'} data-workspace-dirty={otherDirty||policyDirty||recalculate||manualPriceDirty||seoView&&editedNames.size>0}/><span hidden data-quotation-source-step="대표 이미지" data-workspace-dirty={imageDirty}/></>;
  const changedElsewhere = Boolean(product.updated_at && (!snapshotVersion || Date.parse(product.updated_at) > Date.parse(snapshotVersion)));
  useEffect(() => {
    if (!changedElsewhere || busy || loading || activeRequest.current) return;
    const controller = new AbortController();
    if (dirty) {
      Promise.resolve().then(() => { if (!controller.signal.aborted) setRefreshNotice('다른 탭에서 상품 또는 가격이 변경되었습니다. 옵션 입력은 유지했습니다. 입력 내용을 보관한 뒤 최신 가격·저장본을 확인해주세요.'); });
    } else {
      fetchOptions(endpoint, controller.signal,registrationParent.current).then(body => {
        if (!controller.signal.aborted) { applyLoaded(body); setSnapshotVersion(body.productVersion); setRefreshNotice(''); }
      }).catch(cause => { if (!controller.signal.aborted) setRefreshNotice(cause instanceof Error ? cause.message : '최신 옵션을 불러오지 못했습니다.'); });
    }
    return () => controller.abort();
  }, [changedElsewhere, dirty, endpoint, applyLoaded, product.updated_at, busy, loading]);
  let images: string[] = []; try { images = productImageKeys(product.image_keys); } catch { /* Server checks invalid references on save. */ }
  const included = rows.filter(row => row.included).length;
  const packagingTarget = saved?.options.rows.find(row => selected.has(row.id))?.id
    ?? (focusedOptionId ? saved?.options.rows.find(row => row.id === focusedOptionId)?.id
      : saved?.options.rows.find(row => row.included)?.id ?? null);
  async function reload() {
    if(activeRequest.current || busy || loading||bundleAttempt.current||atomicAttempt.current)return;
    const controller=new AbortController();activeRequest.current=controller;
    setLoading(true); try { const body = await fetchOptions(endpoint,controller.signal,registrationParent.current); if(controller.signal.aborted)return; applyLoaded(body); setRefreshNotice(''); } catch (cause) { if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : '저장본을 불러오지 못했습니다.'); } finally { if(activeRequest.current===controller)activeRequest.current=null;if(!controller.signal.aborted)setLoading(false); }
  }
  async function refreshPricesKeepingDraft(merge = false) {
    if (!saved || busy || loading || activeRequest.current||bundleAttempt.current||atomicAttempt.current) return;
    const controller=new AbortController();activeRequest.current=controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const latest = await fetchOptions(endpoint,controller.signal,registrationParent.current);
      if(controller.signal.aborted)return;
      const refreshed = merge ? mergeOptionDraft(saved, latest, rows) : refreshOptionPriceBase(saved, latest, rows);
      savedRef.current=refreshed.saved;setSaved(refreshed.saved); setRows(refreshed.rows); setSnapshotVersion(latest.productVersion);
      setConflict(false); setRefreshNotice('');
      setMessage(merge ? '서로 다른 항목의 변경을 합쳤습니다. 옵션과 가격을 확인한 뒤 저장하세요. 아직 서버에 저장하지 않았습니다.' : '옵션 입력을 유지하고 최신 가격 정책을 적용했습니다. 계산 결과를 확인한 뒤 옵션을 저장하세요.');
      onSaved?.();
    } catch (cause) { if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : '최신 가격 확인 실패'); }
    finally { if(activeRequest.current===controller)activeRequest.current=null;if(!controller.signal.aborted)setBusy(false); }
  }
  async function save(imagesOnly = false) {
    if (!saved || busy || loading || conflict || changedElsewhere || activeRequest.current||bundleAttempt.current||atomicAttempt.current) return;
    const controller=new AbortController();activeRequest.current=controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const changes=rows.filter(row=>editedNames.has(row.id)).map(row=>({optionId:row.id,value:row.translatedName}));
      const response = await fetch(seoView?endpoint.replace(/\/options$/u,'/option-names'):endpoint, { method: 'PATCH', signal:controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: saved.options.revision, expectedProductVersion: saved.productVersion, ...(seoView?{changes}:{rows: imagesOnly ? optionImageSaveRows(saved.options, rows) : rows}) }) });
      const body = await response.json() as ProductOptionsResponse & { error?: string };
      if(controller.signal.aborted)return;
      if (!response.ok || !body.options) { if (response.status === 409) setConflict(true); throw new Error(body.error || '옵션을 저장하지 못했습니다.'); }
      verifyOptionsRegistrationDisplay(body,product.id,registrationParent.current);
      if(seoView){
        const expected=optionInputs(applyOptionNameChanges(saved.options,changes,body.productVersion));
        confirmOptionTranslationSave(body,saved.options,saved.productVersion,expected);
        if(changes.some(change=>body.options.rows.find(row=>row.id===change.optionId)?.provenance.translatedName!=='manual'))throw Error('옵션명 저장 결과를 확인하지 못했습니다. 입력을 유지합니다.');
        applyLoaded(body);setMessage(`한국어 옵션명 ${changes.length}개 저장 완료`);onSaved?.();return;
      }
      if (imagesOnly) { savedRef.current=body;setSaved(body); setRows(previous => mergeSavedOptionImages(previous, body.options)); setSnapshotVersion(body.productVersion); setConflict(false); setMessage('옵션 대표 이미지를 저장했습니다. 다른 미저장 입력은 유지했습니다.'); onSaved?.(); return; }
      applyLoaded(body); setMessage(`옵션 ${body.options.rows.length}개 저장 완료 · 견적 포함 ${body.options.rows.filter(row => row.included).length}개`); onSaved?.();
    } catch (cause) { if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : '옵션을 저장하지 못했습니다.'); } finally { if(activeRequest.current===controller)activeRequest.current=null;if(!controller.signal.aborted)setBusy(false); }
  }
  function gridAllowed(controller:OptionPriceController){return gridEpoch.current===generation&&controller.current()&&!controller.snapshot().busy&&!controller.busy&&!quotationLocked.current&&!busy&&!combined.current&&!activeRequest.current&&!atomicAttempt.current&&!bundleAttempt.current&&!pricePolicyLocked&&!imageProcessingBusy&&beforePriceCommit?.()!==false;}
  function changeStageTwoPolicy(controller:OptionPriceController,next:PricePolicy){
    if(!gridAllowed(controller)||loading||atomicAttempt.current)return;
    storePolicy(next);setError('');setPolicyError('');setMessage('');
    try{
      const normalized=pricePolicy({...next,recalculationMode:'couplus-stage-two-v1',arithmeticMode:next.roundingMode==='nearest'?'couplus-number-v1':undefined});
      const nextRows=recalculateStageTwoRows(rowsRef.current,normalized);
      if(!controller.replaceEdits([]))return;
      storePolicy(normalized);setRows(nextRows);recalculateRef.current=true;setRecalculate(true);
    }catch(cause){setPolicyError(cause instanceof Error?cause.message:'가격 설정을 확인해주세요.');}
  }
  function recalculateStageTwo(controller:OptionPriceController){
    const policy=policyDraftRef.current;if(policy)changeStageTwoPolicy(controller,policy);
  }
  function stageTwoDisplayController(controller:OptionPriceController,policy=currentPolicy,recalculatePrices=recalculate):OptionPriceController{
    if(!controller.view||!policy)return controller;
    try{const preview=stageTwoQuotationDraft(controller.view,policy,recalculatePrices,controller.edits);
      return {...controller,view:{...controller.view,overrides:preview.overrides,...(preview.stageTwoMsrp?{stageTwoMsrp:preview.stageTwoMsrp}:{})},edits:preview.changes};
    }catch{return controller;}
  }
  function finishAtomic(attempt:AtomicAttempt,receipt:StageTwoPricingReceipt,controller:OptionPriceController){
    const verified=verifyStageTwoPricingReceipt(attempt.base,attempt.quotation,attempt.request,receipt);
    verifyOptionsRegistrationDisplay(verified.options,product.id,registrationParent.current);verifyOptionPriceView(verified.quotation,profileId);
    const currentQuote=controller.snapshot().view;
    if(gridEpoch.current!==generation||attempt.scope!==gridScope||!controller.current()||atomicAttempt.current!==attempt||currentQuote!==null&&!sameBundleSnapshot(currentQuote,attempt.quotation)&&!sameBundleSnapshot(currentQuote,verified.quotation)||!controller.acceptAtomicSaved(verified.quotation,currentQuote))throw Error('저장 중 상품 또는 카테고리 화면이 변경됐습니다. 입력과 저장 시도를 유지했습니다.');
    applyLoaded(verified.options);atomicAttempt.current=null;setAtomicUncertain(false);setSelected(new Set());setMessage('가격 설정·옵션·견적 가격 저장 완료');onSaved?.();return true;
  }
  async function saveGrid(controller:OptionPriceController){
    const base=savedRef.current,snapshot=controller.snapshot(),draft=structuredClone(rowsRef.current),policy=policyDraftRef.current;
    if(!base||!policy||!gridAllowed(controller)||loading||conflict||changedElsewhere||!snapshot.view||!snapshot.fresh||snapshot.uncertain||atomicAttempt.current)return false;
    if(sameBundleSnapshot(draft,optionInputs(base.options))&&sameBundleSnapshot(policy,base.pricing.policy)&&!recalculateRef.current&&!snapshot.edits.length)return true;
    if(snapshot.edits.some(edit=>!draft.some(row=>row.id===edit.optionId&&row.included))){setError('직접 가격을 수정한 옵션은 포함 상태를 유지해주세요. 가격 입력을 복원하거나 저장한 뒤 삭제·제외하세요.');return false;}
    let request:StageTwoPricingRequest;
    try{
      const checked=pricePolicy(policy),display=stageTwoDisplayController({...controller,view:snapshot.view,edits:snapshot.edits},checked,recalculateRef.current),prices=effectiveGridPrices(draft,calculateOptionPrices(draft,checked),display.view,display.edits);
      if(draft.some(row=>row.included&&!prices.get(row.id)?.calculation))throw Error('포함한 옵션의 원가·공급가·판매가를 확인해주세요. 입력은 유지했습니다.');
      for(const edit of snapshot.edits)if(edit.value!==null){const field=snapshot.view.resolved.schema.fields.find(value=>value.id===edit.fieldKey);if(!field)throw Error('수정한 가격 항목을 다시 확인해주세요.');const issues=quotationValueIssues(field,edit.value,snapshot.view.imageKeys);if(issues.length)throw Error(`${field.label}: ${issues.join(' ')}`);}
      request={expectedProductVersion:base.productVersion,expectedOptionRevision:base.options.revision,expectedQuotationRevision:snapshot.view.revision,expectedInputFingerprint:snapshot.view.inputFingerprint,policy:checked,rows:draft,changes:structuredClone(snapshot.edits),recalculate:recalculateRef.current};
    }catch(cause){setError(cause instanceof Error?cause.message:'가격 입력 확인 실패');return false;}
    const attempt:AtomicAttempt={scope:gridScope,generation,base,quotation:snapshot.view,request};atomicAttempt.current=attempt;
    const requestController=new AbortController();activeRequest.current=requestController;combined.current=requestController;onPriceBusyChange?.(true,generation);setBusy(true);setError('');setMessage('');
    const current=()=>!requestController.signal.aborted&&gridEpoch.current===generation&&controller.current()&&atomicAttempt.current===attempt;
    let knownRejection=false;
    try{
      const response=await fetch(stageTwoEndpoint,{method:'POST',signal:requestController.signal,headers:{'content-type':'application/json'},body:JSON.stringify(request)}),receipt=await response.json() as StageTwoPricingReceipt&{error?:string};
      if(!current())return false;
      if(!response.ok){knownRejection=response.status<500;if(response.status===409)setConflict(true);throw Error(receipt.error||'가격을 저장하지 못했습니다. 입력은 유지했습니다.');}
      return finishAtomic(attempt,receipt,controller);
    }catch(cause){if(current()){if(knownRejection){atomicAttempt.current=null;setAtomicUncertain(false);}else setAtomicUncertain(true);setError(cause instanceof Error?cause.message:'가격 저장 응답을 확인하지 못했습니다. 모든 입력을 유지했습니다.');}return false;}
    finally{if(activeRequest.current===requestController)activeRequest.current=null;if(combined.current===requestController)combined.current=null;if(!requestController.signal.aborted&&gridEpoch.current===generation){setBusy(false);onPriceBusyChange?.(!!atomicAttempt.current||quotationLocked.current,generation);}}
  }
  async function recoverGridSource(controller:OptionPriceController){
    const attempt=atomicAttempt.current;if(!attempt||attempt.scope!==gridScope||activeRequest.current||combined.current||!controller.current()||pricePolicyLocked||imageProcessingBusy)return;
    const requestController=new AbortController();activeRequest.current=requestController;combined.current=requestController;setBusy(true);setError('');onPriceBusyChange?.(true,generation);
    const current=()=>!requestController.signal.aborted&&gridEpoch.current===generation&&controller.current()&&atomicAttempt.current===attempt;
    try{
      const response=await fetch(stageTwoEndpoint,{cache:'no-store',signal:requestController.signal}),receipt=await response.json() as StageTwoPricingReceipt&{error?:string};if(!current())return;
      if(!response.ok)throw Error(receipt.error||'가격 저장 결과를 확인하지 못했습니다.');
      if(unchangedStageTwoPricingReceipt(attempt.base,attempt.quotation,receipt)){
        if(!controller.acceptAtomicSaved(receipt.quotation,controller.snapshot().view)||!controller.replaceEdits(attempt.request.changes,true))throw Error('현재 카테고리의 입력 복원을 확인하지 못했습니다. 저장 시도를 유지했습니다.');
        atomicAttempt.current=null;setAtomicUncertain(false);setMessage('아직 저장되지 않은 동일한 원본 상태를 확인했습니다. 입력은 유지했습니다. 확인 후 저장해주세요.');return;}
      finishAtomic(attempt,receipt,controller);
    }catch(cause){if(current()){setAtomicUncertain(true);setError(cause instanceof Error?cause.message:'가격 저장 결과 확인 실패');}}
    finally{if(activeRequest.current===requestController)activeRequest.current=null;if(combined.current===requestController)combined.current=null;if(!requestController.signal.aborted&&gridEpoch.current===generation){setBusy(false);onPriceBusyChange?.(!!atomicAttempt.current||quotationLocked.current,generation);}}
  }
  function bulkAllowed(){return gridEpoch.current===generation&&savedRef.current===saved&&!busy&&!loading&&!conflict&&!changedElsewhere&&!selectionRequest.current&&!activeRequest.current&&!combined.current&&!atomicAttempt.current&&!bundleAttempt.current&&!quotationLocked.current&&!pricePolicyLocked&&!imageProcessingBusy&&beforePriceCommit?.()!==false;}
  function openSelection(kind:'bundle'|'addBundle'|'remove',controller:OptionPriceController){
    const base=savedRef.current,snapshot=controller.snapshot(),ids=[...selected].filter(id=>rowsRef.current.some(row=>row.id===id));
    if(!base||!ids.length||!bulkAllowed()||!gridAllowed(controller)||!snapshot.view||!snapshot.fresh||snapshot.uncertain)return;
    if(kind==='addBundle'&&(policyDirty||recalculate||JSON.stringify(rowsRef.current)!==JSON.stringify(optionInputs(base.options))||snapshot.edits.length)){setError('저장하지 않은 옵션 또는 가격 입력이 있습니다. 입력을 유지했습니다. 먼저 옵션·가격을 저장한 뒤 번들을 추가해주세요.');return;}
    setError('');setSelectionError('');storeSelectionDialog({kind,ids,generation,base,rowsBase:JSON.stringify(rowsRef.current),priceBase:optionBulkPriceBase(policyDraftRef.current??base.pricing.policy),value:'2',...(kind==='addBundle'?{quotation:snapshot.view}:{})});
  }
  const sameBundleSnapshot=(a:unknown,b:unknown)=>{
    const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([x],[y])=>x.localeCompare(y)).map(([key,item])=>[key,ordered(item)])):value;
    return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
  };
  function bundleOperationAllowed(controller:OptionPriceController){return gridEpoch.current===generation&&controller.current()&&!controller.snapshot().busy&&!controller.busy&&!busy&&!loading&&!selectionRequest.current&&!activeRequest.current&&!combined.current&&!atomicAttempt.current&&!pricePolicyLocked&&!imageProcessingBusy&&beforePriceCommit?.()!==false;}
  async function finishBundleReceipt(attempt:BundleAttempt,receipt:BundleAddReceipt,controller:OptionPriceController,current:()=>boolean){
    const verified=verifyBundleAddReceipt(attempt.base,attempt.quotation,receipt,attempt.additions,attempt.quantity);
    verifyOptionsRegistrationDisplay(verified.options,product.id,registrationParent.current);verifyOptionPriceView(verified.quotation,profileId);
    if(!current())return false;
    applyLoaded(verified.options);setSelected(new Set(attempt.selectedIds));
    const hasBase=!!controller.snapshot().view;
    const refreshed=await controller.refresh(hasBase,hasBase,{notify:false,coordinated:true,expectedProductVersion:verified.options.productVersion,expectedOptionRevision:verified.options.options.revision});
    if(!current())return false;
    if(!refreshed||!sameBundleSnapshot(refreshed,verified.quotation))throw Error('번들은 저장됐지만 동일한 견적서 저장 결과를 확인하지 못했습니다. 새 옵션 식별자를 유지하고 저장 결과를 조회해주세요.');
    bundleAttempt.current=null;setBundleUncertain(false);setBundleRetry(false);setSelected(new Set());storeSelectionDialog(null);setSelectionError('');setMessage('번들 추가 완료 · 견적서에 반영됩니다.');onSaved?.();return true;
  }
  async function confirmBundleAdd(target:SelectionDialog,controller:OptionPriceController){
    if(target.kind!=='addBundle'||dialogRef.current!==target||target.generation!==generation||!bundleOperationAllowed(controller)||conflict||changedElsewhere)return;
    const base=savedRef.current,snapshot=controller.snapshot(),existing=bundleAttempt.current;
    if(existing&&existing.state!=='retry')return;
    if(!base||base!==target.base||target.rowsBase!==JSON.stringify(rowsRef.current)||target.priceBase!==optionBulkPriceBase(policyDraftRef.current??base.pricing.policy)||!snapshot.view||!snapshot.fresh||snapshot.uncertain||snapshot.edits.length||JSON.stringify(rowsRef.current)!==JSON.stringify(optionInputs(base.options))){setSelectionError('옵션 또는 가격 입력이 변경되었습니다. 입력을 유지했습니다. 취소 후 먼저 옵션·가격을 저장해주세요.');return;}
    let attempt:BundleAttempt;
    try{
      const quantity=parseCouplusBundleQuantity(target.value,2);
      if(existing){
        if(existing.scope!==gridScope||existing.quantity!==quantity||!sameBundleSnapshot(existing.base,base)||!sameBundleSnapshot(existing.quotation,snapshot.view))throw Error('번들 재시도 기준이 변경되었습니다. 입력을 유지하고 저장 결과를 다시 확인해주세요.');
        attempt=existing;
      }else{
        if(!target.quotation||!sameBundleSnapshot(snapshot.view,target.quotation))throw Error('견적서 저장 상태가 변경되었습니다. 입력을 유지했습니다. 취소 후 최신 저장본을 확인해주세요.');
        const additions=target.ids.map(sourceOptionId=>({sourceOptionId,optionId:crypto.randomUUID()}));createBundleAddDraft(base.options,additions,quantity);
        attempt={scope:gridScope,state:'unknown',base:structuredClone(base),quotation:structuredClone(snapshot.view),quantity,additions,selectedIds:[...selected]};
      }
    }catch(cause){setSelectionError(cause instanceof Error?cause.message:'번들 추가 입력을 확인해주세요.');return;}
    const operation={},requestController=new AbortController();selectionRequest.current=operation;activeRequest.current=requestController;combined.current=requestController;attempt.state='unknown';bundleAttempt.current=attempt;setBundleRetry(false);setSelectionBusy(true);setBusy(true);setError('');setSelectionError('');onPriceBusyChange?.(true,generation);
    const current=()=>!requestController.signal.aborted&&gridEpoch.current===generation&&controller.current()&&bundleAttempt.current===attempt;
    let knownRejection=false;
    try{
      const response=await fetch(bundleEndpoint,{method:'POST',signal:requestController.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedProductVersion:attempt.base.productVersion,expectedOptionRevision:attempt.base.options.revision,expectedQuotationRevision:attempt.quotation.revision,expectedInputFingerprint:attempt.quotation.inputFingerprint,quantity:attempt.quantity,additions:attempt.additions})});
      const receipt=await response.json() as BundleAddReceipt&{error?:string};if(!current())return;
      if(!response.ok){knownRejection=response.status<500;if(response.status===409)setConflict(true);throw Error(receipt.error||'번들을 추가하지 못했습니다.');}
      await finishBundleReceipt(attempt,receipt,controller,current);
    }catch(cause){if(current()){if(knownRejection){bundleAttempt.current=null;setBundleUncertain(false);}else setBundleUncertain(true);setSelectionError(cause instanceof Error?cause.message:'번들 저장 결과를 확인하지 못했습니다. 새 옵션 식별자를 유지하고 저장 결과를 조회해주세요.');}}
    finally{if(activeRequest.current===requestController)activeRequest.current=null;if(combined.current===requestController)combined.current=null;if(selectionRequest.current===operation)selectionRequest.current=null;if(!requestController.signal.aborted&&gridEpoch.current===generation){if(bundleAttempt.current?.state==='unknown'){setBundleUncertain(true);setBundleRetry(false);}setSelectionBusy(false);setBusy(false);onPriceBusyChange?.(!!bundleAttempt.current||quotationLocked.current,generation);}}
  }
  async function recoverBundleAdd(controller:OptionPriceController){
    const attempt=bundleAttempt.current;if(!attempt||attempt.scope!==gridScope||!bundleOperationAllowed(controller)||controller.snapshot().edits.length)return;
    if(!sameBundleSnapshot(rowsRef.current,optionInputs(savedRef.current?.options??attempt.base.options))){setError('옵션 입력이 변경되었습니다. 입력을 보관한 뒤 번들 저장 결과를 확인해주세요.');return;}
    const requestController=new AbortController(),operation={};activeRequest.current=requestController;combined.current=requestController;selectionRequest.current=operation;setSelectionBusy(true);setBusy(true);setSelectionError('');setError('');onPriceBusyChange?.(true,generation);
    const current=()=>!requestController.signal.aborted&&gridEpoch.current===generation&&controller.current()&&bundleAttempt.current===attempt;
    try{
      const latestOptions=await fetchOptions(endpoint,requestController.signal,registrationParent.current);if(!current())return;
      const response=await fetch(quotationEndpoint,{cache:'no-store',signal:requestController.signal}),quotation=await response.json() as QuotationFieldsView&{error?:string};if(!current())return;
      if(!response.ok)throw Error(quotation.error||'번들 견적서 저장 결과를 불러오지 못했습니다.');verifyOptionPriceView(quotation,profileId);
      if(sameBundleSnapshot(latestOptions,attempt.base)&&sameBundleSnapshot(quotation,attempt.quotation)){
        const hasBase=!!controller.snapshot().view,refreshed=await controller.refresh(hasBase,hasBase,{notify:false,coordinated:true,expectedProductVersion:attempt.base.productVersion,expectedOptionRevision:attempt.base.options.revision});if(!current())return;
        if(!refreshed||!sameBundleSnapshot(refreshed,quotation))throw Error('동일한 원본 견적서의 저장 상태를 확인하지 못했습니다. 새 옵션 식별자를 유지했습니다.');
        attempt.state='retry';setBundleUncertain(false);setBundleRetry(true);setSelectionError('아직 저장되지 않은 원본 상태를 확인했습니다. 같은 새 옵션 식별자로 다시 추가할 수 있습니다.');
        if(!dialogRef.current)storeSelectionDialog({kind:'addBundle',ids:attempt.additions.map(item=>item.sourceOptionId),generation,base:savedRef.current!,rowsBase:JSON.stringify(rowsRef.current),priceBase:optionBulkPriceBase(attempt.base.pricing.policy),value:String(attempt.quantity),quotation:refreshed});
        return;
      }
      await finishBundleReceipt(attempt,{options:latestOptions,quotation},controller,current);
    }catch(cause){if(current()){setBundleUncertain(true);setBundleRetry(false);const text=cause instanceof Error?cause.message:'번들 저장 결과를 확인하지 못했습니다.';setError(text);setSelectionError(text);}}
    finally{if(activeRequest.current===requestController)activeRequest.current=null;if(combined.current===requestController)combined.current=null;if(selectionRequest.current===operation)selectionRequest.current=null;if(!requestController.signal.aborted&&gridEpoch.current===generation){if(bundleAttempt.current?.state==='unknown'){setBundleUncertain(true);setBundleRetry(false);}setSelectionBusy(false);setBusy(false);onPriceBusyChange?.(!!bundleAttempt.current||quotationLocked.current,generation);}}
  }
  async function confirmSelection(target:SelectionDialog,controller:OptionPriceController){
    if(target.kind==='addBundle'){await confirmBundleAdd(target,controller);return;}
    if(selectionRequest.current||dialogRef.current!==target||target.generation!==generation||!gridAllowed(controller)||!bulkAllowed())return;
    const base=savedRef.current,snapshot=controller.snapshot();
    if(!base||base!==target.base||target.rowsBase!==JSON.stringify(rowsRef.current)||target.priceBase!==optionBulkPriceBase(policyDraftRef.current??base.pricing.policy)||!snapshot.view||!snapshot.fresh||snapshot.uncertain){setSelectionError('옵션 또는 가격 기준이 변경되었습니다. 입력은 유지했습니다. 취소 후 다시 선택해주세요.');return;}
    const selectedIds=new Set(target.ids);
    if(target.ids.some(id=>!rowsRef.current.some(row=>row.id===id))){setSelectionError('선택했던 옵션이 없습니다. 취소 후 다시 선택해주세요.');return;}
    if(target.kind==='remove'&&snapshot.edits.some(edit=>edit.optionId!==null&&selectedIds.has(edit.optionId))){setSelectionError('선택한 옵션에 저장하지 않은 직접 가격이 있습니다. 가격 입력은 유지했습니다. 먼저 가격을 저장하거나 복원한 뒤 삭제해주세요.');return;}
    const operation={};selectionRequest.current=operation;setSelectionBusy(true);setSelectionError('');
    try{
      const action:BulkOptionAction=target.kind==='bundle'?{type:'applyBundle',value:parseCouplusBundleQuantity(target.value)}:{type:'remove'};
      const reviewedPolicy=policyDraftRef.current??base.pricing.policy;
      const next=applyOptionBulk(rowsRef.current,previewOptionBulk(rowsRef.current,target.ids,action,reviewedPolicy,images),reviewedPolicy,images);
      if(target.kind==='bundle'){
        const prices=calculateOptionPrices(next,{...reviewedPolicy,roundingMode:'nearest',arithmeticMode:'couplus-number-v1',recalculationMode:'couplus-stage-two-v1'}).filter(result=>selectedIds.has(result.optionId)&&result.included);
        for(const result of prices){
          if(!result.calculation)throw Error(result.error||'선택한 옵션의 원가와 번들 수량을 확인해주세요.');
          if(!snapshot.view.resolved.rows.some(row=>row.optionId===result.optionId&&row.included))throw Error('새로 추가하거나 포함한 옵션을 먼저 저장한 뒤 번들을 적용해주세요. 입력은 유지했습니다.');
        }
        for(const result of prices)for(const key of ['supplyPrice','salePrice','msrp'] as const)controller.change(result.optionId,key,String(result.calculation![key]));
        const latest=controller.snapshot();
        if(latest.view!==snapshot.view||!controller.targets||prices.some(result=>(['supplyPrice','salePrice','msrp'] as const).some(key=>controller.targets![key].linked.some(fieldKey=>!latest.edits.some(edit=>edit.optionId===result.optionId&&edit.fieldKey===fieldKey&&edit.value===String(result.calculation![key]))))))throw Error('번들 가격 입력을 확인하지 못했습니다. 입력은 유지했습니다. 최신 가격을 확인해주세요.');
      }
      setRows(next);
      const accepted=await saveGrid(controller);
      if(selectionRequest.current!==operation||gridEpoch.current!==generation)return;
      if(accepted){storeSelectionDialog(null);setSelectionError('');}
      else setSelectionError('저장 결과를 확인하지 못했습니다. 번들 수량과 입력은 유지했습니다. 취소 후 저장 결과를 확인해주세요.');
    }catch(cause){if(selectionRequest.current===operation&&gridEpoch.current===generation)setSelectionError(cause instanceof Error?cause.message:'선택 옵션 저장 실패');}
    finally{if(selectionRequest.current===operation){selectionRequest.current=null;if(gridEpoch.current===generation)setSelectionBusy(false);}}
  }
  function update<K extends OptionField>(id: string, key: K, value: OptionInput[K]) { if(bundleAttempt.current||atomicAttempt.current||editableQuotationPrices&&(combined.current||pricePolicyLocked||imageProcessingBusy||beforePriceCommit?.()===false))return;if(seoView&&key==='translatedName')setEditedNames(previous=>new Set([...previous,id]));setRows(previous => previous.map(row => row.id === id ? { ...row, [key]: value, ...(key === 'unitsPerPack' && value !== row.unitsPerPack ? {packagingConfirmed:false} : {}) } : row)); }
  function updateStageTwoRow<K extends OptionField>(controller:OptionPriceController,id:string,key:K,value:OptionInput[K]){
    if(key!=='unitCostCny'){update(id,key,value);return;}
    if(!gridAllowed(controller)||loading||conflict||changedElsewhere)return;
    const row=rowsRef.current.find(value=>value.id===id),snapshot=controller.snapshot(),policy=policyDraftRef.current,cost=value as OptionInput['unitCostCny'];
    if(!row||Object.is(row.unitCostCny,cost)||!snapshot.fresh||snapshot.uncertain||!snapshot.view||!policy)return;
    try{
      const plan=recalculateStageTwoOptionCost(row,cost,policy,snapshot.view,snapshot.edits);
      if(plan&&!controller.replaceEdits(plan.changes))return;
      setRows(previous=>previous.map(value=>value.id===id?plan?.row??{...value,unitCostCny:cost}:value));setError('');setMessage('');
    }catch(cause){setRows(previous=>previous.map(value=>value.id===id?{...value,unitCostCny:cost}:value));setError(cause instanceof Error?cause.message:'현재 옵션의 원가와 가격을 확인해주세요.');}
  }
  function origin(row: OptionInput, key: OptionField) {
    const previous = saved?.options.rows.find(item => item.id === row.id);
    return previous && previous[key] === row[key] ? originNames[previous.provenance[key] ?? 'unverified'] : '미저장 수정';
  }
  const numberKeys = ['unitCostCny', 'unitsPerPack', 'minimumOrderQuantity', 'stock', 'widthCm', 'lengthCm', 'heightCm', 'weightKg', 'packagedWeightG', 'packagedWidthMm', 'packagedLengthMm', 'packagedHeightMm'] as const;

  if (imageView) {
    const existing = rows.filter(row => saved?.options.rows.some(option => option.id === row.id));
    const activeId = imageOptionId || existing[0]?.id;
    const active = existing.find(row => row.id === activeId);
    const fileUrl = (key: string) => '/api/files/' + key.split('/').map(encodeURIComponent).join('/');
    return <div ref={editorRoot} className="panel-stack" aria-busy={busy || loading} data-workspace-dirty={dirty} data-workspace-saving={busy}>
      {sourceMarkers}
      <h3>옵션별 대표 이미지</h3>
      {loading && <p role="status">옵션 이미지를 불러오는 중입니다.</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {(refreshNotice || conflict || changedElsewhere) && <p role="status">{refreshNotice || '상품이 변경되었습니다. 입력을 보관한 뒤 최신 저장본을 확인해주세요.'}</p>}
      <label className="field"><span>대표 이미지를 지정할 옵션</span><select aria-label="대표 이미지 옵션 선택" value={activeId || ''} disabled={busy || loading} onChange={event => setImageOptionId(event.target.value)}>
        {!active && <option value={activeId || ''}>{activeId ? '선택했던 옵션이 없습니다' : '저장한 옵션이 없습니다'}</option>}
        {existing.map((row,index) => <option key={row.id} value={row.id}>{row.translatedName || row.originalName || `옵션 ${index+1}`}</option>)}
      </select></label>
      {active && <>
        {active.imageKey ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(active.imageKey)} alt="선택 옵션 대표 이미지" style={{width:'100%',height:320,objectFit:'contain',background:'#f7f8fa'}} />
        </> : <p>이 옵션은 공통 대표 이미지를 사용합니다.</p>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))',gap:10}}>{images.map((key,index) => <button type="button" key={key} aria-label={`옵션 대표 이미지 ${index+1} 선택`} aria-pressed={active.imageKey===key} disabled={busy || loading} onClick={() => update(active.id,'imageKey',key)} style={{padding:4,border:active.imageKey===key?'2px solid #29b9df':'1px solid #dfe4ec',background:'white',borderRadius:8}}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(key)} alt={`상품 이미지 ${index+1}`} style={{width:'100%',height:100,objectFit:'contain'}} />
        </button>)}</div>
        <button type="button" className="btn ghost" disabled={busy || loading || !active.imageKey} onClick={() => update(active.id,'imageKey',null)}>옵션 이미지 해제·공통 이미지 사용</button>
      </>}
      <div style={{display:'flex',gap:8}}><button type="button" className="btn primary" disabled={!active || !imageDirty || busy || loading || conflict || changedElsewhere} onClick={() => void save(true)}>옵션 대표 이미지 저장</button><button type="button" className="btn ghost" disabled={busy || loading} onClick={() => void reload()}>입력 버리고 저장본 불러오기</button></div>
      {dirty && <small>대표 이미지 저장은 기존 옵션의 이미지 변경만 반영합니다. 옵션명·가격 등 다른 입력은 해당 단계에서 저장하세요.</small>}
    </div>;
  }

  if (seoView) return <section ref={editorRoot} className="seo-option-names" aria-label="SEO 옵션명 편집" aria-busy={busy || loading} data-workspace-dirty={dirty} data-workspace-saving={busy}>
    {sourceMarkers}<h3>옵션명</h3><div className="seo-option-names-body">
      {loading&&<p role="status">옵션명을 불러오는 중입니다.</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
      {(refreshNotice||conflict||changedElsewhere)&&<p role="status">{refreshNotice||'상품이 변경되었습니다. 옵션명 입력은 유지했습니다. 최신 저장본을 확인해주세요.'}</p>}
      {rows.map((row,index)=>{const key=row.imageKey??saved?.sourceImageKeys?.[row.id],thumbnail=key&&images.includes(key)?key:null;return <article key={row.id} className="seo-option-name" data-option-target={row.id===focusedOptionId}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Use the same owned option image as the registration editor. */}
        {thumbnail&&<img src={'/api/files/'+thumbnail.split('/').map(encodeURIComponent).join('/')} alt="" width={64} height={64} loading="lazy"/>}
        <label><span>원본: {row.originalName||row.supplierSku||`옵션 ${index+1}`}</span><input aria-label={`${index+1}번째 한국어 옵션명`} value={row.translatedName} maxLength={500} disabled={busy||loading} onChange={event=>update(row.id,'translatedName',event.target.value)}/><small>{row.included?'견적 포함':'견적 제외'} · {origin(row,'translatedName')}</small></label>
      </article>;})}
      {!loading&&!rows.length&&<p>저장된 옵션이 없습니다.</p>}
      <div className="seo-option-name-actions"><button type="button" className="btn primary" disabled={!saved||!dirty||busy||loading||conflict||changedElsewhere} onClick={()=>void save()}>옵션명 저장</button><button type="button" className="btn ghost" disabled={busy||loading} onClick={()=>void reload()}>저장본 다시 조회</button></div>
    </div>
  </section>;

  return <div ref={editorRoot} className={pricingView?"panel-stack couplus-price-stage":"panel-stack"} aria-busy={busy || loading} data-workspace-dirty={dirty} data-workspace-saving={busy}>
    {sourceMarkers}{pricingView&&<h2 className="couplus-price-heading">가격 설정</h2>}
    {loading && <p role="status">저장한 옵션과 가격 설정을 불러오는 중입니다.</p>}
    {error && <div role="alert" className="panel-note"><div><strong>{error}</strong>{conflict && <p>입력 내용을 보관한 후 최신 상품·가격·옵션을 확인해주세요.</p>}<button type="button" className="btn ghost" disabled={busy || loading} onClick={() => void reload()}>{saved ? '입력 버리고 저장본 불러오기' : '다시 불러오기'}</button></div></div>}
    {message && <p role="status">{message}</p>}
    {(refreshNotice || conflict) && <div role="status" className="panel-note"><div><p>{refreshNotice || '저장 중 상품 버전이 바뀌었습니다. 옵션 입력을 유지한 채 최신 가격을 확인할 수 있습니다.'}</p><button type="button" className="btn primary" disabled={busy || loading || !saved} onClick={() => void refreshPricesKeepingDraft()}>입력 유지 · 최신 가격 적용</button><button type="button" className="btn ghost" disabled={busy || loading || !saved} onClick={() => void refreshPricesKeepingDraft(true)}>입력 유지 · 서버 변경 합치기</button><button type="button" className="btn ghost" disabled={busy || loading} onClick={() => void reload()}>입력 버리고 최신 저장본 불러오기</button></div></div>}
    {saved && <>
      {focusedOptionId && !pricingView && <p role="status">{rows.some(row=>row.id===focusedOptionId) ? initialBulkAction==='remove'?'선택한 옵션을 삭제 검토 대상으로 표시했습니다. 변경 미리보기를 확인한 뒤 적용하고 저장하세요.':'옵션 목록에서 선택한 행을 강조했습니다. 옵션 이미지를 선택한 뒤 저장하세요.' : '선택했던 옵션이 현재 목록에 없습니다. 다른 옵션으로 자동 선택하지 않았습니다.'}</p>}
      <p hidden={pricingView} style={{ color: '#64748b', fontSize: 13 }}>계산 기준: {saved.pricing.policySource === 'saved-product' ? '상품에 저장한 가격 설정' : '상품의 기존 환율·마진 + 현재 기본설정'} · 환율 {saved.pricing.policy.exchangeRate}원 · 공급 마진 {saved.pricing.policy.supplyMargin}% · 쿠팡 마진 {saved.pricing.policy.coupangMargin}% · 최소 마진 {won(saved.pricing.policy.minimumMargin)} · {saved.pricing.policy.roundingUnit}원 단위 {saved.pricing.policy.roundingMode === 'nearest' ? '반올림' : '올림'}</p>
      <fieldset disabled={busy || loading||editableQuotationPrices&&(pricePolicyLocked||imageProcessingBusy)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {!rows.length && <div className="empty"><strong>저장한 옵션이 없습니다.</strong><small>수집된 옵션이 연결되면 여기에 표시됩니다. 확인한 옵션을 추가해 수정할 수도 있습니다.</small></div>}
        {pricingView && !editableQuotationPrices&&<OptionPriceTable layout="registration" rows={rows} calculations={calculations} exchangeRate={saved.pricing.policy.exchangeRate} selected={selected} focusedOptionId={focusedOptionId} optionRegistrationNumbers={saved?.optionRegistrationNumbers} onSelect={ids => setSelected(new Set(ids))} onChange={update} />}
        {editableQuotationPrices&&product.updated_at&&<div><OptionQuotationPrices productId={product.id} version={product.updated_at} profileId={profileId} refreshToken={refreshToken} stageTwoPricingPolicy={currentPolicy} onDraftStateChange={changeManualPriceDirty} onSaved={onSaved} onLockChange={locked=>{quotationLocked.current=locked;onPriceBusyChange?.(locked||!!combined.current||!!atomicAttempt.current||!!bundleAttempt.current,generation);}}
          disabled={busy||loading||pricePolicyLocked||imageProcessingBusy||atomicUncertain||bundleUncertain||bundleRetry} beforeEdit={()=>!activeRequest.current&&!combined.current&&!atomicAttempt.current&&!bundleAttempt.current&&!pricePolicyLocked&&!imageProcessingBusy&&beforePriceCommit?.()!==false} beforeSave={()=>!bundleAttempt.current&&!pricePolicyLocked&&!imageProcessingBusy&&beforePriceCommit?.()!==false}
          renderGrid={controller=><><div hidden={!pricingView}><div className="stage-two-pricing-workspace"><StageTwoPricePolicyFields policy={currentPolicy!} dirty={dirty||controller.dirty} sourceDirty={otherDirty||policyDirty||recalculate||manualPriceDirty||controller.dirty} busy={busy||controller.busy} disabled={loading||conflict||changedElsewhere||pricePolicyLocked||imageProcessingBusy||atomicUncertain||bundleUncertain||bundleRetry||!controller.fresh} error={policyError} onChange={next=>changeStageTwoPolicy(controller,next)} onRecalculate={()=>recalculateStageTwo(controller)} onSave={()=>void saveGrid(controller)}/><section className="pricing-options-panel"><header className="step-visual-price-header"><h3>옵션별 가격 정보</h3><div style={{display:'flex',gap:8,marginBottom:12}}>{(['remove','addBundle','bundle'] as const).map(kind=><button type="button" key={kind} className="btn ghost" disabled={!selected.size||busy||loading||conflict||changedElsewhere||pricePolicyLocked||imageProcessingBusy||atomicUncertain||bundleUncertain||bundleRetry||selectionBusy||controller.busy||controller.uncertain||!controller.fresh} onClick={()=>openSelection(kind,controller)}>{kind==='remove'?`선택 삭제 (${selected.size})`:kind==='addBundle'?'번들 추가':'번들 적용'}</button>)}</div></header>
            {selectionDialog&&selectionDialog.generation===generation&&<PriceSelectionDialog kind={selectionDialog.kind} count={selectionDialog.ids.length} value={selectionDialog.value} busy={selectionBusy||busy||controller.busy} error={selectionError} quantityLocked={selectionDialog.kind==='addBundle'&&(bundleUncertain||bundleRetry)} confirmationBlocked={selectionDialog.kind==='addBundle'&&bundleUncertain} onRecover={selectionDialog.kind==='addBundle'&&bundleUncertain?()=>void recoverBundleAdd(controller):undefined} onChange={value=>{if(dialogRef.current!==selectionDialog||selectionRequest.current||gridEpoch.current!==generation||selectionDialog.kind==='addBundle'&&bundleAttempt.current)return;storeSelectionDialog({...selectionDialog,value});setSelectionError('');}} onConfirm={()=>void confirmSelection(selectionDialog,controller)} onCancel={()=>{if(selectionRequest.current||dialogRef.current!==selectionDialog||gridEpoch.current!==generation)return;if(selectionDialog.kind==='addBundle'&&bundleAttempt.current?.state==='retry'){bundleAttempt.current=null;setBundleRetry(false);setBundleUncertain(false);onPriceBusyChange?.(quotationLocked.current,generation);}storeSelectionDialog(null);setSelectionError('');}}/>}
            {bundleUncertain&&selectionDialog?.kind!=='addBundle'&&<button type="button" className="btn ghost" disabled={busy||loading||pricePolicyLocked||imageProcessingBusy||controller.busy} onClick={()=>void recoverBundleAdd(controller)}>입력 유지 · 번들 저장 결과 확인</button>}
            <OptionPriceTable layout={pricingView?'registration':'standard'} rows={rows} calculations={calculations} exchangeRate={currentPolicy!.exchangeRate} selected={selected} focusedOptionId={focusedOptionId} optionRegistrationNumbers={saved?.optionRegistrationNumbers} onSelect={ids=>setSelected(new Set(ids))} onChange={(id,key,value)=>updateStageTwoRow(controller,id,key,value)} priceController={stageTwoDisplayController(controller)} priceBlocked={busy||loading||pricePolicyLocked||imageProcessingBusy||atomicUncertain||bundleUncertain||bundleRetry} showSummary={false}/>
          </section><div className="stage-two-price-breakdown"><PricePolicyRatio policy={currentPolicy!}/><OptionPriceSummary rows={rows} calculations={calculations} priceController={stageTwoDisplayController(controller)}/></div><div className="stage-two-pricing-save">
            <button type="button" className="btn primary" aria-label="옵션 가격 저장하기" disabled={busy||loading||conflict||changedElsewhere||pricePolicyLocked||imageProcessingBusy||atomicUncertain||bundleUncertain||bundleRetry||controller.busy||controller.uncertain||!controller.fresh||(!dirty&&!controller.dirty)} onClick={()=>void saveGrid(controller)}>저장하기</button>
            {atomicUncertain&&<button type="button" className="btn ghost" disabled={busy||loading||pricePolicyLocked||imageProcessingBusy} onClick={()=>void recoverGridSource(controller)}>입력 유지 · 저장 결과 확인</button>}
          </div></div></div>{!pricingView&&<div className="quote-actions">
            <button type="button" className="btn primary" aria-label="옵션 관리 저장하기" disabled={busy||loading||conflict||changedElsewhere||pricePolicyLocked||imageProcessingBusy||atomicUncertain||bundleUncertain||bundleRetry||controller.busy||controller.uncertain||!controller.fresh||(!dirty&&!controller.dirty)} onClick={()=>void saveGrid(controller)}>옵션 저장하기</button>
            {atomicUncertain&&<button type="button" className="btn ghost" disabled={busy||loading||pricePolicyLocked||imageProcessingBusy} onClick={()=>void recoverGridSource(controller)}>입력 유지 · 옵션 저장 결과 확인</button>}
            <small>옵션 입력과 미저장 가격 입력을 함께 저장합니다.</small>
          </div>}</>}/></div>}
        <div className="panel-stack" hidden={pricingView}>{rows.map((row, index) => {
          const calculated = calculations.find(value => value.optionId === row.id);
          const stored = saved.options.rows.find(item => item.id === row.id);
          const packagingBasis = stored?.packagingUnitsPerPack ?? (stored && [stored.packagedWeightG,stored.packagedWidthMm,stored.packagedLengthMm,stored.packagedHeightMm].some(value => value != null) ? stored.unitsPerPack : undefined);
          const packagingChanged = packagingBasis !== undefined && packagingBasis !== row.unitsPerPack && [row.packagedWeightG,row.packagedWidthMm,row.packagedLengthMm,row.packagedHeightMm].some(value => value != null);
          return <article data-option-target={row.id===focusedOptionId} key={row.id} style={{ border: '1px solid #dfe4ec', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" aria-label={`옵션 ${index + 1} 일괄 편집 선택`} checked={selected.has(row.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /><strong>옵션 {index + 1}</strong></label><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={row.included} onChange={event => update(row.id, 'included', event.target.checked)} />견적 포함</label><div style={{ display: 'flex', gap: 6 }}><button type="button" className="btn ghost" aria-label={`옵션 ${index + 1} 위로`} disabled={index === 0} onClick={() => setRows(previous => moveOption(previous, row.id, -1))}>↑</button><button type="button" className="btn ghost" aria-label={`옵션 ${index + 1} 아래로`} disabled={index === rows.length - 1} onClick={() => setRows(previous => moveOption(previous, row.id, 1))}>↓</button><button type="button" className="btn ghost" disabled={rows.length >= OPTION_LIMIT} title="이름·원가·상품 치수·이미지를 유지하고 공급자 SKU는 비운 미포함 옵션을 만듭니다. 포장정보는 현재 구성 수량과 기준이 일치할 때만 복제합니다." onClick={() => setRows(previous => duplicateOption(previous, row.id, crypto.randomUUID(), saved.options.rows.find(option => option.id === row.id)))}>복제</button><button type="button" className="btn ghost" aria-label={`옵션 ${index + 1} 삭제`} onClick={() => setRows(previous => previous.filter(value => value.id !== row.id))}>삭제</button></div></div>
            <div className="form-grid">{(['originalName', 'translatedName', 'supplierSku', 'color', 'size'] as const).map(key => <label className={`field ${key === 'supplierSku' ? 'full' : ''}`} key={key}><span>{optionFieldNames[key]} <small style={{ color: '#64748b', fontWeight: 400 }}>{origin(row, key)}</small></span><input aria-label={`옵션 ${index + 1} ${optionFieldNames[key]}`} value={row[key] ?? ''} maxLength={key === 'originalName' || key === 'translatedName' ? 500 : 200} onChange={event => update(row.id, key, event.target.value)} /></label>)}</div>
            <div className="form-grid">{numberKeys.map(key => <label className="field" key={key}><span>{optionFieldNames[key]}{key === 'stock' && <small> · {origin(row, key)} · 공란은 미확인</small>}{key === 'unitCostCny' && row.included ? ' · 필수' : ''}</span><input aria-label={`옵션 ${index + 1} ${optionFieldNames[key]}`} type="number" min={0} step={key === 'unitsPerPack' || key === 'minimumOrderQuantity' || key === 'stock' || key.startsWith('packaged') ? 1 : 'any'} value={row[key] === null || !Number.isFinite(row[key]) ? '' : row[key]} onChange={event => { const value = event.target.value === '' ? null : event.target.valueAsNumber; if (key === 'unitsPerPack') update(row.id, key, value ?? NaN); else update(row.id, key, value); }} /></label>)}</div>
            <label className="field" style={{ marginTop: 14 }}><span>옵션 이미지</span><select aria-label={`옵션 ${index + 1} 이미지`} value={row.imageKey ?? ''} onChange={event => update(row.id, 'imageKey', event.target.value || null)} style={{ padding: 10, border: '1px solid #dfe4ec', borderRadius: 8 }}><option value="">공통 대표 이미지 사용</option>{images.map((key, imageIndex) => <option value={key} key={key}>업로드 이미지 {imageIndex + 1}</option>)}</select></label>
            {row.imageKey && <div style={{ marginTop: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${row.imageKey.split('/').map(encodeURIComponent).join('/')}`} alt={`옵션 ${index + 1} 연결 이미지`} width={100} height={100} style={{ objectFit: 'contain' }} />
            </div>}
            {row.included && (calculated?.error ? <p role="status" style={{ color: '#a34410', marginTop: 14 }}>{calculated.error}</p> : calculated?.calculation && <div style={{ background: '#f5f8ff', padding: 12, borderRadius: 8, marginTop: 14 }}><p style={{ margin: 0 }}>판매 단위 원가 ¥{calculated.sourceCostCny?.toLocaleString('ko-KR')} = 개당 ¥{row.unitCostCny} × {row.unitsPerPack}개</p><p style={{ margin: '6px 0 0' }}><strong>공급가 {won(calculated.calculation.supplyPrice)} · 판매가 {won(calculated.calculation.salePrice)}</strong><br />MSRP {won(calculated.calculation.msrp)} · 공급 마진 {won(calculated.calculation.marginKrw)}</p></div>)}
            {packagingChanged && <div role="status"><p>포장 정보는 {packagingBasis}개입 기준입니다. 현재 {row.unitsPerPack}개입의 포장 상태를 확인해주세요. 입력값은 유지했습니다.</p><label><input type="checkbox" checked={row.packagingConfirmed === true} onChange={event => setRows(previous => previous.map(item => item.id === row.id ? {...item,packagingConfirmed:event.target.checked} : item))}/>현재 구성의 포장 무게·치수를 확인했습니다 · 옵션 저장 시 반영</label></div>}
            {!row.included && <p style={{ color: '#64748b', marginTop: 12, marginBottom: 0 }}>견적에서 제외 · 입력한 자료는 저장됩니다.</p>}
          </article>;
        })}</div>
    <details className="pricing-input-guide" open={pricingView ? undefined : true}><summary hidden={!pricingView}>가격·포장 입력 안내</summary>
      <div className="panel-note"><div><strong>옵션·SKU별 견적 구성</strong><p>옵션 원가와 판매 단위당 구성 수량으로 각각 계산합니다. 상품의 대표 원가는 별도로 유지됩니다. 원문·한국어 이름을 수정해 저장할 수 있으며 자동 수집·번역이 실행되는 화면은 아닙니다. 공급자 재고는 수집 시점 또는 직접 입력한 값이며 실시간 재고가 아닙니다. 구성 수량·최소 주문 수량·견적 수량과는 별개입니다. 포장 무게(g)와 포장 치수(mm)는 실제 배송할 포장 상태를 입력하고 저장하세요. 견적서에서 직접 수정한 포장값은 유지됩니다. 전송 전에 견적서에 적용된 값을 확인해주세요.</p></div></div>
    </details>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><strong>전체 {rows.length}개 · 견적 포함 {included}개</strong><button type="button" className="btn ghost" disabled={rows.length >= OPTION_LIMIT||bundleUncertain||bundleRetry} onClick={() => {if(bundleAttempt.current||atomicAttempt.current)return;setRows(previous => [...previous, emptyOptionInput(crypto.randomUUID())]);}}>＋ 옵션 추가</button></div>
        <details className="pricing-extra-options" open={pricingView ? undefined : true}><summary hidden={!pricingView}>추가 옵션 편집</summary>
          <OptionBulkTools key={initialBulkAction ?? 'edit'} initialBulkAction={initialBulkAction} allowLegacyBundleAdd={!editableQuotationPrices} productId={product.id} rows={rows} images={images} selected={[...selected].filter(id => rows.some(row => row.id === id))} onSelect={ids => setSelected(new Set(ids))} policy={currentPolicy!} onApply={next => { if(!bulkAllowed())return false;setRows(next); setSelected(previous => new Set([...previous].filter(id => next.some(row => row.id === id))));return true; }} />
        </details>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18 }}><small style={{ color: '#64748b' }}>{dirty ? '저장하지 않은 변경' : `저장 버전 ${saved.options.revision}`}</small>{!editableQuotationPrices&&<button type="button" className="btn primary" disabled={!dirty || conflict || busy || changedElsewhere} onClick={() => void save()}>{busy ? '저장 중…' : '옵션 저장·가격 계산'}</button>}</div>
        {onReviewPackaging && <button type="button" className="btn ghost" disabled={dirty || busy || loading || conflict || changedElsewhere || packagingTarget === undefined} onClick={() => {
          if (activeRequest.current || dirty || busy || loading || conflict || changedElsewhere || packagingTarget === undefined) return;
          onReviewPackaging(packagingTarget);
        }}>견적서 포장값 확인</button>}
      </fieldset>
    </>}
  </div>;
}

function OptionBulkTools({ productId, rows, images, selected, onSelect, policy, onApply, initialBulkAction,allowLegacyBundleAdd=true }: { productId: string; rows: OptionInput[]; images: string[]; selected: string[]; onSelect: (ids: string[]) => void; policy: PricePolicy; onApply: (rows: OptionInput[]) => boolean|void; initialBulkAction?: 'remove';allowLegacyBundleAdd?:boolean }) {
  type ToolAction = Exclude<BulkOptionAction['type'],'applyBundle'>;
  const [operation, setOperation] = useState<ToolAction>(initialBulkAction ?? 'unitsPerPack');
  const [imageKey, setImageKey] = useState('');
  const [packaging, setPackaging] = useState({packagedWeightG:'',packagedWidthMm:'',packagedLengthMm:'',packagedHeightMm:''});
  const [value, setValue] = useState(''); const [preview, setPreview] = useState<BulkOptionPreview | null>(null);
  const [error, setError] = useState(''); const [undo, setUndo] = useState<{ before: OptionInput[]; after: string } | null>(null);
  const [settings, setSettings] = useState<{ boxSkuQuantity: number } | null>(null); const [settingsMessage, setSettingsMessage] = useState('');
  const [bundleCriterion, setBundleCriterion] = useState<BundlePolicy['bundleCriterion']>('supplyMargin');
  const [bundleSupply, setBundleSupply] = useState('3000'), [bundleCoupang, setBundleCoupang] = useState('3000');
  const [bundleLoading, setBundleLoading] = useState(false);
  const bundleRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { bundleRequest.current?.abort(); }, []);
  const actionNames = { packaging: '포장 무게·치수 입력', clearPackaging: '포장 정보 비우기', addBundle: '번들 추가 (원래 옵션 유지)', autoBundle: '자동 번들 수량 제안', unitsPerPack: '판매 단위당 구성 수량', unitCostCny: '개당 원가 CNY', include: '견적에 포함', exclude: '견적에서 제외', remove: '옵션 삭제', imageKey: '옵션 이미지 연결' };
  const current = Boolean(preview && preview.priceBase === optionBulkPriceBase(policy) && preview.base === JSON.stringify(rows) && [...preview.selectedIds].sort().join('\n') === [...selected].sort().join('\n'));
  async function showDefaults() {
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/registration-settings`, { cache: 'no-store' }); const body = await response.json() as { settings?: { boxSkuQuantity: number } | null; error?: string };
      if (!response.ok) throw new Error(body.error || '기본설정을 불러오지 못했습니다.');
      setSettings(body.settings ?? null); setSettingsMessage(body.settings ? '' : '저장한 기본설정이 없습니다.');
    } catch (cause) { setSettings(null); setSettingsMessage(cause instanceof Error ? cause.message : '기본설정을 불러오지 못했습니다.'); }
  }
  async function loadBundleDefaults() {
    if (bundleRequest.current) return;
    const controller = new AbortController(); bundleRequest.current = controller;
    setBundleLoading(true); setPreview(null); setError('');
    try {
      const response = await fetch('/api/settings', { cache: 'no-store', signal: controller.signal });
      const body = await response.json() as { settings?: unknown; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || '번들 기준을 불러오지 못했습니다.');
      const bundle = configuredBundlePolicy(body.settings);
      if (!bundle) throw new Error('저장된 번들 기준이 없습니다. 기준과 금액을 직접 확인해주세요.');
      setBundleCriterion(bundle.bundleCriterion); setBundleSupply(String(bundle.bundleMinimumSupplyMargin)); setBundleCoupang(String(bundle.bundleMinimumCoupangMargin));
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '번들 기준을 불러오지 못했습니다.'); }
    finally { if (bundleRequest.current === controller) bundleRequest.current = null; if (!controller.signal.aborted) setBundleLoading(false); }
  }
  function makePreview() {
    if (bundleRequest.current) return;
    if(!allowLegacyBundleAdd&&operation==='addBundle'){setError('가격표의 번들 추가 버튼에서 저장된 옵션으로 번들을 추가해주세요. 입력은 유지했습니다.');return;}
    setError('');
    try {
      const action: BulkOptionAction = operation === 'autoBundle' ? { type: operation, value: { bundleCriterion, bundleMinimumSupplyMargin: bundleSupply.trim() ? Number(bundleSupply) : NaN, bundleMinimumCoupangMargin: bundleCoupang.trim() ? Number(bundleCoupang) : NaN } } : operation === 'packaging' ? {type:'packaging',value:{packagedWeightG:Number(packaging.packagedWeightG),packagedWidthMm:Number(packaging.packagedWidthMm),packagedLengthMm:Number(packaging.packagedLengthMm),packagedHeightMm:Number(packaging.packagedHeightMm)}} : operation === 'addBundle' ? { type: operation, value: value.trim() ? Number(value) : NaN, newIds: Object.fromEntries(selected.map(id => [id, crypto.randomUUID()])) } : operation === 'unitCostCny' || operation === 'unitsPerPack' ? { type: operation, value: value.trim() ? Number(value) : NaN } : operation === 'imageKey' ? { type: operation, value: imageKey || null } : { type: operation };
      setPreview(previewOptionBulk(rows, selected, action, policy, images));
    } catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : '변경값을 확인해주세요.'); }
  }
  function applyPreview() {
    if (!preview || !current || bundleRequest.current) return;
    if(!allowLegacyBundleAdd&&preview.action.type==='addBundle'){setError('가격표의 번들 추가 버튼을 사용해주세요. 이전 미리보기는 적용하지 않았습니다.');return;}
    try { const next = applyOptionBulk(rows, preview, policy, images); if(onApply(next)===false){setError('현재 다른 저장 또는 가격·이미지 작업이 진행 중입니다. 미리보기와 입력을 유지했습니다. 확인 후 다시 적용해주세요.');return;}setUndo({ before: rows.map(row => ({ ...row })), after: JSON.stringify(next) }); setPreview(null); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '미리보기를 다시 실행해주세요.'); }
  }
  const describe = (row: OptionInput | null) => !row ? '삭제' : operation === 'packaging' || operation === 'clearPackaging' ? `${row.unitsPerPack}개입 · ${row.packagedWeightG ?? '미입력'}g · ${row.packagedWidthMm ?? '미입력'} × ${row.packagedLengthMm ?? '미입력'} × ${row.packagedHeightMm ?? '미입력'}mm` : operation === 'imageKey' ? (row.imageKey ? (images.includes(row.imageKey) ? '업로드 이미지 '+(images.indexOf(row.imageKey)+1) : '상품에서 제외된 이미지') : '공통 대표 이미지') : operation === 'unitCostCny' ? `¥ ${row.unitCostCny ?? '미입력'}` : (operation === 'unitsPerPack' || operation === 'addBundle' || operation === 'autoBundle') ? `${row.unitsPerPack}개` : row.included ? '견적 포함' : '견적 제외';
  return <details open={initialBulkAction==='remove'||undefined} style={{ border: '1px solid #dfe4ec', borderRadius: 10, padding: 14, marginBottom: 16 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>선택 옵션 일괄 편집 · {selected.length}개 선택</summary>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}><button type="button" className="btn ghost" onClick={() => onSelect(rows.map(row => row.id))}>전체 선택</button><button type="button" className="btn ghost" onClick={() => onSelect(rows.filter(row => row.included).map(row => row.id))}>견적 포함 옵션 선택</button><button type="button" className="btn ghost" onClick={() => onSelect([])}>선택 해제</button><button type="button" className="btn ghost" onClick={() => void showDefaults()}>저장한 기본설정 확인</button></div>
    {settings && <p style={{ fontSize: 13, color: '#64748b' }}>이 상품의 기본 박스 내 SKU {settings.boxSkuQuantity}개(물류 입수)</p>}
    {settingsMessage && <p role="status">{settingsMessage}</p>}
    <p style={{ fontSize: 13, color: '#64748b' }}>판매 구성 수량은 직접 확인한 값으로 지정합니다. 박스 내 SKU 수량은 물류용 기본설정이며 옵션 구성 수량으로 자동 적용하지 않습니다.</p>
    <div className="form-grid"><label className="field"><span>선택 옵션에 적용할 작업</span><select value={operation} disabled={bundleLoading} onChange={event => { if (bundleRequest.current) return; setOperation(event.target.value as ToolAction); setPreview(null); }} style={{ padding: 10, border: '1px solid #dfe4ec', borderRadius: 8 }}>{Object.entries(actionNames).filter(([key])=>allowLegacyBundleAdd||key!=='addBundle').map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>{(operation === 'unitsPerPack' || operation === 'addBundle' || operation === 'unitCostCny') && <label className="field"><span>변경값 · {operation !== 'unitCostCny' ? '개' : 'CNY'}</span><input aria-label="일괄 편집 변경값" type="number" min={0} step={operation !== 'unitCostCny' ? 1 : 'any'} value={value} onChange={event => { setValue(event.target.value); setPreview(null); }} /></label>}</div>
    {operation === 'autoBundle' && <><div className="form-grid">
      <label className="field"><span>번들 수량 기준</span><select aria-label="번들 수량 기준" value={bundleCriterion} disabled={bundleLoading} onChange={event => { if (bundleRequest.current) return; setBundleCriterion(event.target.value as BundlePolicy['bundleCriterion']); setPreview(null); }}><option value="supplyMargin">최소 공급 마진액</option><option value="coupangMargin">최소 쿠팡 마진액</option></select></label>
      <label className="field"><span>번들 최소 공급 마진액</span><input aria-label="번들 최소 공급 마진액" type="number" min={1000} step={1000} value={bundleSupply} disabled={bundleLoading} onChange={event => { if (bundleRequest.current) return; setBundleSupply(event.target.value); setPreview(null); }}/></label>
      <label className="field"><span>번들 최소 쿠팡 마진액</span><input aria-label="번들 최소 쿠팡 마진액" type="number" min={1000} step={1000} value={bundleCoupang} disabled={bundleLoading} onChange={event => { if (bundleRequest.current) return; setBundleCoupang(event.target.value); setPreview(null); }}/></label>
    </div><button type="button" className="btn ghost" disabled={bundleLoading} onClick={() => void loadBundleDefaults()}>{bundleLoading ? '번들 기준 읽는 중…' : '저장한 번들 기준 불러오기'}</button><p>이 상품에 저장된 환율·마진·가격 처리 단위로 1·3·5…21개 중 수량을 제안합니다. 실제 구성과 포장을 확인한 뒤 적용해주세요. 기본설정을 불러와도 상품 가격 정책과 옵션은 바뀌지 않습니다.</p></>}
    {operation === 'packaging' && <><div className="form-grid">{(['packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'] as const).map(key=><label className="field" key={key}><span>{optionFieldNames[key]}</span><input type="number" min={1} step={1} max={key==='packagedWeightG'?1e9:1e6} aria-label={'일괄 '+optionFieldNames[key]} value={packaging[key]} onChange={event=>{setPackaging(previous=>({...previous,[key]:event.target.value}));setPreview(null);}}/></label>)}</div><p>선택한 각 옵션의 현재 구성에 같은 포장값을 적용합니다. 실제 포장 상태가 같은 옵션을 선택해주세요. 적용 후 옵션을 저장하면 각 구성 수량의 포장 정보로 기록됩니다.</p></>}
    {operation === 'clearPackaging' && <p>선택한 옵션의 포장 무게·치수만 공란으로 바꿉니다. 상품 자체의 크기·무게와 견적서에서 직접 수정한 물류값은 유지됩니다.</p>}
    {operation === 'addBundle' && <p>원래 옵션을 유지하고 지정 수량(2~100개)의 새 옵션을 추가합니다. 개당 원가와 이미지를 사용해 가격을 계산합니다. 새 옵션의 공급자 SKU·재고·최소주문량·포장 크기·무게는 비워 두므로 저장 전에 확인해주세요.</p>}
    {operation === 'imageKey' && <label className="field"><span>선택 옵션에 연결할 이미지</span><select aria-label="일괄 연결 이미지" value={imageKey} onChange={event=>{setImageKey(event.target.value);setPreview(null);}}><option value="">공통 대표 이미지 사용</option>{images.map((key,index)=><option key={key} value={key}>업로드 이미지 {index+1}</option>)}</select><small>선택한 옵션의 기존 이미지 연결을 바꿉니다. 파일은 삭제하지 않으며, 미리보기 적용 후 옵션 저장으로 확정합니다.</small></label>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}><button type="button" className="btn ghost" disabled={!selected.length || bundleLoading} onClick={makePreview}>변경 미리보기</button>{undo && <button type="button" className="btn ghost" disabled={undo.after !== JSON.stringify(rows)} onClick={() => { if(onApply(undo.before.map(row => ({ ...row })))===false){setError('현재 변경을 적용할 수 없습니다. 되돌릴 입력은 유지했습니다.');return;}setUndo(null);setPreview(null);setError(''); }}>최근 일괄 변경 되돌리기</button>}</div>
    {error && <p role="alert" style={{ color: '#a34410' }}>{error}</p>}
    {preview && <div style={{ marginTop: 14 }}><strong>{preview.action.type==='applyBundle'?'번들 적용':actionNames[preview.action.type]} · {preview.changes.length}개 옵션 미리보기</strong><div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}><table style={{ width: '100%', fontSize: 13 }}><thead><tr><th>옵션</th><th>현재 → 변경</th><th>공급가 변경</th></tr></thead><tbody>{preview.changes.map(change => <tr key={change.id}><td>{change.name}</td><td>{describe(change.before)} → {describe(change.after)}</td><td>{change.beforePrice === null ? '—' : won(change.beforePrice)} → {change.error ? change.error : change.afterPrice === null ? '—' : won(change.afterPrice)}</td></tr>)}</tbody></table></div>{!current && <p role="status">선택·편집 내용 또는 가격 정책이 바뀌었습니다. 미리보기를 다시 실행해주세요.</p>}<p style={{ fontSize: 13, color: '#64748b' }}>적용 후에도 아직 저장되지 않습니다. 아래 옵션 저장 버튼으로 서버에 저장하세요.</p><div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn ghost" onClick={() => setPreview(null)}>미리보기 취소</button><button type="button" className="btn primary" disabled={!current} onClick={applyPreview}>편집 내용에 적용</button></div></div>}
  </details>;
}
