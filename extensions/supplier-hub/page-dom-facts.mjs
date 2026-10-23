// Read labelled current-product DOM sections only. The caller separately binds
// these inert observations to the exact offer through the retained JSON IDs.
import {isUnrelatedProductElement,productSectionKind,readProductSectionLinks} from './page-dom-sections.mjs';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.replace(/\s+/gu,' ').trim():'';
const label=value=>text(value).replace(/[：:]$/u,'');
const semanticLabel=value=>label(value).replace(/\s/gu,'');
const ATTR_LABELS=['商品属性','产品属性','商品属性信息','产品属性信息','商品参数','产品参数','제품 속성','상품 속성','제품 속성 정보','상품 속성 정보'].map(semanticLabel);
const PACK_LABELS=['包装信息','包装参数','포장 정보','제품 무게 및 치수'].map(semanticLabel);
const ALL_LABELS=[...ATTR_LABELS,...PACK_LABELS];
const EXCLUDED='nav,aside,footer,[role="tab"],[class*="recommend" i],[id*="recommend" i],[class*="comment" i],[class*="evaluate" i]';
const ROOTS='table,[role="table"],[role="grid"]';
const HEADINGS='h1,h2,h3,h4,h5,h6,div,span,p,dt,th,legend,caption,font,strong,b,em,i,u,small,mark,sub,sup';
const INLINE_WRAPPERS=new Set(['font','span','strong','b','em','i','u','small','mark','sub','sup','br']);
const fail=()=>{throw Error('현재 상품의 속성·포장 표를 정확히 수집하지 못했습니다. 상품 속성과 포장 정보를 펼친 뒤 다시 수집해주세요. 옵션·치수를 임의로 채우지 않았습니다.');};
const numeric=(value,max)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=max;
function excluded(node){
 if(node.closest(EXCLUDED))return true;
 // The relationship authorizes the panel, never another product/card or a
 // navigation region nested inside it. Check ancestors for tables AND pairs.
 let depth=0,productSection=false;for(let current=node;current;current=current.parentElement){
  if(++depth>40||current.getAttribute?.('role')==='navigation'||isUnrelatedProductElement(current))return true;
  if(['DIV','SECTION','ARTICLE'].includes(current.tagName)){
   const first=Array.from(current.children??[]).find(child=>text(child.textContent)||child.tagName==='IMG');
   const kind=first&&!['SECTION','ARTICLE'].includes(first.tagName)&&first.getAttribute?.('role')!=='tabpanel'?productSectionKind(first.textContent):null;
   // A local product section can follow a review heading in a shared layout.
   // Its own exact heading bounds this heuristic; explicit unrelated metadata,
   // navigation roles and other-offer links still apply at every ancestor.
   if(!productSection&&kind==='unrelated')return true;
   if(kind==='attributes'||kind==='packaging')productSection=true;
  }
 }
 return false;
}

export function validatePagePackaging(value){
 if(!object(value)||Object.keys(value).some(key=>!['source','weightG','widthMm','lengthMm','heightMm'].includes(key))||value.source!=='package-table'
  ||!['weightG','widthMm','lengthMm','heightMm'].some(key=>Object.hasOwn(value,key)))return fail();
 for(const key of ['weightG','widthMm','lengthMm','heightMm'])if(Object.hasOwn(value,key)&&!numeric(value[key],key==='weightG'?1e9:1e6))return fail();
 return {...value};
}

function cells(row){
 return Array.from(row.children??[]).filter(node=>['td','th'].includes(node.tagName?.toLowerCase())||['cell','columnheader','rowheader','gridcell'].includes(node.getAttribute?.('role')));
}
function rows(root){
 const result=Array.from(root.querySelectorAll('tr,[role="row"]')).filter(row=>row.closest(ROOTS)===root);
 // A permitted table may still contain unrelated row groups. Keep the raw
 // row-count limit before excluding them. textContent must not smuggle a
 // nested card/navigation span into an otherwise permitted cell either.
 return safeRows(result);
}
function safeRows(result){
 if(result.length>201)fail();return result.filter(row=>{
  const pending=[{node:row,depth:0}];let count=0;
  while(pending.length){
   const {node,depth}=pending.pop();if(++count>512||depth>40)fail();if(excluded(node))return false;
   for(const child of Array.from(node.children??[]))pending.push({node:child,depth:depth+1});
  }
  return true;
 });
}
/** Chrome translation wraps a label in font/span nodes. Only bounded inert
 * inline text qualifies; a container including another section/table/link is
 * never promoted to a product heading merely because it contains its label. */
