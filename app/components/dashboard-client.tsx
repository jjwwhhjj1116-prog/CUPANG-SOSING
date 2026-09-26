'use client';

import { registrationSteps, initialRegistrationStep, type CollectionEditorTab } from '@/app/registration-navigation';
import { requestWorkspaceClose, workspaceEditState, quotationSourceState } from '@/app/workspace-close';
import type { QuotationNavigationTarget } from '@/app/quotation-navigation';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CategoryProfileEditor } from '@/app/components/category-profile-editor';
import { IntakeQueuePanel } from '@/app/components/intake-queue-panel';
import { useIntakeDraft } from '@/app/components/use-intake-draft';
import { ProductArchive } from '@/app/components/product-archive';
import { ProductContentEditor } from '@/app/components/product-content-editor';
import { AutomationPanel } from '@/app/components/automation-panel';
import { ProductOptionsEditor } from '@/app/components/product-options-editor';
import { QuotationPanel } from '@/app/components/quotation-panel';
import { SubmissionReviewPanel } from '@/app/components/submission-review-panel';
import { CollectionResultPanel } from '@/app/components/collection-result-panel';
import { CollectionBatchPanel } from '@/app/components/collection-batch-panel';
import { ProductOptionBoard } from '@/app/components/product-option-board';
import { RegistrationBoard } from '@/app/components/registration-board';
import TranslationPanel from '@/app/components/translation-panel';
import ImageGenerationPanel from '@/app/components/image-generation-panel';
import { DocumentImagePanel } from '@/app/components/document-image-panel';
import type { ProductContent } from '@/app/product-content';
import { BatchWorkPanel } from '@/app/components/batch-work-panel';
import type { CategoryProfile, CategoryProfileInput } from '@/app/category-profiles';
import { WorkspaceSettingsDialog } from '@/app/components/workspace-settings-dialog';
import { savedRegistrationSettings, type WorkspaceSettings as Settings } from '@/app/workspace-settings';
import { requestErrorMessage } from '@/app/request-error';
import { PriceEditor } from '@/app/components/price-editor';
import { quotationCsv, pricePolicy, type PricePolicy } from '@/app/pricing';
import { collectionBlock, collectionJobProgress, type CollectionJob } from '@/app/sourcing';

type Product = {
  id: string; source_url: string; title: string; source_price_cny: number; exchange_rate: number;
  supply_margin: number; coupang_margin: number; supply_price: number; sale_price: number; msrp: number;
  options_count: number; seo_status: string; image_status: string; quote_status: string;
  registration_status: string; supplier_hub_status: string; image_keys: string; goal_stage: string;
  created_at: string; updated_at: string;
  pricing_policy?: string | null;
};

type IntegrationStatus = {
  checkedAt: string; database: string; files: string; authentication: string;
  databaseSchema?: {status: string; missingTables: string[]};
  translation: { configured: boolean; model: string|null; issues: string[] };
  imageProcessing: { configured: boolean; model: string|null; issues: string[] };
};

async function readJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(requestErrorMessage(result));
  return result as T;
}


