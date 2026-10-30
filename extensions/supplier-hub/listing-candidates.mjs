// Inert interpretation of cards already loaded in the current search document.
// Card prices are observations only; this module never creates an option or a
// product snapshot, opens another page, or requests remote information.
export const LISTING_BATCH_LIMIT=60;
export const LISTING_SCAN_LIMIT=1000;
export const LISTING_BATCH_BYTES=128*1024;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const uuid=value=>typeof value==='string'&&UUID.test(value);
const ID=/^[1-9]\d{0,19}$/u;
const fields=['offerId','sourceUrl','title','thumbnail','displayPrice'];
const text=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,max):'';
const literal=(value,max,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||value.length>0)&&value===value.trim()&&!/[\u0000-\u001f\u007f]/u.test(value);
const attr=(element,name)=>typeof element?.getAttribute==='function'?element.getAttribute(name):null;
const descendants=(element,selector)=>typeof element?.querySelectorAll==='function'?Array.from(element.querySelectorAll(selector)).slice(0,LISTING_SCAN_LIMIT):[];
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const dense=value=>Array.isArray(value)&&Object.keys(value).length===value.length&&Object.keys(value).every((key,index)=>key===String(index));
export function listingPageUrl(value){
 let url;try{url=new URL(value);}catch{throw Error('1688 검색 결과에서 여러 상품을 선택해주세요.');}
 if(url.protocol!=='https:'||url.hostname!=='s.1688.com'||url.port||url.username||url.password||url.pathname!=='/selloffer/offer_search.htm'||url.href.length>6000)throw Error('1688 검색 결과에서 여러 상품을 선택해주세요.');
 url.hash='';return url.href;
}
export function listingOfferUrl(value,base='https://s.1688.com/selloffer/offer_search.htm'){
 try{
  if(typeof value!=='string'||value.length>4096)return null;
  const url=new URL(value,base),match=/^\/offer\/([1-9]\d{0,19})\.html$/u.exec(url.pathname);
  if(url.protocol!=='https:'||url.hostname!=='detail.1688.com'||url.port||url.username||url.password||!match)return null;
  return {offerId:match[1],sourceUrl:`https://detail.1688.com/offer/${match[1]}.html`};
 }catch{return null;}
}
function thumbnailUrl(value){
 try{
  if(typeof value!=='string'||value.length>2048)return '';
  const url=new URL(value.startsWith('//')?'https:'+value:value);
  return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&!url.hash&&(url.hostname==='alicdn.com'||url.hostname.endsWith('.alicdn.com'))?url.href:'';
 }catch{return '';}
}
function isLoaded(card){
 if(!card||card.isConnected===false||card.hidden===true||attr(card,'aria-hidden')==='true')return false;
 if(card.style?.display==='none'||card.style?.visibility==='hidden')return false;
 return !card.closest?.('[hidden], [aria-hidden="true"]');
}
function officialTrackingLink(value,base){
 try{const url=new URL(value,base);return url.protocol==='https:'&&url.hostname==='dj.1688.com'&&!url.port&&!url.username&&!url.password;}catch{return false;}
}
function cardIdentity(card,base){
 const found=new Set();let invalid=false;
 const push=value=>{if(value===null||value===undefined||value==='')return;if(typeof value==='number'){if(!Number.isSafeInteger(value)){invalid=true;return;}value=String(value);}if(typeof value!=='string'||value.length>64||!ID.test(value.trim())){invalid=true;return;}found.add(value.trim());};
 const keys=['data-offer-id','data-offerid','data-complete-offer-id','data-offer-expose-id'];
 // Shipped RS evidence: href can be dj.1688.com and contain no offer ID.
 // These are local card observations; tracking links are never followed.
 for(const node of [card,...descendants(card,keys.map(key=>`[${key}]`).join(','))])for(const key of keys)push(attr(node,key));
 const links=[card,...descendants(card,'a[href]')];
 for(const link of links){
  const href=attr(link,'href'),identity=listingOfferUrl(href,base);if(identity)push(identity.offerId);
  if(!identity&&!officialTrackingLink(href,base)&&!String(attr(link,'class')||'').includes('offerCard'))continue;
  const render=attr(link,'data-renderkey');if(render&&render.length<=2048){const match=/_([0-9]+)$/u.exec(render);if(match)push(match[1]);}
  const aplus=attr(link,'data-aplus-report');if(aplus){if(aplus.length>8192){invalid=true;continue;}const matches=[...aplus.matchAll(/(?:^|[&;|,^\s])object_id@([0-9]+)(?=$|[&;|,^\s])/gu)];if(/(?:^|[&;|,^\s])object_id@/u.test(aplus)&&!matches.length)invalid=true;for(const match of matches)push(match[1]);}
 }
 for(const node of [card,...descendants(card,'[data-extra]')]){
  const raw=attr(node,'data-extra');if(!raw||!raw.includes('"offerId"'))continue;if(raw.length>8192){invalid=true;continue;}
  try{const root=JSON.parse(raw),queue=[{value:root,depth:0}];let visited=0;while(queue.length){const {value,depth}=queue.shift();if(!object(value)&&!Array.isArray(value))continue;if(++visited>64||depth>4){invalid=true;break;}if(Object.hasOwn(value,'offerId'))push(value.offerId);for(const child of Object.values(value))if(child&&typeof child==='object')queue.push({value:child,depth:depth+1});}}catch{invalid=true;}
 }
 if(invalid||found.size!==1)return null;
 const offerId=[...found][0];return {offerId,sourceUrl:`https://detail.1688.com/offer/${offerId}.html`};
}
function cardPrice(card){
 const explicit=descendants(card,'[data-price]')[0];if(explicit){const value=text(attr(explicit,'data-price')||explicit.textContent,120);if(value)return value;}
 const row=descendants(card,'[class*="priceRow"], [class*="price-row"]')[0]||descendants(card,'[class*="price"]')[0];if(!row)return '';
 const pieces=descendants(row,'[class*="priceItem"], [class*="price-item"]');if(pieces.length)return text(pieces.map(piece=>piece.textContent||'').join(' – '),120);
 let visited=0,overflow=false;const withoutSales=(node,depth=0)=>{if(++visited>512||depth>32){overflow=true;return '';}if(/descText|desc-text/u.test(String(attr(node,'class')||'')))return '';const children=node.childNodes;if(!children?.length)return String(node.textContent||'');return Array.from(children).map(child=>withoutSales(child,depth+1)).join('');};
 const observed=withoutSales(row);return overflow?'':text(observed,120);
}
export function readListingCard(card,baseUrl){
 if(!isLoaded(card))return null;
 const base=listingPageUrl(baseUrl),links=[card,...descendants(card,'a[href]')],identity=cardIdentity(card,base);if(!identity)return null;
 let title='';
 for(const selector of ['[data-offer-title]','[class*="titleText"]','[class*="title"]','[class*="subject"]','h3']){
  const element=descendants(card,selector)[0];title=text(attr(element,'data-offer-title')||attr(element,'title')||element?.textContent,500);if(title)break;
 }
 if(!title)for(const element of links){title=text(attr(element,'title'),500);if(title)break;}
 let thumbnail='';
 for(const image of [...new Set([...descendants(card,'img[class*="mainImg"]'),...descendants(card,'img')])]){
  if(!title)title=text(attr(image,'alt'),500);
  for(const value of [image.currentSrc,attr(image,'src'),attr(image,'data-src'),attr(image,'data-lazyload-src'),attr(image,'data-ks-lazyload')]){thumbnail=thumbnailUrl(value);if(thumbnail)break;}
  if(thumbnail)break;
 }
 const displayPrice=cardPrice(card);
 return title?Object.freeze({...identity,title,thumbnail,displayPrice}):null;
}
export function scanListingCards(document,baseUrl){
 listingPageUrl(baseUrl);
 const marker='[data-offer-grid-cell],[data-complete-offer-id],[data-offer-expose-id],[data-offer-id],[data-offerid]';
 const markedRoot=element=>{const grid=element.closest?.('[data-offer-grid-cell]');if(grid)return grid;let result=null,cursor=element;for(let depth=0;cursor&&depth<7;depth++){const next=cursor.closest?.(marker);if(!next)break;result=next;cursor=next.parentElement||next.parentNode;}return result;};
 const visualWrapper=element=>{
  const marked=markedRoot(element);if(marked)return marked;
  let cursor=element.parentElement||element.parentNode;
  for(let depth=0;cursor&&depth<4;depth++,cursor=cursor.parentElement||cursor.parentNode){
   const tag=String(cursor.localName||cursor.tagName||cursor.tag||'').toLowerCase();if(['html','body','nav','header','footer'].includes(tag))break;
   const semantic=tag==='li'||tag==='article'||/(?:offer|product)[-_]?(?:card|item)|(?:offer|product)[-_]wrapper/iu.test(String(attr(cursor,'class')||''));
   const links=descendants(cursor,'a[href]').filter(link=>listingOfferUrl(attr(link,'href'),baseUrl)||officialTrackingLink(attr(link,'href'),baseUrl));
   if(semantic)return cursor; // Mixed product identities in one card reject it.
   if(links.length>1)break; // Never use the entire search grid as a card.
   if(links.length===1&&descendants(cursor,'[data-extra]').length>descendants(element,'[data-extra]').length)return cursor;
  }
  return element;
 };
 const roots=[...descendants(document,marker),...descendants(document,'a[class*="offerCard"]')];
 const elements=new Set(),offers=new Set(),result=[];
 const add=element=>{
  if(elements.has(element)||element.closest?.('nav,header,footer,[role="navigation"]'))return;elements.add(element);
  const candidate=readListingCard(element,baseUrl);
  if(!candidate||offers.has(candidate.offerId))return;
  offers.add(candidate.offerId);result.push({element,candidate});
 };
 for(const raw of roots.slice(0,LISTING_SCAN_LIMIT))add(visualWrapper(raw));
 // Logged-in variants need not carry the measured RS class prefixes. Start
 // only at an official detail/tracking link, then take the nearest unambiguous visual
 // product card with its own price. Navigation/whole-grid containers fail.
 for(const link of descendants(document,'a[href]')){
  if(result.length>=LISTING_SCAN_LIMIT)break;
  if(!listingOfferUrl(attr(link,'href'),baseUrl)&&!officialTrackingLink(attr(link,'href'),baseUrl)||link.closest?.('nav,header,footer,[role="navigation"]'))continue;
  const marked=markedRoot(link);if(marked){add(marked);continue;}
  let node=visualWrapper(link);
  for(let depth=0;node&&depth<7;depth++,node=node.parentElement||node.parentNode){
   if(['html','body','nav','header','footer'].includes(String(node.localName||node.tagName||node.tag||'').toLowerCase()))break;
   const candidate=readListingCard(node,baseUrl);
   if(candidate?.thumbnail&&candidate.displayPrice){add(node);break;}
  }
 }
 return result;
}
/** Selection is bound to the exact connected card identity at click time.
 * A different node with the same ID does not inherit a removed selection. */