function inlineTextOnly(node){
 let count=0;
 const visit=(current,depth)=>{
  if(++count>32||depth>8)return false;
  return Array.from(current.children??[]).every(child=>INLINE_WRAPPERS.has(child.tagName?.toLowerCase())&&!excluded(child)&&visit(child,depth+1));
 };
 return visit(node,0);
}
function pairTextOnly(node){
 let count=0;
 const visit=(current,depth)=>{
  if(++count>32||depth>8||excluded(current))return false;
  const children=Array.from(current.children??[]);
  return children.every(child=>(INLINE_WRAPPERS.has(child.tagName?.toLowerCase())||children.length===1&&child.tagName==='DIV')&&visit(child,depth+1));
 };
 return visit(node,0);
}
function labelledHeadings(elements){
 const candidates=elements.filter(node=>ALL_LABELS.includes(semanticLabel(node.textContent))&&!excluded(node)&&inlineTextOnly(node));
 const known=new Set(candidates);
 // Prefer the outer label wrapper once. A translated h3/font/font chain is
 // one heading and must not consume three slots or widen section traversal.
 return candidates.filter(node=>{
  for(let parent=node.parentElement,depth=0;parent&&depth<8;parent=parent.parentElement,depth++)if(known.has(parent))return false;
  return true;
 });
}
function sectionRoot(heading,kind){
 for(let scope=heading.parentElement,depth=0;scope&&depth<6;scope=scope.parentElement,depth++){
  const section=inspectSection(scope,kind,heading);if(section===false)return null;if(section)return section;
 }
 return null;
}
function inspectSection(scope,kind,heading=null){
 if(!scope?.tagName||['HTML','BODY','MAIN'].includes(scope.tagName)||excluded(scope))return false;
 if(heading){
  const first=Array.from(scope.children??[]).find(child=>text(child.textContent)||child.tagName==='IMG');
  if(first&&(productSectionKind(first.textContent)!==kind||['SECTION','ARTICLE'].includes(first.tagName)))return false;
 }
 // A local label cannot expand into a parent holding detail/recommendation
 // sections. Their tables/pairs describe a different region of the document.
 if(Array.from(scope.querySelectorAll(HEADINGS)).some(node=>['detail','unrelated'].includes(productSectionKind(node.textContent))&&inlineTextOnly(node)))return false;
 const headings=labelledHeadings(Array.from(scope.querySelectorAll(HEADINGS)));
 if(headings.some(node=>node!==heading&&(ATTR_LABELS.includes(semanticLabel(node.textContent))?'attributes':'packaging')!==kind))return false;
 const tables=Array.from(scope.querySelectorAll(ROOTS)).filter(node=>!excluded(node));
 if(scope.matches?.(ROOTS))tables.unshift(scope);
 if(tables.length>4)fail();if(tables.length)return{scope,tables};
 if(kind==='packaging'){
  const divTables=structuralPackageTables(scope);if(divTables.length)return{scope,tables:[],divTables};
 }
 if(kind==='attributes'){
  const pairs=Array.from(scope.querySelectorAll('div,li,dl')).filter(node=>node!==heading&&!excluded(node)&&node.children.length===2&&Array.from(node.children).every(pairTextOnly)&&(!heading||!node.contains(heading)));
  if(pairs.length)return{scope,tables:[],pairs};
 }
 return null;
}
/** CSS tables need no ARIA role to be real tables. Require one headed local
 * package section, explicit column semantics and a rectangular row hierarchy;
 * classes, row position and option order never supply identity or units. */
