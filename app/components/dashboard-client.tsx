'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CategoryProfileEditor } from '@/app/components/category-profile-editor';
import { ProductContentEditor } from '@/app/components/product-content-editor';
import { AutomationPanel } from '@/app/components/automation-panel';
import { ProductOptionsEditor } from '@/app/components/product-options-editor';
import { QuotationPanel } from '@/app/components/quotation-panel';
import TranslationPanel from '@/app/components/translation-panel';
import ImageGenerationPanel from '@/app/components/image-generation-panel';
import { DocumentImagePanel } from '@/app/components/document-image-panel';
import type { ProductContent } from '@/app/product-content';
import { BatchWorkPanel } from '@/app/components/batch-work-panel';
import type { CategoryProfile } from '@/app/category-profiles';
import { WorkspaceSettingsEditor } from '@/app/components/workspace-settings-editor';
import { defaultSettings as defaults, type WorkspaceSettings as Settings } from '@/app/workspace-settings';
import { PriceEditor } from '@/app/components/price-editor';
import { quotationCsv, pricePolicy, type PricePolicy } from '@/app/pricing';
import { collectionBlock, parseCollectionRequest, type CollectionJob } from '@/app/sourcing';

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
  translation: { configured: boolean; model: string|null; issues: string[] };
  imageProcessing: { configured: boolean; model: string|null; issues: string[] };
};

async function readJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? '요청에 실패했습니다.');
  return result as T;
}

const stages = [
  { label:'상품 수집', detail:'1688 URL', tone:'blue' }, { label:'AI 최적화', detail:'SEO · 가격', tone:'purple' },
  { label:'콘텐츠 제작', detail:'이미지 · 상세', tone:'orange' }, { label:'제안 전송', detail:'견적서 · Supplier Hub', tone:'green' },
];

