// Exact, inert ARIA section relationships. A navigation label alone never
// authorizes reading adjacent tables or the whole product document.
const normalize=value=>String(value??'').replace(/\s/gu,'').replace(/[：:]$/u,'');
const labels=new Map([
 ...['商品属性','产品属性','商品属性信息','产品属性信息','商品参数','产品参数','제품속성','상품속성','제품속성정보','상품속성정보','제품매개변수','상품매개변수'].map(value=>[value,'attributes']),
 ...['包装信息','包装参数','포장정보','포장매개변수','제품무게및치수'].map(value=>[value,'packaging']),
 ...['商品详情','产品详情','图文详情','商品描述','产品描述','详细描述','详细说明','商品介绍','제품상세정보','상품상세정보','제품상세','상품상세','상품설명','제품설명','상세설명','상세정보'].map(value=>[value,'detail']),
]);
const unrelatedLabels=new Set(['猜你喜欢','为你推荐','为您推荐','相关推荐','商品推荐','店铺推荐','买家评价','商品评价','同款推荐','看了又看','추천상품','추천제품','관련상품','관련제품','상점추천','매장추천','고객리뷰','구매자리뷰','제품리뷰','상품리뷰','상품평','동일한스타일추천','동일스타일추천','함께본상품','함께보면좋은상품']);
const labelElements='h1,h2,h3,h4,h5,h6,div,span,p,dt,th,legend,caption,font,strong,b,em,i,u,small,mark,sub,sup,a,button,li';
export function productSectionKind(value){const normalized=normalize(value);return labels.get(normalized)??(unrelatedLabels.has(normalized)?'unrelated':null);}
const attr=(node,name)=>node?.getAttribute?.(name)??'';
const select=(root,selector)=>Array.from(root?.querySelectorAll?.(selector)??[]);
const bounded=()=>{throw Error('상품 탭·본문 연결 영역이 수집 크기를 초과했습니다.');};
const id=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\u0000-\u001f]/u.test(value);

/** Structure only: known label categories, fixed tag/role enums and counts.
 * No page text, identifiers, classes, links or image addresses are returned.
 * A navigation label is diagnostic evidence, never permission to read a body. */
export function readProductSectionStructure(document){
 const elements=select(document,labelElements);if(elements.length>20000)bounded();
 const candidates=elements.filter(node=>String(node.textContent??'').length<=120&&productSectionKind(node.textContent)&&!Array.from(node.children??[]).some(child=>productSectionKind(child.textContent)===productSectionKind(node.textContent)));
 if(candidates.length>60)bounded();
 const tag=node=>['H1','H2','H3','H4','H5','H6','DIV','SPAN','P','FONT','STRONG','B','EM','LI','UL','OL','A','BUTTON','SECTION','ARTICLE','TABLE','THEAD','TBODY','TR','TD','TH','MAIN','NAV','HEADER','FOOTER','ASIDE','BODY','HTML'].includes(node?.tagName)?node.tagName:'OTHER';
 const role=node=>['tab','tablist','tabpanel','navigation','heading','table','grid','row','rowgroup','cell','columnheader','rowheader','gridcell'].includes(attr(node,'role'))?attr(node,'role'):'';
 const labels=candidates.map(node=>{
  const ancestors=[];for(let current=node,depth=0;current&&depth++<5;current=current.parentElement){
   // Broad document/layout roots are represented only by their own shape.
   // Counting their descendants would not identify a bounded product section.
   const local=!['HTML','BODY','MAIN'].includes(current.tagName);
   ancestors.push({tag:tag(current),role:role(current),children:Math.min(current.children?.length??0,1000),tables:local?Math.min(select(current,'table,[role="table"],[role="grid"]').length,1000):0,images:local?Math.min(select(current,'img').length,2001):0,frames:local?Math.min(select(current,'iframe').length,301):0});
  }
  return{kind:productSectionKind(node.textContent),excluded:excluded(node,false),ancestors};
 });
 return{labelCount:labels.length,bodyLabelCount:labels.filter(row=>!row.excluded&&row.kind!=='unrelated').length,labels};
}

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