function structuralPackageTables(scope){
 const containers=Array.from(scope.querySelectorAll('div,ul,ol'));if(containers.length>2000)fail();
 const atomic=(node,depth=0)=>depth<=8&&!excluded(node)&&Array.from(node.children??[]).every(child=>(INLINE_WRAPPERS.has(child.tagName?.toLowerCase())||child.tagName==='DIV')&&atomic(child,depth+1));
 const directCells=node=>{
  const children=Array.from(node.children??[]);
  return children.length>=2&&children.length<=20&&children.every(child=>atomic(child))?children:null;
 };
 const unpack=(node,depth=0)=>{
  if(depth>4||excluded(node))return null;
  const children=Array.from(node.children??[]);if(!children.length||children.length>201)return null;
  const groups=children.map(child=>unpack(child,depth+1));
  if(groups.every(Boolean))return groups.flat();
  return directCells(node)?[node]:null;
 };
 const found=[];
 for(const root of containers){
  if(excluded(root))continue;
  // Start below the table root. Otherwise a two-row div table can itself
  // look like two atomic cells after font translation wrappers are applied.
  const groups=Array.from(root.children??[]).map(child=>unpack(child));
  if(!groups.length||groups.some(group=>!group))continue;
  const observed=groups.flat();if(observed.length<2)continue;
  const first=directCells(observed[0]);if(!first)continue;
  const columns=first.map(cell=>header(cell.textContent));
  if(!columns.some(column=>column?.kind==='name'||column?.kind==='supplierSku'))continue;
  if(!first.some(cell=>/^(?:重量|包装重量|毛重|무게|포장무게|총중량|(?:包装|포장)?(?:宽度|宽|长度|长|高度|高|가로|너비|세로|길이|높이))(?:[（(]|$)/u.test(semanticLabel(cell.textContent))))continue;
  if(observed.some(row=>directCells(row)?.length!==first.length))fail();
  const retained=safeRows(observed);if(retained[0]!==observed[0])continue;
  found.push({root,rows:retained});
 }
 const unique=found.filter(table=>!found.some(other=>other!==table&&table.root.contains(other.root)));
 if(unique.length>4)fail();return unique;
}
function header(value){
 const name=text(value).replace(/\s/gu,'').replace(/（/gu,'(').replace(/）/gu,')');
 if(['颜色','颜色分类','规格','款式','型号','选项','색상','색상분류','규격','스타일','모델','옵션'].includes(name))return{kind:'name'};
 if(['SKU','sku','SKU ID','skuId','SKU编号','sku编号','SKU编码','sku编码'].map(value=>value.replace(/\s/gu,'')).includes(name))return{kind:'supplierSku'};
 const weight=/^(?:重量|包装重量|毛重|무게|포장무게|총중량)\((g|克|그램|kg|千克|킬로그램)\)$/u.exec(name);
 if(weight)return{kind:'weightG',multiplier:['kg','千克','킬로그램'].includes(weight[1])?1000:1};
 const dimension=/^(?:包装|포장)?(宽度|宽|长度|长|高度|高|가로|너비|세로|길이|높이)\((mm|毫米|밀리미터|cm|厘米|센티미터)\)$/u.exec(name);
 if(dimension)return{kind:/^(?:宽|가로|너비)/u.test(dimension[1])?'widthMm':/^(?:长|세로|길이)/u.test(dimension[1])?'lengthMm':'heightMm',multiplier:['cm','厘米','센티미터'].includes(dimension[2])?10:1};
 return null;
}
function measurement(value,column){
 const raw=text(value);if(!raw||raw==='-'||raw==='--'||raw==='暂无')return undefined;
 const match=/^(\d+(?:\.\d+)?)\s*(g|克|그램|kg|千克|킬로그램|mm|毫米|밀리미터|cm|厘米|센티미터)?$/u.exec(raw);if(!match)fail();
 const suffix=match[2];
 if(suffix){const expected=column.kind==='weightG'?(column.multiplier===1000?['kg','千克','킬로그램']:['g','克','그램']):(column.multiplier===10?['cm','厘米','센티미터']:['mm','毫米','밀리미터']);if(!expected.includes(suffix))fail();}
 // Convert only explicitly headed units, retaining integer physical fields.
 const result=Number(match[1])*column.multiplier;
 if(!numeric(result,column.kind==='weightG'?1e9:1e6))fail();return result;
}
function packagingRows(root,observedRows=null){
 const all=observedRows??rows(root);if(!all.length)return[];
 const readCells=observedRows?row=>Array.from(row.children??[]):cells;
 const first=readCells(all[0]),columns=first.map(cell=>header(cell.textContent));
 if(first.length>20||columns.filter(column=>column?.kind==='name').length>1||columns.filter(column=>column?.kind==='supplierSku').length>1)return fail();
 const kinds=columns.filter(Boolean).map(column=>column.kind);
 if(!kinds.some(kind=>kind==='name'||kind==='supplierSku')||!kinds.some(kind=>!['name','supplierSku'].includes(kind)))return fail();
 if(new Set(kinds).size!==kinds.length)return fail();
 return all.slice(1).map(row=>{
  const values=readCells(row);if(values.length!==first.length)return fail();
  const result={packaging:{source:'package-table'}};
  columns.forEach((column,index)=>{if(!column)return;const value=text(values[index].textContent);
   if(column.kind==='name'||column.kind==='supplierSku'){if(!value||value.length>(column.kind==='name'?500:200))fail();result[column.kind]=value;}
   else{const observed=measurement(value,column);if(observed!==undefined)result.packaging[column.kind]=observed;}
  });
  // Chrome translation changes text, but an explicit supplier SKU attribute
  // retains its identity. Never use a row index or a generic DOM element ID.
  const stableSkus=['data-sku-id','data-skuid'].map(key=>row.getAttribute?.(key)).filter(value=>value!==null&&value!==undefined);
  if(stableSkus.length){
   if(stableSkus.some(value=>typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>200)||new Set(stableSkus).size!==1||result.supplierSku&&result.supplierSku!==stableSkus[0])fail();
   result.supplierSku=stableSkus[0];
  }
  return Object.keys(result.packaging).length===1?null:result;
 }).filter(Boolean);
}

export function readPageDomFacts(document){
 const elements=Array.from(document.querySelectorAll(HEADINGS));if(elements.length>20000)fail();
 const headings=labelledHeadings(elements);
 if(headings.length>30)fail();
 const linked=readProductSectionLinks(document).sections.filter(section=>section.kind!=='detail');
 if(!headings.length&&!linked.length)return null;
 const attributes=[],packaging=[],knownAttributes=new Map(),seenRoots=new Set();
 const add=(name,value)=>{
  name=label(name);value=text(value);if(!name||!value||name.length>190||value.length>1000||/[\u0000-\u001f]/u.test(name+value))fail();
  const key=name.toLowerCase();if(knownAttributes.has(key)){if(knownAttributes.get(key)!==value)fail();return;}
  if(attributes.length>=50)fail();knownAttributes.set(key,value);attributes.push({name,value});
 };
 const discovered=linked.map(({kind,root})=>({kind,section:inspectSection(root,kind)}));
 for(const heading of headings){
  const kind=ATTR_LABELS.includes(semanticLabel(heading.textContent))?'attributes':'packaging',section=sectionRoot(heading,kind);if(!section){if(kind==='packaging')fail();continue;}
  discovered.push({kind,section});
 }
 for(const {kind,section}of discovered){
  if(!section)continue;
  for(const root of section.tables){
   if(seenRoots.has(root))continue;seenRoots.add(root);
   for(const link of root.querySelectorAll('a[href]'))if(/\/offer\/\d+\.html/u.test(link.getAttribute('href')??''))fail();
   if(kind==='packaging'){packaging.push(...packagingRows(root));if(packaging.length>200)fail();}
   else for(const row of rows(root)){
    const values=cells(row);if(!values.length)continue;if(values.length%2||values.length>20)fail();
    for(let index=0;index<values.length;index+=2)add(values[index].textContent,values[index+1].textContent);
   }
  }
  if(kind==='attributes')for(const pair of section.pairs??[])add(pair.children[0].textContent,pair.children[1].textContent);
  if(kind==='packaging')for(const table of section.divTables??[]){
   if(seenRoots.has(table.root))continue;seenRoots.add(table.root);
   packaging.push(...packagingRows(table.root,table.rows));if(packaging.length>200)fail();
  }
 }
 return attributes.length||packaging.length?{attributes,packaging}:null;
}

export function validatePageDomFacts(value){
 if(!object(value)||Object.keys(value).some(key=>!['format','sourceUrl','offerId','attributes','packaging'].includes(key))||value.format!=='yoofam-page-dom-facts-v1'
  ||!Array.isArray(value.attributes)||value.attributes.length>50||!Array.isArray(value.packaging)||value.packaging.length>200)fail();
 for(const row of value.attributes)if(!object(row)||Object.keys(row).sort().join(',')!=='name,value'||!text(row.name)||text(row.name)!==row.name||row.name.length>190||!text(row.value)||text(row.value)!==row.value||row.value.length>1000)fail();
 for(const row of value.packaging){
  if(!object(row)||Object.keys(row).some(key=>!['name','supplierSku','packaging'].includes(key))||!row.name&&!row.supplierSku)fail();
  for(const key of ['name','supplierSku'])if(Object.hasOwn(row,key)&&(!text(row[key])||text(row[key])!==row[key]||row[key].length>(key==='name'?500:200)))fail();
  validatePagePackaging(row.packaging);
 }
 return value;
}

export function mergePageDomFacts(attributes,options,facts){
 const merged=attributes.map(row=>({...row})),names=new Map(merged.map(row=>[row.name.toLowerCase(),row.value]));
 for(const row of facts.attributes){const key=row.name.toLowerCase();if(names.has(key)){if(names.get(key)!==row.value)fail();continue;}if(merged.length>=50)fail();names.set(key,row.value);merged.push({...row});}
 const assignments=new Map();
 for(const row of facts.packaging){
  const named=options.filter(option=>row.name&&text(option.name)===row.name);
  const candidates=row.supplierSku?options.filter(option=>option.supplierSku===row.supplierSku&&(!named.length||named.includes(option))):named;
  if(candidates.length!==1)throw Error('포장 표의 옵션명·SKU가 현재 상품과 정확히 일치하지 않습니다. Chrome 번역으로 옵션명이 바뀌었다면 원문 표시로 전환한 뒤 다시 수집해주세요. 행 순서나 번역을 추측해 연결하지 않았습니다.');const option=candidates[0];
  const prior=assignments.get(option.key)??{};
  for(const [key,value]of Object.entries(row.packaging)){if(Object.hasOwn(prior,key)&&prior[key]!==value)fail();prior[key]=value;}
  assignments.set(option.key,prior);
 }
 return{attributes:merged,options:options.map(option=>assignments.has(option.key)?{...option,packaging:validatePagePackaging(assignments.get(option.key))}:option)};
}