function fetchWorkspace() {
  return Promise.allSettled([
    readJson<{ products: Product[] }>('/api/products'),
    readJson<{ settings: Partial<Settings> | null }>('/api/settings'),
    readJson<{ jobs: CollectionJob[] }>('/api/collection-jobs'),
    readJson<{ profiles: CategoryProfile[] }>('/api/category-profiles'),
  ]);
}
const goalOptions = [
  { id:'collect', title:'상품 수집', desc:'수집 연결 후 원문·옵션·원가를 확인합니다.' },
  { id:'price', title:'SEO + 가격', desc:'수집 후 번역 검토와 가격 계산을 준비합니다.' },
  { id:'work', title:'전체 작업', desc:'수집 후 이미지·표시사항·견적 자료까지 준비합니다.' },
  { id:'transmit', title:'전송 준비', desc:'미검증 · 전송은 차단됩니다.' },
];

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
export default function DashboardClient({ userName }: { userName: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(defaults);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('전체');
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transmitOpen, setTransmitOpen] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);
  const [tab, setTab] = useState('SEO');
  const [busy, setBusy] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProductId, setHistoryProductId] = useState('');
  const [pendingUpload,setPendingUpload]=useState<{productId:string;key:string}|null>(null);
  const [toast, setToast] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connections, setConnections] = useState<IntegrationStatus | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [checkingConnections, setCheckingConnections] = useState(false);
  const [collectionJobs, setCollectionJobs] = useState<CollectionJob[]>([]);
  const [collectionError, setCollectionError] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [categoryProfiles, setCategoryProfiles] = useState<CategoryProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryProfile|null>(null);
  const [intakeStep, setIntakeStep] = useState<'category'|'urls'>('category');
  const collectionPreview = useMemo(() => {
    if (!urlInput.trim()) return { count: 0, duplicates: 0, error: '' };
    const urls = urlInput.trim().split(/\s+/);
    try { const entries = parseCollectionRequest({ urls }); return { count: entries.length, duplicates: urls.length - entries.length, error: '' }; }
    catch (error) { return { count: 0, duplicates: 0, error: error instanceof Error ? error.message : 'URL을 확인해주세요.' }; }
  }, [urlInput]);

  async function checkConnections() {
    setConnectionsOpen(true); setCheckingConnections(true); setConnectionError(''); setConnections(null);
    try { setConnections(await readJson<IntegrationStatus>('/api/integrations')); }
    catch (error) { setConnectionError(error instanceof Error ? error.message : '연결 상태를 확인하지 못했습니다.'); }
    finally { setCheckingConnections(false); }
  }

  const applyWorkspace = useCallback((results: Awaited<ReturnType<typeof fetchWorkspace>>) => {
    const [productData, settingData, collectionData, categoriesData] = results;
    if (productData.status === 'fulfilled') setProducts(productData.value.products);
    if (productData.status === 'fulfilled') setDetail(current=>current?productData.value.products.find(product=>product.id===current.id)??null:null);
    if (settingData.status === 'fulfilled' && settingData.value.settings) setSettings({ ...defaults, ...settingData.value.settings });
    if (collectionData.status === 'fulfilled') setCollectionJobs(collectionData.value.jobs);
    if (categoriesData.status === 'fulfilled') setCategoryProfiles(categoriesData.value.profiles);
    setLoadError(results.filter(r => r.status === 'rejected').map(r => String(r.reason instanceof Error ? r.reason.message : r.reason)).join(' '));
    setLoading(false);
  }, []);
  async function loadWorkspace() {
    applyWorkspace(await fetchWorkspace());
  }
  useEffect(() => {
    let active = true;
    fetchWorkspace().then(results => { if (active) applyWorkspace(results); });
    return () => { active = false; };
  }, [applyWorkspace]);

  const filtered = useMemo(() => products.filter((p) => {
    const matchesQuery = `${p.title} ${p.source_url}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === '전체' || (filter === '작업 중' && !['전송 가능','전송완료'].includes(p.registration_status)) || p.registration_status === filter;
    return matchesQuery && matchesFilter;
  }), [products, query, filter]);

  const ready = products.filter(p => p.registration_status === '전송 가능');
  const completed = products.filter(p => p.seo_status === '완료').length;
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600); };

  async function createProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setCollectionError('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await readJson<{ jobs: CollectionJob[] }>('/api/collection-jobs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: urlInput.trim().split(/\s+/), goal: String(data.get('goal')), profileId, features: String(data.get('features')??''), keywords: String(data.get('keywords')??'') }),
      });
      setCollectionJobs(current => [...result.jobs, ...current.filter(job => !result.jobs.some(saved => saved.id === job.id))]);
      setUrlInput(''); setAddOpen(false);
      showToast(`${result.jobs.length}건의 수집 요청을 확인했습니다. 공급원 연결 대기 중입니다.`);
    } catch (error) { setCollectionError(error instanceof Error ? error.message : '수집 요청을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

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
      showToast('이미지를 추가했습니다. 이미지 탭에서 역할을 지정할 수 있습니다.');
    } catch (error) { showToast(error instanceof Error ? error.message : '업로드하지 못했습니다.'); }
    finally { setBusy(false); event.target.value=''; }
  }

  async function transmit() {
    showToast('Supplier Hub 연결과 제안 규격이 미검증이므로 전송할 수 없습니다.');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>SOURCEFLOW</span></div>
        <nav aria-label="주 메뉴"><p className="nav-caption">WORKSPACE</p>
          <button className="nav-item active"><span>✦</span>AI 상품등록</button>
          <button className="nav-item"><span>▦</span>상품 관리</button><button className="nav-item"><span>◫</span>공급 관리</button><button className="nav-item"><span>▤</span>판매 장부</button>
          <p className="nav-caption nav-gap">AUTOMATION</p><button className="nav-item" onClick={()=>void checkConnections()}><span>⌁</span>연동 설정</button><button className="nav-item" onClick={()=>{setHistoryProductId(detail?.id??products[0]?.id??'');setHistoryOpen(true);}}><span>↻</span>작업 이력</button>
        </nav>
        <div className="sidebar-status"><span className="status-dot" /><div><strong>자동화 엔진</strong><small>작업별 연결 상태 확인</small></div></div>
      </aside>

      <section className="content">
        <header className="topbar"><div><p className="eyebrow">ROCKET DELIVERY AUTOMATION</p><h1>로켓배송 AI상품등록</h1><p>소싱 URL부터 Supplier Hub 제안서까지 한 번에 준비하세요.</p></div>
          <div className="top-actions"><div className="user-chip"><span>{userName.slice(0,1).toUpperCase()}</span><div><strong>{userName}</strong><small>Rocket seller</small></div></div><button className="btn ghost" onClick={()=>setSettingsOpen(true)}>⚙ 기본설정</button><button className="btn primary" onClick={()=>{setIntakeStep('category');setAddOpen(true);}}>＋ 상품 추가</button></div></header>

        <div className="panel-note" role="note"><div><strong>수집 공급원 연결 대기 · 실제 자동화 미완성</strong><p>카테고리와 양식을 선택해 수집을 요청하세요. 자동수집 공급원은 연결 대기 중이며, 저장된 상품의 자료 편집·가격 계산·견적서 출력은 사용할 수 있습니다. AI 번역·이미지 가공은 서버 설정과 유료 승인 후 실행합니다.</p></div></div>
        {loadError&&<div className="panel-note" role="alert"><p>{loadError}</p><button className="btn ghost" onClick={()=>{setLoading(true);setLoadError('');void loadWorkspace();}} disabled={loading}>다시 불러오기</button></div>}
        {pendingUpload&&<div className="panel-note" role="status"><div><strong>업로드 파일 연결 대기</strong><p>파일은 보관돼 있습니다. 상품에 연결하기를 다시 시도할 수 있습니다.</p></div><button className="btn ghost" disabled={busy} onClick={()=>void retryUploadedImage()}>보관된 이미지 연결 재시도</button></div>}
        <section className="pipeline" aria-label="자동화 진행 단계">{stages.map((stage,index)=><div className="step" key={stage.label}><span className={`step-number ${stage.tone}`}>{index+1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div>{index<3&&<span className="step-arrow">→</span>}</div>)}</section>

        <section className="collection-panel" aria-label="수집 대기열">
          <div className="collection-heading"><div><h2>수집 대기열 <span>{collectionJobs.filter(job => job.status !== 'cancelled').length}</span></h2><p>{collectionBlock}</p></div><button className="btn ghost" disabled={loading || busy} onClick={()=>{setLoading(true);void loadWorkspace();}}>새로고침</button></div>
          <label className="collection-history"><input type="checkbox" checked={showCancelled} onChange={event=>setShowCancelled(event.target.checked)} />취소한 요청 보기 · 최근 200건</label>
          {!collectionJobs.some(job=>showCancelled || job.status !== 'cancelled') && <p className="collection-empty">{loading ? '대기열을 불러오는 중입니다.' : loadError ? '대기열 조회 상태를 확인해주세요.' : '아직 수집 요청이 없습니다. 상품 추가에서 URL을 붙여넣으세요.'}</p>}
          <ul className="collection-list">{collectionJobs.filter(job=>showCancelled || job.status !== 'cancelled').map(job=><li key={job.id}><div><strong>1688 · {job.offer_id}</strong><small>{job.source_url}</small><small>{job.context?.category.categoryPath.join(' > ') ?? '카테고리 미지정 · 기존 요청'}</small><small>목표: {goalOptions.find(goal=>goal.id===job.goal)?.title} · 요청 {new Date(job.created_at).toLocaleString('ko-KR')}</small></div><span className={`collection-status ${job.status}`}>{job.status === 'cancelled' ? '취소됨' : '수집 연결 대기'}</span>{job.status !== 'cancelled' && <button className="btn ghost" disabled={busy} aria-label={`${job.offer_id} 수집 취소`} onClick={()=>void cancelCollectionJob(job.id)}>취소</button>}</li>)}</ul>
        </section>

        <section className="summary-grid">
          <article><span className="metric-icon blue">◈</span><div><small>전체 상품</small><strong>{products.length}</strong></div><em>저장된 상품</em></article>
          <article><span className="metric-icon purple">✦</span><div><small>기존 완료 표시 (미검증)</small><strong>{completed}</strong></div><em>완료율 {Math.round(completed/Math.max(products.length,1)*100)}%</em></article>
          <article><span className="metric-icon orange">₩</span><div><small>기본 공급 마진</small><strong>{settings.supplyMargin}%</strong></div><em>{settings.minimumMarginEnabled?'최소 '+won(settings.minimumMargin):'최소 마진 사용 안 함'}</em></article>
          <article><span className="metric-icon green">✓</span><div><small>기존 전송 가능 표시</small><strong>{ready.length}</strong></div><em>Supplier Hub</em></article>
        </section>

        <section className="workspace"><div className="workspace-head"><div><h2>상품 작업 보드</h2><p>각 단계를 확인하고 필요한 항목만 바로 수정할 수 있습니다.</p></div><div className="workspace-actions"><button className="btn ghost" onClick={()=>{setIntakeStep('category');setAddOpen(true);}}>카테고리·견적서 설정</button><button className="btn dark" disabled={busy} onClick={runAutomation}>{busy?'처리 중…':'작업 개시'}</button><button className="btn rose" onClick={()=>setTransmitOpen(true)}>등록 전송</button></div></div>
          <div className="filters"><label className="search"><span>⌕</span><input aria-label="상품 검색" value={query} onChange={e=>setQuery(e.target.value)} placeholder="상품명 또는 URL 검색" /></label>{['전체','작업 중','검토 대기','전송 가능'].map(value=><button key={value} onClick={()=>setFilter(value)} className={`filter-chip ${filter===value?'active':''}`}>{value}</button>)}</div>
          <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="전체 선택" checked={selected.size===products.length&&products.length>0} onChange={e=>setSelected(e.target.checked?new Set(products.map(p=>p.id)):new Set())}/></th><th>상품</th><th>소싱 원가</th><th>판매가 / 공급가</th><th>AI 작업</th><th>이미지</th><th>견적서</th><th>상태</th><th /></tr></thead>
            <tbody>{filtered.map((p,index)=><tr key={p.id}><td><input type="checkbox" aria-label={`${p.title} 선택`} checked={selected.has(p.id)} onChange={e=>setSelected(current=>{const next=new Set(current); if (e.target.checked) next.add(p.id); else next.delete(p.id); return next;})}/></td><td><button className="product-cell" onClick={()=>{setDetail(p);setTab('SEO')}}><div className={`product-thumb ${index%3===1?'coral':index%3===2?'violet':''}`}>1688</div><div><strong>{p.title}</strong><span>SF-{p.id.slice(0,8).toUpperCase()} · {p.options_count}개 옵션</span></div></button></td><td><strong>¥ {p.source_price_cny.toFixed(2)}</strong><span className="sub">환율 {p.exchange_rate}원</span></td><td><strong>{won(p.sale_price)}</strong><span className="sub">공급가 {won(p.supply_price)}</span></td><td><Status value={p.seo_status}/></td><td><Status value={p.image_status}/></td><td><Status value={p.quote_status}/></td><td><Status value={p.registration_status}/></td><td><button className="more" aria-label={`${p.title} 상세`} onClick={()=>setDetail(p)}>•••</button></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty"><span>⌕</span><strong>{loading?'상품을 불러오는 중입니다.':loadError?'목록을 확인하지 못했습니다.':'조건에 맞는 상품이 없습니다.'}</strong><small>{loadError?'위 오류를 확인하고 다시 불러와주세요.':'URL을 추가해 수집을 요청하거나 검색 조건을 확인하세요.'}</small></div>}</div>
        </section>
      </section>

      {addOpen&&<Modal wide title="상품 수집 준비" subtitle="카테고리·견적서 연결을 선택한 다음 URL을 입력합니다." onClose={()=>{if(!busy)setAddOpen(false);}}>
        <div className="intake-steps"><button className={intakeStep==='category'?'active':''} onClick={()=>setIntakeStep('category')}>1. 카테고리·견적서</button><button disabled={!profileId} className={intakeStep==='urls'?'active':''} onClick={()=>setIntakeStep('urls')}>2. URL·작업 목표</button></div>
        {intakeStep==='category'?<div className="modal-form"><p>저장한 카테고리 연결을 선택하세요. 공식 목록 동기화와 Supplier Hub 검증은 아직 연결되지 않았습니다.</p>
          <div className="category-options">{categoryProfiles.map(profile=><label className="goal-card" key={profile.id}><input type="radio" name="categoryProfile" value={profile.id} checked={profileId===profile.id} onChange={()=>setProfileId(profile.id)}/><span><strong>{profile.name}</strong><small>{profile.categoryPath.join(' > ')}</small><small>{profile.template?.name??'견적서 양식 미연결'} · 연결 초안 v{profile.revision}</small></span></label>)}</div>
          {!categoryProfiles.length&&<p>저장된 연결이 없습니다. 견적서 양식과 카테고리 연결을 추가해주세요.</p>}
          <div className="modal-actions"><button className="btn ghost" onClick={()=>{setEditingCategory(null);setAddOpen(false);setCategoryOpen(true);}}>카테고리 연결 추가</button><button className="btn ghost" disabled={!profileId} onClick={()=>{setEditingCategory(categoryProfiles.find(profile=>profile.id===profileId)??null);setAddOpen(false);setCategoryOpen(true);}}>연결 수정</button><button className="btn primary" disabled={!profileId} onClick={()=>setIntakeStep('urls')}>선택 후 URL 입력</button></div>
        </div>:<form onSubmit={createProducts} className="modal-form">
          <p><strong>{categoryProfiles.find(profile=>profile.id===profileId)?.categoryPath.join(' > ')}</strong></p>
          <label className="field full"><span>1688 상품 URL <b>필수 · 최대 50개</b></span><textarea name="urls" value={urlInput} onChange={event=>{setUrlInput(event.target.value);setCollectionError('');}} disabled={busy} required placeholder={'https://detail.1688.com/offer/…\n여러 URL은 줄바꿈으로 구분'} aria-describedby="collection-validation" /></label>
          <p id="collection-validation" aria-live="polite">{collectionPreview.error || (collectionPreview.count + '개 상품 · 중복 ' + collectionPreview.duplicates + '개 제외')}</p>
          <div className="form-grid"><label className="field"><span>상품 특징 (선택)</span><textarea name="features" maxLength={2000} disabled={busy}/></label><label className="field"><span>타겟 키워드 (선택)</span><textarea name="keywords" maxLength={2000} disabled={busy}/></label></div>
          <fieldset className="goal-list" disabled={busy}><legend>작업 목표</legend>{goalOptions.map((goal,i)=><label key={goal.id} className="goal-card"><input type="radio" name="goal" value={goal.id} defaultChecked={i===0}/><span><strong>{goal.title}</strong><small>{goal.desc}</small></span></label>)}</fieldset>
          <p className="collection-notice">{collectionBlock} 선택한 카테고리 연결과 저장된 기본설정을 요청에 함께 보관합니다.</p>
          {collectionError&&<p role="alert" className="collection-error">{collectionError}</p>}
          <div className="modal-actions"><button type="button" className="btn ghost" disabled={busy} onClick={()=>setIntakeStep('category')}>이전</button><button className="btn primary" disabled={busy||!profileId||!collectionPreview.count||!!collectionPreview.error}>{busy?'저장 중…':'수집 요청 보관'}</button></div>
        </form>}
      </Modal>}
      {categoryOpen&&<Modal wide title="카테고리·견적서 연결" subtitle="상품 자료를 견적서 열에 연결하고 카테고리별 설정을 보관합니다." onClose={()=>setCategoryOpen(false)}><CategoryProfileEditor value={editingCategory} onClose={()=>setCategoryOpen(false)} onSave={profile=>{setCategoryProfiles(current=>[profile,...current.filter(item=>item.id!==profile.id)]);setProfileId(profile.id);setCategoryOpen(false);setIntakeStep('category');setAddOpen(true);}}/></Modal>}

      {settingsOpen&&<Modal wide title="기본 등록 정보 설정" subtitle="가격·물류·이미지 작업의 기본값을 관리합니다. 취소하면 변경은 반영되지 않습니다." onClose={()=>setSettingsOpen(false)}><WorkspaceSettingsEditor value={settings} onSave={saveWorkspaceSettings} onClose={()=>setSettingsOpen(false)}/></Modal>}
      {batchOpen&&<Modal wide title="선택 상품 일괄 작업" subtitle="저장한 상품을 순서대로 처리하고 각 결과를 기록합니다." onClose={()=>setBatchOpen(false)}><BatchWorkPanel products={products.filter(product=>selected.has(product.id))} onOpen={id=>{setBatchOpen(false);setDetail(products.find(product=>product.id===id)??null);setTab('작업');}}/></Modal>}
      {historyOpen&&<Modal wide title="상품별 작업 이력" subtitle="각 상품에 저장된 단계별 산출물과 실행 이력을 확인합니다." onClose={()=>setHistoryOpen(false)}><div className="modal-form"><label>상품 선택<select aria-label="작업 이력 상품 선택" value={historyProductId} onChange={event=>setHistoryProductId(event.target.value)}>{!products.length&&<option value="">저장된 상품 없음</option>}{products.map(product=><option key={product.id} value={product.id}>{product.title}</option>)}</select></label>{products.filter(product=>product.id===historyProductId).map(product=><AutomationPanel key={product.id} productId={product.id} version={product.updated_at}/>)}</div></Modal>}

      {detail&&<div className="drawer-backdrop" onMouseDown={()=>setDetail(null)}><aside className="detail-drawer" onMouseDown={e=>e.stopPropagation()}><header><div><span className="drawer-eyebrow">PRODUCT WORKSPACE</span><h2>{detail.title}</h2><a href={detail.source_url} target="_blank" rel="noreferrer">1688 원본 보기 ↗</a></div><button className="icon-close" onClick={()=>setDetail(null)}>×</button></header><nav className="detail-tabs">{['작업','번역','SEO','옵션','가격','이미지','표시사항','견적서'].map(value=><button key={value} onClick={()=>setTab(value)} className={tab===value?'active':''}>{value}</button>)}</nav><div className="detail-body"><DetailPanel key={detail.id} onSaved={()=>void loadWorkspace()} onManageCategories={()=>{setDetail(null);setIntakeStep('category');setAddOpen(true);}} onSavePrice={savePrice} tab={tab} product={detail} settings={settings} onUpload={uploadImage}/></div></aside></div>}

      {transmitOpen&&<Modal title="Supplier Hub 등록 전송" subtitle="확장·로그인된 Supplier Hub 탭·제안 규격의 확인이 필요합니다." onClose={()=>setTransmitOpen(false)}><div className="transmit-summary"><div className="send-icon">↗</div><strong>전송 차단 · 연결 미검증</strong><p>아래는 과거 코드에서 전송 가능으로 표시한 상품입니다. 실제 준비 완료를 의미하지 않습니다. 운영 전송은 구현·검증 및 사용자 승인 후 가능합니다.</p><ul>{ready.map(p=><li key={p.id}><span>{p.title}</span><strong>{won(p.supply_price)}</strong></li>)}</ul><label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>전송 대상과 가격 정보를 확인했습니다.</span></label></div><div className="modal-actions"><button className="btn ghost" onClick={()=>setTransmitOpen(false)}>취소</button><button className="btn rose" disabled onClick={transmit}>{busy?'전송 중…':'Supplier Hub 전송'}</button></div></Modal>}

      {connectionsOpen&&<Modal title="연동 상태" subtitle="현재 실행 중인 서버를 확인합니다. Cloudflare 운영 배포 여부와는 별개입니다." onClose={()=>setConnectionsOpen(false)}>
        <div className="settings-form">
          {checkingConnections&&<p role="status">서버 연결을 확인하고 있습니다.</p>}
          {connectionError&&<p role="alert">{connectionError}</p>}
          {connections&&<><dl className="connection-list">
            <div><dt>Cloudflare Workers</dt><dd>현재 서버 응답 확인</dd></div>
            <div><dt>작업 공간 인증</dt><dd>{connections.authentication==='cloudflare_access'?'Cloudflare Access 검증됨':'이 PC의 로컬 개발 환경'}</dd></div>
            <div><dt>D1 · 상품 및 설정</dt><dd>{connections.database==='query_ok'?'읽기 쿼리 성공':'연결 확인 실패'}</dd></div>
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

function Status({ value }: { value: string }) {
  const kind = value === '완료' ? 'success' : value.includes('전송') ? 'ready' : value.includes('처리') || value.includes('작업') ? 'progress' : value === '대기' ? 'muted' : 'warning';
  return <span className={`status ${kind}`}>{value}</span>;
}
function Modal({ title, subtitle, onClose, children, wide=false }: { title:string; subtitle:string; onClose:()=>void; children:React.ReactNode; wide?:boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={e=>e.stopPropagation()}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-close" onClick={onClose}>×</button></header>{children}</section></div>;
}
function DetailPanel({ tab, product, settings, onUpload, onSavePrice, onSaved, onManageCategories }: { onSavePrice:(policy:PricePolicy)=>Promise<void>; tab:string; product:Product; settings:Settings; onSaved:()=>void; onManageCategories:()=>void; onUpload:(e:ChangeEvent<HTMLInputElement>)=>void }) {
  const contentSection = tab==='이미지' ? '이미지' : tab==='표시사항' ? '표시사항' : 'SEO';
  let imageKeys:string[]=[];try{const keys:unknown=JSON.parse(product.image_keys);if(Array.isArray(keys))imageKeys=keys.filter((key):key is string=>typeof key==='string');}catch{/* The file and content APIs report invalid stored references. */}
  return <>
    <div hidden={!['SEO','이미지','표시사항'].includes(tab)} className="panel-stack">
      {tab==='이미지'&&<label className="btn primary upload-btn">＋ 이미지 업로드<input type="file" accept="image/*" onChange={onUpload}/></label>}
      <ProductContentEditor product={product} section={contentSection} onSaved={onSaved}/>
    </div>
    <div hidden={tab!=='이미지'} className="panel-stack"><ImageGenerationPanel productId={product.id} version={product.updated_at} imageKeys={imageKeys} onProductChanged={onSaved}/></div>
    <div hidden={tab!=='표시사항'}><DocumentImagePanel productId={product.id} version={product.updated_at} section="label" onSaved={onSaved}/></div>
    {tab==='작업'&&<AutomationPanel productId={product.id} version={product.updated_at}/>}
    <div hidden={tab!=='번역'}><TranslationPanel productId={product.id} version={product.updated_at} title={product.title} onContentSaved={onSaved}/></div>
    <div hidden={tab!=='옵션'} className="panel-stack"><ProductOptionsEditor product={product} onSaved={onSaved}/><DocumentImagePanel productId={product.id} version={product.updated_at} section="size" onSaved={onSaved}/></div>
    {tab==='가격'&&<PriceEditor sourcePrice={product.source_price_cny} initial={savedPricePolicy(product,settings)} onSave={onSavePrice}/>}
    {tab==='견적서'&&<div className="panel-stack"><QuotationPanel productId={product.id} onManageCategories={onManageCategories}/><details><summary>대표 상품 가격·내부 CSV 참고</summary><LegacyQuotePanel product={product} settings={settings}/></details></div>}
  </>;
}
function LegacyQuotePanel({ product, settings }: {product:Product;settings:Settings}) {
  return <div className="panel-stack"><article className="quote-sheet"><header><div><span>SUPPLY QUOTATION</span><h3>대표 상품 가격 참고</h3></div><strong>SF-{product.id.slice(0,8).toUpperCase()}</strong></header><dl><div><dt>상품명</dt><dd>{product.title}</dd></div><div><dt>옵션 수</dt><dd>{product.options_count}개</dd></div><div><dt>공급가</dt><dd>{won(product.supply_price)}</dd></div><div><dt>권장 판매가</dt><dd>{won(product.sale_price)}</dd></div><div><dt>시장가격(MSRP)</dt><dd>{won(product.msrp)}</dd></div><div><dt>수입·판매원</dt><dd>{settings.importer}</dd></div></dl><footer><span>내부 검토용 · Supplier Hub 호환 미검증</span><strong>SOURCEFLOW</strong></footer></article><p>SEO·표시사항·이미지 탭에서 저장한 자료는 검토 ZIP에 포함됩니다. 연결된 원본 양식을 채우려면 위에서 카테고리와 입력 행을 선택하세요.</p><div className="quote-actions"><a className="btn primary" href={'/api/products/'+product.id+'/bundle'}>첨부 자료 ZIP 다운로드</a><button className="btn ghost" onClick={()=>window.print()}>견적서 인쇄 / PDF</button><button className="btn primary" onClick={()=>downloadQuote(product,settings)}>견적 CSV 다운로드</button></div></div>;
}

function downloadQuote(product: Product, settings: Settings) {
  const rows: (string|number)[][] = [
    ['문서 구분','내부 검토용 견적 · Supplier Hub 업로드 양식 아님'],
    ['상품 ID','상품명','상품 URL','옵션 수','공급가(KRW)','판매가(KRW)','MSRP(KRW)','수입·판매원 설정','가격 저장 시각'],
    [product.id,product.title,product.source_url,product.options_count,product.supply_price,product.sale_price,product.msrp,settings.importer,product.updated_at],
    ['유의사항','옵션별 단가·물류비·관세·세금 및 Supplier Hub 규격은 별도 확인 필요'],
  ];
  const url = URL.createObjectURL(new Blob([quotationCsv(rows)],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='SourceFlow-quote-'+product.id+'.csv';anchor.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function savedPricePolicy(product: Product, settings: Settings): PricePolicy {
  if (product.pricing_policy) { try { return pricePolicy(JSON.parse(product.pricing_policy)); } catch { /* Older records use current defaults. */ } }
  return {exchangeRate:product.exchange_rate,supplyMargin:product.supply_margin,coupangMargin:product.coupang_margin,minimumMargin:settings.minimumMarginEnabled?settings.minimumMargin:0,msrpMultiple:settings.msrpMultiple,roundingUnit:settings.roundingUnit};
}
