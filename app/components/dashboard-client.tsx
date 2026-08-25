'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';

type Product = {
  id: string; source_url: string; title: string; source_price_cny: number; exchange_rate: number;
  supply_margin: number; coupang_margin: number; supply_price: number; sale_price: number; msrp: number;
  options_count: number; seo_status: string; image_status: string; quote_status: string;
  registration_status: string; supplier_hub_status: string; image_keys: string; goal_stage: string;
  created_at: string; updated_at: string;
};

type Settings = {
  brand: string; manufacturer: string; importer: string; exchangeRate: number;
  supplyMargin: number; coupangMargin: number; minimumMargin: number; msrpMultiple: number;
  translateImages: boolean; removeBackground: boolean; addCopyright: boolean;
};

const defaults: Settings = {
  brand: 'SourceFlow Select', manufacturer: '해외 협력 제조사', importer: '로켓셀러',
  exchangeRate: 190, supplyMargin: 40, coupangMargin: 35, minimumMargin: 3000,
  msrpMultiple: 1.3, translateImages: true, removeBackground: true, addCopyright: true,
};

const seed: Product[] = [
  { id:'demo-1', source_url:'https://detail.1688.com/offer/demo-1.html', title:'모듈형 접이식 수납 바구니', source_price_cny:18.4, exchange_rate:190, supply_margin:40, coupang_margin:35, supply_price:7400, sale_price:11400, msrp:14900, options_count:3, seo_status:'완료', image_status:'검토', quote_status:'완료', registration_status:'작업 중', supplier_hub_status:'미전송', image_keys:'[]', goal_stage:'work', created_at:'2026-08-25', updated_at:'2026-08-25' },
  { id:'demo-2', source_url:'https://detail.1688.com/offer/demo-2.html', title:'실리콘 주방 정리 트레이', source_price_cny:9.7, exchange_rate:190, supply_margin:40, coupang_margin:35, supply_price:5000, sale_price:7700, msrp:10100, options_count:5, seo_status:'완료', image_status:'완료', quote_status:'완료', registration_status:'전송 가능', supplier_hub_status:'미전송', image_keys:'[]', goal_stage:'transmit', created_at:'2026-08-25', updated_at:'2026-08-25' },
  { id:'demo-3', source_url:'https://detail.1688.com/offer/demo-3.html', title:'스테인리스 휴대용 텀블러 홀더', source_price_cny:13.2, exchange_rate:190, supply_margin:40, coupang_margin:35, supply_price:5600, sale_price:8700, msrp:11400, options_count:2, seo_status:'완료', image_status:'대기', quote_status:'대기', registration_status:'가격 완료', supplier_hub_status:'미전송', image_keys:'[]', goal_stage:'price', created_at:'2026-08-24', updated_at:'2026-08-24' },
];

