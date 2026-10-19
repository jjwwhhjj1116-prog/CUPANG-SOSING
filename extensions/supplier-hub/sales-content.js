(() => {
  'use strict';
  const BOOT_KEY = '__yoofamFlusSalesV2';
  if (globalThis[BOOT_KEY]) return;
  globalThis[BOOT_KEY] = true;

  const CARD_TAG = 'yf-sales-card-v2';
  const DOCK_TAG = 'yf-sales-dock-v2';
  const MAX_PRODUCTS = 300;
  const BATCH_SIZE = 10;
  const REQUEST_TIMEOUT = 240000;
  const REQUEST_NONCE = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const EXTENSION_VERSION = (() => {
    try {
      const version = chrome.runtime.getManifest?.()?.version;
      return typeof version === 'string' && /^\d+(?:\.\d+){0,3}$/.test(version) ? version : 'v2';
    } catch { return 'v2'; }
  })();
  const BRAND_SYMBOL = "<svg aria-hidden=\"true\" focusable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\" fill=\"none\"><defs><linearGradient id=\"yf-blue\" x1=\"16\" y1=\"8\" x2=\"110\" y2=\"126\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#6576FF\"/><stop offset=\".48\" stop-color=\"#3A56EC\"/><stop offset=\"1\" stop-color=\"#2539B7\"/></linearGradient><linearGradient id=\"yf-mint\" x1=\"73\" y1=\"36\" x2=\"96\" y2=\"54\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#C7FFE8\"/><stop offset=\"1\" stop-color=\"#70E9CA\"/></linearGradient></defs><rect x=\"4\" y=\"4\" width=\"120\" height=\"120\" rx=\"32\" fill=\"url(#yf-blue)\"/><rect x=\"5\" y=\"5\" width=\"118\" height=\"118\" rx=\"31\" stroke=\"white\" stroke-opacity=\".16\" stroke-width=\"2\"/><path d=\"M37 43C37 38 43 35 47 39L68 61C71 64 73 68 73 73V91C73 96 69 99 64 99C59 99 55 96 55 91V76C55 73 54 71 52 69L40 54C38 51 37 48 37 43Z\" fill=\"white\"/><path d=\"M70 56C69 46 75 36 86 34L96 32L94 42C92 53 83 59 73 59C71 59 70 58 70 56Z\" fill=\"url(#yf-mint)\"/></svg>";
  const records = new Map();
  const cardBindings = new WeakMap();
  const number = new Intl.NumberFormat('ko-KR');
  let generation = 0;
  let running = false;
  let completed = 0;
  let total = 0;
  let scanTimer;
  let currentLocation = location.pathname + location.search;
  let dock;
  let collapsed = true;
  let selectedRun = false;
  let pauseUntil = 0;
  let cancelPause = null;
  let requestSequence = 0;
  let activeProgress = null;

  // All styling inside each shadow root is local. No page stylesheet or remote
  // asset is required. Search results stay over the image without adding height.
  const commonStyles = `
    :host{font-family:Inter,Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#162634;font-size:12px;font-weight:400;line-height:1.45;text-align:left;letter-spacing:-.2px;color-scheme:light}
    *,*::before,*::after{box-sizing:border-box}button{font:inherit;cursor:pointer}button:disabled{cursor:default;opacity:.45}
    button:focus-visible,summary:focus-visible,input:focus-visible{outline:3px solid #36b5da;outline-offset:3px}
    button{touch-action:manipulation} .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  `;
  const cardStyles = `${commonStyles}
    :host{display:none!important;position:absolute!important;right:5px!important;top:5px!important;width:min(138px,calc(100% - 10px))!important;min-width:0!important;margin:0!important;z-index:12!important;line-height:1.4}
    :host([data-visible]){display:block!important}:host([data-detail]){position:relative!important;top:auto!important;right:auto!important;width:180px!important;max-width:100%!important;margin:8px 0!important}
    .card{background:#ddfce9f5;border:1px solid #90e8b3;border-radius:9px;padding:7px 8px;overflow:hidden;box-shadow:0 2px 7px #1e673328;cursor:default}
    .heading{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:4px}
    .brand{display:flex;align-items:center;font-size:8px;font-weight:900;color:#147348;white-space:nowrap}
    .brand b{font-size:9px;font-style:italic;letter-spacing:-.5px;color:#157a4c}
    .state{font-size:8px;color:#448463;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:76px}
    .main{display:flex;align-items:baseline;justify-content:space-between;gap:4px;margin-bottom:4px}
    .main dt{font-size:9px;color:#24633f;font-weight:700;white-space:nowrap}.main dd{font-size:14px;font-weight:850;line-height:1.1;letter-spacing:-.4px;color:#096b3c;font-variant-numeric:tabular-nums}
    .main dd.empty{font-size:11px;letter-spacing:-.3px;color:#658775}.unit{font-size:8px;font-weight:500;margin-left:1px;letter-spacing:0}
    dl,dt,dd{padding:0;margin:0}.rows{display:grid;gap:2px}.row{display:flex;justify-content:space-between;align-items:baseline;gap:4px;font-size:9px;line-height:1.4}.row dt{color:#4d8063;white-space:nowrap}.row dd{font-variant-numeric:tabular-nums;color:#16653c;font-weight:650;text-align:right;overflow-wrap:anywhere}.row.revenue{font-size:8px}
    .divider{height:1px;background:#bae8cb;margin:3px 0}.foot{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:4px}.source{font-size:7px;color:#6c8c76;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 25px)}
    .lookup{border:0;border-radius:3px;padding:1px 3px;color:#237143;background:#ffffffb5;font-size:8px;line-height:1.35;white-space:nowrap}.lookup:hover:not(:disabled){background:#fff}
    .error{color:#976339;font-size:8px;line-height:1.4;padding-top:4px;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.card[data-state=error]{background:#fff8e9f5;border-color:#e4cfac}.card[data-state=error] .main dd{color:#8e683d}
    .card[data-state=loading] .state::before{content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:#158569;margin-right:4px;animation:pulse 1s infinite alternate}
    @keyframes pulse{to{opacity:.2}}
  `;
  const dockStyles = `${commonStyles}
    :host{display:block!important;position:fixed!important;right:20px!important;bottom:18px!important;z-index:2147483000!important;width:auto!important;max-width:calc(100vw - 24px)!important;pointer-events:none}
    [hidden]{display:none!important}.dock{display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}.menu{display:flex;flex-direction:column;align-items:flex-end;gap:7px;width:260px;max-width:calc(100vw - 24px);pointer-events:none}.menu>*{pointer-events:auto}.dock.collapsed .menu{display:none}
    .launcher{pointer-events:auto;display:grid;place-items:center;width:52px;height:52px;border:0;border-radius:16px;background:transparent;padding:0;line-height:1;filter:drop-shadow(0 4px 8px #243bb633);transition:transform .16s ease,filter .16s ease}.launcher-mark,.launcher-mark svg{display:block;width:100%;height:100%}.launcher:hover{transform:translateY(-2px);filter:drop-shadow(0 6px 11px #243bb64d)}.launcher:active{transform:translateY(0)}
    .context{display:flex;gap:7px;align-items:center;font-size:9px;color:#5c7592;background:#ffffffed;border:1px solid #e3eaf4;border-radius:7px;padding:5px 8px;box-shadow:0 2px 7px #31497412}.context b{font-size:9px;color:#347dcd}.count strong{color:#347dcd;font-weight:800}
    .primary,.secondary,.wing,.collapse{border:0;white-space:nowrap;box-shadow:0 2px 8px #3459992b;font-weight:700}.primary{background:#3479ff;color:white;border-radius:18px;min-height:33px;min-width:152px;padding:8px 15px;font-size:12px}.primary:disabled{opacity:.88}.primary:hover:not(:disabled){background:#2468ee}.secondary{background:#3479ff;color:#fff;border-radius:16px;padding:7px 13px;font-size:11px}.secondary:hover:not(:disabled){background:#2468ee}.stop{background:#fff;color:#315e9a;border:1px solid #cfdef6}.utilities{display:flex;align-items:center;justify-content:flex-end;gap:6px}.wing{background:#fff;color:#3473c7;border:1px solid #dbe6f6;border-radius:14px;padding:6px 11px;font-size:10px}.wing:hover{background:#f3f7ff}.collapse{border:1px solid #e0e4ea;background:#fff;color:#718099;border-radius:7px;padding:5px 9px;font-size:10px}
    .status-box{background:#fffffff5;border:1px solid #dae5f4;border-radius:10px;padding:9px 11px;width:248px;max-width:100%;box-shadow:0 3px 14px #324b731c}.status{margin:0;color:#48637e;font-size:10px;line-height:1.65;overflow-wrap:anywhere}.progress{height:3px;border-radius:4px;background:#e5edf9;overflow:hidden;margin-top:7px}.bar{height:100%;width:0;background:#3479ff;border-radius:4px;transition:width .15s ease}
    details{background:#fff;border:1px solid #e3eaf3;border-radius:8px;padding:6px 9px;max-width:248px;font-size:10px;color:#6b8195;box-shadow:0 2px 8px #34599912}summary{cursor:pointer;font-size:10px;color:#6a83a0}details p{line-height:1.65;margin:7px 0 0}details[open]{width:248px}.refresh{display:flex;align-items:center;gap:5px;color:#617b93;font-size:10px;cursor:pointer;margin-top:9px}.refresh input{accent-color:#3479ff;margin:0;width:12px;height:12px}
    @media(max-width:640px){:host{right:12px!important;bottom:12px!important}.launcher{width:46px;height:46px}}
  `;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addStyles(shadow, css) {
    const style = element('style');
    style.textContent = css;
    shadow.append(style);
  }

  function identity(value) {
    return [value.productId, value.itemId || '', value.vendorItemId || ''].join('|');
  }

  function idValue(value) {
    return typeof value === 'string' && /^\d{1,30}$/.test(value) ? value : null;
  }

  function validNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
  }

  function extractProduct(card) {
    const anchor = card.querySelector('a[href*="/vp/products/"]');
    if (!anchor) return null;
    let url;
    try { url = new URL(anchor.href, location.href); } catch { return null; }
    if (url.protocol !== 'https:' || !['www.coupang.com', 'coupang.com'].includes(url.hostname) || url.username || url.password) return null;
    const match = /^\/vp\/products\/(\d{1,30})(?:\/|$)/.exec(url.pathname);
    if (!match) return null;
    const image = card.querySelector('figure img, .image img, img');
    const titleNode = card.querySelector('[class*="ProductUnit_productName"], .name');
    const title = (titleNode?.textContent || image?.alt || '').trim().replace(/\s+/g, ' ').slice(0, 400);
    const modernPrice = card.querySelector('[class*="PriceArea_priceArea"] .fw-font-bold > span, [class*="PriceArea_priceArea"] [class*="font-bold"] > span');
    const priceText = (modernPrice || card.querySelector('.price-value'))?.textContent || '';
    const priceMatch = /^\s*([\d,]+)\s*(?:원)?\s*$/.exec(priceText);
    const parsedPrice = priceMatch ? Number(priceMatch[1].replaceAll(',', '')) : NaN;
    return {
      productId: match[1],
      itemId: idValue(url.searchParams.get('itemId')),
      vendorItemId: idValue(url.searchParams.get('vendorItemId')),
      title,
      price: validNumber(parsedPrice) && parsedPrice > 0 && parsedPrice <= 1e9 ? parsedPrice : null,
      url: url.href,
    };
  }

  function makeMetric(label) {
    const row = element('div', 'row');
    const name = element('dt', '', label);
    const value = element('dd', '', '—');
    row.append(name, value);
    return { row, value };
  }

  function createCard(record, card, placement) {
    const host = element(CARD_TAG);
    const root = host.attachShadow({ mode: 'open' });
    addStyles(root, cardStyles);
    const box = element('section', 'card');
    box.setAttribute('aria-label', `${record.product.title || '쿠팡 상품'} 판매량`);
    const heading = element('div', 'heading');
    const brand = element('span', 'brand');
    brand.append(element('b', '', 'YOO'));
    const state = element('span', 'state', '조회 대기');
    heading.append(brand, state);
    const metrics = element('dl');
    const main = element('div', 'main');
    const monthly = element('dd', 'empty', '—');
    main.append(element('dt', '', '28일 판매량'), monthly);
    const rows = element('div', 'rows');
    const weekly = makeMetric('주 판매 (추정)');
    const revenue = makeMetric('추정 매출');
    revenue.row.classList.add('revenue');
    revenue.row.title = '최근 28일 판매량 × 현재 표시 가격';
    const views = makeMetric('조회수');
    const conversion = makeMetric('전환율 (계산)');
    rows.append(weekly.row, revenue.row, element('div', 'divider'), views.row, conversion.row);
    metrics.append(main, rows);
    const foot = element('div', 'foot');
    const source = element('span', 'source', '버튼을 눌러 조회하세요');
    const lookup = element('button', 'lookup', '조회');
    lookup.type = 'button';
    lookup.setAttribute('aria-label', `${record.product.title || '이 상품'} 판매량 조회`);
    lookup.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!running) void startLookup([record], dock.force.checked);
    });
    foot.append(source, lookup);
    const error = element('p', 'error');
    error.hidden = true;
    box.append(heading, metrics, foot, error);
    root.append(box);
    // Only the small lookup button intercepts navigation. Other parts of the
    // image, including the passive metric display, retain the product link.
    host.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.composedPath().some(node => node.tagName === 'BUTTON')) event.stopPropagation();
    });
    const picture = card.querySelector('figure, .image');
    if (placement) {
      host.dataset.detail = 'true';
      placement.after(host);
    } else if (picture && card.contains(picture)) {
      if (getComputedStyle(picture).position === 'static') picture.style.position = 'relative';
      picture.append(host);
    } else {
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      card.append(host);
    }
    const binding = { host, card, box, state, monthly, weekly: weekly.value, revenue: revenue.value, views: views.value, conversion: conversion.value, source, lookup, error };
    record.mounts.add(binding);
    cardBindings.set(card, { key: identity(record.product), binding });
    renderCard(record, binding);
    return binding;
  }

  function normalizedResult(value, product) {
    if (!value || identity(value) !== identity(product) || !['ok', 'unavailable', 'error'].includes(value.status)) return null;
    const periodValid = value.periodDays === 28;
    const monthlySales = periodValid && validNumber(value.monthlySales) ? value.monthlySales : null;
    const views = periodValid && validNumber(value.views) ? value.views : null;
    const hasData = monthlySales !== null || views !== null;
    const asOf = typeof value.asOf === 'string' && Number.isFinite(Date.parse(value.asOf)) ? new Date(value.asOf).toISOString() : null;
    return {
      productId: product.productId, itemId: product.itemId, vendorItemId: product.vendorItemId,
      status: value.status === 'ok' && !hasData ? 'unavailable' : value.status,
      monthlySales: value.status === 'ok' ? monthlySales : null,
      views: value.status === 'ok' ? views : null,
      periodDays: 28,
      scope: 'source-defined',
      matchedBy: value.matchedBy === 'item' ? 'item' : 'product',
      sourceItemId: idValue(value.sourceItemId),
      source: typeof value.source === 'string' ? value.source.slice(0, 300) : '',
      asOf,
      error: typeof value.error === 'string' ? value.error.slice(0, 300) : '',
    };
  }

  function derived(record) {
    const sales = record.result?.monthlySales;
    const views = record.result?.views;
    return {
      weekly: validNumber(sales) ? Math.round(sales * 7 / 28) : null,
      revenue: validNumber(sales) && validNumber(record.product.price) ? sales * record.product.price : null,
      conversion: validNumber(sales) && validNumber(views) && views > 0 ? sales / views * 100 : null,
    };
  }

  function timeLabel(iso) {
    if (!iso) return '조회 시각 미확인';
    return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso));
  }

  function renderCard(record, binding) {
    const result = record.result;
    binding.host.toggleAttribute('data-visible', record.loading || !!result);
    const state = record.loading ? 'loading' : result?.status || 'idle';
    binding.box.dataset.state = state;
    binding.state.textContent = ({ idle: '조회 대기', loading: '조회 중', ok: '최근 28일', unavailable: '자료 없음', error: '조회 실패' })[state];
    binding.monthly.replaceChildren();
    if (result?.monthlySales !== null && validNumber(result?.monthlySales)) {
      binding.monthly.className = '';
      binding.monthly.append(document.createTextNode(number.format(result.monthlySales)), element('span', 'unit', '개'));
    } else {
      binding.monthly.className = 'empty';
      binding.monthly.textContent = state === 'unavailable' ? '자료 없음' : state === 'error' ? '확인 필요' : '—';
    }
    const estimates = derived(record);
    binding.weekly.textContent = estimates.weekly === null ? '—' : `${number.format(estimates.weekly)}개`;
    binding.revenue.textContent = estimates.revenue === null ? '—' : `${number.format(Math.round(estimates.revenue))}원`;
    binding.views.textContent = validNumber(result?.views) ? number.format(result.views) : '—';
    binding.conversion.textContent = estimates.conversion === null ? '—' : `${estimates.conversion.toFixed(1)}%`;
    binding.lookup.disabled = running;
    binding.lookup.textContent = result ? '다시' : '조회';
    binding.source.textContent = result ? result.status === 'ok' ? 'Wing 제공 · 최근 28일' : '쿠팡 지표 미확인' : '버튼을 눌러 조회하세요';
    binding.source.title = result ? `출처: ${result.source || '미확인'}\n조회: ${result.asOf ? timeLabel(result.asOf) + ' (한국 시간) / ' + result.asOf : '미확인'}\n집계 범위: 쿠팡 제공 기준\n기간: 최근 28일\n주 판매량 = 28일 판매량 × 7/28\n매출 추정 = 28일 판매량 × 현재 표시 가격\n전환율 계산 = 판매량 ÷ 조회수 × 100` : '쿠팡에서 확인한 판매 지표를 표시합니다.';
    binding.error.textContent = result?.error || (state === 'unavailable' ? '쿠팡에서 해당 상품의 지표를 확인하지 못했습니다.' : '');
    binding.error.title = binding.error.textContent;
    binding.error.hidden = !binding.error.textContent || record.loading;
  }

  function renderRecord(record) {
    for (const binding of record.mounts) {
      if (!binding.host.isConnected) record.mounts.delete(binding);
      else renderCard(record, binding);
    }
  }

  function liveRecords() {
    return [...records.values()].filter(record => [...record.mounts].some(binding => binding.host.isConnected));
  }

  function hasConfirmedResult(record) {
    return record.result?.status === 'ok' || record.result?.status === 'unavailable';
  }

  function updateDock(message) {
    if (!dock) return;
    const active = liveRecords();
    const hasResults = active.some(record => record.result);
    const canResume = !dock.force.checked && hasResults && active.some(record => !hasConfirmedResult(record));
    const visibleCompleted = completed + (activeProgress?.received.size || 0);
    dock.count.textContent = number.format(active.length);
    dock.start.disabled = running || !active.length;
    dock.start.textContent = running ? pauseUntil > Date.now() ? `⏸ ${Math.ceil((pauseUntil - Date.now()) / 1000)}초 후 자동 계속` : `⏳ 조회 중 · ${visibleCompleted}/${total}` : canResume ? '남은 상품 이어서 조회' : hasResults ? '📈 판매량 다시 조회' : '📈 판매량 조회';
    dock.stop.disabled = !running;
    dock.stop.hidden = !running;
    dock.csv.disabled = !active.some(record => record.result);
    dock.csv.hidden = dock.csv.disabled;
    dock.force.disabled = running;
    dock.bar.style.width = total ? `${Math.round(visibleCompleted / total * 100)}%` : '0%';
    dock.progress.setAttribute('aria-valuenow', String(total ? Math.round(visibleCompleted / total * 100) : 0));
    if (message !== undefined) {
      dock.status.textContent = message;
    }
  }

  function setMenuOpen(open) {
    collapsed = !open;
    if (!dock) return;
    dock.panel.classList.toggle('collapsed', collapsed);
    dock.launcher.setAttribute('aria-expanded', String(open));
    dock.launcher.setAttribute('aria-label', open ? 'YOO 판매량 메뉴 닫기' : 'YOO 판매량 메뉴 열기');
  }

  function createDock() {
    const host = element(DOCK_TAG);
    const root = host.attachShadow({ mode: 'open' });
    addStyles(root, dockStyles);
    const panel = element('aside', 'dock collapsed');
    panel.setAttribute('aria-label', 'YOOFAM PLUS 판매량 조회');
    const menu = element('div', 'menu');
    menu.id = 'yoo-sales-menu';
    const context = element('div', 'context');
    const countLabel = element('span', 'count');
    const count = element('strong', '', '0');
    countLabel.append(count, document.createTextNode('개 상품'));
    context.append(element('b', '', `YOOFAM PLUS ${EXTENSION_VERSION}`), countLabel);
    const statusBox = element('div', 'status-box');
    statusBox.hidden = true;
    const status = element('p', 'status', '현재 페이지의 상품을 확인하고 있습니다.');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const progress = element('div', 'progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', '판매량 조회 진행률');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', '0');
    const bar = element('div', 'bar');
    progress.append(bar);
    statusBox.append(status, progress);
    const start = element('button', 'primary', '📈 판매량 조회');
    const stop = element('button', 'secondary stop', '■ 조회 중지');
    const csv = element('button', 'secondary', '↓ CSV 저장');
    for (const button of [start, stop, csv]) button.type = 'button';
    stop.disabled = csv.disabled = true;
    stop.hidden = csv.hidden = true;
    csv.setAttribute('aria-label', '현재 상품 조회 결과 CSV 저장');
    start.addEventListener('click', () => { scan(); void startLookup(liveRecords(), force.checked); });
    stop.addEventListener('click', () => stopLookup('조회를 중지했습니다. 완료된 결과는 유지됩니다.'));
    csv.addEventListener('click', exportCSV);
    const utilities = element('div', 'utilities');
    const refresh = element('label', 'refresh');
    const force = element('input');
    force.type = 'checkbox';
    force.addEventListener('change', () => updateDock());
    refresh.append(force, document.createTextNode('저장된 결과 새로 확인'));
    const wing = element('button', 'wing', '쿠팡 Wing ↗');
    wing.setAttribute('aria-label', '쿠팡 Wing 열기');
    wing.type = 'button';
    wing.addEventListener('click', async () => {
      wing.disabled = true;
      statusBox.hidden = false;
      try {
        const response = await sendMessage({ type: 'YF_SALES_OPEN_WING' });
        if (!response?.ok) throw new Error(response?.error || '쿠팡 Wing을 열지 못했습니다.');
        if (!running) updateDock('쿠팡 Wing에서 로그인 상태를 확인한 뒤 판매량을 다시 조회하세요.');
      } catch (error) {
        updateDock(errorMessage(error));
      } finally { wing.disabled = false; }
    });
    utilities.append(csv, wing);
    const details = element('details');
    details.append(element('summary', '', '조회 설정 · 지표 안내'));
    details.append(refresh);
    details.append(element('p', '', '판매량·조회수는 조회된 쿠팡 지표만 표시합니다. 자료를 확인하지 못한 상품은 “자료 없음”으로 표시합니다.'));
    details.append(element('p', '', '쿠팡이 제공하는 집계 기간은 최근 28일입니다. 주 판매량은 28일 판매량 × 7/28, 매출은 판매량 × 현재 표시 가격, 전환율은 판매량 ÷ 조회수로 계산합니다. 취소·반품·가격 변동을 반영한 정산 매출과 다를 수 있습니다.'));
    details.append(element('p', '', '상품·옵션 ID를 대조한 쿠팡 제공 통계이며 집계 범위는 쿠팡 기준입니다. 카드 하단에 마우스를 올리면 출처와 조회 시각을 확인할 수 있습니다.'));
    const close = element('button', 'collapse', '× 닫기');
    close.type = 'button';
    close.addEventListener('click', () => { setMenuOpen(false); launcher.focus(); });
    menu.append(context, statusBox, start, stop, utilities, details, close);
    const launcher = element('button', 'launcher');
    const mark = element('span', 'launcher-mark');
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML = BRAND_SYMBOL; // Bundled, fixed SVG; no page or remote content.
    launcher.append(mark);
    launcher.type = 'button';
    launcher.title = `YOOFAM PLUS ${EXTENSION_VERSION} · 판매량 조회`;
    launcher.setAttribute('aria-label', 'YOO 판매량 메뉴 열기');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', menu.id);
    launcher.addEventListener('click', () => setMenuOpen(collapsed));
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !collapsed) { setMenuOpen(false); launcher.focus(); }
    });
    panel.append(menu, launcher);
    root.append(panel);
    document.body.append(host);
    dock = { host, panel, launcher, menu, statusBox, count, status, progress, bar, start, stop, csv, force, wing };
  }

  function errorMessage(error) {
    const message = String(error?.message || error || '판매량을 조회하지 못했습니다.').slice(0, 300);
    if (/Extension context invalidated|receiving end does not exist|Could not establish connection/i.test(message)) return '확장이 업데이트되었거나 연결이 끊겼습니다. 쿠팡 페이지를 새로고침해주세요.';
    return message;
  }

  function diagnosticCode(value) {
    return ['LOGIN', 'RATE_LIMIT', 'HTTP', 'RESPONSE_TYPE', 'SCHEMA', 'TIMEOUT', 'NETWORK', 'INPUT', 'LOOKUP', 'CANCELLED', 'PAGE_CHANGED', 'WING_CHANGED'].includes(value) ? value : '';
  }

  function sendMessage(message, lookupGeneration = generation) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (message.type === 'YF_SALES_LOOKUP' && lookupGeneration === generation) void sendMessage({ type: 'YF_SALES_CANCEL' }).catch(() => {});
        finish(new Error('조회 응답이 지연되고 있습니다. 쿠팡 로그인 상태를 확인한 뒤 다시 조회하세요.'));
      }, REQUEST_TIMEOUT);
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error); else resolve(result);
      }
      try {
        chrome.runtime.sendMessage(message, response => {
          const runtimeError = chrome.runtime.lastError;
          finish(runtimeError ? new Error(runtimeError.message) : null, response);
        });
      } catch (error) { finish(error); }
    });
  }

  function stopLookup(message) {
    generation++;
    activeProgress = null;
    cancelPause?.();
    running = false;
    for (const record of records.values()) {
      record.loading = false;
      renderRecord(record);
    }
    updateDock(message);
    void sendMessage({ type: 'YF_SALES_CANCEL' }).catch(() => {});
  }

  function waitForRateLimit(retryAfterMs, run, remainingProducts) {
    const supplied = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : 60000;
    const deadline = Date.now() + Math.max(0, supplied);
    pauseUntil = deadline;
    return new Promise(resolve => {
      let timer;
      let settled = false;
      const finish = resume => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancelPause === cancel) { cancelPause = null; pauseUntil = 0; }
        resolve(resume);
      };
      const cancel = () => finish(false);
      cancelPause = cancel;
      const tick = () => {
        if (run !== generation || !running) { finish(false); return; }
        const remaining = deadline - Date.now();
        if (remaining <= 0) { finish(true); return; }
        updateDock(`쿠팡 요청 제한으로 잠시 기다립니다. ${completed}/${total}개 확인 · 남은 ${remainingProducts}개 · ${Math.ceil(remaining / 1000)}초 뒤 자동으로 이어갑니다.`);
        timer = setTimeout(tick, Math.min(1000, remaining));
      };
      tick();
    });
  }

  async function startLookup(requested, force) {
    if (running || !requested.length) return;
    if (dock) { dock.statusBox.hidden = false; setMenuOpen(true); }
    const candidates = [...new Map(requested.map(record => [identity(record.product), record])).values()].slice(0, MAX_PRODUCTS);
    const queue = force === true ? candidates : candidates.filter(record => !hasConfirmedResult(record));
    if (!queue.length) {
      updateDock('모든 상품을 이미 확인했습니다. 다시 조회하려면 “저장된 결과 새로 확인”을 선택하세요.');
      return;
    }
    const run = ++generation;
    const keyword = new URL(location.href).searchParams.get('q') || '';
    running = true;
    selectedRun = queue.length === 1;
    completed = 0;
    total = queue.length;
    for (const record of records.values()) renderRecord(record);
    updateDock(`${total}개 상품의 최근 28일 판매 지표를 조회합니다.`);
    let successCount = 0;
    let unavailableCount = 0;
    let errorCount = 0;
    let lastError = '';
    let haltCode = '';
    let halted = false;
    let rateLimitPaused = false;
    let noProgressRetries = 0;
    let pending = [...queue];
    while (pending.length) {
      if (run !== generation) return;
      const batch = pending.slice(0, BATCH_SIZE);
      batch.forEach(record => { record.loading = true; renderRecord(record); });
      updateDock(`${completed}/${total}개 처리 · 남은 ${total - completed}개 중 ${batch.length}개를 순서대로 조회합니다.`);
      let response;
      const requestId = `${REQUEST_NONCE}_${run}_${++requestSequence}`;
      activeProgress = { requestId, records: new Map(batch.map(record => [identity(record.product), record])), received: new Set() };
      try {
        response = await sendMessage({
          type: 'YF_SALES_LOOKUP',
          requestId,
          products: batch.map(({ product }) => ({ productId: product.productId, itemId: product.itemId, vendorItemId: product.vendorItemId, title: product.title, price: product.price })),
          keyword: keyword.slice(0, 200),
          force: force === true,
        });
        if (!response?.ok || !Array.isArray(response.results)) throw new Error(response?.error || '쿠팡 판매 지표 응답을 확인하지 못했습니다.');
      } catch (error) {
        if (run !== generation) return;
        // Confirmed progress is still valid when the final message port closes.
        // Count only those exact, unique tuples; the rest remain unconfirmed.
        for (const key of activeProgress?.received || []) {
          const record = activeProgress.records.get(key);
          if (!record || !hasConfirmedResult(record)) continue;
          completed++;
          if (record.result.status === 'ok') successCount++;
          else unavailableCount++;
        }
        activeProgress = null;
        lastError = errorMessage(error);
        haltCode = diagnosticCode(response?.code);
        halted = true;
        for (const record of batch) {
          record.loading = false;
          renderRecord(record);
        }
        // A failed preflight or missing reply does not establish which products
        // were attempted. Preserve their previous results and stop the queue.
        break;
      }
      if (run !== generation) return;
      activeProgress = null;
      const rateLimited = response.halt?.code === 'RATE_LIMIT';
      let batchCompleted = 0;
      let confirmedProgress = 0;
      let batchError = '';
      const received = new Set();
      for (const record of batch) {
        const matches = response.results.filter(value => value && identity(value) === identity(record.product));
        const result = matches.length === 1 ? normalizedResult(matches[0], record.product) : null;
        record.loading = false;
        // Only a matching result proves this product was attempted. A halted
        // batch intentionally omits the remaining products, which stay pending.
        if (result && !(rateLimited && result.status === 'error')) {
          record.result = result;
          batchCompleted++;
          received.add(identity(record.product));
          if (result.status === 'ok') { successCount++; confirmedProgress++; }
          else if (result.status === 'unavailable') { unavailableCount++; confirmedProgress++; }
          else {
            errorCount++;
            if (!batchError) batchError = result.error || '쿠팡 판매량 조회 중 오류가 발생했습니다.';
          }
        }
        renderRecord(record);
      }
      completed += batchCompleted;
      pending = pending.filter(record => !received.has(identity(record.product)));
      if (confirmedProgress) noProgressRetries = 0;
      if (rateLimited) {
        // A 429 is a pause for this user-started run, not a failed product.
        // Keep a separate current-run queue so forced refreshes cannot skip old results.
        if (!pending.length) break;
        if (typeof response.halt.retryAfterMs === 'number' && Number.isFinite(response.halt.retryAfterMs) && response.halt.retryAfterMs > 900000) {
          halted = rateLimitPaused = true;
          haltCode = 'RATE_LIMIT';
          lastError = `쿠팡이 긴 대기 시간을 요청했습니다. ${number.format(Math.ceil(response.halt.retryAfterMs / 1000))}초 뒤 “남은 상품 이어서 조회”를 눌러주세요.`;
          break;
        }
        if (noProgressRetries >= 3) {
          halted = rateLimitPaused = true;
          haltCode = 'RATE_LIMIT';
          lastError = '쿠팡 요청 제한이 계속되어 자동 재시도를 잠시 멈췄습니다. 잠시 뒤 “남은 상품 이어서 조회”를 눌러주세요.';
          break;
        }
        noProgressRetries++;
        if (!await waitForRateLimit(response.halt.retryAfterMs, run, pending.length)) return;
        continue;
      }
      if (response.halt || batchError || batchCompleted !== batch.length) {
        halted = true;
        haltCode = diagnosticCode(response.halt?.code);
        lastError = errorMessage(response.halt?.error || batchError || '일부 상품의 조회 결과를 확인하지 못했습니다. 다시 조회해주세요.');
        break;
      }
      updateDock(`${completed}/${total}개 처리 · 지표 ${successCount}개 · 자료 없음 ${unavailableCount}개`);
    }
    if (run !== generation) return;
    running = false;
    for (const record of records.values()) { record.loading = false; renderRecord(record); }
    const summary = `${selectedRun ? '상품 조회' : '조회'} ${rateLimitPaused ? '일시정지' : halted ? '중단' : '완료'} · 처리 ${completed}/${total}개 · 지표 ${successCount}개 · 자료 없음 ${unavailableCount}개${errorCount ? ` · 실패 ${errorCount}개` : ''}`;
    updateDock(halted ? `${summary} · 미조회 ${total - completed}개. ${lastError}${haltCode ? ` [${haltCode}]` : ''}` : `${summary}. 카드에서 결과와 확인 시각을 확인하세요.`);
  }

  function csvCell(value) {
    let text = value == null ? '' : String(value);
    // Spreadsheet applications may evaluate quoted strings as formulas too.
    if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportCSV() {
    const columns = ['상품ID', '옵션ID', '판매자상품ID', '상품명', '현재가격(원)', '조회상태', '28일판매량', '주판매량(추정)', '28일매출(추정·원)', '조회수', '전환율(계산·%)', '기간(일)', '집계기준', '대조기준', '출처옵션ID', '데이터출처', '조회시각(UTC)', '상품URL', '안내'];
    const rows = liveRecords().filter(record => record.result).map(record => {
      const { product, result } = record;
      const values = derived(record);
      return [product.productId, product.itemId, product.vendorItemId, product.title, product.price,
        ({ ok: '확인', unavailable: '자료 없음', error: '조회 실패' })[result.status], result.monthlySales,
        values.weekly, values.revenue === null ? null : Math.round(values.revenue), result.views,
        values.conversion === null ? null : values.conversion.toFixed(3), result.periodDays, '쿠팡 제공 기준', result.matchedBy === 'item' ? '상품·옵션 ID' : '상품 ID', result.sourceItemId,
        result.source, result.asOf, product.url, result.error];
    });
    if (!rows.length) return;
    const content = '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = element('a');
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    anchor.href = url;
    anchor.download = `YOOFAM-FLUS-판매량-${stamp}.csv`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (!running) updateDock(`${rows.length}개 상품의 조회 결과를 CSV로 저장했습니다. 추정값·출처·조회 시각을 함께 기록했습니다.`);
  }

  function scan() {
    scanTimer = undefined;
    if (!document.body || !dock) return;
    if (!dock.host.isConnected) document.body.append(dock.host);
    const changedLocation = currentLocation !== location.pathname + location.search;
    if (changedLocation) {
      currentLocation = location.pathname + location.search;
      if (running) stopLookup('검색 화면이 변경되어 조회를 중지했습니다. 새 목록에서 다시 조회하세요.');
      else updateDock('새 검색 목록입니다. 판매량 조회를 눌러 확인하세요.');
    }
    for (const [key, record] of records) {
      for (const binding of record.mounts) if (!binding.host.isConnected) record.mounts.delete(binding);
      if (!record.mounts.size && records.size > MAX_PRODUCTS) records.delete(key);
    }
    const cards = document.querySelectorAll('li[class*="ProductUnit_productUnit"], li.search-product');
    let processed = 0;
    for (const card of cards) {
      if (++processed > MAX_PRODUCTS) break;
      const product = extractProduct(card);
      if (!product) continue;
      const key = identity(product);
      const existing = cardBindings.get(card);
      if (existing && (existing.key !== key || !existing.binding.host.isConnected)) {
        existing.binding.host.remove();
        records.get(existing.key)?.mounts.delete(existing.binding);
        cardBindings.delete(card);
      }
      let record = records.get(key);
      if (!record) {
        record = { product, mounts: new Set(), result: null, loading: false };
        records.set(key, record);
      } else {
        const changed = record.product.price !== product.price || record.product.title !== product.title;
        record.product = product;
        if (changed) renderRecord(record);
      }
      if (!cardBindings.has(card)) createCard(record, card);
    }
    // On a detail page the current URL is the product identity. A missing
    // displayed price remains unknown; no structured or guessed price is used.
    const detailMatch = /^\/vp\/products\/(\d{1,30})(?:\/|$)/.exec(location.pathname);
    const detailTitle = detailMatch && document.querySelector('h1.prod-buy-header__title, h1');
    if (detailTitle?.parentElement && !detailTitle.closest(CARD_TAG)) {
      const detailCard = detailTitle.parentElement;
      const detailUrl = new URL(location.href);
      const detailPriceText = document.querySelector('.prod-sale-price .total-price strong, .total-price strong')?.textContent?.replaceAll(',', '').trim() || '';
      const price = /^\d+$/.test(detailPriceText) ? Number(detailPriceText) : null;
      const product = {
        productId: detailMatch[1], itemId: idValue(detailUrl.searchParams.get('itemId')),
        vendorItemId: idValue(detailUrl.searchParams.get('vendorItemId')),
        title: (detailTitle.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 400),
        price: validNumber(price) && price > 0 && price <= 1e9 ? price : null, url: detailUrl.href,
      };
      const key = identity(product);
      const existing = cardBindings.get(detailCard);
      if (existing && (existing.key !== key || !existing.binding.host.isConnected)) {
        existing.binding.host.remove();
        records.get(existing.key)?.mounts.delete(existing.binding);
        cardBindings.delete(detailCard);
      }
      let record = records.get(key);
      if (!record) { record = { product, mounts: new Set(), result: null, loading: false }; records.set(key, record); }
      else { record.product = product; renderRecord(record); }
      if (!cardBindings.has(detailCard)) createCard(record, detailCard, detailTitle);
    }
    updateDock();
    if (!liveRecords().length && !running) updateDock('쿠팡 검색·목록 페이지에서 상품이 보이면 조회할 수 있습니다.');
  }

  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(scan, 180);
  }

  function ownNode(node) {
    const target = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return target?.matches?.(`${CARD_TAG},${DOCK_TAG}`) || target?.closest?.(`${CARD_TAG},${DOCK_TAG}`);
  }

  function init() {
    if (!document.body) return;
    createDock();
    scan();
    if (liveRecords().length) updateDock('로그인된 쿠팡 Wing의 판매 지표를 상품별로 확인합니다. 버튼을 눌러 시작하세요.');
    const observer = new MutationObserver(changes => {
      const relevant = changes.some(change => {
        if (ownNode(change.target)) return false;
        if (change.type === 'childList') {
          const nodes = [...change.addedNodes, ...change.removedNodes];
          return nodes.some(node => !ownNode(node));
        }
        return true;
      });
      if (relevant) scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
    addEventListener('popstate', scheduleScan);
    // Some Coupang route changes use pushState without a DOM mutation.
    const routeTimer = setInterval(() => {
      if (currentLocation !== location.pathname + location.search) scheduleScan();
    }, 1000);
    addEventListener('pagehide', event => {
      if (running) stopLookup('화면을 이동해 조회를 중지했습니다.');
      if (event.persisted) return;
      clearInterval(routeTimer);
      clearTimeout(scanTimer);
      observer.disconnect();
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'YF_SALES_PROGRESS') {
      if (sender?.id !== chrome.runtime.id || !running || !activeProgress || message.requestId !== activeProgress.requestId || !message.result || typeof message.result !== 'object') return;
      const record = activeProgress.records.get(identity(message.result));
      const result = record && normalizedResult(message.result, record.product);
      if (!result || !['ok', 'unavailable'].includes(result.status)) return;
      record.result = result;
      record.loading = false;
      activeProgress.received.add(identity(record.product));
      renderRecord(record);
      updateDock(`${completed + activeProgress.received.size}/${total}개 확인 · 확인한 상품부터 카드에 표시합니다.`);
      respond?.({ ok: true });
      return;
    }
    if (message?.type !== 'YF_SALES_UI_START' || sender?.id !== chrome.runtime.id) return;
    if (!dock) { respond({ ok: false, error: '쿠팡 페이지를 불러온 뒤 다시 실행해주세요.' }); return; }
    scan();
    if (!liveRecords().length) { respond({ ok: false, error: '쿠팡 검색·목록 페이지에서 상품을 찾지 못했습니다.' }); return; }
    if (!running) void startLookup(liveRecords(), message.force === true);
    respond({ ok: true });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
