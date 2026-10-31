import {readPageSourceElementImage,pageSourceUrl} from './page-source.mjs';
import {isUnrelatedProductElement,productSectionKind,readProductSectionLinks} from './page-dom-sections.mjs';

const knownContainers='#desc-lazyload-container,.offer-description,.detail-desc-decorate-richtext,[data-module-name="description"],[data-plg-name="description"]';
const headings='h1,h2,h3,h4,h5,h6,[role="heading"]';
const headingWrappers=headings+',div,span,font';
const detailHeading=/^(?:商品详情|产品详情|图文详情|商品描述|产品描述|详细描述|详细说明|商品介绍|제품상세정보|상품상세정보|제품상세|상품상세|상품설명|제품설명|상세설명|상세정보)$/u;
const unrelated=/(?:gallery|sku[-_ ]?(?:list|image))/iu;
const ignoredTags=new Set(['ASIDE','NAV','HEADER','FOOTER','SCRIPT','STYLE','NOSCRIPT','IFRAME','SVG','BUTTON']);
// This evidence stays inside this collector execution. Serialized URL lists do
// not prove that two observations came from the same current-product roots.
const observedScopes=new WeakMap();
export function samePageDomDetailsScope(left,right){
 const a=left&&typeof left==='object'?observedScopes.get(left):null,b=right&&typeof right==='object'?observedScopes.get(right):null;
 return Boolean(a&&b&&a.roots.length&&a.document===b.document&&a.sourceUrl===b.sourceUrl&&a.roots.length===b.roots.length&&a.roots.every((root,index)=>root===b.roots[index]));
}
const select=(root,selector)=>{try{return [...(root?.querySelectorAll?.(selector)??[])];}catch{return [];}};
const attr=(node,name)=>node?.getAttribute?.(name)??'';
const headingText=node=>{const value=String(node?.textContent??'');return value.length<=120?value.replace(/[\s\p{P}\p{S}]/gu,'').trim():'';};
function firstLocalHeading(node){
 const first=[...(node?.children??[])].find(child=>String(child.textContent??'').trim()||child.tagName==='IMG');
 // A heading's translation wrappers may be div/span/font elements. Read only
 // the first local branch; never descend through another content section.
 if(['SECTION','ARTICLE'].includes(first?.tagName)||attr(first,'role')==='tabpanel')return '';
 return first?headingText(first):'';
}
function excluded(node){
 let depth=0,detailSection=false;
 for(let current=node;current;current=current.parentElement){
  if(++depth>40)return true;
  if(ignoredTags.has(current.tagName)||attr(current,'role')==='navigation'||isUnrelatedProductElement(current,{includeOfferLinks:false})||unrelated.test([attr(current,'id'),attr(current,'class'),attr(current,'data-module-name'),attr(current,'data-plg-name')].join(' ')))return true;
  if(['SECTION','ARTICLE','DIV'].includes(current.tagName)||attr(current,'role')==='tabpanel'){
   const kind=productSectionKind(firstLocalHeading(current));
   // A shared layout's earlier review/attribute heading does not describe an
   // independently headed detail section. Only stop the heading heuristic;
   // explicit forbidden tags, roles and metadata still apply at every level.
   if(!detailSection&&['unrelated','attributes','packaging'].includes(kind))return true;
   if(kind==='detail')detailSection=true;
  }
 }
 return false;
}
function semanticDetailRoot(heading,sourceUrl){
 if(excluded(heading)||otherOffer(heading,sourceUrl))return null;
 const label=headingText(heading);let anchor=heading,depth=0;
 // Collapse the heading's inert translation wrappers, not a content container
 // with sibling images/text. Nested CSS header wrappers may have several divs;
 // every wrapper must still contain only this same exact section label.
 while(anchor.parentElement&&depth++<12){
  const parent=anchor.parentElement;
  if(!['SPAN','FONT','DIV','H1','H2','H3','H4','H5','H6'].includes(parent.tagName)&&attr(parent,'role')!=='heading')break;
  if(parent.children?.length!==1||headingText(parent)!==label)break;
  anchor=parent;
 }
 const root=anchor.parentElement;
 if(!root||!['SECTION','ARTICLE','DIV'].includes(root.tagName)&&attr(root,'role')!=='tabpanel'
  ||firstLocalHeading(root)!==label||excluded(root)||otherOffer(root,sourceUrl))return null;
 return root;
}
function otherOffer(node,sourceUrl){
 let depth=0;
 for(let current=node;current&&depth++<40;current=current.parentElement)if(current.tagName==='A'){
  try{const link=new URL(attr(current,'href'),sourceUrl);if(link.hostname==='detail.1688.com'&&/^\/offer\/\d+\.html$/u.test(link.pathname)&&link.origin+link.pathname!==sourceUrl)return true;}catch{/* A non-product image link supplies no source identity. */}
 }
 return false;
}
function imageUrl(node){
 for(const name of ['data-src','data-lazyload-src','data-ks-lazyload','data-original','data-original-src','data-lazy-src','data-lazyload']){
  const value=attr(node,name);if(!value)continue;
  const allowed=readPageSourceElementImage({currentSrc:'',getAttribute:key=>key==='data-src'?value:null},{preferDataSource:true});
  if(allowed)return allowed;
 }
 return readPageSourceElementImage(node,{preferDataSource:true});
}
function backgroundImageUrls(value){
 if(typeof value!=='string'||value.length>16384||/[\u0000-\u001f]/u.test(value))return[];
 const source=value.trim();if(!source||source==='none')return[];
 // Accept complete computed url() layers only. Do not interpret CSS escapes,
 // image-set(), gradients, arbitrary style text or URLs buried in functions.
 const pattern=/url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'\\()]+))\s*\)/iy,urls=[];
 let cursor=0;
 while(cursor<source.length){
  if(urls.length>=16)return[];
  pattern.lastIndex=cursor;const match=pattern.exec(source);if(!match)return[];
  const raw=match[1]??match[2]??match[3];
  const url=readPageSourceElementImage({currentSrc:'',getAttribute:key=>key==='data-src'?raw:null},{preferDataSource:true});
  urls.push(url);cursor=pattern.lastIndex;
  while(/\s/u.test(source[cursor]??'')&&cursor<source.length)cursor++;
  if(cursor===source.length)break;
  if(source[cursor++]!==',')return[];
  while(/\s/u.test(source[cursor]??'')&&cursor<source.length)cursor++;
  if(cursor===source.length)return[];
 }
 return urls.filter(Boolean);
}
function plainDescription(root,sourceUrl){
 if(!root?.childNodes)return String(root?.textContent??'').trim().slice(0,20000);
 const parts=[];let visited=0;
 const visit=node=>{
  if(++visited>6000)throw Error('상품 상세 본문이 수집 크기를 초과했습니다.');
  if(node.nodeType===3||node.nodeName==='#text'){parts.push(node.nodeValue??node.value??node.textContent??'');return;}
  if(excluded(node)||otherOffer(node,sourceUrl)||/^H[1-6]$/u.test(node.tagName??'')||attr(node,'role')==='heading'||detailHeading.test(headingText(node)))return;
  for(const child of node.childNodes??[])visit(child);
  if(['P','DIV','LI','BR'].includes(node.tagName))parts.push('\n');
 };
 visit(root);return parts.join('').replace(/[\u0000-\u001f]+/gu,' ').replace(/\s+/gu,' ').trim().slice(0,20000);
}

