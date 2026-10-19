// First-party product identifiers, never seller-product IDs or fuzzy title matches.
export const SALES_SOURCE = '쿠팡 Wing · 상품 카탈로그';
export const WING_URL = 'https://wing.coupang.com/tenants/rfm/coupang-trends/popularity-search';
export function numericId(value, required = false) {
  if (value == null || value === '') {
    if (required) throw Error('상품 ID가 없습니다. 쿠팡 검색 화면을 새로고침해주세요.');
    return null;
  }
  if (typeof value==='number' && (!Number.isSafeInteger(value) || value<=0)) throw Error('상품 ID 형식이 올바르지 않습니다.');
  const id = String(value);
  if (!/^[1-9]\d{0,19}$/.test(id)) throw Error('상품 ID 형식이 올바르지 않습니다.');
  return id;
}
export function validateProducts(products) {
  if (!Array.isArray(products) || !products.length || products.length > 10) throw Error('한 번에 1~10개 상품을 조회할 수 있습니다.');
  return products.map(p => ({productId:numericId(p?.productId,true), itemId:numericId(p?.itemId),vendorItemId:numericId(p?.vendorItemId),title:typeof p?.title === 'string' ? p.title.trim().slice(0,250) : ''}));
}
export function productKey(p) { return `${p.productId}|${p.itemId || ''}|${p.vendorItemId || ''}`; }
export function validateSalesSender(sender, extensionId) {
  if (sender?.id !== extensionId || !Number.isInteger(sender?.tab?.id) || !Number.isInteger(sender?.tab?.windowId) || sender.frameId !== 0) throw Error('쿠팡 상품 화면에서 조회해주세요.');
  const u = new URL(sender.url || '');
  if (u.origin !== 'https://www.coupang.com' || !/^\/(?:np\/search\/?$|np\/categories\/\d+\/?$|vp\/products\/\d+\/?$)/.test(u.pathname)) throw Error('쿠팡 검색·상품 화면에서 조회해주세요.');
  return sender.tab;
}
export function count(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
  const n=Number(value.replaceAll(',',''));return Number.isSafeInteger(n) ? n : null;
}
export function unavailable(product, error = '쿠팡에서 해당 상품의 판매량을 제공하지 않았습니다.') {
  return {...product,status:'unavailable',monthlySales:null,views:null,periodDays:28,source:SALES_SOURCE,asOf:new Date().toISOString(),error};
}
export function selectMetrics(rows, product) {
  if (!Array.isArray(rows)) throw Error('쿠팡 응답 형식이 변경되었습니다.');
  const safeId=v=>{try{return numericId(v);}catch{return null;}};
  const matches = rows.filter(r => r && safeId(r.productId) === product.productId);
  // These are Wing-provided catalog statistics, whose aggregation scope is
  // source-defined. Prefer the requested identifiers when present, but a
  // different catalog item ID does not invalidate an exact product match.
  const exactItems=product.itemId ? matches.filter(r=>safeId(r.itemId)===product.itemId) : [];
  let candidates=exactItems.length ? exactItems : matches;
  if (!candidates.length) return null;
  const exactVendors=product.vendorItemId ? candidates.filter(r=>safeId(r.vendorItemId)===product.vendorItemId) : [];
  if (exactVendors.length) candidates=exactVendors;
  // Even an exact vendor can have duplicate/conflicting rows. Never select an
  // arbitrary number from an ambiguous group, and never sum catalog variants.
  const row=candidates[0];
  if (candidates.some(r=>count(r.salesLast28d)!==count(row.salesLast28d)||count(r.pvLast28Day)!==count(row.pvLast28Day))) return null;
  const monthlySales=count(row.salesLast28d), views=count(row.pvLast28Day);
  if(monthlySales===null && views===null) return null;
  return {monthlySales,views,sourceItemId:safeId(row.itemId),sourceVendorItemId:safeId(row.vendorItemId),scope:'source-defined',matchedBy:exactItems.length ? 'item' : 'product'};
}