export function createListingSelection(){
 const selected=new Map();
 const reconcile=entries=>{
  const current=new Map(entries.map(entry=>[entry.element,entry.candidate]));let removed=0;
  for(const [element,identity] of selected){const value=current.get(element);if(!value||value.offerId!==identity.offerId||value.sourceUrl!==identity.sourceUrl){selected.delete(element);removed++;}}
  return removed;
 };
 return Object.freeze({
  reconcile,
  set(entry,checked){if(checked)selected.set(entry.element,{offerId:entry.candidate.offerId,sourceUrl:entry.candidate.sourceUrl});else selected.delete(entry.element);},
  has:element=>selected.has(element),
  clear:()=>selected.clear(),
  removeOffers(offerIds){const remove=new Set(offerIds);for(const [element,value] of selected)if(remove.has(value.offerId))selected.delete(element);},
  values(entries){reconcile(entries);return entries.filter(entry=>selected.has(entry.element)).map(entry=>entry.candidate);},
  get size(){return selected.size;},
 });
}
export function validateListingBatchPayload(value){
 if(!exact(value,['version','batchId','listingUrl','items','destinations'])||value.version!==1||!uuid(value.batchId)||listingPageUrl(value.listingUrl)!==value.listingUrl
  ||!dense(value.destinations)||value.destinations.length<1||value.destinations.length>2||new Set(value.destinations).size!==value.destinations.length||value.destinations.some(item=>!['ai-registration','rocket-compare'].includes(item))
  ||!dense(value.items)||value.items.length<1||value.items.length>LISTING_BATCH_LIMIT)throw Error('선택한 상품 목록과 현재 검색 주소를 확인해주세요.');
 const seen=new Set(),items=value.items.map(item=>{
  if(!exact(item,fields)||!ID.test(item.offerId||'')||seen.has(item.offerId)||listingOfferUrl(item.sourceUrl)?.sourceUrl!==item.sourceUrl||listingOfferUrl(item.sourceUrl)?.offerId!==item.offerId
   ||!literal(item.title,500)||!literal(item.thumbnail,2048,true)||!literal(item.displayPrice,120,true)
   ||item.thumbnail!==''&&thumbnailUrl(item.thumbnail)!==item.thumbnail)throw Error('선택한 상품의 번호·원문 URL 또는 카드 정보를 확인하지 못했습니다.');
  seen.add(item.offerId);return Object.freeze(Object.fromEntries(fields.map(key=>[key,item[key]])));
 });
 const result={version:1,batchId:value.batchId,listingUrl:value.listingUrl,items,destinations:Object.freeze([...value.destinations])};
 if(new TextEncoder().encode(JSON.stringify(result)).length>LISTING_BATCH_BYTES)throw Error('선택 목록의 크기를 초과했습니다. 상품 수를 줄여주세요.');
 return Object.freeze({...result,items:Object.freeze(items)});
}
export function createListingBatchPayload({batchId,listingUrl,entries,selection,destinations}){
 // Re-read every selected card immediately before the message is constructed.
 // Earlier title/price observations cannot turn a recycled card into a source.
 const current=entries.map(entry=>({element:entry.element,candidate:readListingCard(entry.element,listingUrl)})).filter(entry=>entry.candidate);
 const removed=selection.reconcile(current);
 if(removed)throw Error(`선택 후 바뀌거나 사라진 상품 ${removed}개를 해제했습니다. 현재 목록을 확인하고 다시 담아주세요.`);
 return validateListingBatchPayload({version:1,batchId,listingUrl:listingPageUrl(listingUrl),items:selection.values(current),destinations});
}
const itemStates=new Set(['queued','opening','reading','saving','saved','failed','uncertain','cancelled']);
const batchStates=new Set(['running','completed','partial','paused','cancelled']);
const comparisonStates=new Set(['queued','saving','saved','failed','uncertain','cancelled']);
const safeTime=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now+5000;
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=LISTING_BATCH_LIMIT;
function storedReceipt(value){
 return exact(value,['storedId','captureVersion','receivedAt'])&&uuid(value.storedId)&&Number.isSafeInteger(value.captureVersion)&&value.captureVersion>0
  &&typeof value.receivedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value.receivedAt)&&Number.isFinite(Date.parse(value.receivedAt));
}
/** Only worker-correlated status is displayed. Queue acceptance is never a
 * collection receipt, and comparison receipts never masquerade as AI saves. */