const stages = [
  { label:'상품 수집', detail:'1688 URL', tone:'blue' }, { label:'AI 최적화', detail:'SEO · 가격', tone:'purple' },
  { label:'콘텐츠 제작', detail:'이미지 · 상세', tone:'orange' }, { label:'제안 전송', detail:'견적서 · Supplier Hub', tone:'green' },
];
const goalOptions = [
  { id:'collect', title:'상품만 추가', desc:'옵션과 원가를 직접 확인합니다.' },
  { id:'price', title:'SEO + 가격', desc:'상품명과 공급·판매가까지 계산합니다.' },
  { id:'work', title:'전체 작업', desc:'이미지, 표시사항, 상세와 견적서를 만듭니다.' },
  { id:'transmit', title:'전송 준비', desc:'Supplier Hub 전송 직전까지 완료합니다.' },
];

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const imagesFor = (product: Product) => {
  try { return (JSON.parse(product.image_keys) as string[]).map((key) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`); }
  catch { return []; }
};

export default function DashboardClient({ userName }: { userName: string }) {
  const [products, setProducts] = useState<Product[]>(seed);
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
  const [toast, setToast] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    Promise.all([fetch('/api/products').then(r=>r.json()), fetch('/api/settings').then(r=>r.json())])
      .then(([productData, settingData]) => {
        if (productData.products?.length) setProducts(productData.products);
        if (settingData.settings) setSettings({ ...defaults, ...settingData.settings });
      }).catch(() => undefined);
  }, []);

  const filtered = useMemo(() => products.filter((p) => {
    const matchesQuery = `${p.title} ${p.source_url}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === '전체' || (filter === '작업 중' && !['전송 가능','전송완료'].includes(p.registration_status)) || p.registration_status === filter;
    return matchesQuery && matchesFilter;
  }), [products, query, filter]);

  const ready = products.filter(p => p.registration_status === '전송 가능');
  const completed = products.filter(p => p.seo_status === '완료').length;
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600); };

  async function createProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    const urls = String(data.get('urls') ?? '').split(/\s+/).filter(Boolean);
    const payload = {
      title: String(data.get('title') ?? ''), sourcePriceCny: Number(data.get('price')),
      optionsCount: Number(data.get('options')), goalStage: String(data.get('goal')),
      exchangeRate: settings.exchangeRate, supplyMargin: settings.supplyMargin,
      coupangMargin: settings.coupangMargin, minimumMargin: settings.minimumMargin,
    };
    try {
      const created: Product[] = [];
      for (const [index, sourceUrl] of urls.entries()) {
        const response = await fetch('/api/products', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ ...payload, sourceUrl, title: urls.length > 1 && payload.title ? `${payload.title} ${index + 1}` : payload.title }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        created.push(result.product);
      }
      setProducts(current => [...created, ...current]); setAddOpen(false); showToast(`${created.length}개 상품을 대기열에 추가했습니다.`);
    } catch (error) { showToast(error instanceof Error ? error.message : '상품을 추가하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function patchProduct(id: string, updates: Partial<Product>) {
    setProducts(current => current.map(p => p.id === id ? { ...p, ...updates } : p));
    if (!id.startsWith('demo-')) await fetch(`/api/products/${id}`, { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify(updates) }).catch(()=>undefined);
    setDetail(current => current?.id === id ? { ...current, ...updates } : current);
  }

  async function runAutomation() {
    const targets = selected.size ? products.filter(p=>selected.has(p.id)) : products.filter(p=>p.registration_status !== '전송완료');
    if (!targets.length) return showToast('작업할 상품을 선택해주세요.');
    setBusy(true); showToast(`${targets.length}개 상품의 AI 작업을 시작했습니다.`);
    for (const product of targets) {
      await patchProduct(product.id, { registration_status:'AI 처리 중' });
      await new Promise(resolve => window.setTimeout(resolve, 180));
      await patchProduct(product.id, { seo_status:'완료', image_status:'완료', quote_status:'완료', registration_status:'전송 가능' });
    }
    setBusy(false); setSelected(new Set()); showToast('이미지·표시사항·견적서 작업이 완료됐습니다.');
  }

  async function saveWorkspaceSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await fetch('/api/settings', { method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify(settings) }).catch(()=>undefined);
    setSettingsOpen(false); showToast('기본 설정을 저장했습니다.');
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    if (!detail || !event.target.files?.[0]) return;
    const form = new FormData(); form.append('file', event.target.files[0]); setBusy(true);
    try {
      const response = await fetch('/api/files', { method:'POST', body:form }); const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const keys = [...JSON.parse(detail.image_keys || '[]'), result.key];
      await patchProduct(detail.id, { image_keys:JSON.stringify(keys), image_status:'검토' }); showToast('새 이미지를 추가했습니다.');
    } catch (error) { showToast(error instanceof Error ? error.message : '업로드하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function transmit() {
    setBusy(true);
    const response = await fetch('/api/supplier-hub', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ productIds:ready.map(p=>p.id).filter(id=>!id.startsWith('demo-')), confirmed }) });
    const result = await response.json(); setBusy(false); setTransmitOpen(false); setConfirmed(false);
    showToast(result.message ?? result.error ?? '전송 요청을 확인했습니다.');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>SOURCEFLOW</span></div>
        <nav aria-label="주 메뉴"><p className="nav-caption">WORKSPACE</p>
          <button className="nav-item active"><span>✦</span>AI 상품등록</button>
          <button className="nav-item"><span>▦</span>상품 관리</button><button className="nav-item"><span>◫</span>공급 관리</button><button className="nav-item"><span>▤</span>판매 장부</button>
          <p className="nav-caption nav-gap">AUTOMATION</p><button className="nav-item"><span>⌁</span>연동 설정</button><button className="nav-item"><span>↻</span>작업 이력</button>
        </nav>
        <div className="sidebar-status"><span className="status-dot" /><div><strong>자동화 엔진</strong><small>정상 작동 중</small></div></div>
      </aside>

      <section className="content">
        <header className="topbar"><div><p className="eyebrow">ROCKET DELIVERY AUTOMATION</p><h1>로켓배송 AI상품등록</h1><p>소싱 URL부터 Supplier Hub 제안서까지 한 번에 준비하세요.</p></div>
          <div className="top-actions"><div className="user-chip"><span>{userName.slice(0,1).toUpperCase()}</span><div><strong>{userName}</strong><small>Rocket seller</small></div></div><button className="btn ghost" onClick={()=>setSettingsOpen(true)}>⚙ 기본설정</button><button className="btn primary" onClick={()=>setAddOpen(true)}>＋ 상품 추가</button></div></header>

        <section className="pipeline" aria-label="자동화 진행 단계">{stages.map((stage,index)=><div className="step" key={stage.label}><span className={`step-number ${stage.tone}`}>{index+1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div>{index<3&&<span className="step-arrow">→</span>}</div>)}</section>

        <section className="summary-grid">
          <article><span className="metric-icon blue">◈</span><div><small>전체 상품</small><strong>{products.length}</strong></div><em>오늘 +{Math.min(products.length,2)}</em></article>
          <article><span className="metric-icon purple">✦</span><div><small>AI 작업 완료</small><strong>{completed}</strong></div><em>완료율 {Math.round(completed/Math.max(products.length,1)*100)}%</em></article>
          <article><span className="metric-icon orange">₩</span><div><small>평균 공급 마진</small><strong>{settings.supplyMargin}%</strong></div><em>최소 {won(settings.minimumMargin)}</em></article>
          <article><span className="metric-icon green">✓</span><div><small>전송 준비</small><strong>{ready.length}</strong></div><em>Supplier Hub</em></article>
        </section>

        <section className="workspace"><div className="workspace-head"><div><h2>상품 작업 보드</h2><p>각 단계를 확인하고 필요한 항목만 바로 수정할 수 있습니다.</p></div><div className="workspace-actions"><button className="btn ghost">전체 작업 ▾</button><button className="btn dark" disabled={busy} onClick={runAutomation}>{busy?'처리 중…':'작업 개시'}</button><button className="btn rose" onClick={()=>setTransmitOpen(true)}>등록 전송</button></div></div>
          <div className="filters"><label className="search"><span>⌕</span><input aria-label="상품 검색" value={query} onChange={e=>setQuery(e.target.value)} placeholder="상품명 또는 URL 검색" /></label>{['전체','작업 중','검토 대기','전송 가능'].map(value=><button key={value} onClick={()=>setFilter(value)} className={`filter-chip ${filter===value?'active':''}`}>{value}</button>)}</div>
          <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="전체 선택" checked={selected.size===products.length&&products.length>0} onChange={e=>setSelected(e.target.checked?new Set(products.map(p=>p.id)):new Set())}/></th><th>상품</th><th>소싱 원가</th><th>판매가 / 공급가</th><th>AI 작업</th><th>이미지</th><th>견적서</th><th>상태</th><th /></tr></thead>
            <tbody>{filtered.map((p,index)=><tr key={p.id}><td><input type="checkbox" aria-label={`${p.title} 선택`} checked={selected.has(p.id)} onChange={e=>setSelected(current=>{const next=new Set(current); e.target.checked?next.add(p.id):next.delete(p.id); return next;})}/></td><td><button className="product-cell" onClick={()=>{setDetail(p);setTab('SEO')}}><div className={`product-thumb ${index%3===1?'coral':index%3===2?'violet':''}`}>1688</div><div><strong>{p.title}</strong><span>SF-{p.id.slice(0,8).toUpperCase()} · {p.options_count}개 옵션</span></div></button></td><td><strong>¥ {p.source_price_cny.toFixed(2)}</strong><span className="sub">환율 {p.exchange_rate}원</span></td><td><strong>{won(p.sale_price)}</strong><span className="sub">공급가 {won(p.supply_price)}</span></td><td><Status value={p.seo_status}/></td><td><Status value={p.image_status}/></td><td><Status value={p.quote_status}/></td><td><Status value={p.registration_status}/></td><td><button className="more" aria-label={`${p.title} 상세`} onClick={()=>setDetail(p)}>•••</button></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty"><span>⌕</span><strong>조건에 맞는 상품이 없습니다.</strong><small>검색어 또는 필터를 바꿔보세요.</small></div>}</div>
        </section>
      </section>

      {addOpen&&<Modal title="1688 상품 추가" subtitle="상품 URL을 붙여넣으면 가격과 작업 대기열을 자동으로 만듭니다." onClose={()=>setAddOpen(false)}><form onSubmit={createProducts} className="modal-form"><label className="field full"><span>1688 상품 URL <b>필수</b></span><textarea name="urls" required placeholder={'https://detail.1688.com/offer/…\n여러 URL은 줄바꿈으로 구분'} /></label><div className="form-grid"><label className="field"><span>상품명</span><input name="title" placeholder="비워두면 AI가 생성" /></label><label className="field"><span>1688 원가 (CNY)</span><input name="price" type="number" min="0.01" step="0.01" defaultValue="18.4" /></label><label className="field"><span>옵션 수</span><input name="options" type="number" min="1" defaultValue="1" /></label><label className="field"><span>적용 환율</span><input value={`${settings.exchangeRate}원`} disabled /></label></div><fieldset className="goal-list"><legend>어디까지 자동으로 진행할까요?</legend>{goalOptions.map((goal,i)=><label key={goal.id} className="goal-card"><input type="radio" name="goal" value={goal.id} defaultChecked={i===1}/><span><strong>{goal.title}</strong><small>{goal.desc}</small></span></label>)}</fieldset><div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setAddOpen(false)}>취소</button><button className="btn primary" disabled={busy}>{busy?'수집 중…':'대기열에 추가'}</button></div></form></Modal>}

      {settingsOpen&&<Modal wide title="기본 등록 정보 설정" subtitle="새로 수집하는 상품에 적용할 가격·이미지 기본값입니다." onClose={()=>setSettingsOpen(false)}><form onSubmit={saveWorkspaceSettings} className="settings-form"><section><h3>기본 등록 정보</h3><div className="form-grid"><SettingInput label="브랜드명" value={settings.brand} onChange={value=>setSettings({...settings,brand:value})}/><SettingInput label="제조사" value={settings.manufacturer} onChange={value=>setSettings({...settings,manufacturer:value})}/><SettingInput label="수입 및 판매원" value={settings.importer} onChange={value=>setSettings({...settings,importer:value})}/><SettingInput label="시장가격 배수" type="number" value={settings.msrpMultiple} onChange={value=>setSettings({...settings,msrpMultiple:Number(value)})}/></div></section><section><h3>가격 설정</h3><div className="price-preview"><div><small>상품 원가</small><strong>{100-settings.supplyMargin}%</strong></div><span>→</span><div><small>공급 마진</small><strong>{settings.supplyMargin}%</strong></div><span>→</span><div><small>쿠팡 마진</small><strong>{settings.coupangMargin}%</strong></div></div><div className="form-grid"><SettingInput label="적용환율 (CNY → KRW)" type="number" value={settings.exchangeRate} onChange={v=>setSettings({...settings,exchangeRate:Number(v)})}/><SettingInput label="공급 마진율 (%)" type="number" value={settings.supplyMargin} onChange={v=>setSettings({...settings,supplyMargin:Number(v)})}/><SettingInput label="쿠팡 마진율 (%)" type="number" value={settings.coupangMargin} onChange={v=>setSettings({...settings,coupangMargin:Number(v)})}/><SettingInput label="최소 공급 마진액" type="number" value={settings.minimumMargin} onChange={v=>setSettings({...settings,minimumMargin:Number(v)})}/></div></section><section><h3>이미지 작업</h3><div className="switch-grid"><Switch label="이미지 자동 번역" checked={settings.translateImages} onChange={v=>setSettings({...settings,translateImages:v})}/><Switch label="배경·텍스트 제거" checked={settings.removeBackground} onChange={v=>setSettings({...settings,removeBackground:v})}/><Switch label="카피라이트 추가" checked={settings.addCopyright} onChange={v=>setSettings({...settings,addCopyright:v})}/></div></section><div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setSettingsOpen(false)}>취소</button><button className="btn primary">설정 저장</button></div></form></Modal>}

      {detail&&<div className="drawer-backdrop" onMouseDown={()=>setDetail(null)}><aside className="detail-drawer" onMouseDown={e=>e.stopPropagation()}><header><div><span className="drawer-eyebrow">PRODUCT WORKSPACE</span><h2>{detail.title}</h2><a href={detail.source_url} target="_blank" rel="noreferrer">1688 원본 보기 ↗</a></div><button className="icon-close" onClick={()=>setDetail(null)}>×</button></header><nav className="detail-tabs">{['SEO','가격','이미지','표시사항','견적서'].map(value=><button key={value} onClick={()=>setTab(value)} className={tab===value?'active':''}>{value}</button>)}</nav><div className="detail-body"><DetailPanel tab={tab} product={detail} settings={settings} onPatch={updates=>patchProduct(detail.id,updates)} onUpload={uploadImage}/></div></aside></div>}

      {transmitOpen&&<Modal title="Supplier Hub 등록 전송" subtitle="전송 가능한 상품과 견적서를 마지막으로 확인합니다." onClose={()=>setTransmitOpen(false)}><div className="transmit-summary"><div className="send-icon">↗</div><strong>{ready.length}개 상품이 전송 준비됐습니다.</strong><p>대표이미지, 상품정보, 공급가, 한글표시사항, 견적서가 하나의 제안 패키지로 전송됩니다.</p><ul>{ready.map(p=><li key={p.id}><span>{p.title}</span><strong>{won(p.supply_price)}</strong></li>)}</ul><label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>전송 대상과 가격 정보를 확인했습니다.</span></label></div><div className="modal-actions"><button className="btn ghost" onClick={()=>setTransmitOpen(false)}>취소</button><button className="btn rose" disabled={!confirmed||!ready.length||busy} onClick={transmit}>{busy?'전송 중…':'Supplier Hub 전송'}</button></div></Modal>}

      {toast&&<div className="toast" role="status"><span>✓</span>{toast}</div>}
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
function SettingInput({ label, value, onChange, type='text' }: { label:string; value:string|number; onChange:(value:string)=>void; type?:string }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}
function Switch({ label, checked, onChange }: { label:string; checked:boolean; onChange:(value:boolean)=>void }) {
  return <label className="switch-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><i /></label>;
}

function DetailPanel({ tab, product, settings, onPatch, onUpload }: { tab:string; product:Product; settings:Settings; onPatch:(updates:Partial<Product>)=>void; onUpload:(e:ChangeEvent<HTMLInputElement>)=>void }) {
  if (tab==='SEO') return <div className="panel-stack"><div className="panel-note"><span>✦</span><div><strong>AI 상품명과 검색어가 준비됐습니다.</strong><p>쿠팡 노출 규칙에 맞게 브랜드·카테고리·핵심 속성을 조합합니다.</p></div></div><label className="field full"><span>노출 상품명</span><input defaultValue={`${settings.brand} ${product.title}`} /></label><label className="field full"><span>검색어</span><textarea defaultValue="정리용품, 생활수납, 공간활용, 모듈수납, 로켓배송" /></label><button className="btn primary" onClick={()=>onPatch({seo_status:'완료'})}>AI SEO 다시 생성</button></div>;
  if (tab==='가격') return <div className="panel-stack"><div className="price-formula"><div><small>1688 원가</small><strong>¥ {product.source_price_cny.toFixed(2)}</strong><span>× {product.exchange_rate}원</span></div><b>→</b><div><small>공급가</small><strong>{won(product.supply_price)}</strong><span>마진 {product.supply_margin}%</span></div><b>→</b><div><small>판매가</small><strong>{won(product.sale_price)}</strong><span>쿠팡 {product.coupang_margin}%</span></div></div><div className="margin-card"><span>예상 공급 마진</span><strong>{won(product.supply_price-product.source_price_cny*product.exchange_rate)}</strong><em>기본 설정 자동 적용</em></div><button className="btn primary" onClick={()=>onPatch({registration_status:'가격 완료'})}>현재 가격 적용</button></div>;
  if (tab==='이미지') { const uploaded=imagesFor(product); return <div className="panel-stack"><div className="image-toolbar"><label className="btn primary upload-btn">＋ 이미지 업로드<input type="file" accept="image/*" onChange={onUpload}/></label><button className="btn ghost" onClick={()=>onPatch({image_status:'완료'})}>배경 제거</button><button className="btn ghost" onClick={()=>onPatch({image_status:'완료'})}>한글 번역</button><button className="btn ghost" onClick={()=>onPatch({image_status:'완료'})}>1:1 맞춤</button></div><div className="image-grid">{uploaded.map((src,i)=><button key={src} className={`image-option ${i===0?'selected':''}`}><img src={src} alt="업로드 상품"/><span>{i===0?'대표':'추가'}</span></button>)}{['blue','coral','sand','mint','violet'].map((tone,i)=><button key={tone} className={`image-option mock ${tone} ${!uploaded.length&&i===0?'selected':''}`}><b>{product.title.slice(0,7)}</b><small>{i===0?'대표 후보':'상세 후보'}</small><span>{i===0&&!uploaded.length?'대표':'선택'}</span></button>)}</div><div className="crop-card"><strong>대표 이미지 편집</strong><p>쿠팡 권장 1:1 비율 · 텍스트/워터마크 자동 감지 · 흰 배경 적용</p><button className="btn primary" onClick={()=>onPatch({image_status:'완료'})}>선택 이미지 적용</button></div></div>; }
  if (tab==='표시사항') return <div className="panel-stack"><div className="notice-grid">{[['품명 및 모델명',product.title],['제조국','중국'],['제조사',settings.manufacturer],['수입자',settings.importer],['A/S 책임자','쿠팡 고객센터 1577-7011'],['품질보증기준','관련 법 및 소비자분쟁해결기준에 따름']].map(([k,v])=><label className="field" key={k}><span>{k}</span><input defaultValue={v}/></label>)}</div><button className="btn primary" onClick={()=>onPatch({quote_status:'완료'})}>한글 표시사항 저장</button></div>;
  return <div className="panel-stack"><article className="quote-sheet"><header><div><span>SUPPLY QUOTATION</span><h3>로켓배송 상품 공급 견적서</h3></div><strong>SF-{product.id.slice(0,8).toUpperCase()}</strong></header><dl><div><dt>상품명</dt><dd>{product.title}</dd></div><div><dt>옵션 수</dt><dd>{product.options_count}개</dd></div><div><dt>공급가</dt><dd>{won(product.supply_price)}</dd></div><div><dt>권장 판매가</dt><dd>{won(product.sale_price)}</dd></div><div><dt>시장가격(MSRP)</dt><dd>{won(product.msrp)}</dd></div><div><dt>수입·판매원</dt><dd>{settings.importer}</dd></div></dl><footer><span>Supplier Hub 제안용</span><strong>SOURCEFLOW</strong></footer></article><div className="quote-actions"><button className="btn ghost" onClick={()=>window.print()}>견적서 인쇄 / PDF</button><button className="btn primary" onClick={()=>onPatch({quote_status:'완료',registration_status:'전송 가능'})}>견적 확정</button></div></div>;
}
