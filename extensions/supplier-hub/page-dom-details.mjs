import {readPageSourceElementImage,pageSourceUrl} from './page-source.mjs';

const knownImages='#desc-lazyload-container img,.offer-description img';
const knownContainers='#desc-lazyload-container,.offer-description,[data-module-name="description"],[data-plg-name="description"]';
const headings='h1,h2,h3,h4,h5,h6,[role="heading"]';
const detailHeading=/^(?:商品详情|产品详情|图文详情|商品描述|产品描述|详细描述|详细说明|商品介绍)$/u;
const unrelatedHeading=/^(?:猜你喜欢|为你推荐|为您推荐|相关推荐|商品推荐|店铺推荐|买家评价|商品评价|看了又看)$/u;
const unrelated=/(?:recommend|related|suggest|review|feedback|shop[-_ ]?(?:card|recommend)|store[-_ ]?(?:card|recommend)|gallery|sku[-_ ]?(?:list|image)|offer[-_ ]?card)/iu;
const ignoredTags=new Set(['ASIDE','NAV','HEADER','FOOTER','SCRIPT','STYLE','NOSCRIPT','IFRAME','SVG','BUTTON']);
const select=(root,selector)=>{try{return [...(root?.querySelectorAll?.(selector)??[])];}catch{return [];}};
const attr=(node,name)=>node?.getAttribute?.(name)??'';
const headingText=node=>String(node?.textContent??'').replace(/[\s\p{P}\p{S}]/gu,'').trim();
function excluded(node){
 let depth=0;
 for(let current=node;current;current=current.parentElement){
  if(++depth>40)return true;
  if(ignoredTags.has(current.tagName)||attr(current,'role')==='navigation'||unrelated.test([attr(current,'id'),attr(current,'class'),attr(current,'data-module-name'),attr(current,'data-plg-name')].join(' ')))return true;
  if(['SECTION','ARTICLE'].includes(current.tagName)||attr(current,'role')==='tabpanel'){
   const first=select(current,headings)[0];if(first&&unrelatedHeading.test(headingText(first)))return true;
  }
 }
 return false;
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
function plainDescription(root,sourceUrl){
 if(!root?.childNodes)return String(root?.textContent??'').trim().slice(0,20000);
 const parts=[];let visited=0;
 const visit=node=>{
  if(++visited>6000)throw Error('상품 상세 본문이 수집 크기를 초과했습니다.');
  if(node.nodeType===3||node.nodeName==='#text'){parts.push(node.nodeValue??node.value??node.textContent??'');return;}
  if(excluded(node)||otherOffer(node,sourceUrl)||/^H[1-6]$/u.test(node.tagName??'')||attr(node,'role')==='heading')return;
  for(const child of node.childNodes??[])visit(child);
  if(['P','DIV','LI','BR'].includes(node.tagName))parts.push('\n');
 };
 visit(root);return parts.join('').replace(/[\u0000-\u001f]+/gu,' ').replace(/\s+/gu,' ').trim().slice(0,20000);
}

/** Current-document semantic regions only; never reads frames or fetches HTML. */
export function readPageDomDetails(document,sourceUrl){
 sourceUrl=pageSourceUrl(sourceUrl).sourceUrl;
 const roots=select(document,knownContainers);
 const sections=select(document,'section,article,[role="tabpanel"]');
 if(sections.length>300)throw Error('상품 상세 구역이 수집 크기를 초과했습니다.');
 for(const root of sections){
  const first=select(root,headings)[0];
  if(first&&detailHeading.test(headingText(first))&&!roots.includes(root))roots.push(root);
 }
 if(roots.length>30)throw Error('상품 상세 영역이 너무 많습니다. 현재 상품 본문을 확인해주세요.');
 const images=[],texts=[],seenRoots=new Set();
 const add=node=>{
  if(excluded(node)||otherOffer(node,sourceUrl))return;
  const url=imageUrl(node);if(!url||images.includes(url))return;
  if(images.length>=200)throw Error('상품 상세 이미지가 200개를 초과했습니다. 이미지를 일부만 수집하지 않았습니다.');
  images.push(url);
 };
 // Retain the original exact-container path, including old same-page layouts.
 const known=select(document,knownImages);if(known.length>2000)throw Error('상품 상세 이미지 영역이 너무 큽니다.');
 for(const node of known)add(node);
 for(const root of roots){
  if(excluded(root)||otherOffer(root,sourceUrl)||seenRoots.has(root)||[...seenRoots].some(parent=>parent.contains?.(root)))continue;
  seenRoots.add(root);
  const nodes=select(root,'img');if(nodes.length>2000)throw Error('상품 상세 이미지 영역이 너무 큽니다.');
  for(const node of nodes)add(node);
  const text=plainDescription(root,sourceUrl);if(text&&!texts.includes(text))texts.push(text);
 }
 return {description:texts.join('\n').slice(0,20000),detailImages:images};
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