const imageSteps = ['대표 이미지','추가 이미지','상세 이미지'];
const supportingTabs = [{value:'작업',label:'작업 이력'},{value:'번역',label:'번역·SEO 생성'},{value:'옵션',label:'옵션·사이즈표'}];
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
    readJson<{ profiles: CategoryProfile[] }>('/api/category-profiles'),
  ]);
}
const goalOptions = [
  { id:'collect', title:'상품추가', desc:'수집 연결 후 원문·옵션·원가를 확인합니다.' },
  { id:'price', title:'SEO + 가격', desc:'수집 후 번역 검토와 가격 계산을 준비합니다.' },
  { id:'work', title:'작업개시', desc:'수집 후 이미지·표시사항·견적 자료까지 준비합니다.' },
  { id:'transmit', title:'등록전송', desc:'미검증 · 전송은 차단됩니다.' },
];

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
export default function DashboardClient({ userName }: { userName: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [view, setView] = useState<'work'|'archive'>('work');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(() => savedRegistrationSettings(null));
  const [selected, setSelected] = useState<Set<string>>(new Set());


  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transmitOpen, setTransmitOpen] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);
  const [tab, setTab] = useState('SEO');
  const [quotationTarget,setQuotationTarget]=useState<QuotationNavigationTarget|undefined>();
  const [detailProfileId,setDetailProfileId]=useState<string|undefined>();
  const [lastRegistrationStep, setLastRegistrationStep] = useState('SEO');
  const detailBody = useRef<HTMLDivElement>(null);
  const [closeNotice, setCloseNotice] = useState('');
  function closeWorkspace(manageCategories = false) {
    const result = requestWorkspaceClose(detailBody.current, () => window.confirm('저장하지 않은 입력이 있습니다. 입력을 버리고 상품 작업창을 닫을까요?'));
    if (result === 'busy') { setCloseNotice('작업이 진행 중입니다. 현재 작업을 마친 뒤 닫아주세요.'); return; }
    if (result === 'cancel') return;
    setCloseNotice(''); setDetail(null);
    if (manageCategories) setAddOpen(true);
  }
  useEffect(() => {
    if (!detail) return;
    const protect = (event: BeforeUnloadEvent) => {
      const state = workspaceEditState(detailBody.current);
      if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [detail]);
  const productNavigation=useRef(0);
  useEffect(()=>()=>{productNavigation.current++;},[]);
  const [busy, setBusy] = useState(false);
  const [focusedOptionId, setFocusedOptionId] = useState<string|undefined>();
  const [optionBoardProduct, setOptionBoardProduct] = useState<Product|null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProductId, setHistoryProductId] = useState('');
  const [pendingUpload,setPendingUpload]=useState<{productId:string;key:string}|null>(null);
  const [toast, setToast] = useState('');

  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connections, setConnections] = useState<IntegrationStatus | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [checkingConnections, setCheckingConnections] = useState(false);
  const [collectionJobs, setCollectionJobs] = useState<CollectionJob[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);
  const [categoryProfiles, setCategoryProfiles] = useState<CategoryProfile[]>([]);
  const intakeDraft = useIntakeDraft();
  const { rows: intakeRows, setRows: setIntakeRows, goal: intakeGoal, setGoal: setIntakeGoal } = intakeDraft;
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryProfile|null>(null);
  const [categorySeed,setCategorySeed]=useState<CategoryProfileInput|undefined>();
  function selectDetailTab(value: string) {
    if (value === '견적서') {
      const pending=quotationSourceState(detailBody.current);
      if(pending.busy){setCloseNotice('저장 중인 작업이 있습니다. 저장이 끝나면 견적서를 열어주세요.');return;}
      if(pending.steps.length){
        setCloseNotice(pending.steps.join(' · ')+'에 저장하지 않은 입력이 있습니다. 해당 단계에서 저장하면 견적서에 반영됩니다.');
        setTab(pending.steps[0]);
        if(registrationSteps.includes(pending.steps[0]))setLastRegistrationStep(pending.steps[0]);
        detailBody.current?.scrollTo({top:0});return;
      }
    }
    setCloseNotice('');
    setTab(value);
    if (registrationSteps.includes(value)) setLastRegistrationStep(value);
    detailBody.current?.scrollTo({ top: 0 });
  }
  function openProduct(product: Product, initialTab = 'SEO', preferredProfileId?:string, target?:QuotationNavigationTarget, optionId?:string) {
    setCloseNotice('');
    setFocusedOptionId(optionId);
    productNavigation.current++;
    setQuotationTarget(target);setDetailProfileId(preferredProfileId);
    setDetail(product); setTab(initialTab); setLastRegistrationStep(initialRegistrationStep(initialTab));
  }
  async function openCollectedProduct(productId:string,initialTab:CollectionEditorTab,signal:AbortSignal){
    const request=++productNavigation.current;
    const result=await readJson<{product:Product}>(`/api/products/${encodeURIComponent(productId)}`,{cache:'no-store',signal});
    if(signal.aborted||request!==productNavigation.current)return;
    if(!result.product||result.product.id!==productId)throw new Error('연결된 상품을 확인하지 못했습니다. 수집 대기열을 새로고침해주세요.');
    openProduct(result.product,initialTab);
  }
  const detailStepIndex = registrationSteps.indexOf(tab);
  async function checkConnections() {
    setConnectionsOpen(true); setCheckingConnections(true); setConnectionError(''); setConnections(null);
    try { setConnections(await readJson<IntegrationStatus>('/api/integrations')); }
    catch (error) { setConnectionError(error instanceof Error ? error.message : '연결 상태를 확인하지 못했습니다.'); }
    finally { setCheckingConnections(false); }
  }

  const applyWorkspace = useCallback((results: Awaited<ReturnType<typeof fetchWorkspace>>) => {
    const [productData, settingData, collectionData, categoriesData] = results;
    if (productData.status === 'fulfilled') setProducts(productData.value.products);
    if (productData.status === 'fulfilled') setDetail(current=>current?productData.value.products.find(product=>product.id===current.id)??current:null);
    if (settingData.status === 'fulfilled') setSettings(savedRegistrationSettings(settingData.value.settings));
    if (collectionData.status === 'fulfilled') setCollectionJobs(collectionData.value.jobs);
    if (categoriesData.status === 'fulfilled') setCategoryProfiles(categoriesData.value.profiles);
    setLoadError(results.filter(r => r.status === 'rejected').map(r => String(r.reason instanceof Error ? r.reason.message : r.reason)).join(' '));
    setLoading(false);
  }, []);
  async function loadWorkspace() {
    const detailId=detail?.id;
    const [workspace,currentDetail]=await Promise.all([
      fetchWorkspace(),
      detailId?readJson<{product:Product}>(`/api/products/${encodeURIComponent(detailId)}`).catch(()=>null):Promise.resolve(null),
    ]);
    applyWorkspace(workspace);
    if(currentDetail)setDetail(current=>current?.id===detailId?currentDetail.product:current);
  }
  async function openArchivedProduct(id: string) {
    const result=await readJson<{product:Product}>(`/api/products/${encodeURIComponent(id)}`);
    openProduct(result.product);
  }
  useEffect(() => {
    let active = true;
    fetchWorkspace().then(results => { if (active) applyWorkspace(results); });
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

  async function savePrice(policy: PricePolicy) {
    if (!detail) throw new Error('상품을 선택해주세요.');
    const result = await readJson<{ product: Product }>('/api/products/' + detail.id + '/pricing', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ policy, expectedVersion: detail.updated_at }),
    });
    setProducts(current => current.map(product => product.id === result.product.id ? result.product : product));
    setDetail(current => current?.id === result.product.id ? result.product : current);
  }

  async function runAutomation() {
    if(!products.some(item=>selected.has(item.id))){showToast('작업할 상품을 선택해주세요.');return;}
    setBatchOpen(true);
  }

  async function saveWorkspaceSettings(value: Settings) {
    const result = await readJson<{settings:Settings}>('/api/settings', {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
    setSettings(result.settings);setSettingsOpen(false);showToast('기본 설정을 저장했습니다.');
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


  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">Y</span><span>YOOFAM PLUS</span></div>
        <nav aria-label="주 메뉴"><p className="nav-caption">WORKSPACE</p>
          <button className={`nav-item ${view==='work'?'active':''}`} onClick={()=>setView('work')}><span>✦</span>AI 상품등록</button>
          <button className={`nav-item ${view==='archive'?'active':''}`} onClick={()=>setView('archive')}><span>▦</span>상품 관리</button><button className="nav-item"><span>◫</span>공급 관리</button><button className="nav-item"><span>▤</span>판매 장부</button>
          <p className="nav-caption nav-gap">AUTOMATION</p><button className="nav-item" onClick={()=>void checkConnections()}><span>⌁</span>연동 설정</button><button className="nav-item" onClick={()=>{setHistoryProductId(detail?.id??products[0]?.id??'');setHistoryOpen(true);}}><span>↻</span>작업 이력</button>
        </nav>
        <div className="sidebar-status"><span className="status-dot" /><div><strong>자동화 엔진</strong><small>작업별 연결 상태 확인</small></div></div>
      </aside>

      <section className="content">
        <header className="topbar"><div><h1>로켓배송 AI상품등록</h1><p>상품별 등록 현황 및 관리</p></div>
          <div className="top-actions"><span className="workspace-user">{userName}</span><button className="btn settings" onClick={()=>setSettingsOpen(true)}>⚙ 기본설정</button><button className="btn primary" onClick={()=>{setAddOpen(true);}}>＋ 상품 추가</button><details className="bulk-action-menu"><summary className="btn ghost">전체 작업 ▾</summary><div><button type="button" onClick={()=>setSelected(new Set(products.map(product=>product.id)))}>최근 상품 전체 선택</button><button type="button" onClick={()=>setSelected(new Set())}>선택 해제</button><button type="button" onClick={()=>setBatchOpen(true)}>선택 상품 일괄 작업</button><button type="button" onClick={()=>{setHistoryProductId(products[0]?.id??'');setHistoryOpen(true);}}>작업 이력</button></div></details><button className="btn start" disabled={busy} onClick={runAutomation}>작업 개시</button><button className="btn rose" onClick={()=>setTransmitOpen(true)}>등록 전송</button></div></header>

        <div className="panel-note" role="note"><div><strong>수집 공급원 연결 대기 · 실제 자동화 미완성</strong><p>카테고리와 양식을 선택해 수집을 요청하세요. 자동수집 공급원은 연결 대기 중이며, 저장된 상품의 자료 편집·가격 계산·견적서 출력은 사용할 수 있습니다. AI 번역·이미지 가공은 서버 설정과 유료 승인 후 실행합니다.</p></div></div>
        {loadError&&<div className="panel-note" role="alert"><p>{loadError}</p><button className="btn ghost" onClick={()=>{setLoading(true);setLoadError('');void loadWorkspace();}} disabled={loading}>다시 불러오기</button></div>}
        {pendingUpload&&<div className="panel-note" role="status"><div><strong>업로드 파일 연결 대기</strong><p>파일은 보관돼 있습니다. 상품에 연결하기를 다시 시도할 수 있습니다.</p></div><button className="btn ghost" disabled={busy} onClick={()=>void retryUploadedImage()}>보관된 이미지 연결 재시도</button></div>}


        {view==='archive'?<ProductArchive onOpenProduct={openArchivedProduct} refreshToken={`${collectionJobs[0]?.updated_at}:${products[0]?.updated_at}`}/>:<>
        <details className="collection-panel" aria-label="수집 대기열"><summary>상품 대기열 · {collectionJobs.filter(job=>job.status!=='cancelled').length}건</summary>
          <CollectionBatchPanel jobs={collectionJobs} onSaved={()=>void loadWorkspace()} onOpenProduct={openCollectedProduct}/>
          <div className="collection-heading"><div><h2>수집 대기열 <span>{collectionJobs.filter(job => job.status !== 'cancelled').length}</span></h2><p>{collectionBlock}</p></div><button className="btn ghost" disabled={loading || busy} onClick={()=>{setLoading(true);void loadWorkspace();}}>새로고침</button></div>
          <label className="collection-history"><input type="checkbox" checked={showCancelled} onChange={event=>setShowCancelled(event.target.checked)} />취소한 요청 보기 · 최근 200건</label>
          {!collectionJobs.some(job=>showCancelled || job.status !== 'cancelled') && <p className="collection-empty">{loading ? '대기열을 불러오는 중입니다.' : loadError ? '대기열 조회 상태를 확인해주세요.' : '아직 수집 요청이 없습니다. 상품 추가에서 URL을 붙여넣으세요.'}</p>}
          <ul className="collection-list">{collectionJobs.filter(job=>showCancelled || job.status !== 'cancelled').map(job=><li key={job.id}><div><strong>1688 · {job.offer_id}</strong><a href={job.source_url} target="_blank" rel="noreferrer" style={{overflowWrap:"anywhere"}}>{job.source_url}</a><small>{job.context?.category.categoryPath.join(' > ') ?? '카테고리 미지정 · 기존 요청'}</small><small>목표: {goalOptions.find(goal=>goal.id===job.goal)?.title} · 요청 {new Date(job.created_at).toLocaleString('ko-KR')}</small>{job.received_at&&<small>원문 수신 {new Date(job.received_at).toLocaleString('ko-KR')}</small>}</div><span className={`collection-status ${collectionJobProgress(job).kind}`}>{collectionJobProgress(job).label}</span><CollectionResultPanel jobId={job.id} offerId={job.offer_id} productId={job.product_id} onSaved={()=>void loadWorkspace()} onOpenProduct={openCollectedProduct}/>{!job.product_id && job.status !== 'cancelled' && <button className="btn ghost" disabled={busy} aria-label={`${job.offer_id} 수집 취소`} onClick={()=>void cancelCollectionJob(job.id)}>취소</button>}</li>)}</ul>
        </details>

        <RegistrationBoard products={products} selected={selected} onSelected={setSelected} onOpen={openProduct} onOptions={setOptionBoardProduct} loading={loading} error={loadError} onArchive={()=>setView('archive')}/></>}
      </section>

      {addOpen&&<Modal wide title="상품 대기열" subtitle="상품마다 카테고리·URL·특징·키워드를 지정합니다." onClose={()=>{if(!busy&&!intakeDraft.loading)setAddOpen(false);}}>
        <div className="intake-draft-actions"><p role="status">{intakeDraft.message}{intakeDraft.dirty?' · 저장하지 않은 변경 있음':''}</p><button type="button" className="btn ghost" disabled={busy||intakeDraft.saving||!intakeDraft.ready} onClick={()=>void intakeDraft.save()}>{intakeDraft.autoPaused?'저장 다시 시도':intakeDraft.saving?'저장 중…':'지금 저장'}</button><button type="button" className="btn ghost" disabled={busy||intakeDraft.saving} onClick={()=>{if(!intakeDraft.dirty||window.confirm('현재 미저장 입력을 서버 초안으로 교체할까요?'))void intakeDraft.load();}}>{intakeDraft.ready?'서버 초안으로 교체':'초안 다시 불러오기'}</button></div>
        {intakeDraft.ready&&!intakeDraft.loading&&<IntakeQueuePanel goal={intakeGoal} onGoal={setIntakeGoal} rows={intakeRows} onRows={setIntakeRows} profiles={categoryProfiles} onBusy={setBusy}
          onProfile={profile=>setCategoryProfiles(current=>[profile,...current.filter(item=>item.id!==profile.id)])}
          onJobs={jobs=>{setCollectionJobs(current=>[...jobs,...current.filter(job=>!jobs.some(saved=>saved.id===job.id))]);if(jobs.some(job=>job.product_id))void loadWorkspace();}}
          onAdvanced={seed=>{setEditingCategory(seed?.profileId?categoryProfiles.find(profile=>profile.id===seed.profileId)??null:null);setCategorySeed(seed?{name:seed.categoryPath.at(-1)??'',categoryId:seed.categoryId,categoryPath:seed.categoryPath,template:null,mappings:[]}:undefined);setAddOpen(false);setCategoryOpen(true);}}/>}
      </Modal>}
      {categoryOpen&&<Modal wide title="카테고리·견적서 연결" subtitle="상품 자료를 견적서 열에 연결하고 카테고리별 설정을 보관합니다." onClose={()=>setCategoryOpen(false)}><CategoryProfileEditor value={editingCategory} initialDraft={categorySeed} onClose={()=>setCategoryOpen(false)} onSave={profile=>{setCategoryProfiles(current=>[profile,...current.filter(item=>item.id!==profile.id)]);setCategoryOpen(false);setAddOpen(true);}}/></Modal>}

      {settingsOpen&&<Modal wide title="기본설정" subtitle="가격·물류·이미지 작업의 기본값을 관리합니다. 취소하면 변경은 반영되지 않습니다." onClose={()=>setSettingsOpen(false)}><WorkspaceSettingsDialog onSave={saveWorkspaceSettings} onClose={()=>setSettingsOpen(false)}/></Modal>}
      {batchOpen&&<Modal wide title="선택 상품 일괄 작업" subtitle="저장한 상품을 순서대로 처리하고 각 결과를 기록합니다." onClose={()=>setBatchOpen(false)}><BatchWorkPanel products={products.filter(product=>selected.has(product.id))} onOpen={id=>{setBatchOpen(false);const product=products.find(product=>product.id===id);if(product)openProduct(product,'작업');}}/></Modal>}
      {historyOpen&&<Modal wide title="상품별 작업 이력" subtitle="각 상품에 저장된 단계별 산출물과 실행 이력을 확인합니다." onClose={()=>setHistoryOpen(false)}><div className="modal-form"><label>상품 선택<select aria-label="작업 이력 상품 선택" value={historyProductId} onChange={event=>setHistoryProductId(event.target.value)}>{!products.length&&<option value="">저장된 상품 없음</option>}{products.map(product=><option key={product.id} value={product.id}>{product.title}</option>)}</select></label>{products.filter(product=>product.id===historyProductId).map(product=><AutomationPanel key={product.id} productId={product.id} version={product.updated_at}/>)}</div></Modal>}

      {detail&&<div className="drawer-backdrop" onMouseDown={()=>closeWorkspace()}><aside className="detail-drawer registration-workspace" role="dialog" aria-modal="true" aria-label="상품 등록 작업 공간" onMouseDown={e=>e.stopPropagation()}>
        <header><div className="detail-heading"><span className="drawer-eyebrow">PRODUCT WORKSPACE · 등록 자료 준비</span><h2>{detail.title}</h2><div className="detail-product-meta"><span>YP-{detail.id.slice(0,8).toUpperCase()}</span><time dateTime={detail.created_at}>등록 {registrationDate(detail.created_at)}</time><span>{detail.options_count}개 옵션</span></div><div className="detail-source"><span>1688 원본 URL</span>{sourceLink(detail.source_url)?<a href={sourceLink(detail.source_url)} target="_blank" rel="noopener noreferrer">{detail.source_url}</a>:<span className="detail-source-value">{detail.source_url||'원본 URL 미입력'}</span>}</div></div><button className="icon-close" aria-label="상품 작업 공간 닫기" onClick={()=>closeWorkspace()}>×</button></header>{closeNotice&&<p role="status" className="panel-note">{closeNotice}</p>}
        <nav className="registration-steps" aria-label="상품 등록 7단계">{registrationSteps.map((value,index)=><button type="button" key={value} onClick={()=>selectDetailTab(value)} aria-current={tab===value?'step':undefined} className={tab===value?'active':''}><span>{index+1}</span><strong>{value}</strong></button>)}</nav>
        <nav className="registration-tools" aria-label="상품 보조 작업"><span>보조 작업</span>{supportingTabs.map(item=><button key={item.value} type="button" onClick={()=>selectDetailTab(item.value)} aria-pressed={tab===item.value} className={tab===item.value?'active':''}>{item.label}</button>)}<small>단계 이동 시 입력 유지 · 각 단계에서 저장</small></nav>
        <div className="detail-body" ref={detailBody}><DetailPanel key={detail.id} focusedOptionId={focusedOptionId} preferredProfileId={detailProfileId} quotationTarget={quotationTarget} onSaved={()=>void loadWorkspace()} onManageCategories={()=>closeWorkspace(true)} onSavePrice={savePrice} tab={tab} product={detail} settings={settings} onUpload={uploadImage}/></div>
        <footer className="registration-navigation">{detailStepIndex>=0?<><button type="button" className="btn ghost" disabled={detailStepIndex===0} onClick={()=>selectDetailTab(registrationSteps[detailStepIndex-1])}>← 이전{detailStepIndex>0?` · ${registrationSteps[detailStepIndex-1]}`:''}</button><div><strong>{detailStepIndex+1} / {registrationSteps.length} · {tab}</strong><small>입력 단계이며 자동화 완료 상태를 뜻하지 않습니다.</small></div><button type="button" className="btn primary" disabled={detailStepIndex===registrationSteps.length-1} onClick={()=>selectDetailTab(registrationSteps[detailStepIndex+1])}>{detailStepIndex===registrationSteps.length-1?'마지막 단계':`다음 · ${registrationSteps[detailStepIndex+1]} →`}</button></>:<><span>보조 작업 · {supportingTabs.find(item=>item.value===tab)?.label}</span><button type="button" className="btn primary" onClick={()=>selectDetailTab(lastRegistrationStep)}>{registrationSteps.indexOf(lastRegistrationStep)+1}. {lastRegistrationStep} 단계로 돌아가기 →</button></>}</footer>
      </aside></div>}

      {optionBoardProduct&&<Modal wide title={optionBoardProduct.title} subtitle="옵션별 상품 자료와 견적서를 확인합니다." onClose={()=>setOptionBoardProduct(null)}><ProductOptionBoard key={optionBoardProduct.id} productId={optionBoardProduct.id} sourceUrl={optionBoardProduct.source_url} imageKeys={optionBoardProduct.image_keys} onContent={step=>{openProduct(optionBoardProduct,step);setOptionBoardProduct(null);}} onImage={optionId=>{openProduct(optionBoardProduct,'옵션',undefined,undefined,optionId);setOptionBoardProduct(null);}} onEdit={optionId=>{openProduct(optionBoardProduct,'가격',undefined,undefined,optionId);setOptionBoardProduct(null);}} onQuotation={optionId=>{openProduct(optionBoardProduct,'견적서',undefined,{optionId,fieldId:'title'});setOptionBoardProduct(null);}}/></Modal>}
      {transmitOpen&&<Modal title="Supplier Hub 등록 전송" subtitle="선택 상품의 실제 저장 자료를 검사하고 필요한 항목을 수정하세요." onClose={()=>setTransmitOpen(false)}><SubmissionReviewPanel products={products.filter(product=>selected.has(product.id))} profiles={categoryProfiles} onEdit={(id,preferredProfileId,target)=>{const product=products.find(item=>item.id===id);if(product){setTransmitOpen(false);openProduct(product,'견적서',preferredProfileId,target);}}}/></Modal>}

      {connectionsOpen&&<Modal title="연동 상태" subtitle="현재 실행 중인 서버를 확인합니다. Cloudflare 운영 배포 여부와는 별개입니다." onClose={()=>setConnectionsOpen(false)}>
        <div className="settings-form">
          {checkingConnections&&<p role="status">서버 연결을 확인하고 있습니다.</p>}
          {connectionError&&<p role="alert">{connectionError}</p>}
          {connections&&<><dl className="connection-list">
            <div><dt>Cloudflare Workers</dt><dd>현재 서버 응답 확인</dd></div>
            <div><dt>작업 공간 인증</dt><dd>{connections.authentication==='cloudflare_access'?'Cloudflare Access 검증됨':'이 PC의 로컬 개발 환경'}</dd></div>
            <div><dt>D1 · 상품 및 설정</dt><dd>{connections.database==='query_ok'?'읽기 쿼리 성공':'연결 확인 실패'}</dd></div>
            <div><dt>저장 테이블</dt><dd>{connections.databaseSchema?.status==='tables_present'?'필요 테이블 있음 · 열 구조 및 저장 동작은 별도 검증':connections.databaseSchema?.status==='missing_tables'?`업데이트 필요 · 누락: ${connections.databaseSchema.missingTables.join(', ')}`:'테이블 확인 실패 · 연결을 다시 확인해주세요'}</dd></div>
            <div><dt>R2 · 이미지 파일</dt><dd>{connections.files==='binding_present'?'바인딩 있음 · 읽기/쓰기 미검증':'바인딩 없음'}</dd></div>
            <div><dt>상품 자동수집</dt><dd>상품 데이터 공급원 연결 필요</dd></div>
            <div><dt>AI 번역·SEO</dt><dd>{connections.translation.configured?'서버 설정됨 · '+connections.translation.model+' · 실제 호출 별도 검증':'서버 모델·키 설정 필요'}</dd></div>
            <div><dt>AI 이미지 가공</dt><dd>{connections.imageProcessing.configured?'서버 설정됨 · '+connections.imageProcessing.model+' · 실제 호출 별도 검증':'서버 모델·키 설정 필요'}</dd></div>
            <div><dt>쿠플러스 확장</dt><dd>미확인 · 연결 코드 없음</dd></div>
            <div><dt>Supplier Hub 탭</dt><dd>미확인 · 열린 탭 관찰 필요</dd></div>
            <div><dt>CLI</dt><dd>미확인 · 역할 분석 필요</dd></div>
          </dl><p>Supplier Hub를 열어두어야 한다는 조건은 전달받았지만, 확장과 탭의 실제 연결 방식은 아직 검증하지 못했습니다. 제안 전송은 차단되어 있습니다.</p><small>확인 시각: {new Date(connections.checkedAt).toLocaleString('ko-KR')}</small></>}
          <div className="modal-actions"><button className="btn ghost" onClick={()=>setConnectionsOpen(false)}>닫기</button><button className="btn primary" disabled={checkingConnections} onClick={()=>void checkConnections()}>다시 확인</button></div>
        </div>
      </Modal>}
      {toast&&<div className="toast" role="status"><span>ⓘ</span>{toast}</div>}
    </main>
  );
}

function Modal({ title, subtitle, onClose, children, wide=false }: { title:string; subtitle:string; onClose:()=>void; children:React.ReactNode; wide?:boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={e=>e.stopPropagation()}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-close" onClick={onClose}>×</button></header>{children}</section></div>;
}
function DetailPanel({ tab, product, settings, onUpload, onSavePrice, onSaved, onManageCategories, preferredProfileId, quotationTarget, focusedOptionId }: { focusedOptionId?:string; quotationTarget?:QuotationNavigationTarget; preferredProfileId?:string; onSavePrice:(policy:PricePolicy)=>Promise<void>; tab:string; product:Product; settings:Settings; onSaved:()=>void; onManageCategories:()=>void; onUpload:(e:ChangeEvent<HTMLInputElement>)=>void }) {
  const [quotationRefresh, setQuotationRefresh] = useState(0);
  function sourceSaved() { setQuotationRefresh(value => value + 1); onSaved(); }
  async function saveSourcePrice(policy: PricePolicy) { await onSavePrice(policy); setQuotationRefresh(value => value + 1); }
  const isImageStep=imageSteps.includes(tab);
  const contentSection = isImageStep ? '이미지' : tab==='표시사항' ? '표시사항' : 'SEO';
  const focusedAssetRole=tab==='대표 이미지'?'main':tab==='추가 이미지'?'additional':tab==='상세 이미지'?'detail':undefined;
  let imageKeys:string[]=[];try{const keys:unknown=JSON.parse(product.image_keys);if(Array.isArray(keys))imageKeys=keys.filter((key):key is string=>typeof key==='string');}catch{/* The file and content APIs report invalid stored references. */}
  return <>
    <div hidden={!['SEO','표시사항',...imageSteps].includes(tab)} className="panel-stack">
      {isImageStep&&<label className="btn primary upload-btn">＋ 이미지 업로드<input type="file" accept="image/*" onChange={onUpload}/></label>}
      <ProductContentEditor product={product} section={contentSection} focusedAssetRole={focusedAssetRole} onSaved={sourceSaved}/>
    </div>
    <div hidden={!isImageStep} className="panel-stack"><ImageGenerationPanel productId={product.id} version={product.updated_at} imageKeys={imageKeys} onProductChanged={sourceSaved}/></div>
    <div hidden={tab!=='표시사항'}><DocumentImagePanel productId={product.id} version={product.updated_at} section="label" onSaved={sourceSaved}/></div>
    {tab==='작업'&&<AutomationPanel productId={product.id} version={product.updated_at}/>}
    <div hidden={tab!=='번역'}><TranslationPanel productId={product.id} version={product.updated_at} title={product.title} onContentSaved={sourceSaved}/></div>
    <div data-quotation-source-step="가격" hidden={!['옵션','가격'].includes(tab)} className={tab==='가격'?'pricing-workspace':'panel-stack'}>
      <section hidden={tab!=='가격'} className="pricing-policy-panel"><h3>가격 정책 설정</h3><PriceEditor productId={product.id} version={product.updated_at} sourcePrice={product.source_price_cny} initial={savedPricePolicy(product,settings)} onSave={saveSourcePrice}/></section>
      <section className="pricing-options-panel"><ProductOptionsEditor focusedOptionId={focusedOptionId} product={product} onSaved={sourceSaved} pricingView={tab==='가격'}/><div hidden={tab!=='옵션'}><DocumentImagePanel productId={product.id} version={product.updated_at} section="size" onSaved={sourceSaved}/></div></section>
    </div>
    <div hidden={tab!=='견적서'} className="panel-stack"><QuotationPanel productId={product.id} preferredProfileId={preferredProfileId} navigationTarget={quotationTarget} refreshToken={`${product.updated_at}:${quotationRefresh}:${JSON.stringify(settings)}`} onManageCategories={onManageCategories}/><details><summary>대표 상품 가격·내부 CSV 참고</summary><LegacyQuotePanel product={product} settings={settings}/></details></div>
  </>;
}
function LegacyQuotePanel({ product, settings }: {product:Product;settings:Settings}) {
  return <div className="panel-stack"><article className="quote-sheet"><header><div><span>SUPPLY QUOTATION</span><h3>대표 상품 가격 참고</h3></div><strong>YP-{product.id.slice(0,8).toUpperCase()}</strong></header><dl><div><dt>상품명</dt><dd>{product.title}</dd></div><div><dt>옵션 수</dt><dd>{product.options_count}개</dd></div><div><dt>공급가</dt><dd>{won(product.supply_price)}</dd></div><div><dt>권장 판매가</dt><dd>{won(product.sale_price)}</dd></div><div><dt>시장가격(MSRP)</dt><dd>{won(product.msrp)}</dd></div><div><dt>수입·판매원</dt><dd>{settings.importer}</dd></div></dl><footer><span>내부 검토용 · Supplier Hub 호환 미검증</span><strong>YOOFAM PLUS</strong></footer></article><p>SEO·표시사항·이미지 탭에서 저장한 자료는 검토 ZIP에 포함됩니다. 연결된 원본 양식을 채우려면 위에서 카테고리와 입력 행을 선택하세요.</p><div className="quote-actions"><button className="btn ghost" onClick={()=>window.print()}>견적서 인쇄 / PDF</button><button className="btn primary" onClick={()=>downloadQuote(product,settings)}>견적 CSV 다운로드</button></div></div>;
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

function savedPricePolicy(product: Product, settings: Settings): PricePolicy {
  if (product.pricing_policy) { try { return pricePolicy(JSON.parse(product.pricing_policy)); } catch { /* Older records use current defaults. */ } }
  return {exchangeRate:product.exchange_rate,supplyMargin:product.supply_margin,coupangMargin:product.coupang_margin,minimumMargin:settings.minimumMarginEnabled?settings.minimumMargin:0,msrpMultiple:settings.msrpMultiple,roundingUnit:settings.roundingUnit,roundingMode:settings.roundingMode};
}