/** Current-document semantic regions only; never reads frames or fetches HTML. */
export function readPageDomDetails(document,sourceUrl){
 sourceUrl=pageSourceUrl(sourceUrl).sourceUrl;
 const roots=select(document,knownContainers);
 for(const section of readProductSectionLinks(document).sections)if(section.kind==='detail'&&!roots.includes(section.root))roots.push(section.root);
 const sections=select(document,'section,article,[role="tabpanel"]');
 if(sections.length>300)throw Error('상품 상세 구역이 수집 크기를 초과했습니다.');
 const candidates=select(document,headingWrappers);
 if(candidates.length>6000)throw Error('상품 상세 제목 영역이 수집 크기를 초과했습니다.');
 for(const heading of candidates){
  const label=headingText(heading);
  if(!detailHeading.test(label)||[...(heading.children??[])].some(child=>headingText(child)===label))continue;
  const root=semanticDetailRoot(heading,sourceUrl);if(root&&!roots.includes(root))roots.push(root);
 }
 if(roots.length>30)throw Error('상품 상세 영역이 너무 많습니다. 현재 상품 본문을 확인해주세요.');
 const images=[],texts=[],seenRoots=new Set();
 const addUrl=url=>{
  if(!url||images.includes(url))return;
  if(images.length>=200)throw Error('상품 상세 이미지가 200개를 초과했습니다. 이미지를 일부만 수집하지 않았습니다.');
  images.push(url);
 };
 const add=node=>{if(!excluded(node)&&!otherOffer(node,sourceUrl))addUrl(imageUrl(node));};
 const readStyle=typeof document.defaultView?.getComputedStyle==='function'?node=>document.defaultView.getComputedStyle(node)
  :typeof globalThis.getComputedStyle==='function'?node=>globalThis.getComputedStyle(node):null;
 for(const root of roots){
  if(excluded(root)||otherOffer(root,sourceUrl)||seenRoots.has(root)||[...seenRoots].some(parent=>parent.contains?.(root)))continue;
  seenRoots.add(root);
  // Read ordinary/lazy images and computed backgrounds in one DOM traversal.
  // Reading all <img>s before the background pass reordered mixed detail pages.
  // The exact same verified roots/exclusions still bound every style read.
  const pending=[root];let visited=0,imageNodes=0;
  while(pending.length){
   const node=pending.pop();if(++visited>6000)throw Error('상품 상세 배경 이미지 영역이 수집 크기를 초과했습니다.');
   if(excluded(node)||otherOffer(node,sourceUrl))continue;
   if(readStyle){
    let background;try{background=readStyle(node)?.backgroundImage;}catch{/* Unreadable styles provide no image evidence. */}
    for(const url of backgroundImageUrls(background))addUrl(url);
   }
   if(node.tagName==='IMG'){if(++imageNodes>2000)throw Error('상품 상세 이미지 영역이 너무 큽니다.');add(node);}
   const children=Array.from(node.children??[]);for(let index=children.length-1;index>=0;index--)pending.push(children[index]);
  }
  const text=plainDescription(root,sourceUrl);if(text&&!texts.includes(text))texts.push(text);
 }
 const result={description:texts.join('\n').slice(0,20000),detailImages:images};
 observedScopes.set(result,{document,sourceUrl,roots:[...seenRoots]});
 return result;
}

/** At most 1.5 seconds of passive DOM settling after the user's click. No
 * scrolling, show-more clicks, source requests or cross-frame access. */
export function waitForPageDomDetails(document,sourceUrl,{assertCurrent=()=>{},wait}={}){
 assertCurrent();const initial=readPageDomDetails(document,sourceUrl);
 const delay=wait??(typeof globalThis.setTimeout==='function'?ms=>new Promise(resolve=>globalThis.setTimeout(resolve,ms)):null);
 if(!delay)return initial;
 return (async()=>{
  let previous=initial,stable=0;
  for(let attempt=0;attempt<6;attempt++){
   await delay(250);assertCurrent();const current=readPageDomDetails(document,sourceUrl);
   stable=JSON.stringify(current)===JSON.stringify(previous)?stable+1:0;previous=current;
   if(current.detailImages.length&&stable>=2)break;
  }
  assertCurrent();return previous;
 })();
}
