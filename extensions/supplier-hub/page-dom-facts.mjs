// Read labelled current-product DOM sections only. The caller separately binds
// these inert observations to the exact offer through the retained JSON IDs.
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.replace(/\s+/gu,' ').trim():'';
const label=value=>text(value).replace(/[：:]$/u,'');
const semanticLabel=value=>label(value).replace(/\s/gu,'');
const ATTR_LABELS=['商品属性','产品属性','商品参数','产品参数','제품 속성','상품 속성'].map(semanticLabel);
const PACK_LABELS=['包装信息','包装参数','포장 정보','제품 무게 및 치수'].map(semanticLabel);
const ALL_LABELS=[...ATTR_LABELS,...PACK_LABELS];
const EXCLUDED='nav,aside,footer,[role="tab"],[class*="recommend" i],[id*="recommend" i],[class*="review" i],[id*="review" i],[class*="comment" i],[class*="evaluate" i],[class*="shop" i],[class*="store" i]';
const ROOTS='table,[role="table"],[role="grid"]';
const HEADINGS='h1,h2,h3,h4,h5,h6,div,span,p,dt,th,legend,caption,font,strong,b,em,i,u,small,mark,sub,sup';
const INLINE_WRAPPERS=new Set(['font','span','strong','b','em','i','u','small','mark','sub','sup','br']);
const fail=()=>{throw Error('현재 상품의 속성·포장 표를 정확히 수집하지 못했습니다. 상품 속성과 포장 정보를 펼친 뒤 다시 수집해주세요. 옵션·치수를 임의로 채우지 않았습니다.');};
const numeric=(value,max)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=max;

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
 if(result.length>201)fail();return result;
}
/** Chrome translation wraps a label in font/span nodes. Only bounded inert
 * inline text qualifies; a container including another section/table/link is
 * never promoted to a product heading merely because it contains its label. */
function inlineTextOnly(node){
 let count=0;
 const visit=(current,depth)=>{
  if(++count>32||depth>8)return false;
  return Array.from(current.children??[]).every(child=>INLINE_WRAPPERS.has(child.tagName?.toLowerCase())&&!child.closest(EXCLUDED)&&visit(child,depth+1));
 };
 return visit(node,0);
}
function labelledHeadings(elements){
 const candidates=elements.filter(node=>ALL_LABELS.includes(semanticLabel(node.textContent))&&!node.closest(EXCLUDED)&&inlineTextOnly(node));
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
  if(scope.closest(EXCLUDED))return null;
  const headings=labelledHeadings(Array.from(scope.querySelectorAll(HEADINGS)));
  if(headings.some(node=>node!==heading&&(ATTR_LABELS.includes(semanticLabel(node.textContent))?'attributes':'packaging')!==kind))return null;
  const tables=Array.from(scope.querySelectorAll(ROOTS)).filter(node=>!node.closest(EXCLUDED));
  if(scope.matches?.(ROOTS))tables.unshift(scope);
  if(tables.length>4)fail();
  if(tables.length)return{scope,tables};
  if(kind==='attributes'){
   const pairs=Array.from(scope.querySelectorAll('div,li,dl')).filter(node=>node!==heading&&!node.closest(EXCLUDED)&&node.children.length===2&&Array.from(node.children).every(inlineTextOnly)&&!node.contains(heading));
   if(pairs.length)return{scope,tables:[],pairs};
  }
 }
 return null;
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
function packagingRows(root){
 const all=rows(root);if(!all.length)return[];
 const first=cells(all[0]),columns=first.map(cell=>header(cell.textContent));
 if(first.length>20||columns.filter(column=>column?.kind==='name').length>1||columns.filter(column=>column?.kind==='supplierSku').length>1)return fail();
 const kinds=columns.filter(Boolean).map(column=>column.kind);
 if(!kinds.some(kind=>kind==='name'||kind==='supplierSku')||!kinds.some(kind=>!['name','supplierSku'].includes(kind)))return fail();
 if(new Set(kinds).size!==kinds.length)return fail();
 return all.slice(1).map(row=>{
  const values=cells(row);if(values.length!==first.length)return fail();
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
 if(headings.length>30)fail();if(!headings.length)return null;
 const attributes=[],packaging=[],knownAttributes=new Map(),seenRoots=new Set();
 const add=(name,value)=>{
  name=label(name);value=text(value);if(!name||!value||name.length>190||value.length>1000||/[\u0000-\u001f]/u.test(name+value))fail();
  const key=name.toLowerCase();if(knownAttributes.has(key)){if(knownAttributes.get(key)!==value)fail();return;}
  if(attributes.length>=50)fail();knownAttributes.set(key,value);attributes.push({name,value});
 };
 for(const heading of headings){
  const kind=ATTR_LABELS.includes(semanticLabel(heading.textContent))?'attributes':'packaging',section=sectionRoot(heading,kind);if(!section){if(kind==='packaging')fail();continue;}
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
