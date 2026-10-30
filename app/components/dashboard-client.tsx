'use client';
import '@/app/components/registration-workspace.css';
import { loadCategoryProfiles, readCategoryJsonResponse } from '@/app/load-category-profiles';

import { allRegistrationSteps, registrationStepsForLayout, initialRegistrationStep, type CollectionEditorTab } from '@/app/registration-navigation';
import { useRegistrationLayout } from '@/app/components/use-registration-layout';
import { requestWorkspaceClose, workspaceEditState, quotationSourceState, workspaceSourceWriteState, type WorkspaceSourceWrite } from '@/app/workspace-close';
import type { QuotationNavigationTarget } from '@/app/quotation-navigation';

import { ChangeEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CategoryProfileEditor } from '@/app/components/category-profile-editor';
import { IntakeQueuePanel, type IntakeSourceSeed, type IntakeCategoryEntry } from '@/app/components/intake-queue-panel';
import { useIntakeDraft } from '@/app/components/use-intake-draft';
import { ProductArchive } from '@/app/components/product-archive';
import { ProductManagementWorkspace } from '@/app/components/product-management-workspace';
import HistoricalAiRegistrationsPanel from '@/app/components/historical-ai-registrations-panel';
import { ProductContentEditor } from '@/app/components/product-content-editor';
import { OptionSeoEditor } from '@/app/components/option-seo-editor';
import { SeoWorkspaceGenerator } from '@/app/components/seo-workspace-generator';
import type { SeoGeneratedDraft } from '@/app/seo-generated-draft';
import { setSeoGuidanceSessionOwner } from '@/app/seo-guidance-session';
import {parseSeoGenerationConfiguration,type SeoGenerationConfiguration} from '@/app/seo-workspace-draft';
import { SeoWorkspaceEditor } from '@/app/components/seo-workspace-editor';
import { sameSeoAppliedSource, type SeoAppliedReceipt } from '@/app/seo-apply-focus';
import { OptionImageEditor } from '@/app/components/option-image-editor';
import {quotationImageKeys} from '@/app/quotation-image-targets';
import { DetailImageBatchPanel } from '@/app/components/detail-image-batch-panel';
import { DetailFamilyApplyPanel } from '@/app/components/detail-family-apply-panel';
import { OptionLabelEditor } from '@/app/components/option-label-editor';
import { ProductLabelEditor } from '@/app/components/product-label-editor';
import { AutomationPanel } from '@/app/components/automation-panel';
import { PreservedProductRequestInspector } from '@/app/components/preserved-product-request-inspector';
import { ProductOptionsEditor } from '@/app/components/product-options-editor';
import { QuotationPanel } from '@/app/components/quotation-panel';
import { SubmissionReviewPanel } from '@/app/components/submission-review-panel';
import { CollectionResultPanel } from '@/app/components/collection-result-panel';
import {SourceInboxPanel} from '@/app/components/source-inbox-panel';
import {QuerySourcePanel} from '@/app/components/query-source-panel';
import type {QuerySourceCaptureSummary} from '@/app/query-source-capture';
import {useSourceRegistrations} from '@/app/components/use-source-registrations';
import type {SourceInboxItem} from '@/app/source-inbox';
import {sourceInboxDisplayTitle} from '@/app/source-inbox-title';
import {archiveSourceInboxItem,sourceArchiveReference,sameSourceArchiveReference} from '@/app/source-inbox-archive-client';
import {sameSourceUrl} from '@/app/source-registration';
import {sourceCaptureSelection,querySourceCaptureSelection,sameSourceCaptureSelection,type SourceCaptureSelection} from '@/app/source-capture-selection';
import {applyReviewedSourceToIntakeRows,validateReviewedSourceTransition} from '@/app/source-review-intake';
import { CollectionBatchPanel } from '@/app/components/collection-batch-panel';
import { ProductOptionBoard } from '@/app/components/product-option-board';
import { RegistrationBoard, registrationTitle } from '@/app/components/registration-board';
import type {RegistrationSourceSelectionReference} from '@/app/components/registration-board';
import {useMenuDismissal} from '@/app/components/use-menu-dismissal';
import { registrationNumber } from '@/app/product-registration';
import { ProductRemovalDialog } from '@/app/components/product-removal-dialog';
import { ProductSourceContext } from '@/app/components/product-source-context';
import TranslationPanel from '@/app/components/translation-panel';
import ImageGenerationPanel, {type SelectedMainImageProcessingTarget,type ImageGenerationAvailability} from '@/app/components/image-generation-panel';
import FreeImageTranslationPanel, {type FreeImageTranslationTarget} from '@/app/components/free-image-translation-panel';
import { DetailImageEditDialog } from '@/app/components/detail-image-edit-dialog';
import type {FreeImageQuotationRequest} from '@/app/free-image-translation-client';
import {validFreeImageRole} from '@/app/free-image-translation';
import { DocumentImagePanel } from '@/app/components/document-image-panel';
import { SizeChartWorkspace } from '@/app/components/size-chart-workspace';
import type { ProductContent } from '@/app/product-content';
import type { RegistrationContentSummary } from '@/app/registration-content-summary';
import { BatchWorkPanel,type SelectedBatchRequest } from '@/app/components/batch-work-panel';
import type {AutomationStageId} from '@/app/automation/model';
import type { CategoryProfile, CategoryProfileInput } from '@/app/category-profiles';
import { WorkspaceSettingsDialog } from '@/app/components/workspace-settings-dialog';
import { SupplierHubExtensionCheck } from '@/app/components/supplier-hub-extension-check';
import {CliInstallDialog} from '@/app/components/cli-install-guide';
import { savedRegistrationSettings, type WorkspaceSettings as Settings } from '@/app/workspace-settings';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';
import { requestErrorMessage } from '@/app/request-error';
import { productRemovalDecision, type ProductRemovalDecision } from '@/app/product-removal-policy';
import type { SupplierHubReceiptSummary } from '@/app/supplier-hub-receipt';
import type { NativeReceiptSummary } from '@/app/supplier-hub-product-receipt';
import { type PriceSaveOptions } from '@/app/components/price-editor';
import { ProductImageUploadQueue } from '@/app/components/product-image-upload-queue';
import { quotationCsv, type PricePolicy } from '@/app/pricing';
import { collectionBlock, collectionJobProgress, type CollectionJob } from '@/app/sourcing';

type Product = {
  registration_number?: string;
  id: string; source_url: string; title: string; source_price_cny: number; exchange_rate: number;
  supply_margin: number; coupang_margin: number; supply_price: number; sale_price: number; msrp: number;
  options_count: number; seo_status: string; image_status: string; quote_status: string;
  registration_status: string; supplier_hub_status: string; image_keys: string; goal_stage: string;
  created_at: string; updated_at: string;
  owner_id?: string;
  removal_policy?: ProductRemovalDecision | null;
  hub_receipt?: SupplierHubReceiptSummary | null;
  hub_single_receipt?: NativeReceiptSummary | null;
  pricing_policy?: string | null;
  source_image_key?: string | null;
  content_summary?: RegistrationContentSummary | null;
};

type IntegrationStatus = {
  checkedAt: string; database: string; files: string; authentication: string;
  databaseSchema?: {status: string; missingTables: string[]};
  translation: { configured: boolean; model: string|null; issues: string[] };
  imageProcessing: { configured: boolean; model: string|null; issues: string[] };
};

function BatchAiNotice({configuration}:{configuration:SeoGenerationConfiguration}) {
  const translation=configuration.translationConfig,current=translation??configuration;
  return <><strong>{translation?'자동 번역·SEO':'SEO 초안 생성'} · {current.destination}</strong><p>{current.notice}</p><small>모델 {current.model} · {current.maxOutputTokens===null?'출력 토큰 설정 필요':`최대 출력 ${current.maxOutputTokens}토큰`} · {current.freeOnly?'무료 사용만 허용 · 유료 전환 없음':'Workers AI 사용량에 따라 비용 발생'}</small>{!current.configured&&<p role="status">{translation?'자동 번역·SEO':'SEO 생성'} 사용 불가: {current.issues.join(' ')} 다른 선택 작업은 계속 진행합니다.</p>}</>;
}

async function readJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(requestErrorMessage(result));
  return result as T;
}


const imageSteps = ['대표 이미지','추가 이미지','상세 이미지'];
const batchStages:{id:AutomationStageId;label:string}[]=[{id:'seo',label:'SEO'},{id:'pricing',label:'가격'},{id:'mainImage',label:'대표 이미지'},{id:'additionalImages',label:'추가 이미지'},{id:'detailImage',label:'상세 이미지'},{id:'sizeChart',label:'사이즈표'},{id:'koreanLabel',label:'한글 표시사항'},{id:'quotation',label:'견적서'}];
const supportingTabs = [{value:'작업',label:'작업 이력'},{value:'번역',label:'번역·SEO 생성'},{value:'옵션',label:'옵션 관리'},{value:'사이즈표',label:'사이즈표'}];
type SourceReviewSession={scope:object;item:SourceInboxItem;returnToIntake:boolean;targets:{rowId:string;sourceCapture:Readonly<SourceCaptureSelection>}[]};
function sourceLink(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
function registrationDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { timeZone:'Asia/Seoul', dateStyle:'medium', timeStyle:'short' }) : '등록일 미확인';
}