export function validateListingBatchReply(value,{batchId=null,destinations=null,now=Date.now()}={}){
 const bad=()=>{throw Error('일괄 담기의 저장 상태 응답을 확인하지 못했습니다. 다시 담지 말고 진행 상태를 확인해주세요.');};
 try{if(new TextEncoder().encode(JSON.stringify(value)).length>256*1024)return bad();}catch{return bad();}
 if(batchId!==null&&!uuid(batchId)||!object(value)||value.ok!==true||!Object.hasOwn(value,'batch'))return bad();
 const batch=value.batch;if(batch===null){if(batchId)return bad();return null;}
 if(!object(batch)||!uuid(batch.batchId)||batchId&&batch.batchId!==batchId||!batchStates.has(batch.status)
  ||!dense(batch.destinations)||!batch.destinations.length||batch.destinations.length>2||new Set(batch.destinations).size!==batch.destinations.length||batch.destinations.some(item=>!['ai-registration','rocket-compare'].includes(item))
  ||destinations&&JSON.stringify([...batch.destinations].sort())!==JSON.stringify([...destinations].sort())
  ||!dense(batch.items)||batch.items.length<1||batch.items.length>LISTING_BATCH_LIMIT||batch.total!==batch.items.length
  ||typeof batch.cancelRequested!=='boolean'||!safeTime(batch.createdAt,now)||!safeTime(batch.updatedAt,now)||batch.updatedAt<batch.createdAt)return bad();
 const ai=batch.destinations.includes('ai-registration'),compare=batch.destinations.includes('rocket-compare'),seen=new Set(),itemIds=new Set();
 const items=batch.items.map(item=>{
  if(!object(item)||!uuid(item.itemId)||itemIds.has(item.itemId)||!ID.test(item.offerId||'')||seen.has(item.offerId)||listingOfferUrl(item.sourceUrl)?.offerId!==item.offerId||listingOfferUrl(item.sourceUrl)?.sourceUrl!==item.sourceUrl
   ||!itemStates.has(item.status)||!literal(item.title,500)||!literal(item.thumbnail,2048,true)||item.thumbnail!==''&&thumbnailUrl(item.thumbnail)!==item.thumbnail
   ||!literal(item.displayPrice,120,true)||item.error!==undefined&&(typeof item.error!=='string'||item.error.length>1000)
   ||ai&&item.status==='saved'&&!storedReceipt(item.storedReceipt)||item.storedReceipt!==undefined&&!storedReceipt(item.storedReceipt))return bad();
  seen.add(item.offerId);itemIds.add(item.itemId);return Object.freeze({itemId:item.itemId,offerId:item.offerId,sourceUrl:item.sourceUrl,title:item.title,thumbnail:item.thumbnail,displayPrice:item.displayPrice,status:item.status,
   ...(item.error?{error:item.error}:{}),...(item.storedReceipt?{storedReceipt:Object.freeze({...item.storedReceipt})}:{})});
 });
 const counts=Object.fromEntries(['saved','failed','uncertain','queued'].map(state=>[state,items.filter(item=>item.status===state).length]));
 if(Object.entries(counts).some(([key,total])=>!count(batch[key])||batch[key]!==total))return bad();
 let comparison=null;
 if(compare){
  const c=batch.comparison;
  if(!object(c)||!comparisonStates.has(c.status)||!count(c.storedCount)||!count(c.existingCount)||c.storedCount+c.existingCount>items.length
   ||c.error!==undefined&&(typeof c.error!=='string'||c.error.length>1000)
   ||c.status==='saved'&&(!Number.isSafeInteger(c.revision)||c.revision<1||c.storedCount+c.existingCount!==items.length||!object(c.receipt)))return bad();
  if(c.status==='saved'){
   const receipt=c.receipt;
   if(receipt.format!=='yoofam-listing-comparison-receipt-v1'||receipt.batchId!==batch.batchId||receipt.stored!==true||receipt.revision!==c.revision
    ||receipt.storedCount!==c.storedCount||receipt.existingCount!==c.existingCount||!Array.isArray(receipt.itemOfferIds)||JSON.stringify(receipt.itemOfferIds)!==JSON.stringify(items.map(item=>item.offerId)))return bad();
  }
  comparison=Object.freeze({status:c.status,storedCount:c.storedCount,existingCount:c.existingCount,...(c.revision!==undefined?{revision:c.revision}:{}),...(c.error?{error:c.error}:{})});
 }else if(batch.comparison!==undefined&&batch.comparison!==null)return bad();
 if(batch.status==='completed'&&(ai&&counts.saved!==items.length||compare&&comparison.status!=='saved'))return bad();
 return Object.freeze({batchId:batch.batchId,status:batch.status,destinations:Object.freeze([...batch.destinations]),items:Object.freeze(items),total:items.length,...counts,
  cancelRequested:batch.cancelRequested,createdAt:batch.createdAt,updatedAt:batch.updatedAt,comparison});
}

/** A rejected START is reusable only with an exact correlated worker proof
 * that no descriptor was created. Generic failures remain outcome-unknown. */
export function listingStartNotCreated(value,batchId){
 return uuid(batchId)&&exact(value,['ok','accepted','batchId','code','error'])&&value.ok===false&&value.accepted===false&&uuid(value.batchId)&&value.batchId===batchId
  &&typeof value.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(value.code)&&typeof value.error==='string'&&value.error.length>0&&value.error.length<=1000;
}
