// Exact, inert ARIA section relationships. A navigation label alone never
// authorizes reading adjacent tables or the whole product document.
const normalize=value=>String(value??'').replace(/\s/gu,'').replace(/[：:]$/u,'');
const labels=new Map([
 ...['商品属性','产品属性','商品参数','产品参数','제품속성','상품속성'].map(value=>[value,'attributes']),
 ...['包装信息','包装参数','포장정보','제품무게및치수'].map(value=>[value,'packaging']),
 ...['商品详情','产品详情','图文详情','商品描述','产品描述','详细描述','详细说明','商品介绍','제품상세정보','상품상세정보','제품상세','상품상세','상품설명','제품설명','상세설명','상세정보'].map(value=>[value,'detail']),
]);
const attr=(node,name)=>node?.getAttribute?.(name)??'';
const select=(root,selector)=>Array.from(root?.querySelectorAll?.(selector)??[]);
const bounded=()=>{throw Error('상품 탭·본문 연결 영역이 수집 크기를 초과했습니다.');};
const id=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\u0000-\u001f]/u.test(value);

export function isCommerceCardElement(node){
 return /(?:shop|store)[-_ ]?(?:card|recommend)/iu.test(['id','class','data-module-name','data-plg-name'].map(name=>attr(node,name)).join(' '));
}
export function isUnrelatedProductElement(node,{includeOfferLinks=true}={}){
 const metadata=['id','class','data-module-name','data-plg-name'].map(name=>attr(node,name)).join(' ');
 // `preview` is a normal image/detail container, not a review. Splitting
 // camel-case tokens still excludes buyerReview/reviewCard explicitly.
 const tokens=metadata.replace(/([a-z0-9])([A-Z])/gu,'$1 $2');
 return isCommerceCardElement(node)
  ||/(?:recommend|related|suggest|feedback|comment|evaluate|offer[-_ ]?card)/iu.test(metadata)
  ||/(?:^|[\s_-])reviews?(?=$|[\s_-])/iu.test(tokens)
  ||includeOfferLinks&&node?.tagName==='A'&&/\/offer\/\d+\.html/u.test(attr(node,'href'));
}

function excluded(node,tab){
 let depth=0;
 for(let current=node;current;current=current.parentElement){
  if(++depth>40)return true;
  const role=attr(current,'role');
  if(['ASIDE','FOOTER','IFRAME','SCRIPT','STYLE','NOSCRIPT'].includes(current.tagName)||isUnrelatedProductElement(current))return true;
  if(!tab&&(['NAV','HEADER'].includes(current.tagName)||['navigation','tab','tablist'].includes(role)||current!==node&&role==='tabpanel'))return true;
 }
 return false;
}

export function readProductSectionLinks(document){
 const tabs=select(document,'[role="tab"]'),panels=select(document,'[role="tabpanel"]');
 if(tabs.length>300||panels.length>300)bounded();
 const recognized=tabs.map(tab=>({tab,kind:labels.get(normalize(tab.textContent))})).filter(row=>row.kind);
 if(recognized.length>30)bounded();
 const diagnostics={tabCount:tabs.length,knownTabCount:recognized.length,panelCount:panels.length,linkedKnownPanelCount:0,unlinkedKnownTabCount:recognized.length};
 if(!recognized.length)return{sections:[],diagnostics};
 const identified=select(document,'[id]');if(identified.length>20000)bounded();
 const ids=new Map();for(const node of identified){const value=attr(node,'id');if(!ids.has(value))ids.set(value,[]);ids.get(value).push(node);}
 const sections=[];
 for(const {tab,kind}of recognized){
  const tabId=attr(tab,'id'),panelId=attr(tab,'aria-controls');
  if(!id(tabId)||!id(panelId)||ids.get(tabId)?.length!==1||ids.get(tabId)[0]!==tab||ids.get(panelId)?.length!==1||excluded(tab,true))continue;
  let tablist=false;for(let current=tab.parentElement,depth=0;current&&depth++<40;current=current.parentElement)if(attr(current,'role')==='tablist'){tablist=true;break;}
  const panel=ids.get(panelId)[0];
  if(!tablist||!panels.includes(panel)||attr(panel,'aria-labelledby')!==tabId||excluded(panel,false)||panel.contains?.(tab)||tab.contains?.(panel)
   ||tabs.filter(other=>attr(other,'aria-controls')===panelId).length!==1||select(panel,'[role="tabpanel"]').length)continue;
  sections.push({kind,root:panel});
 }
 diagnostics.linkedKnownPanelCount=sections.length;diagnostics.unlinkedKnownTabCount=recognized.length-sections.length;
 return{sections,diagnostics};
}