function fetchWorkspace() {
  return Promise.allSettled([
    readJson<{ products: Product[] }>('/api/products'),
    readJson<{ settings: Partial<Settings> | null }>('/api/settings'),
    readJson<{ jobs: CollectionJob[] }>('/api/collection-jobs'),
    loadCategoryProfiles().then(profiles => ({ profiles })),
  ]);
}
const goalOptions = [
  { id:'collect', title:'상품추가', desc:'수집 연결 후 원문·옵션·원가를 확인합니다.' },
  { id:'price', title:'SEO + 가격', desc:'수집 후 번역 검토와 가격 계산을 준비합니다.' },
  { id:'work', title:'작업개시', desc:'수집 후 이미지·표시사항·견적 자료까지 준비합니다.' },
  { id:'transmit', title:'등록전송', desc:'미검증 · 전송은 차단됩니다.' },
];

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
export default function DashboardClient({ userName, workspaceOwnerId }: { userName: string; workspaceOwnerId?:string }) {
  useMenuDismissal();
  useLayoutEffect(()=>{setSeoGuidanceSessionOwner(workspaceOwnerId);},[workspaceOwnerId]);
  const [products, setProducts] = useState<Product[]>([]);
  const receiptReadSequence=useRef(new Map<string,number>());
  const [view, setView] = useState<'work'|'archive'>('work');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(() => savedRegistrationSettings(null));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedSources,setSelectedSources]=useState<RegistrationSourceSelectionReference[]>([]);
  const sourceSelectionChanged=useCallback((references:RegistrationSourceSelectionReference[])=>setSelectedSources(references),[]);


  const [addOpen, setAddOpen] = useState(false);
  const [collectionQueueOpen,setCollectionQueueOpen]=useState(false);
  const sourceRegistrations=useSourceRegistrations(workspaceOwnerId);
  const sourceReviewScope=useMemo(()=>({ownerId:workspaceOwnerId}),[workspaceOwnerId]);
  const [sourceReviewState,setSourceReview]=useState<SourceReviewSession|null>(null);
  const sourceReview=sourceReviewState?.scope===sourceReviewScope?sourceReviewState:null;
  const sourceReviewSession=useRef<SourceReviewSession|null>(null);
  const sourceWorkspace=useRef<{scope:typeof sourceReviewScope;ready:boolean;company:WorkspaceSettingsScope['company']}|null>(null);
  const [querySourceCompany,setQuerySourceCompany]=useState<{scope:object;company:WorkspaceSettingsScope['company']}>({scope:sourceReviewScope,company:null});
  useLayoutEffect(()=>{sourceReviewSession.current=null;sourceWorkspace.current={scope:sourceReviewScope,ready:false,company:null};return()=>{sourceReviewSession.current=null;sourceWorkspace.current=null;};},[workspaceOwnerId,sourceReviewScope]);
  const [sourceNotice,setSourceNotice]=useState('');
  const [intakeSourceSeed,setIntakeSourceSeed]=useState<IntakeSourceSeed|undefined>();
  const [intakeCategoryEntry,setIntakeCategoryEntry]=useState<IntakeCategoryEntry|undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cliInstallOpen,setCliInstallOpen]=useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [removedOpen,setRemovedOpen]=useState(false);
  const removalBusy=useRef(false);
  const productRemovalRequest=useRef<AbortController|null>(null),productRemovalMounted=useRef(false);
  useEffect(()=>{
    productRemovalMounted.current=true;
    return()=>{productRemovalMounted.current=false;productRemovalRequest.current?.abort();productRemovalRequest.current=null;removalBusy.current=false;};
  },[workspaceOwnerId]);
  const changeRemovalBusy=useCallback((value:boolean)=>{removalBusy.current=value;},[]);
  const settingsBusyRef=useRef(false);
  const changeSettingsBusy=useCallback((value:boolean)=>{settingsBusyRef.current=value;setSettingsBusy(value);},[]);
  const settingsOperationRef=useRef({ownerId:workspaceOwnerId,mounted:false,epoch:0,saving:false});
  useLayoutEffect(()=>{
    const operation=settingsOperationRef.current;
    operation.ownerId=workspaceOwnerId;operation.mounted=true;operation.saving=false;operation.epoch++;
    return()=>{operation.mounted=false;operation.saving=false;operation.epoch++;};
  },[workspaceOwnerId]);
  const submissionContext=useMemo(()=>({ownerId:workspaceOwnerId}),[workspaceOwnerId]);
  type SubmissionSession={context:typeof submissionContext;target:{product:Product;profileId?:string}|null};
  const [submissionSession,setSubmissionSession]=useState<SubmissionSession|null>(null);
  type SubmissionLock={session:SubmissionSession;source:boolean;close:boolean};
  const submissionLock=useRef<SubmissionLock|null>(null),[submissionLockState,setSubmissionLockState]=useState<SubmissionLock|null>(null);
  const liveSubmissionContext=useRef<typeof submissionContext|null>(submissionContext),liveSubmissionSession=useRef<SubmissionSession|null>(null);
  useLayoutEffect(()=>{
    liveSubmissionContext.current=submissionContext;
    return()=>{liveSubmissionContext.current=null;liveSubmissionSession.current=null;submissionLock.current=null;};
  },[submissionContext]);
  const currentSubmission=submissionSession?.context===submissionContext?submissionSession:null;
  const submissionTarget=currentSubmission?.target;
  function openSubmission(target:SubmissionSession['target']) {
    if(batchBusyRef.current||liveSubmissionContext.current!==submissionContext||target&&workspaceOwnerId&&target.product.owner_id!==workspaceOwnerId)return;
    const previous=submissionLock.current;
    if(previous?.close&&submissionCurrent(previous.session)){setToast('현재 문서의 전송·저장 결과를 먼저 확인해주세요.');return;}
    const session={context:submissionContext,target};submissionLock.current=null;setSubmissionLockState(null);liveSubmissionSession.current=session;setSubmissionSession(session);
  }
  function submissionCurrent(session:SubmissionSession|null) {
    return !!session&&liveSubmissionContext.current===submissionContext&&session.context===submissionContext&&liveSubmissionSession.current===session;
  }
  function closeSubmission(session:SubmissionSession|null) {
    if(!submissionCurrent(session))return false;
    if(submissionLock.current?.session===session&&submissionLock.current.close){setToast('현재 문서의 전송·저장 결과를 먼저 확인해주세요. 미확정 요청은 같은 문서에서 이어서 확인합니다.');return false;}
    submissionLock.current=null;setSubmissionLockState(null);liveSubmissionSession.current=null;setSubmissionSession(null);return true;
  }
  function changeSubmissionLock(session:SubmissionSession,source:boolean,close=source){
    if(!submissionCurrent(session))return;const previous=submissionLock.current;
    if(previous?.session===session&&previous.source===source&&previous.close===close)return;
    const next={session,source,close};submissionLock.current=next;setSubmissionLockState(next);
  }
  const [detail, setDetail] = useState<Product | null>(null);
  const [tab, setTab] = useState('SEO');
  const [quotationTarget,setQuotationTarget]=useState<QuotationNavigationTarget|undefined>();
  const [quotationNavigationSequence,setQuotationNavigationSequence]=useState(0);
  const [detailProfileId,setDetailProfileId]=useState<string|undefined>();
  const registrationLayout = useRegistrationLayout(workspaceOwnerId, detail?.id, detail?.updated_at, detailProfileId);
  const registrationSteps = registrationStepsForLayout(registrationLayout.layout ?? registrationLayout.pendingLayout);
  const registrationLayoutReady=!!registrationLayout.layout&&!registrationLayout.loading&&!registrationLayout.error;
  const [lastRegistrationStep, setLastRegistrationStep] = useState('SEO');
  const detailBody = useRef<HTMLDivElement>(null);
  const [closeNotice, setCloseNotice] = useState('');
  const [sourceSupplementBusy,setSourceSupplementBusy]=useState(false);
  const sourceSupplementBusyRef=useRef(false);
  const changeSourceSupplementBusy=useCallback((value:boolean)=>{sourceSupplementBusyRef.current=value;setSourceSupplementBusy(value);},[]);
  const productNavigation=useRef(0);
  const workspaceProductsRead=useRef(0);
  const batchNavigation=useRef<AbortController|null>(null);
  useEffect(()=>()=>{productNavigation.current++;batchNavigation.current?.abort();},[]);
  const [busy, setBusyState] = useState(false);
  const busyRef=useRef(false);
  const setBusy=useCallback((value:boolean)=>{busyRef.current=value;setBusyState(value);},[]);
  const [focusedOptionId, setFocusedOptionId] = useState<string|undefined>();
  const [initialOptionAction,setInitialOptionAction]=useState<'remove'|undefined>();
  const [optionBoardProduct, setOptionBoardProduct] = useState<Product|null>(null);
  const optionBoardScope=useRef<{productId:string;generation:number;ownerId:string|undefined}|null>(null);
  const optionWorkspaceReturn=useRef<{productId:string;generation:number;ownerId:string|undefined;focusLabel?:string}|null>(null);
  const [optionReturnFocus,setOptionReturnFocus]=useState<string|undefined>();
  const [optionBoardReturnRevision,setOptionBoardReturnRevision]=useState(0);
  const optionBoardRenderScope=optionBoardScope.current;
  const optionNavigation=useRef<AbortController|null>(null);
  const [optionNavigationBusy,setOptionNavigationBusy]=useState(false);
  const optionNavigationOwner=useMemo(()=>({ownerId:workspaceOwnerId}),[workspaceOwnerId]);
  const [optionNavigationFailure,setOptionNavigationFailure]=useState<{owner:typeof optionNavigationOwner;productId:string;message:string}|null>(null);
  const optionNavigationError=optionNavigationFailure?.owner===optionNavigationOwner&&optionNavigationFailure.productId===optionBoardProduct?.id?optionNavigationFailure.message:'';
  useEffect(()=>()=>{optionWorkspaceReturn.current=null;optionBoardScope.current=null;optionNavigation.current?.abort();optionNavigation.current=null;},[workspaceOwnerId]);
  const optionBoardVersion=[optionBoardProduct,detail,...products].reduce((version,product)=>
    optionBoardProduct&&product&&product.id===optionBoardProduct.id&&(!workspaceOwnerId||product.owner_id===workspaceOwnerId)&&Date.parse(product.updated_at)>Date.parse(version)
      ?product.updated_at:version,optionBoardProduct?.updated_at??'');
  function changeView(next:'work'|'archive') {
    if(batchBusyRef.current)return;
    productNavigation.current++;
    optionWorkspaceReturn.current=null;optionBoardScope.current=null;optionNavigation.current?.abort();optionNavigation.current=null;setOptionNavigationBusy(false);setOptionBoardProduct(null);setOptionReturnFocus(undefined);
    setOptionNavigationFailure(null);
    setView(next);
  }
  function guardOperationsNavigation(event:{preventDefault:()=>void}){
    if(busyRef.current||batchBusyRef.current||settingsBusyRef.current||sourceSupplementBusyRef.current||sourceWorkRef.current){
      event.preventDefault();setToast('진행 중인 상품 작업을 마친 뒤 운영관리를 열어주세요.');
    }
  }
  function closeWorkspace(manageCategories = false) {
    if(!settingsOperationRef.current.mounted||settingsOperationRef.current.ownerId!==workspaceOwnerId||detailNavigation!==productNavigation.current)return false;
    if(busyRef.current){setCloseNotice('작업이 진행 중입니다. 현재 작업을 마친 뒤 닫아주세요.');return false;}
    if(sourceSupplementBusyRef.current){setCloseNotice('상세 원문 보완을 마친 뒤 닫아주세요.');return false;}
    const result = requestWorkspaceClose(detailBody.current, () => window.confirm('저장하지 않은 입력이 있습니다. 입력을 버리고 상품 작업창을 닫을까요?'));
    if (result === 'busy') { setCloseNotice('작업이 진행 중입니다. 현재 작업을 마친 뒤 닫아주세요.'); return false; }
    if (result === 'cancel') return false;
    const origin=optionWorkspaceReturn.current;
    const operation=settingsOperationRef.current;
    const restoreOptions=!manageCategories&&origin&&detail&&origin.productId===detail.id&&origin.generation===productNavigation.current
      &&operation.mounted&&operation.ownerId===workspaceOwnerId&&origin.ownerId===workspaceOwnerId&&(!workspaceOwnerId||detail.owner_id===workspaceOwnerId);
    const generation=++productNavigation.current;
    optionWorkspaceReturn.current=null;
    setOptionNavigationFailure(null);
    if(restoreOptions){
      optionBoardScope.current={productId:detail.id,generation,ownerId:workspaceOwnerId};setOptionBoardProduct(detail);setOptionReturnFocus(origin.focusLabel);setOptionBoardReturnRevision(value=>value+1);
    }else{optionBoardScope.current=null;setOptionBoardProduct(null);setOptionReturnFocus(undefined);}
    setCloseNotice(''); setDetail(null);
    if (manageCategories) setAddOpen(true);
    return true;
  }
  useEffect(() => {
    if (!detail) return;
    const protect = (event: BeforeUnloadEvent) => {
      const state = workspaceEditState(detailBody.current);
      if (state.dirty || state.busy || sourceSupplementBusyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [detail]);
  const [selectedBatchStages,setSelectedBatchStages]=useState<AutomationStageId[]>(()=>batchStages.map(stage=>stage.id));
  const [selectedBatchMode,setSelectedBatchMode]=useState<'full'|'selected'>('full');
  type BatchRun={request:SelectedBatchRequest;products:Product[]};
  type SourceWorkPlan={scope:object;ownerId:string;company:string;settingsEpoch:number;request:SelectedBatchRequest;sources:RegistrationSourceSelectionReference[];index:number;products:Product[];existingIds:Set<string>;phase:'next'|'preparing'|'ready'};
  const [sourceWorkState,setSourceWorkState]=useState<SourceWorkPlan|null>(null),sourceWorkRef=useRef<SourceWorkPlan|null>(null);
  const sourceWork=sourceWorkState?.scope===sourceReviewScope?sourceWorkState:null;
  function setSourceWork(value:SourceWorkPlan|null){sourceWorkRef.current=value;setSourceWorkState(value);}
  useEffect(()=>()=>{sourceWorkRef.current=null;},[workspaceOwnerId]);
  const batchScope=useMemo(()=>({ownerId:workspaceOwnerId}),[workspaceOwnerId]);
  type BatchState={scope:typeof batchScope;open:boolean;busy:boolean;run:BatchRun|null};
  const [batchState,setBatchState]=useState<BatchState>(()=>({scope:batchScope,open:false,busy:false,run:null}));
  // Rendering a different owner hides the prior session immediately, including
  // A -> B -> A. The layout cleanup only revokes callbacks and in-flight reads.
  const currentBatch=batchState.scope===batchScope?batchState:null;
  const batchOpen=currentBatch?.open??false,batchBusy=currentBatch?.busy??false,batchRun=currentBatch?.run??null;
  const batchScopeRef=useRef<typeof batchScope|null>(batchScope),batchBusyRef=useRef(false),batchRunRef=useRef<BatchRun|null>(null);
  const updateBatch=(patch:Partial<Omit<BatchState,'scope'>>)=>{if(batchScopeRef.current===batchScope)setBatchState(current=>({...current.scope===batchScope?current:{scope:batchScope,open:false,busy:false,run:null},...patch}));};
  const setBatchOpen=(open:boolean)=>updateBatch({open}),setBatchRun=(run:BatchRun|null)=>updateBatch({run});
  const changeBatchBusy=(value:boolean)=>{if(batchScopeRef.current!==batchScope)return;batchBusyRef.current=value;updateBatch({busy:value});};
  useLayoutEffect(()=>{batchScopeRef.current=batchScope;batchRunRef.current=null;batchBusyRef.current=false;return()=>{if(batchScopeRef.current!==batchScope)return;batchScopeRef.current=null;batchRunRef.current=null;batchBusyRef.current=false;batchNavigation.current?.abort();batchNavigation.current=null;};},[batchScope]);
  const [seoConfigurationReload,setSeoConfigurationReload]=useState(0);
  const seoConfigurationScope=useMemo(()=>({ownerId:workspaceOwnerId,company:querySourceCompany.scope===sourceReviewScope?querySourceCompany.company:null,settings,reload:seoConfigurationReload}),[workspaceOwnerId,sourceReviewScope,querySourceCompany,settings,seoConfigurationReload]);
  const [seoConfigurationState,setSeoConfigurationState]=useState<{scope:typeof seoConfigurationScope;configuration:SeoGenerationConfiguration|null;settingsEpoch:number;error:string}|null>(null);
  const seoConfigurationLive=useRef<typeof seoConfigurationScope|null>(seoConfigurationScope),seoConfigurationRead=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{seoConfigurationLive.current=seoConfigurationScope;return()=>{seoConfigurationLive.current=null;seoConfigurationRead.current?.abort();seoConfigurationRead.current=null;};},[seoConfigurationScope]);
  useEffect(()=>{
    const scope=seoConfigurationScope,operation=settingsOperationRef.current;
    if(!scope.ownerId||!scope.company||!operation.mounted||operation.ownerId!==scope.ownerId)return;
    const active=new AbortController(),settingsEpoch=operation.epoch;seoConfigurationRead.current=active;
    const current=()=>seoConfigurationLive.current===scope&&seoConfigurationRead.current===active&&!active.signal.aborted&&operation.mounted&&operation.ownerId===scope.ownerId;
    void(async()=>{
      try{
        const raw=await readJson<{purpose?:unknown;ownerId?:unknown;company?:unknown;configuration?:unknown}>('/api/seo-generation/configuration',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:active.signal});
        if(!current())return;
        const account=parseWorkspaceSettingsScope({ownerId:raw.ownerId,company:raw.company}),configuration=parseSeoGenerationConfiguration(raw.configuration);
        if(Object.keys(raw).sort().join(',')!=='company,configuration,ownerId,purpose'||raw.purpose!=='seo-generation'||!account||account.ownerId!==scope.ownerId||JSON.stringify(account.company)!==JSON.stringify(scope.company)||!configuration)throw Error('현재 계정·회사와 SEO 실행 안내를 확인하지 못했습니다.');
        if(operation.epoch!==settingsEpoch||operation.saving)throw Error('기본설정이 변경되었습니다. SEO 실행 안내를 다시 확인해주세요.');
        setSeoConfigurationState({scope,configuration,settingsEpoch,error:''});
      }catch(error){if(current())setSeoConfigurationState({scope,configuration:null,settingsEpoch,error:error instanceof Error?error.message:'SEO 실행 안내를 확인하지 못했습니다.'});}
    })();
    return()=>{active.abort();if(seoConfigurationRead.current===active)seoConfigurationRead.current=null;};
  },[seoConfigurationScope]);
  const currentSeoConfiguration=seoConfigurationState?.scope===seoConfigurationScope?seoConfigurationState.configuration:null;
  const seoConfigurationError=seoConfigurationState?.scope===seoConfigurationScope?seoConfigurationState.error:'';
  const seoNoticeRequired=selectedBatchStages.includes('seo');
  const batchSeoConfiguration=batchRun?.request.seoGenerationConsent??currentSeoConfiguration;
  const batchSeoNoticeRequired=batchRun?batchRun.request.stages.includes('seo'):seoNoticeRequired;
  const [batchOpenError,setBatchOpenError]=useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProductId, setHistoryProductId] = useState('');
  const [pendingUpload,setPendingUpload]=useState<{productId:string;key:string}|null>(null);
  const [toast, setToast] = useState('');

  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connections, setConnections] = useState<IntegrationStatus | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [checkingConnections, setCheckingConnections] = useState(false);
  const utilityConnectionState=checkingConnections?'checking':connectionError?'error':connections?'read':'unknown';
  const utilityConnectionLabel=checkingConnections?'서버 설정 조회 중':connectionError?'서버 설정 조회 실패':connections?'서버 설정 조회됨 · 실제 AI 호출은 별도 확인':'서버 설정 확인 전';
  const [collectionJobs, setCollectionJobs] = useState<CollectionJob[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);
  const [categoryProfiles, setCategoryProfiles] = useState<CategoryProfile[]>([]);
  const categoryProfilesEpochRef=useRef(0);
  const intakeDraft = useIntakeDraft(workspaceOwnerId);
  const { rows: intakeRows, setRows: setIntakeRows, goal: intakeGoal, setGoal: setIntakeGoal } = intakeDraft;
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryProfile|null>(null);
  const [categorySeed,setCategorySeed]=useState<CategoryProfileInput|undefined>();
  function selectDetailTab(value: string) {
    if (!registrationLayoutReady && allRegistrationSteps.includes(value)) {setCloseNotice('카테고리의 등록 단계를 확인한 뒤 이동해주세요. 입력은 유지됩니다.');return false;}
    if (value === '견적서') {
      const pending=quotationSourceState(detailBody.current);
      if(pending.busy){setCloseNotice('저장 중인 작업이 있습니다. 저장이 끝나면 견적서를 열어주세요.');return false;}
      if(pending.steps.length){
        setCloseNotice(pending.steps.join(' · ')+'에 저장하지 않은 입력이 있습니다. 해당 단계에서 저장하면 견적서에 반영됩니다.');
        setTab(pending.steps[0]);
        if(allRegistrationSteps.includes(pending.steps[0]))setLastRegistrationStep(pending.steps[0]);
        detailBody.current?.scrollTo({top:0});return false;
      }
    }
    setCloseNotice('');
    setTab(value);
    if (allRegistrationSteps.includes(value)) setLastRegistrationStep(value);
    detailBody.current?.scrollTo({ top: 0 });
    return true;
  }
  function openProduct(product: Product, initialTab = 'SEO', preferredProfileId?:string, target?:QuotationNavigationTarget, optionId?:string,returnToOptions=false,focusLabel?:string) {
    const operation=settingsOperationRef.current;
    if(batchBusyRef.current||!operation.mounted||operation.ownerId!==workspaceOwnerId||(workspaceOwnerId&&product.owner_id!==workspaceOwnerId))return;
    setCloseNotice('');
    optionBoardScope.current=null;optionNavigation.current?.abort();optionNavigation.current=null;setOptionNavigationBusy(false);setOptionReturnFocus(undefined);
    setOptionNavigationFailure(null);
    if(returnToOptions)setOptionBoardProduct(product);else setOptionBoardProduct(null);
    setInitialOptionAction(undefined);
    setFocusedOptionId(optionId);
    const generation=++productNavigation.current;
    optionWorkspaceReturn.current=returnToOptions?{productId:product.id,generation,ownerId:workspaceOwnerId,focusLabel}:null;
    setQuotationTarget(target);setQuotationNavigationSequence(0);setDetailProfileId(preferredProfileId);
    setDetail(product); setTab(initialTab); setLastRegistrationStep(initialRegistrationStep(initialTab));
  }
  function openOptionBoard(product:Product){
    const operation=settingsOperationRef.current;
    if(batchBusyRef.current||!operation.mounted||operation.ownerId!==workspaceOwnerId||(workspaceOwnerId&&product.owner_id!==workspaceOwnerId))return;
    if(busyRef.current){showToast('진행 중인 작업을 마친 뒤 옵션을 선택해주세요.');return;}
    if(detail&&!closeWorkspace())return;
    optionNavigation.current?.abort();optionNavigation.current=null;setOptionNavigationBusy(false);
    setOptionNavigationFailure(null);
    const generation=++productNavigation.current;
    optionWorkspaceReturn.current=null;setOptionReturnFocus(undefined);
    optionBoardScope.current={productId:product.id,generation,ownerId:workspaceOwnerId};setOptionBoardProduct(product);
  }
  function closeOptionBoard(){
    if(detail||!optionBoardRenderScope||optionBoardScope.current!==optionBoardRenderScope||productNavigation.current!==optionBoardRenderScope.generation)return;
    productNavigation.current++;optionWorkspaceReturn.current=null;optionBoardScope.current=null;optionNavigation.current?.abort();optionNavigation.current=null;setOptionNavigationBusy(false);setOptionBoardProduct(null);setOptionReturnFocus(undefined);
    setOptionNavigationFailure(null);
  }
  async function navigateOptionBoard(optionId:string|undefined,step:CollectionEditorTab,remove=false){
    const scope=optionBoardRenderScope;
    const current=()=>scope!==null&&optionBoardScope.current===scope&&productNavigation.current===scope.generation
      &&settingsOperationRef.current.mounted&&settingsOperationRef.current.ownerId===scope.ownerId&&scope.ownerId===workspaceOwnerId;
    if(batchBusyRef.current||!scope||!optionBoardProduct||!current()||scope.productId!==optionBoardProduct.id||optionNavigation.current
      ||(optionId!==undefined&&(typeof optionId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(optionId)))
      ||![...allRegistrationSteps,'옵션'].includes(step)||sourceSupplementBusyRef.current||busyRef.current)return;
    if(detail&&!closeWorkspace())return;
    const focusLabel=typeof document==='undefined'?undefined:document.activeElement?.getAttribute('aria-label')??document.activeElement?.textContent?.trim();
    const controller=new AbortController();optionNavigation.current=controller;setOptionNavigationBusy(true);setOptionNavigationFailure(null);
    try{
      const response=await fetch(`/api/products/${encodeURIComponent(optionBoardProduct.id)}`,{cache:'no-store',signal:controller.signal});
      const result=await readCategoryJsonResponse<{product:Product&{owner_id?:string};error?:string}>(response,'옵션 작업용 상품 조회 (GET /api/products/:id)');
      if(controller.signal.aborted||!current())return;
      if(!response.ok)throw Error(requestErrorMessage(result));
      if(!result.product||result.product.id!==scope.productId||(workspaceOwnerId&&result.product.owner_id!==workspaceOwnerId))throw Error('선택한 계정의 상품 자료를 확인하지 못했습니다. 목록을 다시 불러와주세요.');
      openProduct(result.product,step,undefined,step==='견적서'&&optionId?{optionId,fieldId:'title'}:undefined,optionId,true,focusLabel);
      if(remove)setInitialOptionAction('remove');
    }catch(error){if(!controller.signal.aborted&&current())setOptionNavigationFailure({owner:optionNavigationOwner,productId:scope.productId,message:error instanceof Error?error.message:'옵션 자료를 불러오지 못했습니다.'});}
    finally{if(optionNavigation.current===controller){optionNavigation.current=null;setOptionNavigationBusy(false);}}
  }
  function prepareCurrentSubmission(profileId?:string) {
    const operation=settingsOperationRef.current;
    if(batchBusyRef.current||!detail||liveSubmissionContext.current!==submissionContext||!operation.mounted||operation.ownerId!==workspaceOwnerId||detailNavigation!==productNavigation.current||(workspaceOwnerId&&detail.owner_id!==workspaceOwnerId))return;
    if(!registrationLayoutReady){setCloseNotice('카테고리의 등록 단계를 다시 확인한 뒤 전송을 준비해주세요. 입력은 유지됩니다.');return;}
    const state=workspaceEditState(detailBody.current);
    if(state.busy){setCloseNotice('저장 중인 작업이 있습니다. 저장이 끝나면 전송을 준비해주세요.');return;}
    if(state.dirty){setCloseNotice('저장하지 않은 입력이 있습니다. 각 단계에서 저장한 뒤 전송을 준비해주세요.');return;}
    optionWorkspaceReturn.current=null;optionBoardScope.current=null;setOptionBoardProduct(null);setOptionReturnFocus(undefined);
    setCloseNotice('');openSubmission({product:detail,profileId});setDetail(null);
  }
  async function openCollectedProduct(productId:string,initialTab:CollectionEditorTab,signal:AbortSignal){
    const request=++productNavigation.current;
    const result=await readJson<{product:Product}>(`/api/products/${encodeURIComponent(productId)}`,{cache:'no-store',signal});
    if(signal.aborted||request!==productNavigation.current)return;
    if(!result.product||result.product.id!==productId)throw new Error('연결된 상품을 확인하지 못했습니다. 수집 대기열을 새로고침해주세요.');
    openProduct(result.product,initialTab);
  }
  function closeBatch() {
    if(batchScopeRef.current!==batchScope)return;
    if(batchBusyRef.current){setBatchOpenError('진행 중인 일괄 작업을 중지하거나 현재 저장 결과를 확인한 뒤 닫아주세요.');return;}
    batchNavigation.current?.abort();batchNavigation.current=null;
    batchRunRef.current=null;setBatchRun(null);setBatchOpen(false);setBatchOpenError('');
  }
  async function openBatchProduct(productId:string,initialTab='작업') {
    const operation=settingsOperationRef.current,ownerId=workspaceOwnerId;
    if(!operation.mounted||operation.ownerId!==ownerId)return;
    if(batchBusyRef.current){setBatchOpenError('진행 중인 일괄 작업을 중지하거나 현재 저장 결과를 확인한 뒤 상품을 열어주세요.');return;}
    batchNavigation.current?.abort();
    const controller=new AbortController();batchNavigation.current=controller;
    const request=++productNavigation.current;setBatchOpenError('');
    try {
      const result=await readJson<{product:Product}>(`/api/products/${encodeURIComponent(productId)}`,{cache:'no-store',signal:controller.signal});
      if(controller.signal.aborted||request!==productNavigation.current||!operation.mounted||operation.ownerId!==ownerId)return;
      if(!result.product||result.product.id!==productId||ownerId&&result.product.owner_id!==ownerId||!Number.isFinite(Date.parse(result.product.updated_at)))throw new Error('상품 최신 상태를 확인하지 못했습니다. 다시 열어주세요.');
      setProducts(current=>current.map(product=>product.id===productId?result.product:product));
      openProduct(result.product,initialTab);batchRunRef.current=null;setBatchRun(null);setBatchOpen(false);
    } catch(error) {
      if(!controller.signal.aborted&&request===productNavigation.current&&operation.mounted&&operation.ownerId===ownerId)setBatchOpenError(error instanceof Error?error.message:'상품 최신 상태를 읽지 못했습니다. 다시 열어주세요.');
    } finally {
      if(batchNavigation.current===controller)batchNavigation.current=null;
    }
  }
  const detailStepIndex = registrationSteps.indexOf(tab);
  const progressStepIndex = Math.max(0, detailStepIndex < 0 ? registrationSteps.indexOf(lastRegistrationStep) : detailStepIndex);
  const returnRegistrationStep = registrationSteps.includes(lastRegistrationStep) ? lastRegistrationStep : 'SEO';
  const detailNavigation = productNavigation.current;
  function adoptPreparedProfile(profile:CategoryProfile,source:CategoryProfile) {
    const operation=settingsOperationRef.current;
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId||productNavigation.current!==detailNavigation
      ||!detail||workspaceOwnerId&&detail.owner_id!==workspaceOwnerId)throw Error('현재 계정과 상품을 확인하지 못했습니다. 저장한 양식을 다시 불러와주세요.');
    const sameSource=(current:CategoryProfile)=>current.id===source.id&&current.revision===source.revision
      &&JSON.stringify(current)===JSON.stringify(source);
    const current=categoryProfiles.find(item=>item.id===source.id);
    if(!current||!source.hubSchema||source.template||source.mappings.length||profile.id!==source.id
      ||!Number.isSafeInteger(source.revision)||profile.revision!==source.revision+1||profile.verification!=='draft'
      ||profile.name!==source.name||profile.categoryId!==source.categoryId||JSON.stringify(profile.categoryPath)!==JSON.stringify(source.categoryPath)
      ||JSON.stringify(profile.hubSchema)!==JSON.stringify(source.hubSchema)||!profile.template||profile.template.format!=='xlsx'
      ||workspaceOwnerId&&profile.template.storageKey!==`${encodeURIComponent(workspaceOwnerId)}/category-templates/${profile.template.sha256}.xlsx`
      ||!sameSource(current)&&JSON.stringify(current)!==JSON.stringify(profile))throw Error('공식 양식 연결의 저장 결과와 현재 카테고리가 다릅니다. 저장한 양식을 다시 불러와주세요.');
    categoryProfilesEpochRef.current++;
    setCategoryProfiles(items=>items.map(item=>sameSource(item)?profile:item));
  }
  async function checkConnections() {
    setConnectionsOpen(true); setCheckingConnections(true); setConnectionError(''); setConnections(null);
    try { setConnections(await readJson<IntegrationStatus>('/api/integrations')); }
    catch (error) { setConnectionError(error instanceof Error ? error.message : '연결 상태를 확인하지 못했습니다.'); }
    finally { setCheckingConnections(false); }
  }

  const applyWorkspace = useCallback((results: Awaited<ReturnType<typeof fetchWorkspace>>, settingsEpoch:number,categoryProfilesEpoch:number,productsRead:number,detailNavigation:number) => {
    const operation=settingsOperationRef.current;
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId||productsRead!==workspaceProductsRead.current)return;
    const [productData, settingData, collectionData, categoriesData] = results;
    const sourceScope=settingData.status==='fulfilled'?parseWorkspaceSettingsScope((settingData.value as {scope?:unknown}).scope):null;
    // The previous request list is supplementary to a new captured item. Its
    // read failure must not hide healthy products, settings and category data.
    sourceWorkspace.current={scope:sourceReviewScope,ready:productData.status==='fulfilled'&&settingData.status==='fulfilled'&&categoriesData.status==='fulfilled'
      &&sourceScope?.ownerId===workspaceOwnerId&&!!sourceScope?.company,company:sourceScope?.company??null};
    setQuerySourceCompany({scope:sourceReviewScope,company:sourceScope&&sourceScope.ownerId===workspaceOwnerId?sourceScope.company:null});
    if(workspaceOwnerId&&settingData.status==='fulfilled'&&parseWorkspaceSettingsScope((settingData.value as {scope?:unknown}).scope)?.ownerId!==workspaceOwnerId){
      setLoadError('로그인 계정이 변경되었습니다. 페이지를 새로고침해주세요.');setLoading(false);return;
    }
    if (productData.status === 'fulfilled') setProducts(current=>{
      const previous=new Map(current.map(product=>[product.id,product]));
      return productData.value.products.map(product=>{const saved=previous.get(product.id);return saved&&Date.parse(saved.updated_at)>Date.parse(product.updated_at)?saved:product;});
    });
    if (productData.status === 'fulfilled'&&detailNavigation===productNavigation.current) setDetail(current=>{
      if(!current)return null;const product=productData.value.products.find(product=>product.id===current.id);
      return !product||Date.parse(current.updated_at)>Date.parse(product.updated_at)?current:product;
    });
    if (settingData.status === 'fulfilled'&&settingsEpoch===operation.epoch&&!operation.saving) setSettings(savedRegistrationSettings(settingData.value.settings));
    if (collectionData.status === 'fulfilled') setCollectionJobs(collectionData.value.jobs);
    if (categoriesData.status === 'fulfilled'&&categoryProfilesEpoch===categoryProfilesEpochRef.current) setCategoryProfiles(categoriesData.value.profiles);
    setLoadError(results.filter(r => r.status === 'rejected').map(r => String(r.reason instanceof Error ? r.reason.message : r.reason)).join(' '));
    setLoading(false);
  }, [workspaceOwnerId,sourceReviewScope]);
  async function loadWorkspace() {
    const operation=settingsOperationRef.current;
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId)return;
    // A late response from an earlier source save may not replace a later
    // refresh, its failure notice, or a newly opened product's source clocks.
    const productsRead=++workspaceProductsRead.current;
    const detailNavigation=productNavigation.current;
    const settingsEpoch=operation.epoch;
    const categoryProfilesEpoch=categoryProfilesEpochRef.current;
    const detailId=detail?.id;
    const [workspace,currentDetail]=await Promise.all([
      fetchWorkspace(),
      detailId?readJson<{product:Product}>(`/api/products/${encodeURIComponent(detailId)}`).catch(()=>null):Promise.resolve(null),
    ]);
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId||productsRead!==workspaceProductsRead.current)return;
    applyWorkspace(workspace,settingsEpoch,categoryProfilesEpoch,productsRead,detailNavigation);
    if(currentDetail&&detailNavigation===productNavigation.current)setDetail(current=>current&&current.id===detailId&&Date.parse(current.updated_at)<=Date.parse(currentDetail.product.updated_at)?currentDetail.product:current);
  }
  async function refreshReceiptStatus(productId:string,expectedVersion:string) {
    const operation=settingsOperationRef.current,ownerId=workspaceOwnerId;
    const sequence=(receiptReadSequence.current.get(productId)??0)+1;receiptReadSequence.current.set(productId,sequence);
    try{
      const {product:observed}=await readJson<{product:Product}>(`/api/products/${encodeURIComponent(productId)}`,{cache:'no-store'});
      if(!operation.mounted||operation.ownerId!==ownerId||receiptReadSequence.current.get(productId)!==sequence||!observed||observed.id!==productId||observed.updated_at!==expectedVersion||ownerId&&observed.owner_id!==ownerId)return;
      const merge=(current:Product)=>current.id===productId&&current.updated_at===expectedVersion?{...current,hub_receipt:observed.hub_receipt,hub_single_receipt:observed.hub_single_receipt,removal_policy:observed.removal_policy}:current;
      setProducts(current=>current.map(merge));setDetail(current=>current?merge(current):current);
    }catch{if(operation.mounted&&operation.ownerId===ownerId)setToast('전송 결과는 보관됐습니다. 목록을 다시 불러와주세요.');}
  }
  async function openArchivedProduct(id: string) {
    const request=++productNavigation.current;
    const result=await readJson<{product:Product}>(`/api/products/${encodeURIComponent(id)}`,{cache:'no-store'});
    if(request!==productNavigation.current)return;
    if(!result.product||result.product.id!==id)throw new Error('보관함에 연결된 상품을 확인하지 못했습니다. 다시 시도해주세요.');
    openProduct(result.product);
  }
  useEffect(() => {
    let active = true;
    const productsRead=++workspaceProductsRead.current;
    const detailNavigation=productNavigation.current;
    const settingsEpoch=settingsOperationRef.current.epoch;
    const categoryProfilesEpoch=categoryProfilesEpochRef.current;
    fetchWorkspace().then(results => { if (active) applyWorkspace(results,settingsEpoch,categoryProfilesEpoch,productsRead,detailNavigation); });
    return () => { active = false; };
  }, [applyWorkspace]);

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600); };

  async function cancelCollectionJob(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await readJson<{ job: CollectionJob }>(`/api/collection-jobs/${id}`, { method: 'DELETE' });
      setCollectionJobs(current => current.map(job => job.id === id ? result.job : job));
      showToast('수집 요청을 취소했습니다.');
    } catch (error) { setLoadError(error instanceof Error ? error.message : '취소하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function savePrice(policy: PricePolicy, options?:PriceSaveOptions) {
    if (!detail) throw new Error('상품을 선택해주세요.');
    const result = await readJson<{ product: Product }>('/api/products/' + detail.id + '/pricing', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ policy, expectedVersion: detail.updated_at,...options }),
    });
    setProducts(current => current.map(product => product.id === result.product.id ? result.product : product));
    setDetail(current => current?.id === result.product.id ? result.product : current);
  }

  async function runAutomation() {
    const operation=settingsOperationRef.current;
    if(batchScopeRef.current!==batchScope||busyRef.current||batchBusyRef.current||settingsBusyRef.current||operation.saving||!operation.mounted||operation.ownerId!==workspaceOwnerId)return;
    if(!workspaceOwnerId){showToast('현재 로그인 계정을 확인한 뒤 작업을 시작해주세요.');return;}
    const chosen=products.filter(item=>selected.has(item.id));
    if(!chosen.length&&!selectedSources.length){showToast('작업할 상품을 선택해주세요.');return;}
    if(chosen.some(item=>item.owner_id!==workspaceOwnerId)){showToast('현재 계정의 상품을 다시 선택해주세요.');return;}
    if(!selectedBatchStages.length){showToast('실행할 작업을 하나 이상 선택해주세요.');return;}
    if(seoNoticeRequired&&(seoConfigurationLive.current!==seoConfigurationScope||!currentSeoConfiguration||seoConfigurationState?.settingsEpoch!==operation.epoch)){showToast('상품의 SEO 설정 또는 선택 상품 일괄 작업에서 실행 안내를 확인해주세요.');return;}
    const keys=new Map<string,string>();
    if(seoNoticeRequired)keys.set('batch-owner:'+workspaceOwnerId,JSON.stringify({ownerId:workspaceOwnerId,company:seoConfigurationScope.company}));
    const run={request:{id:crypto.randomUUID(),ownerId:workspaceOwnerId,mode:selectedBatchMode,stages:[...selectedBatchStages],keys,...(seoNoticeRequired&&currentSeoConfiguration?{seoGenerationConsent:structuredClone(currentSeoConfiguration)}:{})},products:chosen.map(product=>({...product}))};
    if(selectedSources.length){
      const company=sourceWorkspace.current?.company;
      if(!company||sourceWorkRef.current||addOpen||loading||!intakeDraft.ready||intakeDraft.loading||intakeDraft.saving){showToast('상품 목록과 카테고리 대기열을 불러온 뒤 다시 시작해주세요.');return;}
      const sources=selectedSources.map(reference=>sourceRegistrations.items.find(item=>sameSourceArchiveReference(reference,sourceArchiveReference(item,workspaceOwnerId,company))));
      if(sources.some(item=>!item||item.archivedAt)){showToast('선택한 수집본이 변경되었습니다. 현재 목록에서 다시 선택해주세요.');return;}
      if(new Set(sources.map(item=>item!.snapshot.sourceUrl)).size!==sources.length){showToast('같은 상품의 수집본은 하나만 선택해주세요.');return;}
      setIntakeGoal('collect');
      setSourceWork({scope:sourceReviewScope,ownerId:workspaceOwnerId,company:JSON.stringify(company),settingsEpoch:operation.epoch,request:run.request,sources:[...selectedSources],index:0,products:run.products,existingIds:new Set(products.map(product=>product.id)),phase:'next'});
      return;
    }
    batchRunRef.current=run;setBatchRun(run);changeBatchBusy(true);setBatchOpenError('');setBatchOpen(true);
  }
  function sourceWorkCurrent(plan:SourceWorkPlan){
    const operation=settingsOperationRef.current;
    return sourceWorkRef.current===plan&&plan.scope===sourceReviewScope&&operation.mounted&&operation.ownerId===plan.ownerId&&workspaceOwnerId===plan.ownerId&&!operation.saving&&operation.epoch===plan.settingsEpoch&&JSON.stringify(sourceWorkspace.current?.company)===plan.company
      &&plan.sources.every(reference=>sourceRegistrations.items.some(item=>!item.archivedAt&&sameSourceArchiveReference(reference,sourceArchiveReference(item,workspaceOwnerId,sourceWorkspace.current?.company))));
  }
  async function continueSourceWork(id:string,signal:AbortSignal){
    const plan=sourceWorkRef.current;
    if(!plan)return false;
    if(!sourceWorkCurrent(plan)||plan.phase!=='preparing')throw Error('회원·회사 또는 기본설정이 변경되었습니다. 수집 상품을 다시 선택해주세요.');
    const reference=plan.sources[plan.index];
    const {product}=await readJson<{product:Product}>('/api/products/'+encodeURIComponent(id),{cache:'no-store',signal});
    if(signal.aborted||!sourceWorkCurrent(plan))return true;
    if(product.id!==id||product.owner_id!==plan.ownerId||!sameSourceUrl(product.source_url,reference.sourceUrl)||plan.existingIds.has(id))throw Error('기존 상품은 자동 작업하지 않았습니다. 선택한 수집본으로 별도 초안을 작성해주세요.');
    setSourceWork({...plan,index:plan.index+1,products:[...plan.products,product],phase:plan.index+1===plan.sources.length?'ready':'next'});
    return true;
  }

  function openBatchReview(){const operation=settingsOperationRef.current;if(batchScopeRef.current!==batchScope||batchBusyRef.current||!operation.mounted||operation.ownerId!==workspaceOwnerId)return;batchRunRef.current=null;setBatchRun(null);setBatchOpenError('');setBatchOpen(true);}
  function chooseBatchStage(id:AutomationStageId,enabled:boolean){const operation=settingsOperationRef.current;if(batchScopeRef.current!==batchScope||batchBusyRef.current||!operation.mounted||operation.ownerId!==workspaceOwnerId)return;setSelectedBatchMode('selected');setSelectedBatchStages(current=>batchStages.filter(stage=>stage.id===id?enabled:current.includes(stage.id)).map(stage=>stage.id));}

  async function saveWorkspaceSettings(value: Settings, scope?:WorkspaceSettingsScope) {
    const operation=settingsOperationRef.current;
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId)throw Error('로그인 계정이 변경되었습니다. 기본설정을 다시 열어주세요.');
    if(batchBusyRef.current)throw Error('일괄 작업을 마친 뒤 기본설정을 저장해주세요. 입력은 유지했습니다.');
    if(operation.saving)throw Error('기본설정을 저장 중입니다. 저장 결과를 먼저 확인해주세요.');
    if(workspaceOwnerId&&scope?.ownerId!==workspaceOwnerId)throw Error('기본설정을 불러온 계정을 확인하지 못했습니다. 페이지를 새로고침해주세요.');
    setSeoConfigurationState(null);
    const settingsEpoch=++operation.epoch;operation.saving=true;
    try{
      const result = await readJson<{settings:Settings;scope?:unknown}>('/api/settings', {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...value,...(scope?{expectedOwnerId:scope.ownerId}:{})})});
      if(!operation.mounted||operation.ownerId!==workspaceOwnerId||operation.epoch!==settingsEpoch)throw Error('저장 중 로그인 계정이 변경되었습니다. 기본설정을 다시 열어주세요.');
      if(scope&&parseWorkspaceSettingsScope(result.scope)?.ownerId!==scope.ownerId)throw Error('저장한 기본설정의 계정을 확인하지 못했습니다. 페이지를 새로고침해주세요.');
      setSettings(result.settings);setSettingsOpen(false);showToast('기본 설정을 저장했습니다.');
    }finally{
      // Reads started while saving must also expire when the operation ends.
      if(operation.mounted&&operation.ownerId===workspaceOwnerId&&operation.epoch===settingsEpoch){operation.saving=false;operation.epoch++;}
    }
  }

  function startSettingsReload() {
    const operation=settingsOperationRef.current;
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId)throw Error('로그인 계정이 변경되었습니다. 상품 대기열을 다시 열어주세요.');
    if(operation.saving)throw Error('기본설정을 저장 중입니다. 저장 결과를 먼저 확인해주세요.');
    setSeoConfigurationState(null);
    return ++operation.epoch;
  }
  function applyReloadedSettings(value:Settings,scope?:WorkspaceSettingsScope,epoch?:number) {
    const operation=settingsOperationRef.current,parsedScope=parseWorkspaceSettingsScope(scope);
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId||operation.saving||epoch!==operation.epoch
      ||workspaceOwnerId&&parsedScope?.ownerId!==workspaceOwnerId||scope!==undefined&&!parsedScope)
      throw Error('계정 또는 기본설정 저장 작업이 변경되었습니다. 최신 기본설정을 다시 불러와주세요.');
    operation.epoch++;setSettings(value);setSeoConfigurationReload(current=>current+1);
  }

  async function removeWorkspaceProduct(product:Product){
    if(!productRemovalMounted.current)throw Error('상품 목록을 다시 불러온 뒤 삭제해주세요.');
    if(removalBusy.current||busyRef.current||batchBusyRef.current||settingsBusyRef.current)throw Error('진행 중인 작업을 마친 뒤 삭제해주세요.');
    const decision=productRemovalDecision(product);if(decision.blocked)throw Error(decision.reason);
    const controller=new AbortController();productRemovalRequest.current=controller;
    removalBusy.current=true;
    try{
      const endpoint=`/api/products/${encodeURIComponent(product.id)}`;
      const latest=await readJson<{product?:Product}>(endpoint,{cache:'no-store',signal:controller.signal});
      if(controller.signal.aborted)return;
      if(!latest.product||latest.product.id!==product.id||(workspaceOwnerId&&latest.product.owner_id!==workspaceOwnerId))throw Error('현재 계정의 상품을 확인하지 못했습니다. 상품 목록을 다시 불러와주세요.');
      const currentDecision=productRemovalDecision(latest.product);if(currentDecision.blocked)throw Error(currentDecision.reason);
      if(latest.product.updated_at!==product.updated_at)throw Error('상품이 변경되었습니다. 상품 목록을 다시 불러온 뒤 삭제해주세요.');
      const result=await readJson<{productId:string;removed:boolean}>(endpoint,{method:'DELETE',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:product.updated_at})});
      if(controller.signal.aborted)return;
      if(result.productId!==product.id||result.removed!==true)throw Error('삭제 결과를 확인하지 못했습니다. 상품 목록을 다시 불러와주세요.');
      setProducts(current=>current.filter(row=>row.id!==product.id));setSelected(current=>new Set([...current].filter(id=>id!==product.id)));
      setDetail(current=>current?.id===product.id?null:current);showToast('상품을 삭제했습니다. 삭제된 상품에서 복원할 수 있습니다.');
    }finally{if(productRemovalRequest.current===controller){productRemovalRequest.current=null;removalBusy.current=false;}}
  }

  async function attachUploadedImage(productId:string,key:string) {
    for(let attempt=0;attempt<3;attempt++) {
      const [current,data]=await Promise.all([readJson<{product:Product}>(`/api/products/${productId}`),readJson<{content:ProductContent}>(`/api/products/${productId}/content`)]);
      if((JSON.parse(current.product.image_keys) as string[]).includes(key)){await loadWorkspace();return;}
      const response=await fetch(`/api/products/${productId}/attachments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,role:null,expectedVersion:current.product.updated_at,expectedContentRevision:data.content.revision})});
      const result=await response.json() as {error?:string};
      if(response.ok){await loadWorkspace();return;}
      if(response.status!==409||attempt===2)throw new Error(result.error||'이미지 연결을 저장하지 못했습니다.');
    }
  }
  async function retryUploadedImage() {
    if(!pendingUpload||busy)return;setBusy(true);
    try{await attachUploadedImage(pendingUpload.productId,pendingUpload.key);setPendingUpload(null);showToast('보관된 업로드 이미지를 연결했습니다.');}
    catch(error){showToast(error instanceof Error?error.message:'이미지 연결 실패');}finally{setBusy(false);}
  }
  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    if (!detail || busy || !event.target.files?.[0]) return;
    const productId=detail.id;const form = new FormData(); form.append('file', event.target.files[0]); setBusy(true);
    try {
      const response = await fetch('/api/files', { method:'POST', body:form }); const result = await response.json() as { key: string; error?: string };
      if (!response.ok) throw new Error(result.error);
      setPendingUpload({productId,key:result.key});
      await attachUploadedImage(productId,result.key);setPendingUpload(null);
      showToast('이미지를 추가했습니다. 대표·추가·상세 이미지 단계에서 역할을 지정하세요.');
    } catch (error) { showToast(error instanceof Error ? error.message : '업로드하지 못했습니다.'); }
    finally { setBusy(false); event.target.value=''; }
  }

  const sourceWorkspaceSnapshot=sourceWorkspace.current;
  function openCategoryFirstIntake(){
    const operation=settingsOperationRef.current;
    if(batchScopeRef.current!==batchScope||batchBusyRef.current||addOpen||!operation.mounted||operation.ownerId!==workspaceOwnerId)return;
    setIntakeSourceSeed(undefined);setIntakeCategoryEntry({id:crypto.randomUUID(),ownerId:workspaceOwnerId});setView('work');setCollectionQueueOpen(true);setAddOpen(true);
  }
  const sourceArchiveRequest=useRef<AbortController|null>(null);
  const sourceArchiveDisabled=loading||busy||batchBusy||addOpen||settingsBusy||intakeDraft.loading||intakeDraft.saving;
  const sourceArchiveLive=useRef({ownerId:workspaceOwnerId,scope:sourceReviewScope,items:sourceRegistrations.items,disabled:sourceArchiveDisabled});
  useLayoutEffect(()=>{sourceArchiveLive.current={ownerId:workspaceOwnerId,scope:sourceReviewScope,items:sourceRegistrations.items,disabled:sourceArchiveDisabled};});
  useEffect(()=>()=>{sourceArchiveRequest.current?.abort();sourceArchiveRequest.current=null;},[sourceReviewScope]);
  function prepareSource(item:SourceInboxItem,continuing=false){
    const operation=settingsOperationRef.current,availability=sourceWorkspace.current;
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId||availability!==sourceWorkspaceSnapshot||availability?.scope!==sourceReviewScope)return false;
    if(!continuing)setSourceWork(null);
    try{
      if(item.ownerId!==workspaceOwnerId||!availability.ready||loading||busy||batchBusyRef.current||addOpen&&!continuing||intakeDraft.loading||!intakeDraft.ready||intakeDraft.saving||settingsBusyRef.current)throw Error('현재 상품 목록과 대기열을 확인한 뒤 다시 추가해주세요.');
      if(!availability.company||item.company.code!==availability.company.code||item.company.name!==availability.company.name)throw Error('수집 당시 회사와 현재 로그인 계정의 승인 회사가 다릅니다. 현재 회사의 수집본을 선택해주세요.');
      const existingProducts=products.filter(product=>sameSourceUrl(product.source_url,item.snapshot.sourceUrl));
      const existingIds=new Set(existingProducts.map(product=>product.id));
      const forkJob=collectionJobs.filter(job=>job.product_id&&existingIds.has(job.product_id)&&sameSourceUrl(job.source_url,item.snapshot.sourceUrl)&&job.status!=='cancelled')
        .sort((left,right)=>right.created_at.localeCompare(left.created_at)||right.id.localeCompare(left.id))[0];
      if(existingProducts.length&&!forkJob)throw Error('기존 상품의 원문 연결을 확인하지 못했습니다. 기존 작업 상품은 변경하지 않았습니다.');
      const sourceCapture=sourceCaptureSelection(item);
      setSourceNotice('');
      const sameUrlRows=intakeRows.filter(row=>row.status!=='saved'&&sameSourceUrl(row.url,item.snapshot.sourceUrl));
      const queued=sameUrlRows.find(row=>sameSourceCaptureSelection(row.sourceCapture,sourceCapture));
      if(queued){if(queued.forkJobId!==forkJob?.id)throw Error('대기열에 선택한 수집본의 다른 요청 연결이 있습니다. 기존 행과 원래 요청의 결과를 확인해주세요.');setIntakeCategoryEntry(undefined);if(continuing)setIntakeSourceSeed({id:crypto.randomUUID(),sourceUrl:item.snapshot.sourceUrl,title:sourceInboxDisplayTitle(item),sourceCapture,targetRowId:queued.id,...(forkJob?{forkJobId:forkJob.id}:{})});setView('work');setAddOpen(true);return true;}
      // A different immutable capture may review its own fork without editing
      // the existing URL rows. Normal enqueue deduplication stays unchanged.
      if(sameUrlRows.length&&forkJob?.status!=='awaiting_connector')throw Error('대기열에 같은 상품의 다른 수집본이나 URL 입력이 있습니다. 기존 행을 확인한 뒤 사용할 수집본을 다시 추가해주세요.');
      if(intakeRows.length>=50)throw Error('상품 대기열은 최대 50행입니다. 기존 입력은 유지했습니다.');
      setIntakeCategoryEntry(undefined);setIntakeSourceSeed({id:crypto.randomUUID(),sourceUrl:item.snapshot.sourceUrl,title:sourceInboxDisplayTitle(item),sourceCapture,...(forkJob?{forkJobId:forkJob.id}:{})});setView('work');setAddOpen(true);
      return true;
    }catch(error){setSourceNotice(error instanceof Error?error.message:'상품 추가 실패');return false;}
  }
  // The continuation owns its ref; each render only advances a new phase once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(()=>{
    const plan=sourceWorkRef.current;
    if(!plan||plan!==sourceWork||busy||batchBusy)return;
    if(!sourceWorkCurrent(plan)){setSourceWork(null);setSourceNotice('회원·회사 또는 기본설정이 변경되어 자동 작업 연결을 중단했습니다. 저장한 초안은 유지됩니다.');return;}
    if(plan.phase==='ready'){
      const run={request:plan.request,products:plan.products};
      setSourceWork(null);setIntakeSourceSeed(undefined);setAddOpen(false);setSelected(new Set(run.products.map(product=>product.id)));
      batchRunRef.current=run;setBatchRun(run);changeBatchBusy(true);setBatchOpenError('');setBatchOpen(true);return;
    }
    if(plan.phase!=='next')return;
    const reference=plan.sources[plan.index],company=sourceWorkspace.current?.company;
    const item=sourceRegistrations.items.find(candidate=>sameSourceArchiveReference(reference,sourceArchiveReference(candidate,workspaceOwnerId,company)));
    if(!item||item.archivedAt){setSourceWork(null);setSourceNotice('선택한 수집본이 변경되었습니다. 현재 목록에서 다시 선택해주세요.');return;}
    setSourceWork({...plan,phase:'preparing'});
    if(!prepareSource(item,true))setSourceWork(null);
  });
  function prepareQuerySource(item:QuerySourceCaptureSummary){
    const operation=settingsOperationRef.current,availability=sourceWorkspace.current;
    if(!operation.mounted||operation.ownerId!==workspaceOwnerId||availability!==sourceWorkspaceSnapshot||availability?.scope!==sourceReviewScope)return;
    try{
      if(item.ownerId!==workspaceOwnerId||!availability.ready||loading||busy||batchBusyRef.current||addOpen||intakeDraft.loading||!intakeDraft.ready||intakeDraft.saving||settingsBusyRef.current)throw Error('현재 상품 목록과 대기열을 확인한 뒤 다시 추가해주세요.');
      if(!availability.company||item.company.code!==availability.company.code||item.company.name!==availability.company.name)throw Error('수집 당시 회사와 현재 로그인 계정의 승인 회사가 다릅니다. 현재 회사의 수집본을 선택해주세요.');
      if(item.archivedAt!==null||products.some(product=>sameSourceUrl(product.source_url,item.sourceUrl)))throw Error('이미 작업 중이거나 사용할 수 없는 수집본입니다. 기존 작업 상품은 변경하지 않았습니다.');
      const sourceCapture=querySourceCaptureSelection(item),queued=intakeRows.find(row=>sameSourceUrl(row.url,item.sourceUrl));
      if(queued){if(!sameSourceCaptureSelection(queued.sourceCapture,sourceCapture))throw Error('대기열에 같은 상품의 다른 수집본이나 URL 입력이 있습니다. 기존 행을 확인한 뒤 사용할 수집본을 다시 추가해주세요.');setSourceNotice('');setIntakeCategoryEntry(undefined);setView('work');setAddOpen(true);return;}
      if(intakeRows.length>=50)throw Error('상품 대기열은 최대 50행입니다. 기존 입력은 유지했습니다.');
      setSourceNotice('');setIntakeCategoryEntry(undefined);setIntakeSourceSeed({id:crypto.randomUUID(),sourceUrl:item.sourceUrl,title:item.title,sourceCapture});setView('work');setAddOpen(true);
    }catch(error){setSourceNotice(error instanceof Error?error.message:'상품 추가 실패');}
  }
  async function archiveSource(item:SourceInboxItem){
    const company=sourceWorkspace.current?.company,reference=sourceArchiveReference(item,workspaceOwnerId,company);
    if(!workspaceOwnerId||!company||!reference||sourceArchiveRequest.current)throw Error('현재 회원·회사에서 선택한 수집 상품을 다시 확인해주세요.');
    const assertCurrent=()=>{
      const live=sourceArchiveLive.current,operation=settingsOperationRef.current,currentCompany=sourceWorkspace.current?.company;
      const current=live.items.find(value=>value.id===item.id);
      if(!operation.mounted||operation.ownerId!==workspaceOwnerId||live.ownerId!==workspaceOwnerId||live.scope!==sourceReviewScope||live.disabled
        ||!current||!currentCompany||currentCompany.code!==company.code||currentCompany.name!==company.name
        ||!sameSourceArchiveReference(reference,sourceArchiveReference(current,workspaceOwnerId,currentCompany)))throw Error('회원·회사 또는 선택한 수집본이 변경되었습니다. 목록을 다시 불러와 확인해주세요.');
    };
    assertCurrent();const controller=new AbortController();sourceArchiveRequest.current=controller;
    try{
      const receipt=await archiveSourceInboxItem(item,{ownerId:workspaceOwnerId,company,signal:controller.signal,assertCurrent});
      if(!sourceRegistrations.acceptArchived(item,receipt))throw Error('삭제 결과의 현재 수집본 연결을 확인하지 못했습니다. 목록을 다시 불러와 확인해주세요.');
      sourceRegistrations.reload();
    }finally{if(sourceArchiveRequest.current===controller)sourceArchiveRequest.current=null;}
  }
  function reviewSource(item:SourceInboxItem,returnToIntake=false,rowId?:string){
    if(item.ownerId!==workspaceOwnerId||busy||batchBusyRef.current)return;
    const selected=sourceCaptureSelection(item);
    const targets=returnToIntake?intakeRows.flatMap(row=>{
      const capture=row.sourceCapture;
      if(rowId!==undefined&&row.id!==rowId||row.status==='saved'||row.productId||row.forkJobId||row.pendingJobId||!capture)return [];
      return capture.captureId===selected.captureId&&capture.fingerprint===selected.fingerprint&&capture.sourceUrl===selected.sourceUrl&&capture.revision<=selected.revision?[{rowId:row.id,sourceCapture:capture}]:[];
    }):[];
    const session={scope:sourceReviewScope,item,returnToIntake,targets};sourceReviewSession.current=session;setSourceReview(session);if(returnToIntake)setAddOpen(false);
  }
  function acceptSourceReview(session:SourceReviewSession,saved:SourceInboxItem,before:SourceInboxItem){
    const operation=settingsOperationRef.current;
    if(sourceReviewSession.current!==session||!operation.mounted||operation.ownerId!==workspaceOwnerId||before.ownerId!==workspaceOwnerId
      ||!sameSourceCaptureSelection(sourceCaptureSelection(session.item),sourceCaptureSelection(before))||!validateReviewedSourceTransition(before,saved,workspaceOwnerId))return;
    if(!sourceRegistrations.acceptReviewed(before,saved))return;
    let targets:SourceReviewSession['targets']=[];
    if(session.returnToIntake)setIntakeRows(rows=>{
      const updatedRows=applyReviewedSourceToIntakeRows(rows,session.targets,before,saved);
      // useIntakeDraft invokes this updater synchronously with its current rows.
      // Only rows that adopted this ACK stay attached to later review saves.
      targets=session.targets.flatMap(target=>{
        const previous=rows.find(row=>row.id===target.rowId),updated=updatedRows.find(row=>row.id===target.rowId);
        return previous&&updated&&previous!==updated?[{rowId:target.rowId,sourceCapture:sourceCaptureSelection(saved)}]:[];
      });
      return updatedRows;
    });
    const updated={...session,item:saved,targets};
    sourceReviewSession.current=updated;setSourceReview(updated);
  }
  function closeSourceReview(session:SourceReviewSession){
    const operation=settingsOperationRef.current;
    if(sourceReviewSession.current!==session||session.scope!==sourceReviewScope||!operation.mounted||operation.ownerId!==workspaceOwnerId)return false;
    sourceReviewSession.current=null;setSourceReview(null);sourceRegistrations.reload();if(session.returnToIntake)setAddOpen(true);return true;
  }
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">Y</span><span>YOOFAM 스튜디오</span></div>
        <nav aria-label="주 메뉴"><p className="nav-caption">로켓배송</p>
          <button className={`nav-item ${view==='work'?'active':''}`} onClick={()=>changeView('work')}><span>✦</span>AI 상품등록</button>
          <button className={`nav-item ${view==='archive'?'active':''}`} onClick={()=>changeView('archive')}><span>▦</span>상품관리(신규)</button>
          <a className="nav-item" href="/operations" aria-label="상품소싱·판매관리·손익계산 운영관리" aria-disabled={busy||batchBusy||!!sourceWork} onClick={guardOperationsNavigation}><span aria-hidden="true">▥</span>운영관리</a>
        </nav>
        <div className="sidebar-status"><div><strong>YOOFAM 스튜디오</strong><small>로켓배송 상품 등록 · 관리</small></div></div>
      </aside>

      <section className="content">
        <header className="topbar"><div><h1>{view==='work'?'로켓배송 AI상품등록':'로켓배송 상품관리(신규)'}</h1><p>{view==='work'?'상품별 등록 현황 및 관리':'등록 상품 · SKU · 가격 · 구매정보'}</p></div>
          <div className="topbar-tools"><nav className="workspace-utilities" aria-label="계정 및 연결 도구">
            <button type="button" className="workspace-utility utility-integrations" data-state={utilityConnectionState} aria-label={'연동 설정 · '+utilityConnectionLabel} title={utilityConnectionLabel} aria-haspopup="dialog" aria-expanded={connectionsOpen} disabled={checkingConnections} onClick={()=>void checkConnections()}><span aria-hidden="true">⌁</span>연동 설정<span className="utility-status-dot" aria-hidden="true"/></button>
            <button type="button" className="workspace-utility utility-history" aria-label="작업 이력" aria-haspopup="dialog" aria-expanded={historyOpen} onClick={()=>{setHistoryProductId(detail?.id??products[0]?.id??'');setHistoryOpen(true);}}><span aria-hidden="true">↻</span>작업 이력</button>
            <button type="button" className="workspace-utility utility-cli" aria-label="CLI 설치·연결" aria-haspopup="dialog" aria-expanded={cliInstallOpen} onClick={()=>setCliInstallOpen(true)}><span aria-hidden="true">⌘</span>CLI 설치·연결</button>
            <a className="workspace-utility utility-operations" href="/operations" aria-disabled={busy||batchBusy||!!sourceWork} onClick={guardOperationsNavigation}><span aria-hidden="true">▥</span>운영관리</a>
            <a className="workspace-utility utility-account" href="/account" aria-label={userName+' 계정 관리'}>{userName} · 계정 관리</a>
          </nav><div className="top-actions">{view==='work'&&<><button type="button" className="btn settings" aria-expanded={settingsOpen} aria-controls="workspace-settings-panel" disabled={settingsBusy||batchBusy} onClick={()=>{if(!settingsBusyRef.current&&!batchBusyRef.current)setSettingsOpen(open=>!open);}}>⚙ 기본설정</button><button className="btn primary" disabled={batchBusy} onClick={openCategoryFirstIntake}>＋ 상품 추가</button>
          <details className="bulk-action-menu" data-dismissable-menu><summary className="btn ghost">{selectedBatchMode==='full'?'전체 작업':'부분 작업 ('+selectedBatchStages.length+')'} ▾</summary><div><fieldset disabled={batchBusy} aria-label="실행할 작업 선택"><legend>실행할 작업</legend><label><input type="checkbox" aria-label="전체 작업" checked={selectedBatchMode==='full'} onChange={event=>{if(!batchBusyRef.current){setSelectedBatchMode(event.target.checked?'full':'selected');setSelectedBatchStages(event.target.checked?batchStages.map(stage=>stage.id):[]);}}}/> 전체 작업</label>{batchStages.map(stage=><label key={stage.id} style={{display:'flex',gap:8,padding:'6px 0'}}><input type="checkbox" aria-label={stage.label+' 작업'} checked={selectedBatchStages.includes(stage.id)} onChange={event=>chooseBatchStage(stage.id,event.target.checked)}/>{stage.label}</label>)}</fieldset></div></details>
          <details className="bulk-action-menu" data-dismissable-menu><summary className="btn ghost">상품 선택 ▾</summary><div><button type="button" disabled={batchBusy} onClick={()=>{if(!batchBusyRef.current)setSelected(new Set(products.map(product=>product.id)));}}>최근 상품 전체 선택</button><button type="button" disabled={batchBusy} onClick={()=>{if(!batchBusyRef.current)setSelected(new Set());}}>선택 해제</button><button type="button" disabled={batchBusy} onClick={openBatchReview}>선택 상품 일괄 작업</button><button type="button" onClick={()=>{setHistoryProductId(products[0]?.id??'');setHistoryOpen(true);}}>작업 이력</button></div></details><button className="btn start" disabled={busy||batchBusy||!!sourceWork||!selectedBatchStages.length} onClick={runAutomation}>작업 개시</button><button className="btn rose" disabled={batchBusy} onClick={()=>openSubmission(null)}>등록 전송</button></>}</div></div></header>

        {cliInstallOpen&&<CliInstallDialog onClose={()=>setCliInstallOpen(false)}/>}
        {settingsOpen&&<section id="workspace-settings-panel" className="workspace-settings-panel" aria-labelledby="workspace-settings-heading"><header><h2 id="workspace-settings-heading">기본 등록 정보 설정</h2></header>{batchBusy&&<p role="status">일괄 작업 중에는 기본설정 입력과 저장을 잠시 멈춥니다. 작성한 입력은 유지됩니다.</p>}<fieldset aria-label="기본설정 편집" disabled={batchBusy} style={{border:0,padding:0,margin:0,minWidth:0}}><WorkspaceSettingsDialog workspaceOwnerId={workspaceOwnerId} onSave={saveWorkspaceSettings} onClose={()=>{if(!settingsBusyRef.current&&!batchBusyRef.current)setSettingsOpen(false);}} onBusy={changeSettingsBusy}/></fieldset></section>}

        {loadError&&<div className="panel-note" role="alert"><p>{loadError}</p><button className="btn ghost" onClick={()=>{setLoading(true);setLoadError('');void loadWorkspace();}} disabled={loading}>다시 불러오기</button></div>}
        {pendingUpload&&<div className="panel-note" role="status"><div><strong>업로드 파일 연결 대기</strong><p>파일은 보관돼 있습니다. 상품에 연결하기를 다시 시도할 수 있습니다.</p></div><button className="btn ghost" disabled={busy} onClick={()=>void retryUploadedImage()}>보관된 이미지 연결 재시도</button></div>}


        {view==='archive'?<><ProductManagementWorkspace/><details className="collection-panel"><summary>YOOFAM 스튜디오 작업 상품 보관함</summary><ProductArchive onOpenProduct={openArchivedProduct} refreshToken={`${collectionJobs[0]?.updated_at}:${products[0]?.updated_at}`}/></details></>:<>
        {(sourceNotice||sourceRegistrations.error)&&<p role="status" className="panel-note">{sourceNotice||sourceRegistrations.error}</p>}
        <RegistrationBoard products={products} sources={sourceRegistrations.items} sourceOwnerId={workspaceOwnerId} sourceCompany={querySourceCompany.scope===sourceReviewScope?querySourceCompany.company:null} sourceArchiveDisabled={sourceArchiveDisabled} onPrepareSource={item=>prepareSource(item)} onSourceSelectionChange={sourceSelectionChanged} onReviewSource={item=>reviewSource(item)} onArchiveSource={archiveSource} selected={selected} onSelected={setSelected} onOpen={openProduct} onOptions={openOptionBoard} onDelete={removeWorkspaceProduct} loading={loading} error={loadError} onArchive={()=>changeView('archive')}/>
        <button type="button" className="btn ghost" onClick={()=>setRemovedOpen(true)}>삭제된 상품</button>
        <div id="captured-source-inbox"><SourceInboxPanel key={workspaceOwnerId??'anonymous'} ownerId={workspaceOwnerId} existingProducts={products} disabled={busy||batchBusy||addOpen||intakeDraft.loading||!intakeDraft.ready||intakeDraft.saving} onChanged={sourceRegistrations.reload} onAdd={prepareSource}/></div>
        <details className="collection-panel"><summary>1688 URL로 원문 먼저 담기 · 서버 수집</summary><QuerySourcePanel key={`server-query-${workspaceOwnerId??'anonymous'}`} ownerId={workspaceOwnerId} company={querySourceCompany.scope===sourceReviewScope?querySourceCompany.company:null} disabled={loading||busy||batchBusy||addOpen||settingsBusy||intakeDraft.loading||!intakeDraft.ready||intakeDraft.saving} onAdd={prepareQuerySource}/></details>
        <details className="collection-panel" aria-label="수집 대기열" open={collectionQueueOpen} onToggle={event=>setCollectionQueueOpen(event.currentTarget.open)}><summary>상품 대기열 · {collectionJobs.filter(job=>job.status!=='cancelled').length}건</summary>
          <CollectionBatchPanel jobs={collectionJobs} onSaved={()=>void loadWorkspace()} onOpenProduct={openCollectedProduct}/>
          <div className="collection-heading"><div><h2>수집 대기열 <span>{collectionJobs.filter(job => job.status !== 'cancelled').length}</span></h2><p>{collectionBlock}</p></div><button className="btn ghost" disabled={loading || busy} onClick={()=>{setLoading(true);void loadWorkspace();}}>새로고침</button></div>
          <label className="collection-history"><input type="checkbox" checked={showCancelled} onChange={event=>setShowCancelled(event.target.checked)} />취소한 요청 보기 · 최근 200건</label>
          {!collectionJobs.some(job=>showCancelled || job.status !== 'cancelled') && <p className="collection-empty">{loading ? '대기열을 불러오는 중입니다.' : loadError ? '대기열 조회 상태를 확인해주세요.' : '아직 수집 요청이 없습니다. 상품 추가에서 URL을 붙여넣으세요.'}</p>}
          <ul className="collection-list">{collectionJobs.filter(job=>showCancelled || job.status !== 'cancelled').map(job=><li key={job.id}><div><strong>1688 · {job.offer_id}</strong><a href={job.source_url} target="_blank" rel="noreferrer" style={{overflowWrap:"anywhere"}}>{job.source_url}</a><small>{job.context?.category.categoryPath.join(' > ') ?? '카테고리 미지정 · 기존 요청'}</small><small>목표: {goalOptions.find(goal=>goal.id===job.goal)?.title} · 요청 {new Date(job.created_at).toLocaleString('ko-KR')}</small>{job.received_at&&<small>원문 수신 {new Date(job.received_at).toLocaleString('ko-KR')}</small>}</div><span className={`collection-status ${collectionJobProgress(job).kind}`}>{collectionJobProgress(job).label}</span><CollectionResultPanel jobId={job.id} offerId={job.offer_id} productId={job.product_id} onSaved={()=>void loadWorkspace()} onOpenProduct={openCollectedProduct}/>{!job.product_id && job.status !== 'cancelled' && <button className="btn ghost" disabled={busy} aria-label={`${job.offer_id} 수집 취소`} onClick={()=>void cancelCollectionJob(job.id)}>취소</button>}</li>)}</ul>
        </details>

        <HistoricalAiRegistrationsPanel onReuseUrl={(target,signal)=>{
          if(signal.aborted)return;
          if(busy||batchBusyRef.current||addOpen||intakeDraft.loading||!intakeDraft.ready||intakeDraft.saving||settingsBusyRef.current)throw Error('현재 상품 대기열 작업을 마친 뒤 다시 추가해주세요. 보관된 원본은 유지됩니다.');
          if(intakeRows.length>=50)throw Error('상품 대기열은 최대 50행입니다. 기존 입력을 정리한 뒤 다시 추가해주세요.');
          setIntakeSourceSeed({id:crypto.randomUUID(),sourceUrl:target.sourceUrl});setView('work');setAddOpen(true);
        }}/></>}
      </section>

      {removedOpen&&<Modal title="삭제된 상품" subtitle="저장한 이미지와 편집 내용을 복원합니다." onClose={()=>{if(!removalBusy.current)setRemovedOpen(false);}}><ProductRemovalDialog workspaceOwnerId={workspaceOwnerId} onRestored={loadWorkspace} onBusyChange={changeRemovalBusy}/></Modal>}

      {sourceReview&&sourceReview.item.ownerId===workspaceOwnerId&&<Modal wide title="수집 상품정보 확인·수정" subtitle="현재 수집한 상품만 검토합니다." onClose={()=>{closeSourceReview(sourceReview);}}><SourceInboxPanel key={sourceReview.item.id} ownerId={workspaceOwnerId} disabled={false} initialItem={sourceReview.item} onChanged={sourceRegistrations.reload} onReviewed={(saved,before)=>acceptSourceReview(sourceReview,saved,before)} onAdd={item=>{if(!closeSourceReview(sourceReview))return;if(!sourceReview.returnToIntake)prepareSource(item);}}/></Modal>}
      {addOpen&&<Modal wide title="상품 대기열" subtitle={intakeSourceSeed?'선택한 수집본 → 추천 카테고리 확인 → 상품 대기열. 시작 버튼에서 고른 작업을 진행합니다.':'카테고리 선택 → 1688 URL 입력 → 상품 대기열. 시작 버튼에서 고른 작업을 진행합니다.'} onClose={()=>{if(!busy&&!intakeDraft.loading){setSourceWork(null);setIntakeSourceSeed(undefined);setIntakeCategoryEntry(undefined);setAddOpen(false);}}}>
        <div className="intake-draft-actions"><p role="status">{intakeDraft.message}{intakeDraft.dirty?' · 저장하지 않은 변경 있음':''}</p><button type="button" className="btn ghost" disabled={busy||intakeDraft.saving||!intakeDraft.ready} onClick={()=>void intakeDraft.save()}>{intakeDraft.autoPaused?'저장 다시 시도':intakeDraft.saving?'저장 중…':'지금 저장'}</button><button type="button" className="btn ghost" disabled={busy||intakeDraft.saving} onClick={()=>{if(!intakeDraft.dirty||window.confirm('현재 미저장 입력을 서버 초안으로 교체할까요?'))void intakeDraft.load();}}>{intakeDraft.ready?'서버 초안으로 교체':'초안 다시 불러오기'}</button></div>
        {intakeDraft.ready&&!intakeDraft.loading&&<IntakeQueuePanel onSourceCancelled={()=>setSourceWork(null)} autoStartSource={!!sourceWork&&sourceWork.ownerId===workspaceOwnerId} workspaceOwnerId={workspaceOwnerId} sourceSeed={intakeSourceSeed} initialCategorySelection={intakeCategoryEntry} onInitialCategorySelectionConsumed={id=>setIntakeCategoryEntry(current=>current?.id===id&&current.ownerId===workspaceOwnerId?undefined:current)} sourceItems={sourceRegistrations.items} onReviewSource={(item,rowId)=>reviewSource(item,true,rowId)} onSourceConsumed={id=>setIntakeSourceSeed(current=>current?.id===id?undefined:current)} jobs={collectionJobs} onOpenProduct={async(id,signal)=>{if(await continueSourceWork(id,signal))return;await openCollectedProduct(id,'SEO',signal);if(!signal.aborted)setAddOpen(false);}} settings={settings} onSettingsReloadStarted={startSettingsReload} onSettingsReloaded={applyReloadedSettings} goal={intakeGoal} onGoal={setIntakeGoal} rows={intakeRows} onRows={setIntakeRows} profiles={categoryProfiles} onBusy={setBusy}
          onProfile={profile=>setCategoryProfiles(current=>[profile,...current.filter(item=>item.id!==profile.id)])}
          onJobs={jobs=>{setCollectionJobs(current=>[...jobs,...current.filter(job=>!jobs.some(saved=>saved.id===job.id))]);if(jobs.some(job=>job.product_id))void loadWorkspace();}}
          onAdvanced={seed=>{setEditingCategory(seed?.profileId?categoryProfiles.find(profile=>profile.id===seed.profileId)??null:null);setCategorySeed(seed?{name:seed.categoryPath.at(-1)??'',categoryId:seed.categoryId,categoryPath:seed.categoryPath,template:null,mappings:[]}:undefined);setAddOpen(false);setCategoryOpen(true);}}/>}
      </Modal>}
      {categoryOpen&&<Modal wide title="카테고리·견적서 연결" subtitle="상품 자료를 견적서 열에 연결하고 카테고리별 설정을 보관합니다." onClose={()=>setCategoryOpen(false)}><CategoryProfileEditor value={editingCategory} initialDraft={categorySeed} onClose={()=>setCategoryOpen(false)} onSave={profile=>{setCategoryProfiles(current=>[profile,...current.filter(item=>item.id!==profile.id)]);setCategoryOpen(false);setAddOpen(true);}}/></Modal>}

      {batchOpen&&(!batchRun||batchRun.request.ownerId===workspaceOwnerId)&&<Modal wide title={batchRun?'선택 작업 진행':'선택 상품 일괄 작업'} subtitle={batchRun?'선택한 단계의 초안을 만들고 저장·검토 상태를 확인합니다.':'저장한 상품을 순서대로 처리하고 각 결과를 기록합니다.'} onClose={()=>{const operation=settingsOperationRef.current;if(operation.mounted&&operation.ownerId===workspaceOwnerId&&batchRunRef.current===batchRun)closeBatch();}}>
        {batchOpenError&&<p role="alert">{batchOpenError}</p>}
        {batchSeoNoticeRequired&&<details aria-label="SEO 실행 전 안내"><summary>SEO 실행 안내</summary>
          {batchSeoConfiguration?<BatchAiNotice configuration={batchSeoConfiguration}/>:<p role="status">{seoConfigurationError||'현재 계정·회사의 SEO 실행 안내를 확인하는 중입니다. 안내 확인 전에는 SEO 작업을 시작하지 않습니다.'}</p>}
          <button type="button" className="btn ghost" disabled={batchBusy||settingsBusy} onClick={()=>{if(batchScopeRef.current===batchScope&&!batchBusyRef.current&&!settingsBusyRef.current)setSeoConfigurationReload(value=>value+1);}}>SEO 실행 안내 다시 확인</button>
        </details>}
        <BatchWorkPanel key={batchRun?.request.id??'review'} products={batchRun?.products??products.filter(product=>selected.has(product.id))} runRequest={batchRun?.request} onOpen={(id,step)=>{if(batchRunRef.current===batchRun)void openBatchProduct(id,step);}} onBusyChange={value=>{const operation=settingsOperationRef.current;if(operation.mounted&&operation.ownerId===workspaceOwnerId&&batchRunRef.current===batchRun){const finished=batchBusyRef.current&&!value;changeBatchBusy(value);if(finished&&batchRun)void loadWorkspace();}}}/>
      </Modal>}
      {historyOpen&&<Modal wide title="상품별 작업 이력" subtitle="각 상품에 저장된 단계별 산출물과 실행 이력을 확인합니다." onClose={()=>setHistoryOpen(false)}><div className="modal-form"><label>상품 선택<select aria-label="작업 이력 상품 선택" value={historyProductId} onChange={event=>setHistoryProductId(event.target.value)}>{!products.length&&<option value="">저장된 상품 없음</option>}{products.map(product=><option key={product.id} value={product.id}>{product.title}</option>)}</select></label>{products.filter(product=>product.id===historyProductId).map(product=><AutomationPanel key={product.id} productId={product.id} version={product.updated_at}/>)}</div><PreservedProductRequestInspector ownerId={workspaceOwnerId}/></Modal>}

      {detail&&(!workspaceOwnerId||detail.owner_id===workspaceOwnerId)&&<div className="drawer-backdrop" onMouseDown={()=>closeWorkspace()}><aside className="detail-drawer registration-workspace" role="dialog" aria-modal="true" aria-label="상품 등록 작업 공간" onMouseDown={e=>e.stopPropagation()}>
        <header><div className="detail-heading"><h2>상품 등록 진행: {registrationTitle(detail)}</h2></div><details className="registration-context-menu" data-dismissable-menu><summary aria-label="상품 등록 추가 메뉴">⋯</summary><div className="registration-context-popover"><details className="registration-source-context"><summary>카테고리 · 수집 자료</summary><div className="detail-product-meta"><span>{registrationNumber(detail)}</span><time dateTime={detail.created_at}>등록 {registrationDate(detail.created_at)}</time><span>{detail.options_count}개 옵션</span></div><div className="detail-source"><span>1688 원본 URL</span>{sourceLink(detail.source_url)?<a href={sourceLink(detail.source_url)} target="_blank" rel="noopener noreferrer">{detail.source_url}</a>:<span className="detail-source-value">{detail.source_url||'원본 URL 미입력'}</span>}</div><ProductSourceContext key={detail.id} productId={detail.id} productVersion={detail.updated_at} sourceUrl={detail.source_url} step={tab} onNavigate={selectDetailTab} onSaved={loadWorkspace} onBusy={changeSourceSupplementBusy} onBeforeSupplement={()=>{const state=workspaceEditState(detailBody.current);if(state.dirty||state.busy){setCloseNotice('저장하지 않은 입력이나 진행 중인 작업이 있습니다. 먼저 저장한 뒤 상세 원문을 보완해주세요.');return false;}return true;}}/></details><details className="registration-tools-menu"><summary>추가 작업</summary><nav className="registration-tools" aria-label="상품 보조 작업">{supportingTabs.filter(item=>!registrationSteps.includes(item.value)).map(item=><button key={item.value} type="button" onClick={()=>selectDetailTab(item.value)} aria-pressed={tab===item.value} className={tab===item.value?'active':''}>{item.label}</button>)}<small>단계 이동 시 입력 유지 · 각 단계에서 저장</small></nav></details></div></details><button className="icon-close" aria-label="상품 작업 공간 닫기" onClick={()=>closeWorkspace()}>×</button></header>{closeNotice&&<p role="status" className="panel-note">{closeNotice}</p>}
        <div className="registration-progress" role="progressbar" aria-label="상품 등록 입력 단계" aria-valuemin={1} aria-valuemax={registrationSteps.length} aria-valuenow={progressStepIndex+1}><span style={{width:`${(progressStepIndex+1)/registrationSteps.length*100}%`}}/></div>
        <nav className="registration-steps" aria-label={`상품 등록 ${registrationSteps.length}단계`} aria-busy={registrationLayout.loading}>{registrationSteps.map((value,index)=><button type="button" key={value} disabled={!registrationLayoutReady} onClick={()=>selectDetailTab(value)} aria-current={tab===value?'step':undefined} className={[tab===value?'active':'',index<=progressStepIndex?'reached':''].filter(Boolean).join(' ')}><span>{index+1}</span><strong>{({SEO:'SEO 설정',가격:'가격 설정',표시사항:'한글 표시사항',견적서:'견적서 작업'} as Record<string,string>)[value]??value}</strong></button>)}</nav>
        {registrationLayout.error&&<div className="registration-layout-error" role="alert"><p>{registrationLayout.error} 입력은 유지했습니다. 카테고리의 필수 단계를 다시 확인해주세요.</p><button type="button" className="btn ghost" onClick={()=>{if(registrationLayout.retry())setCloseNotice('');}}>등록 단계 다시 확인</button></div>}
        {tab==='상세 이미지'&&!focusedOptionId&&<div className="panel-note"><div><strong>수집 사진으로 옵션별 상세 구성</strong><p>편집할 옵션을 선택하면 저장된 상품 사진으로 상세 본문을 구성하고 번역·순서·삭제를 편집할 수 있습니다. 대표·추가 사진 배치는 유지됩니다.</p></div><button type="button" className="btn primary" disabled={busy||sourceSupplementBusy} onClick={()=>openOptionBoard(detail)}>옵션별 상세 편집</button></div>}
        <div className="detail-body" data-registration-stage={tab} ref={detailBody} inert={sourceSupplementBusy}><DetailPanel workspaceOwnerId={workspaceOwnerId} onEditSeo={()=>{if(detailNavigation===productNavigation.current&&settingsOperationRef.current.ownerId===workspaceOwnerId)selectDetailTab('SEO');}} onReceiptSaved={()=>void refreshReceiptStatus(detail.id,detail.updated_at)} key={detail.id} onBeforeSeoGenerate={()=>{
          if(sourceSupplementBusyRef.current||busyRef.current||detailNavigation!==productNavigation.current)return false;
          const pending=workspaceEditState(detailBody.current,false,true);
          if(pending.busy||pending.dirty){setCloseNotice('저장하지 않은 수정이나 진행 중인 작업이 있습니다. 먼저 저장한 뒤 SEO 초안을 작성해주세요.');return false;}
          return true;
        }} onBeforeFreeImageApply={()=>{
          if(sourceSupplementBusyRef.current||busyRef.current||detailNavigation!==productNavigation.current)return false;
          const pending=workspaceEditState(detailBody.current,true);
          if(pending.busy||pending.dirty){setCloseNotice('다른 단계에 저장하지 않은 입력 또는 진행 중인 작업이 있습니다. 먼저 저장한 뒤 번역 이미지를 적용해주세요.');return false;}
          return true;
        }} onBeforeSourceWrite={source=>{
          if(sourceSupplementBusyRef.current||busyRef.current||detailNavigation!==productNavigation.current)return false;
          const pending=workspaceSourceWriteState(detailBody.current,source);
          if(pending.busy||pending.dirty){setCloseNotice('다른 단계에 저장하지 않은 입력이나 진행 중인 작업이 있습니다. 먼저 저장한 뒤 이미지를 연결해주세요.');return false;}
          return true;
        }} onPrepareSubmission={prepareCurrentSubmission} onReviewPackaging={optionId=>{
          if(sourceSupplementBusyRef.current || detailNavigation !== productNavigation.current) return;
          const pending=workspaceEditState(detailBody.current);
          if(pending.busy || detailBody.current?.querySelector('[aria-busy="true"]')){setCloseNotice('작업이 진행 중입니다. 작업이 끝나면 견적서를 확인해주세요.');return;}
          if(pending.dirty){if(selectDetailTab('견적서'))setCloseNotice('견적서에 저장하지 않은 입력이 있습니다. 먼저 저장해주세요.');return;}
          if(selectDetailTab('견적서')){setQuotationTarget({...quotationTarget,optionId,fieldId:'packagedWeightG'});setQuotationNavigationSequence(value=>value+1);}
        }} focusedOptionId={focusedOptionId} initialOptionAction={initialOptionAction} preferredProfileId={detailProfileId} quotationTarget={quotationTarget} quotationNavigationSequence={quotationNavigationSequence} onProfilePrepared={adoptPreparedProfile} onProfileSelected={id=>{if(detailNavigation===productNavigation.current&&settingsOperationRef.current.ownerId===workspaceOwnerId)setDetailProfileId(id);}} onSaved={()=>void loadWorkspace()} onManageCategories={()=>closeWorkspace(true)} onSavePrice={savePrice} tab={tab} product={detail} settings={settings} onUpload={uploadImage}/></div>
        <footer className="registration-navigation">{detailStepIndex>=0?<><button type="button" className="btn ghost" aria-label="이전 단계" disabled={!registrationLayoutReady||detailStepIndex===0} onClick={()=>selectDetailTab(registrationSteps[detailStepIndex-1])}>← 이전</button>{detailStepIndex===registrationSteps.length-1?<button type="button" className="btn primary" aria-label="편집 완료" title="편집 화면을 닫고 상품 목록으로 돌아갑니다." disabled={!registrationLayoutReady} onClick={()=>closeWorkspace()}>완료</button>:<button type="button" className="btn ghost" aria-label="다음 단계" disabled={!registrationLayoutReady} onClick={()=>selectDetailTab(registrationSteps[detailStepIndex+1])}>다음 →</button>}<span aria-label="현재 입력 단계">{detailStepIndex+1} / {registrationSteps.length}</span></>:<><span>추가 작업 · {supportingTabs.find(item=>item.value===tab)?.label}</span><button type="button" className="btn primary" disabled={!registrationLayoutReady} onClick={()=>selectDetailTab(returnRegistrationStep)}>{registrationSteps.indexOf(returnRegistrationStep)+1}. {returnRegistrationStep} 단계로 돌아가기 →</button></>}</footer>
      </aside></div>}

      {optionBoardProduct&&(!workspaceOwnerId||optionBoardProduct.owner_id===workspaceOwnerId)&&<div className="option-board-return-context" hidden={!!detail} inert={!!detail}><Modal wide title={registrationTitle(optionBoardProduct)} subtitle={`등록번호 ${registrationNumber(optionBoardProduct)} · 옵션별 상품 자료와 견적서를 확인합니다.`} onClose={closeOptionBoard}>{optionNavigationBusy&&<p role="status">선택한 상품의 최신 자료를 불러오는 중…</p>}{optionNavigationError&&<p role="alert">{optionNavigationError} 같은 작업 버튼을 눌러 다시 시도해주세요.</p>}<ProductOptionBoard key={optionBoardProduct.id} productId={optionBoardProduct.id} productRegistrationNumber={optionBoardProduct.registration_number} sourceUrl={optionBoardProduct.source_url} imageKeys={optionBoardProduct.image_keys} refreshToken={`${optionBoardVersion}:${optionBoardReturnRevision}`} returnFocus={detail?undefined:optionReturnFocus} onReturnFocusHandled={()=>setOptionReturnFocus(undefined)} onStage={(optionId,step)=>{if(typeof optionId==='string')void navigateOptionBoard(optionId,step);}} onManage={optionId=>{if(typeof optionId==='string')void navigateOptionBoard(optionId,'옵션',true);}} onContent={step=>void navigateOptionBoard(undefined,step)} onImage={optionId=>void navigateOptionBoard(optionId,'대표 이미지')} onEdit={optionId=>void navigateOptionBoard(optionId,'가격')} onQuotation={optionId=>void navigateOptionBoard(optionId,'견적서')}/></Modal></div>}
      {currentSubmission&&<Modal title="Supplier Hub 등록 전송" subtitle="선택 상품의 실제 저장 자료를 검사하고 필요한 항목을 수정하세요." closeDisabled={submissionLockState?.session===currentSubmission&&submissionLockState.close} onClose={()=>closeSubmission(currentSubmission)}><SubmissionReviewPanel key={submissionTarget?`${submissionTarget.product.id}:${submissionTarget.profileId}`:"selected"} products={submissionTarget?[submissionTarget.product]:products.filter(product=>selected.has(product.id)&&(!workspaceOwnerId||product.owner_id===workspaceOwnerId))} profiles={categoryProfiles} initialProfileId={submissionTarget?.profileId} onLockChange={(source,close)=>changeSubmissionLock(currentSubmission,source,close)} onReceiptSaved={()=>{if(submissionCurrent(currentSubmission))void loadWorkspace().catch(()=>{if(submissionCurrent(currentSubmission))setToast('전송 결과는 보관됐습니다. 상품 목록을 다시 불러와주세요.');});}} onEdit={(id,preferredProfileId,target)=>{if(!submissionCurrent(currentSubmission)||submissionLock.current?.session===currentSubmission&&submissionLock.current.source)return;const product=submissionTarget?.product.id===id?submissionTarget.product:products.find(item=>item.id===id);if(product&&(!workspaceOwnerId||product.owner_id===workspaceOwnerId)&&closeSubmission(currentSubmission)){openProduct(product,'견적서',preferredProfileId,target);}}}/></Modal>}

      {connectionsOpen&&<Modal title="연동 상태" subtitle="서버의 저장소·AI 설정 상태를 확인합니다." onClose={()=>setConnectionsOpen(false)}>
        <div className="settings-form">
          <SupplierHubExtensionCheck />
          {checkingConnections&&<p role="status">서버 연결을 확인하고 있습니다.</p>}
          {connectionError&&<p role="alert">{connectionError}</p>}
          {connections&&<><dl className="connection-list">
            <div><dt>Cloudflare Workers</dt><dd>현재 서버 응답 확인</dd></div>
            <div><dt>작업 공간 인증</dt><dd>{connections.authentication==='cloudflare_access'?'Cloudflare Access 검증됨':'이 PC의 로컬 개발 환경'}</dd></div>
            <div><dt>D1 · 상품 및 설정</dt><dd>{connections.database==='query_ok'?'읽기 쿼리 성공':'연결 확인 실패'}</dd></div>
            <div><dt>저장 테이블</dt><dd>{connections.databaseSchema?.status==='tables_present'?'필요 테이블 있음 · 열 구조 및 저장 동작은 별도 검증':connections.databaseSchema?.status==='missing_tables'?`업데이트 필요 · 누락: ${connections.databaseSchema.missingTables.join(', ')}`:'테이블 확인 실패 · 연결을 다시 확인해주세요'}</dd></div>
            <div><dt>R2 · 이미지 파일</dt><dd>{connections.files==='binding_present'?'바인딩 있음 · 읽기/쓰기 미검증':'바인딩 없음'}</dd></div>
            <div><dt>AI 번역·SEO</dt><dd>{connections.translation.configured?'서버 설정됨 · '+connections.translation.model+' · 실제 호출 별도 검증':'서버 모델·키 설정 필요'}</dd></div>
            <div><dt>AI 이미지 가공</dt><dd>{connections.imageProcessing.configured?'서버 설정됨 · '+connections.imageProcessing.model+' · 실제 호출 별도 검증':'서버 모델·키 설정 필요'}</dd></div>
          </dl><small>확인 시각: {new Date(connections.checkedAt).toLocaleString('ko-KR')}</small></>}
          <div className="modal-actions"><button className="btn ghost" onClick={()=>setConnectionsOpen(false)}>닫기</button><button className="btn primary" disabled={checkingConnections} onClick={()=>void checkConnections()}>다시 확인</button></div>
        </div>
      </Modal>}
      {toast&&<div className="toast" role="status"><span>ⓘ</span>{toast}</div>}
    </main>
  );
}

function Modal({ title, subtitle, onClose, children, wide=false,closeDisabled=false }: { title:string; subtitle:string; onClose:()=>void; children:React.ReactNode; wide?:boolean;closeDisabled?:boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={e=>e.stopPropagation()}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-close" disabled={closeDisabled} onClick={onClose}>×</button></header>{children}</section></div>;
}
function DetailPanel({ workspaceOwnerId, onEditSeo, onReceiptSaved, onBeforeSeoGenerate, onBeforeFreeImageApply, onBeforeSourceWrite, onPrepareSubmission, onProfilePrepared, onProfileSelected, onReviewPackaging, tab, product, settings, onUpload, onSaved, onManageCategories, preferredProfileId, quotationTarget, quotationNavigationSequence, focusedOptionId, initialOptionAction }: { workspaceOwnerId?:string;onEditSeo?:()=>void;onReceiptSaved:()=>void; onBeforeSeoGenerate:()=>boolean; onBeforeFreeImageApply:()=>boolean; onBeforeSourceWrite?:(source:WorkspaceSourceWrite)=>boolean; onPrepareSubmission:(profileId?:string)=>void; onProfilePrepared:(profile:CategoryProfile,source:CategoryProfile)=>void; onProfileSelected:(id?:string)=>void; onReviewPackaging:(optionId:string|null)=>void; focusedOptionId?:string; initialOptionAction?:'remove'; quotationTarget?:QuotationNavigationTarget; quotationNavigationSequence?:number; preferredProfileId?:string; onSavePrice:(policy:PricePolicy, options?:PriceSaveOptions)=>Promise<void>; tab:string; product:Product; settings:Settings; onSaved:()=>void; onManageCategories:()=>void; onUpload:(e:ChangeEvent<HTMLInputElement>)=>void }) {
  const [quotationRefresh, setQuotationRefresh] = useState(0);
  const seoReviewScope=JSON.stringify([workspaceOwnerId??product.owner_id??null,product.id,tab==='SEO']);
  const [seoReviewClock,setSeoReviewClock]=useState({scope:seoReviewScope,token:{}});
  if(seoReviewClock.scope!==seoReviewScope)setSeoReviewClock({scope:seoReviewScope,token:{}});
  const seoReviewToken=seoReviewClock.scope===seoReviewScope?seoReviewClock.token:null;
  const liveSeoReview=useRef<{token:object|null;version:string;active:boolean}>({token:seoReviewToken,version:product.updated_at,active:tab==='SEO'});
  const [seoApplied,setSeoApplied]=useState<{token:object;receipt:SeoAppliedReceipt}|null>(null);
  const [seoGeneratedDraft,setSeoGeneratedDraft]=useState<{token:object;reviewToken:object;draft:SeoGeneratedDraft}|null>(null);
  useLayoutEffect(()=>{liveSeoReview.current={token:seoReviewToken,version:product.updated_at,active:tab==='SEO'};return()=>{liveSeoReview.current={token:null,version:'',active:false};};},[seoReviewToken,product.updated_at,tab]);
  const seoFocusAfterApply=seoApplied?.token===seoReviewToken?seoApplied.receipt:undefined;
  const seoProcessingScope=JSON.stringify([workspaceOwnerId,product.id,product.updated_at]);
  const [seoProcessingClock,setSeoProcessingClock]=useState({scope:seoProcessingScope,token:{}});
  if(seoProcessingClock.scope!==seoProcessingScope)setSeoProcessingClock({scope:seoProcessingScope,token:{}});
  const seoProcessingToken=seoProcessingClock.scope===seoProcessingScope?seoProcessingClock.token:null;
  const liveSeoProcessingToken=useRef<object|null>(seoProcessingToken),seoProcessingRef=useRef<{token:object|null;busy:boolean;operation:object|null}>({token:seoProcessingToken,busy:false,operation:null});
  const [seoProcessingState,setSeoProcessingState]=useState<{token:object|null;busy:boolean;operation:object|null}>({token:seoProcessingToken,busy:false,operation:null});
  useLayoutEffect(()=>{liveSeoProcessingToken.current=seoProcessingToken;return()=>{liveSeoProcessingToken.current=null;};},[seoProcessingToken]);
  const changeSeoProcessing=useCallback((busy:boolean,operation:object)=>{
    if(!seoProcessingToken||liveSeoProcessingToken.current!==seoProcessingToken)return;
    const previous=seoProcessingRef.current;
    if(!busy&&(previous.token!==seoProcessingToken||previous.operation!==operation))return;
    if(previous.token===seoProcessingToken&&previous.busy===busy&&previous.operation===(busy?operation:null))return;
    seoProcessingRef.current={token:seoProcessingToken,busy,operation:busy?operation:null};setSeoProcessingState(seoProcessingRef.current);
  },[seoProcessingToken]);
  const seoProcessingBusy=seoProcessingState.token===seoProcessingToken&&seoProcessingState.busy;
  const currentSeoGeneratedDraft=seoGeneratedDraft?.token===seoProcessingToken&&seoGeneratedDraft.reviewToken===seoReviewToken&&seoGeneratedDraft.draft.productVersion===product.updated_at?seoGeneratedDraft.draft:null;
  const reviewAppliedSeo=useCallback((receipt:SeoAppliedReceipt)=>{
    const live=liveSeoReview.current;
    if(!seoReviewToken||live.token!==seoReviewToken||!live.active||live.version!==product.updated_at
      ||!seoProcessingToken||liveSeoProcessingToken.current!==seoProcessingToken||!sameSeoAppliedSource(receipt,product.id,product.updated_at))return;
    setSeoApplied({token:seoReviewToken,receipt});
  },[seoReviewToken,seoProcessingToken,product.id,product.updated_at]);
  const reviewGeneratedSeo=useCallback((draft:SeoGeneratedDraft)=>{
    const live=liveSeoReview.current;
    if(!seoReviewToken||live.token!==seoReviewToken||!live.active||live.version!==product.updated_at
      ||!seoProcessingToken||liveSeoProcessingToken.current!==seoProcessingToken
      ||draft.ownerId!==(workspaceOwnerId??null)||draft.productId!==product.id||draft.productVersion!==product.updated_at)return;
    setSeoGeneratedDraft({token:seoProcessingToken,reviewToken:seoReviewToken,draft});
  },[seoReviewToken,seoProcessingToken,workspaceOwnerId,product.id,product.updated_at]);
  const [paidImageBusy,setPaidImageBusy]=useState(false);
  const [freeImageBusy,setFreeImageBusy]=useState(false);
  const [additionalBatchBusy,setAdditionalBatchBusy]=useState(false);
  const [detailBatchBusy,setDetailBatchBusy]=useState(false);
  const [detailFamilyBusy,setDetailFamilyBusy]=useState(false);
  const detailFamilyScope=useRef<HTMLDivElement>(null);
  const imageProcessingRefs=useRef({paid:false,free:false,additionalBatch:false,detailBatch:false,detailFamily:false,mainUpload:false,additionalUpload:false,detailUpload:false,sizeChart:false});
  const [mainUploadBusy,setMainUploadBusy]=useState(false),[additionalUploadBusy,setAdditionalUploadBusy]=useState(false),[detailUploadBusy,setDetailUploadBusy]=useState(false);
  const [sizeChartBusy,setSizeChartBusy]=useState(false);
  const batchImageBusy=additionalBatchBusy||detailBatchBusy;
  const imageOperationsBusy=paidImageBusy||freeImageBusy||batchImageBusy||detailFamilyBusy||mainUploadBusy||additionalUploadBusy||detailUploadBusy;
  const imageProcessingBusy=imageOperationsBusy||sizeChartBusy;
  const changeImageProcessingBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.paid=busy;setPaidImageBusy(busy);},[]);
  const changeFreeImageBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.free=busy;setFreeImageBusy(busy);},[]);
  const changeAdditionalBatchBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.additionalBatch=busy;setAdditionalBatchBusy(busy);},[]);
  const changeDetailBatchBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.detailBatch=busy;setDetailBatchBusy(busy);},[]);
  const changeDetailFamilyBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.detailFamily=busy;setDetailFamilyBusy(busy);},[]);
  const changeMainUploadBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.mainUpload=busy;setMainUploadBusy(busy);},[]);
  const changeAdditionalUploadBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.additionalUpload=busy;setAdditionalUploadBusy(busy);},[]);
  const changeDetailUploadBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.detailUpload=busy;setDetailUploadBusy(busy);},[]);
  const changeSizeChartBusy=useCallback((busy:boolean)=>{imageProcessingRefs.current.sizeChart=busy;setSizeChartBusy(busy);},[]);
  const [imageTranslation,setImageTranslation]=useState<(FreeImageTranslationTarget&{productId:string})|null>(null);
  const [imageEditorEntry,setImageEditorEntry]=useState<{role:'main'|'additional'|'detail';sequence:number}|undefined>();
  const imageEditorEntrySequence=useRef(0);
  const [detailImageEditOpen,setDetailImageEditOpen]=useState(false),[freeImageDirty,setFreeImageDirty]=useState(false);
  const freeImageEditState=useRef({dirty:false}),freeImageCloseGuard=useRef<(() => boolean)|null>(null),detailImageEditOpenRef=useRef(false);
  const changeFreeImageEditing=useCallback((dirty:boolean)=>{freeImageEditState.current.dirty=dirty;setFreeImageDirty(dirty);},[]);
  const changeFreeImageCloseGuard=useCallback((guard:(() => boolean)|null)=>{freeImageCloseGuard.current=guard;},[]);
  const [labelTranslationOpen,setLabelTranslationOpen]=useState(false);
  const [quotationScope,setQuotationScope] = useState<{requested?:string;selected?:string}>({requested:preferredProfileId,selected:preferredProfileId});
  const pricingProfileId=quotationScope.requested===preferredProfileId?quotationScope.selected:preferredProfileId;
  const priceFilesFree=()=>!imageProcessingRefs.current.paid&&!imageProcessingRefs.current.free&&!imageProcessingRefs.current.additionalBatch&&!imageProcessingRefs.current.detailBatch&&!imageProcessingRefs.current.detailFamily&&!imageProcessingRefs.current.mainUpload&&!imageProcessingRefs.current.additionalUpload&&!imageProcessingRefs.current.detailUpload&&!imageProcessingRefs.current.sizeChart;
  const imageUploadFilesFree=(stage:'main'|'additional'|'detail')=>!imageProcessingRefs.current.paid&&!imageProcessingRefs.current.free&&!imageProcessingRefs.current.additionalBatch&&!imageProcessingRefs.current.detailBatch&&!imageProcessingRefs.current.detailFamily&&!imageProcessingRefs.current.sizeChart&&(stage==='main'||!imageProcessingRefs.current.mainUpload)&&(stage==='additional'||!imageProcessingRefs.current.additionalUpload)&&(stage==='detail'||!imageProcessingRefs.current.detailUpload)&&onBeforeSourceWrite?.(`${stage}-upload`)!==false;
  const sizeChartFilesFree=()=>!imageProcessingRefs.current.paid&&!imageProcessingRefs.current.free&&!imageProcessingRefs.current.additionalBatch&&!imageProcessingRefs.current.detailBatch&&!imageProcessingRefs.current.detailFamily&&!imageProcessingRefs.current.mainUpload&&!imageProcessingRefs.current.additionalUpload&&!imageProcessingRefs.current.detailUpload&&onBeforeSourceWrite?.('size-chart')!==false;
  function sourceSaved() { setQuotationRefresh(value => value + 1); onSaved(); }
  const isImageStep=imageSteps.includes(tab);
  const contentSection = isImageStep ? '이미지' : tab==='표시사항' ? '표시사항' : 'SEO';
  const focusedAssetRole=tab==='대표 이미지'?'main':tab==='추가 이미지'?'additional':tab==='상세 이미지'?'detail':undefined;
  const scopedContent=tab==='SEO'||tab==='표시사항'||!!focusedOptionId&&['대표 이미지','추가 이미지','상세 이미지'].includes(tab);
  const commonImageWorkflow=tab==='추가 이미지'||tab==='상세 이미지';
  const primaryImageWorkflow=commonImageWorkflow&&!!focusedOptionId;
  const primaryDetailWorkflow=tab==='상세 이미지'&&!!focusedOptionId;
  const commonContentLabel=tab==='대표 이미지'?'대표 이미지':tab==='추가 이미지'?'추가 이미지':tab==='상세 이미지'?'상세 이미지':tab==='표시사항'?'추가 표시사항·이전 자료':'SEO·설명';
  let imageKeys:string[]=[];try{const keys:unknown=JSON.parse(product.image_keys);if(Array.isArray(keys))imageKeys=keys.filter((key):key is string=>typeof key==='string');}catch{/* The file and content APIs report invalid stored references. */}
  const quotationImageContext=focusedOptionId&&(isImageStep||tab==='표시사항')?{profileId:pricingProfileId??null,optionId:focusedOptionId,input:tab==='대표 이미지'?'mainImage' as const:tab==='추가 이미지'?'additionalImages' as const:tab==='표시사항'?'labelImages' as const:'detailImages' as const}:undefined;
  const mainProcessingScope=JSON.stringify([workspaceOwnerId??product.owner_id??null,product.id,product.updated_at,focusedOptionId??null,pricingProfileId??null,tab,quotationRefresh]);
  const [mainProcessingClock,setMainProcessingClock]=useState(()=>({scope:mainProcessingScope,token:{}}));
  if(mainProcessingClock.scope!==mainProcessingScope)setMainProcessingClock({scope:mainProcessingScope,token:{}});
  const mainProcessingToken=mainProcessingClock.scope===mainProcessingScope?mainProcessingClock.token:null,liveMainProcessingToken=useRef(mainProcessingToken);
  const mainResultScope=JSON.stringify([workspaceOwnerId??product.owner_id??null,product.id,focusedOptionId??null,pricingProfileId??null,tab]);
  const mainResultToken=useMemo(()=>({scope:mainResultScope}),[mainResultScope]),liveMainResultToken=useRef<object|null>(mainResultToken);
  useLayoutEffect(()=>{liveMainResultToken.current=mainResultToken;return()=>{liveMainResultToken.current=null;};},[mainResultToken]);
  const [mainProcessing,setMainProcessing]=useState<{token:object;resultToken:object;target:SelectedMainImageProcessingTarget}|null>(null);
  const mainProcessingSequence=useRef(0);
  useLayoutEffect(()=>{liveMainProcessingToken.current=mainProcessingToken;return()=>{liveMainProcessingToken.current=null;};},[mainProcessingToken]);
  const [mainImageConfiguration,setMainImageConfiguration]=useState<{token:object;configured:boolean}|null>(null);
  const liveMainImageConfiguration=useRef(mainImageConfiguration);
  const changeImageAvailability=useCallback((value:ImageGenerationAvailability|null)=>{
    if(!mainProcessingToken||liveMainProcessingToken.current!==mainProcessingToken||workspaceOwnerId&&product.owner_id!==workspaceOwnerId)return;
    const next=value?.productId===product.id&&value.productVersion===product.updated_at&&typeof value.configured==='boolean'
      ?{token:mainProcessingToken,configured:value.configured}:null;
    const previous=liveMainImageConfiguration.current;
    if(previous?.token===next?.token&&previous?.configured===next?.configured)return;
    liveMainImageConfiguration.current=next;setMainImageConfiguration(next);
  },[mainProcessingToken,workspaceOwnerId,product.owner_id,product.id,product.updated_at]);
  const mainImageConfigured=mainImageConfiguration?.token===mainProcessingToken?mainImageConfiguration.configured:null;
  const processingTabMatches=!!mainProcessing&&(tab==='대표 이미지'&&mainProcessing.target.quotationTarget.input==='mainImage'||tab==='추가 이미지'&&mainProcessing.target.quotationTarget.input==='additionalImages');
  const mainProcessingActive=!!mainProcessing&&mainProcessing.token===mainProcessingToken&&processingTabMatches;
  const mainResultActive=!!mainProcessing&&mainProcessing.resultToken===mainResultToken&&processingTabMatches;
  function processFinalMainImage(sourceKey:string,role:'main'|'additional',quotationTarget:FreeImageQuotationRequest,quotationView?:import('@/app/quotation-schema').QuotationFieldsView){
    const expectedInput=tab==='대표 이미지'&&role==='main'?'mainImage':tab==='추가 이미지'&&role==='additional'?'additionalImages':null;
    if(!expectedInput||!mainProcessingToken||liveMainProcessingToken.current!==mainProcessingToken||liveMainImageConfiguration.current?.token!==mainProcessingToken||liveMainImageConfiguration.current.configured!==true||!priceFilesFree()||detailImageEditOpenRef.current||freeImageEditState.current.dirty
      ||workspaceOwnerId&&product.owner_id!==workspaceOwnerId||!imageKeys.includes(sourceKey)||!quotationImageContext||quotationImageContext.input!==expectedInput
      ||quotationTarget.kind!=='quotation'||quotationTarget.optionId!==quotationImageContext.optionId||quotationTarget.profileId!==quotationImageContext.profileId
      ||quotationTarget.input!==expectedInput||!Number.isSafeInteger(quotationTarget.slotIndex)||quotationTarget.slotIndex<0||quotationTarget.slotIndex>=30
      ||typeof quotationTarget.value!=='string'||quotationImageKeys(quotationTarget.value)[quotationTarget.slotIndex]!==sourceKey
      ||expectedInput==='mainImage'&&(quotationTarget.slotIndex!==0||quotationTarget.value!==sourceKey)||expectedInput==='additionalImages'&&!quotationView)return;
    if(quotationView&&(quotationView.productVersion!==product.updated_at||quotationView.revision!==quotationTarget.revision||quotationView.inputFingerprint!==quotationTarget.inputFingerprint||quotationView.optionRevision!==quotationTarget.optionRevision))return;
    setMainProcessing({token:mainProcessingToken,resultToken:mainResultToken,target:{sourceKey,sequence:++mainProcessingSequence.current,productVersion:product.updated_at,quotationTarget,
      ownerId:workspaceOwnerId??product.owner_id,...(quotationView?{quotationView:JSON.parse(JSON.stringify(quotationView))}:{})}});
  }
  function beforeSelectedMainApply(){return liveMainResultToken.current===mainResultToken&&mainResultActive&&!imageProcessingRefs.current.free&&!imageProcessingRefs.current.additionalBatch&&!imageProcessingRefs.current.detailBatch
    &&!imageProcessingRefs.current.detailFamily&&!imageProcessingRefs.current.mainUpload&&!imageProcessingRefs.current.additionalUpload&&!imageProcessingRefs.current.detailUpload&&!imageProcessingRefs.current.sizeChart
    &&!detailImageEditOpenRef.current&&!freeImageEditState.current.dirty&&onBeforeFreeImageApply();}
  function closeMainImageProcessing(){if(mainProcessingToken&&liveMainProcessingToken.current===mainProcessingToken&&priceFilesFree()&&!freeImageEditState.current.dirty)setMainProcessing(null);}
  const showLabelImageEditing=tab==='표시사항'&&!!quotationImageContext&&imageTranslation?.productId===product.id&&imageTranslation.quotationTarget?.input==='labelImages'
    &&imageTranslation.quotationTarget.optionId===quotationImageContext.optionId&&imageTranslation.quotationTarget.profileId===quotationImageContext.profileId;
  function translateFinalImage(sourceKey:string,role:'main'|'additional'|'detail'|'label',sourceLanguage:'zh'|'en',quotationTarget:FreeImageQuotationRequest,intent?:'manual'){
    if(imageProcessingRefs.current.paid||imageProcessingRefs.current.free||imageProcessingRefs.current.additionalBatch||imageProcessingRefs.current.detailBatch||imageProcessingRefs.current.detailFamily||imageProcessingRefs.current.mainUpload||imageProcessingRefs.current.additionalUpload||imageProcessingRefs.current.detailUpload||imageProcessingRefs.current.sizeChart||!imageKeys.includes(sourceKey)||!quotationImageContext
      ||quotationTarget.optionId!==quotationImageContext.optionId||quotationTarget.profileId!==quotationImageContext.profileId
      ||quotationTarget.input!==quotationImageContext.input||role!==(tab==='대표 이미지'?'main':tab==='추가 이미지'?'additional':tab==='표시사항'?'label':'detail'))return;
    if(imageSteps.includes(tab)){if(detailImageEditOpenRef.current)return;detailImageEditOpenRef.current=true;setDetailImageEditOpen(true);}
    setImageTranslation(previous=>({productId:product.id,sourceKey,sequence:(previous?.sequence??0)+1,sourceLanguage,role,quotationTarget,...(intent?{intent}:{})}));
  }
  function canCloseDetailImageEdit(){return !imageProcessingRefs.current.free&&!imageProcessingRefs.current.paid&&!imageProcessingRefs.current.additionalBatch&&!imageProcessingRefs.current.detailBatch&&!imageProcessingRefs.current.detailFamily&&!imageProcessingRefs.current.mainUpload&&!imageProcessingRefs.current.additionalUpload&&!imageProcessingRefs.current.detailUpload&&!imageProcessingRefs.current.sizeChart&&!freeImageEditState.current.dirty&&freeImageCloseGuard.current?.()===true;}
  function closeDetailImageEdit(){if(canCloseDetailImageEdit()){detailImageEditOpenRef.current=false;setDetailImageEditOpen(false);}}
  function editFinalImage(sourceKey:string,role:'main'|'additional'|'detail',quotationTarget:FreeImageQuotationRequest){translateFinalImage(sourceKey,role,'zh',quotationTarget,'manual');}
  const contentEditor=<ProductContentEditor product={product} section={contentSection} autoFillLabel={false} seoLayout={tab==='SEO'} focusedAssetRole={focusedAssetRole} onSaved={sourceSaved} imageProcessingBusy={imageProcessingBusy||isImageStep&&detailImageEditOpen} onTranslateImage={(sourceKey,sourceLanguage,role)=>{
    if(imageProcessingRefs.current.paid||imageProcessingRefs.current.free||imageProcessingRefs.current.additionalBatch||imageProcessingRefs.current.detailBatch||imageProcessingRefs.current.detailFamily||imageProcessingRefs.current.mainUpload||imageProcessingRefs.current.additionalUpload||imageProcessingRefs.current.detailUpload||imageProcessingRefs.current.sizeChart||!imageKeys.includes(sourceKey)||(role!==undefined&&!validFreeImageRole(role)))return;
    if(imageSteps.includes(tab)){if(detailImageEditOpenRef.current)return;detailImageEditOpenRef.current=true;setDetailImageEditOpen(true);}
    setImageTranslation(previous=>({productId:product.id,sourceKey,sequence:(previous?.sequence??0)+1,sourceLanguage,...(role?{role}:{})}));
  }}/>;
  const mainImageUploadControl=focusedOptionId?<ProductImageUploadQueue key={`${workspaceOwnerId??product.owner_id}:${product.id}:${focusedOptionId}:main:${pricingProfileId??''}`} productId={product.id} ownerId={workspaceOwnerId??product.owner_id??''} version={product.updated_at} storedCount={imageKeys.length} stage="main" target={{optionId:focusedOptionId,profileId:pricingProfileId}} immediate active={tab==='대표 이미지'} disabled={paidImageBusy||freeImageBusy||batchImageBusy||detailFamilyBusy||additionalUploadBusy||detailUploadBusy||sizeChartBusy} beforeUpload={()=>imageUploadFilesFree('main')} onBusyChange={changeMainUploadBusy} onSaved={sourceSaved}/>:undefined;
  const additionalImageUploadControl=<ProductImageUploadQueue key={`${workspaceOwnerId??product.owner_id}:${product.id}:additional`} productId={product.id} ownerId={workspaceOwnerId??product.owner_id??''} version={product.updated_at} storedCount={imageKeys.length} stage="additional" target={{optionId:null,profileId:pricingProfileId}} active={tab==='추가 이미지'} disabled={paidImageBusy||freeImageBusy||batchImageBusy||detailFamilyBusy||mainUploadBusy||detailUploadBusy||sizeChartBusy} beforeUpload={()=>imageUploadFilesFree('additional')} onBusyChange={changeAdditionalUploadBusy} onSaved={sourceSaved}/>;
  const detailImageUploadControl=<ProductImageUploadQueue key={`${workspaceOwnerId??product.owner_id}:${product.id}:detail`} productId={product.id} ownerId={workspaceOwnerId??product.owner_id??''} version={product.updated_at} storedCount={imageKeys.length} stage="detail" target={{optionId:null,profileId:pricingProfileId}} immediate active={tab==='상세 이미지'} disabled={paidImageBusy||freeImageBusy||batchImageBusy||detailFamilyBusy||mainUploadBusy||additionalUploadBusy||sizeChartBusy} beforeUpload={()=>imageUploadFilesFree('detail')} onBusyChange={changeDetailUploadBusy} onSaved={sourceSaved}/>;
  return <>
    <div hidden={tab!=='SEO'} className="registration-seo-heading"><h2>SEO 설정</h2><SeoWorkspaceGenerator workspaceOwnerId={workspaceOwnerId} productId={product.id} version={product.updated_at} brand={settings.brand} active={tab==='SEO'} beforeGenerate={onBeforeSeoGenerate} onProcessingChange={changeSeoProcessing} onDraft={reviewGeneratedSeo} onApplied={reviewAppliedSeo} onSaved={sourceSaved}/></div>
    <div hidden={!!focusedOptionId||tab!=='대표 이미지'} className="registration-upload-actions">{!focusedOptionId&&<label className="btn primary upload-btn">＋ 이미지 업로드<input type="file" accept="image/*" disabled={imageProcessingBusy} onChange={onUpload}/></label>}</div>
    <div hidden={!!focusedOptionId||tab!=='추가 이미지'}>{!focusedOptionId&&additionalImageUploadControl}</div>
    <div hidden={!!focusedOptionId||tab!=='상세 이미지'}>{!focusedOptionId&&detailImageUploadControl}</div>
    <div hidden={!['SEO','표시사항',...imageSteps].includes(tab)||tab==='SEO'&&seoProcessingBusy} inert={tab==='SEO'&&seoProcessingBusy} className={tab==='SEO'?'seo-content-columns':'panel-stack'}>
      <div className="registration-additional-primary-tools panel-stack" hidden={!focusedOptionId||tab!=='추가 이미지'}>
      <div hidden={!focusedOptionId||tab!=='추가 이미지'}>{focusedOptionId&&<OptionImageEditor key={`${product.id}:${focusedOptionId}:${pricingProfileId??''}:additional`} productId={product.id} optionId={focusedOptionId} version={product.updated_at} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} stage="additional" uploadControl={additionalImageUploadControl} saveOnChange={tab==='추가 이미지'} active={tab==='추가 이미지'} disabled={imageProcessingBusy} processingConfigured={mainImageConfigured} onSaved={sourceSaved} onTranslate={translateFinalImage} onEdit={editFinalImage} onProcess={processFinalMainImage}/>}</div>
      <div hidden={!focusedOptionId||tab!=='추가 이미지'}>{focusedOptionId&&<DetailImageBatchPanel key={`${product.id}:${focusedOptionId}:${pricingProfileId??''}:additional-batch`} productId={product.id} optionId={focusedOptionId} version={product.updated_at} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} stage="additional" compactToolbar active={tab==='추가 이미지'} disabled={paidImageBusy||freeImageBusy||detailBatchBusy||detailFamilyBusy||mainUploadBusy||additionalUploadBusy||detailUploadBusy||sizeChartBusy} beforeApply={()=>!imageProcessingRefs.current.paid&&!imageProcessingRefs.current.free&&!imageProcessingRefs.current.detailBatch&&!imageProcessingRefs.current.detailFamily&&!imageProcessingRefs.current.mainUpload&&!imageProcessingRefs.current.additionalUpload&&!imageProcessingRefs.current.detailUpload&&!imageProcessingRefs.current.sizeChart&&onBeforeFreeImageApply()} onBusyChange={changeAdditionalBatchBusy} onSaved={sourceSaved}/>}</div>
      </div>
      <div className="registration-detail-primary-tools panel-stack" hidden={!primaryDetailWorkflow}>
      <div hidden={!focusedOptionId||tab!=='상세 이미지'}>{focusedOptionId&&<DetailImageBatchPanel key={`${product.id}:${focusedOptionId}:${pricingProfileId??''}:detail-batch`} productId={product.id} optionId={focusedOptionId} version={product.updated_at} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} stage="detail" compactToolbar active={tab==='상세 이미지'} disabled={paidImageBusy||freeImageBusy||additionalBatchBusy||detailFamilyBusy||mainUploadBusy||additionalUploadBusy||detailUploadBusy||sizeChartBusy} beforeApply={()=>!imageProcessingRefs.current.paid&&!imageProcessingRefs.current.free&&!imageProcessingRefs.current.additionalBatch&&!imageProcessingRefs.current.detailFamily&&!imageProcessingRefs.current.mainUpload&&!imageProcessingRefs.current.additionalUpload&&!imageProcessingRefs.current.detailUpload&&!imageProcessingRefs.current.sizeChart&&onBeforeFreeImageApply()} onBusyChange={changeDetailBatchBusy} onSaved={sourceSaved}/>}</div>
      <div hidden={!focusedOptionId||tab!=='상세 이미지'}>{focusedOptionId&&<OptionImageEditor key={`${product.id}:${focusedOptionId}:${pricingProfileId??''}:detail`} productId={product.id} optionId={focusedOptionId} version={product.updated_at} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} stage="detail" primaryDetailTools uploadControl={detailImageUploadControl} active={tab==='상세 이미지'} disabled={imageProcessingBusy||detailImageEditOpen} onSaved={sourceSaved} onTranslate={translateFinalImage} onEdit={editFinalImage}/>}</div>
      <details><summary>분할 상품에 상세 이미지 적용</summary><div ref={detailFamilyScope} hidden={tab!=='상세 이미지'}><DetailFamilyApplyPanel productId={product.id} version={product.updated_at} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} active={tab==='상세 이미지'} disabled={paidImageBusy||freeImageBusy||additionalBatchBusy||detailBatchBusy||mainUploadBusy||additionalUploadBusy||detailUploadBusy||sizeChartBusy} onBusyChange={changeDetailFamilyBusy} onSaved={sourceSaved} beforeOpen={()=>{const state=workspaceEditState(detailFamilyScope.current?.closest('.detail-body')??null);return !state.busy&&!state.dirty&&priceFilesFree()&&onBeforeFreeImageApply();}} /></div></details>
      </div>
      <div hidden={tab!=='표시사항'}><ProductLabelEditor resultFirst key={`${product.id}:${focusedOptionId??'common'}:${pricingProfileId??''}`} productId={product.id} optionId={focusedOptionId??null} version={product.updated_at} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} disabled={imageProcessingBusy} active={tab==='표시사항'} onSaved={sourceSaved} onTranslate={focusedOptionId?translateFinalImage:undefined}/></div>
      <div hidden={tab!=='SEO'} style={{gridColumn:'1 / -1'}}><SeoWorkspaceEditor workspaceOwnerId={workspaceOwnerId} productId={product.id} version={product.updated_at} generatedDraft={currentSeoGeneratedDraft} focusedOptionId={focusedOptionId} active={tab==='SEO'} disabled={seoProcessingBusy} focusAfterApply={seoFocusAfterApply} onSaved={sourceSaved}/></div>
      <details className={commonImageWorkflow?'registration-common-image-editor':undefined} open={commonImageWorkflow&&!primaryImageWorkflow||!scopedContent?true:undefined} hidden={tab==='SEO'&&!focusedOptionId}><summary hidden={!scopedContent}>{tab==='SEO'?'옵션별 추가 SEO 편집':`상품 공통 ${commonContentLabel} 편집`}</summary><p hidden={!scopedContent||tab==='SEO'} className="panel-note">아래 수정값은 상품의 공통 자료에 저장됩니다. 옵션별로 직접 저장한 값은 해당 옵션의 값을 유지합니다.</p><div hidden={tab!=='SEO'||!focusedOptionId}>{focusedOptionId&&<OptionSeoEditor key={`${product.id}:${focusedOptionId}:${pricingProfileId??''}`} productId={product.id} optionId={focusedOptionId} version={product.updated_at} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} disabled={seoProcessingBusy} onSaved={sourceSaved}/>}</div><div hidden={tab==='SEO'}>{contentEditor}</div></details>
    </div>
    <div hidden={!isImageStep&&!showLabelImageEditing} inert={batchImageBusy||detailFamilyBusy||mainUploadBusy||additionalUploadBusy||detailUploadBusy||sizeChartBusy} className="panel-stack">
      {isImageStep&&<div className="image-stage-editor-entry"><button type="button" className="btn ghost" disabled={imageProcessingBusy||detailImageEditOpen||freeImageDirty} onClick={()=>{if(mainProcessingToken&&liveMainProcessingToken.current===mainProcessingToken&&priceFilesFree()&&!detailImageEditOpenRef.current&&!freeImageEditState.current.dirty&&freeImageCloseGuard.current?.()===true){setImageTranslation(null);setImageEditorEntry({role:tab==='대표 이미지'?'main':tab==='추가 이미지'?'additional':'detail',sequence:++imageEditorEntrySequence.current});detailImageEditOpenRef.current=true;setDetailImageEditOpen(true);}}}>{tab} 편집 열기</button></div>}
      <DetailImageEditDialog modal={isImageStep} open={detailImageEditOpen} identity={JSON.stringify([product.id,product.updated_at,focusedOptionId??null,pricingProfileId??null])}
        blocked={imageProcessingBusy||freeImageDirty} canClose={canCloseDetailImageEdit} onClose={closeDetailImageEdit}>
        <details open={!focusedOptionId||tab!=='대표 이미지'||imageTranslation?.quotationTarget?.input==='mainImage'||!!imageEditorEntry&&!imageTranslation}><summary hidden={!focusedOptionId||tab!=='대표 이미지'}>{imageTranslation?.quotationTarget?.input==='mainImage'?'선택 옵션 대표이미지 번역':'상품 공통 원본 이미지 번역'}</summary>
          <FreeImageTranslationPanel productId={product.id} version={product.updated_at} imageKeys={imageKeys} focusedOptionId={focusedOptionId} quotationContext={quotationImageContext} editorEntry={imageEditorEntry} editorProfileId={pricingProfileId??null}
            active={isImageStep?detailImageEditOpen:showLabelImageEditing} onProductChanged={sourceSaved} onBusyChange={changeFreeImageBusy} onEditingChange={changeFreeImageEditing} onCloseGuard={changeFreeImageCloseGuard}
            beforeApply={()=>!imageProcessingRefs.current.paid&&!imageProcessingRefs.current.additionalBatch&&!imageProcessingRefs.current.detailBatch&&!imageProcessingRefs.current.detailFamily&&!imageProcessingRefs.current.mainUpload&&!imageProcessingRefs.current.additionalUpload&&!imageProcessingRefs.current.detailUpload&&!imageProcessingRefs.current.sizeChart&&onBeforeFreeImageApply()}
            translationTarget={imageTranslation?.productId===product.id?{sourceKey:imageTranslation.sourceKey,sequence:imageTranslation.sequence,sourceLanguage:imageTranslation.sourceLanguage,...(imageTranslation.role?{role:imageTranslation.role}:{}),...(imageTranslation.quotationTarget?{quotationTarget:imageTranslation.quotationTarget}:{}),...(imageTranslation.intent?{intent:imageTranslation.intent}:{})}:undefined}/>
        </details>
      </DetailImageEditDialog>
      <details hidden={!isImageStep} open={mainProcessingActive||mainResultActive||undefined}><summary>{mainProcessing?`선택 옵션 ${mainProcessing.target.quotationTarget.input==='additionalImages'?'추가이미지':'대표이미지'} AI 처리`:'추가 AI 이미지 가공'}</summary><ImageGenerationPanel key={`${workspaceOwnerId??product.owner_id??''}:${product.id}`} productId={product.id} version={product.updated_at} imageKeys={imageKeys} onProductChanged={sourceSaved} onBusyChange={changeImageProcessingBusy} onAvailabilityChange={changeImageAvailability} processingTarget={mainProcessing?.target} processingTargetActive={mainProcessingActive} processingResultActive={mainResultActive} beforeSelectedImageApply={beforeSelectedMainApply} onCloseProcessingTarget={closeMainImageProcessing}/></details>
    </div>
    <div hidden={tab!=='표시사항'}><button type="button" className="btn ghost" aria-expanded={labelTranslationOpen} aria-controls={`label-translation-${product.id}`} onClick={()=>setLabelTranslationOpen(open=>!open)}>한글 표시사항 번역</button><details><summary>이전 공통 표시사항 PNG·추가 항목 조판</summary><p className="panel-note">이전 공통 자료와 직접 추가한 항목을 조판합니다. 제품 라벨의 항목명·순서·내용은 위 편집 영역에서 저장하고, 카테고리별 상품고시는 견적서에서 확인하세요.</p><DocumentImagePanel productId={product.id} version={product.updated_at} section="label" onSaved={sourceSaved}/></details></div>
    {tab==='작업'&&<AutomationPanel productId={product.id} version={product.updated_at}/>}
    <div id={`label-translation-${product.id}`} hidden={tab!=='SEO'&&tab!=='번역'&&!(tab==='표시사항'&&labelTranslationOpen)||tab==='SEO'&&seoProcessingBusy} inert={tab==='SEO'&&seoProcessingBusy}>
      {tab==='표시사항'&&labelTranslationOpen&&<p className="panel-note">수집 상품 속성의 원문과 완료된 번역 결과를 확인한 뒤, 아래 ‘번역한 상품 속성을 한글 표시사항에 연결’에서 항목을 선택해 공통 표시사항에 저장하세요. 카테고리별 상품고시는 견적서에서 별도로 확인하세요.</p>}
      <details open={tab==='SEO'?undefined:true}><summary hidden={tab!=='SEO'}>SEO 생성 이력 · 원문 확인 · 미번역 옵션</summary><TranslationPanel productId={product.id} version={product.updated_at} title={product.title} profileId={pricingProfileId} onContentSaved={sourceSaved}/></details>
    </div>
    <div hidden={!['옵션','가격','대표 이미지'].includes(tab)} className={tab==='가격'?'panel-stack':tab==='대표 이미지'?'registration-main-surface panel-stack':'panel-stack'}>
      <section className="pricing-options-panel"><ProductOptionsEditor focusedOptionId={focusedOptionId} initialBulkAction={initialOptionAction} product={product} onSaved={sourceSaved} onReviewPackaging={onReviewPackaging} pricingView={tab==='가격'} imageView={tab==='대표 이미지'} imageProcessingBusy={imageProcessingBusy} processingConfigured={mainImageConfigured} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} mainImageUploadControl={mainImageUploadControl} editableQuotationPrices beforePriceCommit={priceFilesFree} onTranslate={focusedOptionId?translateFinalImage:undefined} onEdit={focusedOptionId?editFinalImage:undefined} onProcess={focusedOptionId?processFinalMainImage:undefined}/></section>
    </div>
    <div hidden={tab!=='옵션'&&tab!=='사이즈표'}><SizeChartWorkspace productId={product.id} version={product.updated_at} sourceStep="사이즈표" profileId={pricingProfileId??null} active={tab==='옵션'||tab==='사이즈표'} disabled={imageOperationsBusy||seoProcessingBusy} beforeSave={sizeChartFilesFree} onBusyChange={changeSizeChartBusy} onSaved={sourceSaved}/></div>
    <div hidden={tab!=='견적서'||!focusedOptionId}><details className="registration-option-notices"><summary>상품고시 별도 편집·PNG</summary>{focusedOptionId&&<OptionLabelEditor key={`${product.id}:${focusedOptionId}:${pricingProfileId??''}`} productId={product.id} optionId={focusedOptionId} version={product.updated_at} profileId={pricingProfileId} refreshToken={String(quotationRefresh)} onSaved={sourceSaved}/>}</details></div>
    <div hidden={tab!=='견적서'} className="panel-stack"><QuotationPanel submissionActive={tab==='견적서'} onEditSeo={onEditSeo} onReceiptSaved={onReceiptSaved} onPrepareSubmission={onPrepareSubmission} onProfilePrepared={onProfilePrepared} onProfileChange={selected=>{setQuotationScope({requested:preferredProfileId,selected});onProfileSelected(selected);}} onSaved={sourceSaved} productId={product.id} preferredProfileId={preferredProfileId} navigationTarget={quotationTarget ?? (focusedOptionId ? {optionId:focusedOptionId,fieldId:'title'} : undefined)} navigationSequence={quotationNavigationSequence} refreshToken={`${product.updated_at}:${quotationRefresh}:${JSON.stringify(settings)}`} onManageCategories={onManageCategories}/><details><summary>대표 상품 가격·내부 CSV 참고</summary><LegacyQuotePanel product={product} settings={settings}/></details></div>
  </>;
}
function LegacyQuotePanel({ product, settings }: {product:Product;settings:Settings}) {
  return <div className="panel-stack"><article className="quote-sheet"><header><div><span>SUPPLY QUOTATION</span><h3>대표 상품 가격 참고</h3></div><strong>{registrationNumber(product)}</strong></header><dl><div><dt>상품명</dt><dd>{product.title}</dd></div><div><dt>옵션 수</dt><dd>{product.options_count}개</dd></div><div><dt>공급가</dt><dd>{won(product.supply_price)}</dd></div><div><dt>권장 판매가</dt><dd>{won(product.sale_price)}</dd></div><div><dt>시장가격(MSRP)</dt><dd>{won(product.msrp)}</dd></div><div><dt>수입·판매원</dt><dd>{settings.importer}</dd></div></dl><footer><span>내부 검토용 · Supplier Hub 호환 미검증</span><strong>YOOFAM 스튜디오</strong></footer></article><p>SEO·표시사항·이미지 탭에서 저장한 자료는 검토 ZIP에 포함됩니다. 연결된 원본 양식을 채우려면 위에서 카테고리와 입력 행을 선택하세요.</p><div className="quote-actions"><button className="btn ghost" onClick={()=>window.print()}>견적서 인쇄 / PDF</button><button className="btn primary" onClick={()=>downloadQuote(product,settings)}>견적 CSV 다운로드</button></div></div>;
}

function downloadQuote(product: Product, settings: Settings) {
  const rows: (string|number)[][] = [
    ['문서 구분','내부 검토용 견적 · Supplier Hub 업로드 양식 아님'],
    ['상품 ID','상품명','상품 URL','옵션 수','공급가(KRW)','판매가(KRW)','MSRP(KRW)','수입·판매원 설정','가격 저장 시각'],
    [product.id,product.title,product.source_url,product.options_count,product.supply_price,product.sale_price,product.msrp,settings.importer,product.updated_at],
    ['유의사항','옵션별 단가·물류비·관세·세금 및 Supplier Hub 규격은 별도 확인 필요'],
  ];
  const url = URL.createObjectURL(new Blob([quotationCsv(rows)],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='YOOFAM-PLUS-quote-'+product.id+'.csv';anchor.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
