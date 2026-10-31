// Independent, inert interpretation of the current product document. No vendor
// code, requests, cookies, globals, eval or executable script injection.
import {readPageDomFacts,validatePageDomFacts,mergePageDomFacts,validatePagePackaging} from './page-dom-facts.mjs';
import {isUnrelatedProductElement} from './page-dom-sections.mjs';
export const PAGE_SOURCE_LIMIT=512*1024;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const plain=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';
const price=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1e8?value:typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())?price(Number(value)):null;
const integer=value=>Number.isSafeInteger(Number(value))&&Number(value)>=1?Number(value):null;
export function pageSourceUrl(value){
 const url=new URL(value);
 const match=url.pathname.match(/^\/offer\/([1-9]\d{0,29})\.html$/);
 if(url.protocol!=='https:'||url.hostname!=='detail.1688.com'||url.port||url.username||url.password||!match)throw Error('1688 상품 본문에서 수집해주세요.');
 return {sourceUrl:`https://detail.1688.com/offer/${match[1]}.html`,offerId:match[1]};
}
function image(value){
 try{const url=new URL(String(value).startsWith('//')?'https:'+value:value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&(url.hostname==='alicdn.com'||url.hostname.endsWith('.alicdn.com'))&&url.href.length<=2048?url.href:null;}catch{return null;}
}
function firstImage(...values){for(const value of values){if(typeof value!=='string')continue;const url=image(value);if(url)return url;}return null;}
const optionParts=value=>value.split(/&gt;|＞|[;，,>|]/u).map(part=>part.trim()).filter(Boolean);
/** Read only this image element. A truthy placeholder or foreign URL must not
 * hide a later valid lazy URL. Preserve the caller's existing valid-source
 * priority, and apply the same CDN validation used by the stored snapshot. */
export function readPageSourceElementImage(element,{preferDataSource=false}={}){
 if(!element)return null;
 const attribute=name=>element.getAttribute(name);
 const candidates=preferDataSource
  ?[attribute('data-src'),element.currentSrc,attribute('src'),attribute('data-lazyload-src'),attribute('data-ks-lazyload')]
  :[element.currentSrc,attribute('src'),attribute('data-lazyload-src'),attribute('data-src'),attribute('data-ks-lazyload')];
 // These spellings are already read inside verified detail roots. They are
 // fallback-only here so gallery/SKU images on this same element retain every
 // existing valid-source priority and the identical CDN validation below.
 candidates.push(...['data-original','data-original-src','data-lazy-src','data-lazyload'].map(attribute));
 for(const candidate of candidates){const url=image(candidate);if(url)return url;}
 return null;
}
/** Read a JSON value after an exact quoted property; never evaluate scripts. */
function pageJsonProperties(text,key,firstOnly=false){
 const values=[];
 const pattern=new RegExp('"'+key+'"\\s*:', 'g');
 for(let match;(match=pattern.exec(text))!==null;){
  const position=match.index;
  let start=pattern.lastIndex;while(/\s/.test(text[start]??'')&&start<text.length)start++;
  if(!['{','[','"'].includes(text[start]))continue;
  let quoted=false,escaped=false,depth=0;
  for(let end=start;end<text.length&&end-start<=2*1024*1024;end++){
   const char=text[end];
   if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"'){quoted=false;if(end>start&&depth===0){try{values.push({value:JSON.parse(text.slice(start,end+1)),position,start,end:end+1});if(firstOnly)return values;}catch{}break;}}}
   else if(char==='"')quoted=true;
   else if(char==='{'||char==='[')depth++;
   else if(char==='}'||char===']'){if(--depth===0){try{values.push({value:JSON.parse(text.slice(start,end+1)),position,start,end:end+1});if(firstOnly)return values;}catch{}break;}}
  }
  if(values.length>100)throw Error('상품 원문이 수집 크기를 초과했습니다.');
 }
 return values;
}
export function pageJsonProperty(text,key){return pageJsonProperties(text,key,true)[0]?.value;}
// Locate literal JSON containers without running script text. Unrelated shop
// and recommendation containers cannot supply a current-product title.
function enclosingJsonScope(text,position,key,value,strictLiteral=false){
 const stack=[];let quoted='',escaped=false,line=false,block=false;
 for(let i=0;i<position;i++){
  const char=text[i],next=text[i+1];
  if(line){if(char==='\n'||char==='\r')line=false;continue;}
  if(block){if(char==='*'&&next==='/'){block=false;i++;}continue;}
  if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quoted)quoted='';continue;}
  if(char==='/'&&next==='/'){line=true;i++;continue;}
  if(char==='/'&&next==='*'){block=true;i++;continue;}
  if(strictLiteral&&char==='/')return null;
  if(['"',"'","\x60"].includes(char)){quoted=char;continue;}
  if(char==='{'||char==='[')stack.push({char,start:i});
  else if(char==='}'||char===']')stack.pop();
 }
 if(quoted||line||block)return null;
 for(const container of stack.reverse()){
  if(container.char!=='{')continue;
  const wrapped='"root":'+text.slice(container.start),entry=pageJsonProperties(wrapped,'root',true)[0],parsed=entry?.value;
  if(object(parsed)&&Object.hasOwn(parsed,key)&&(value===undefined||JSON.stringify(parsed[key])===JSON.stringify(value)))return {value:parsed,literal:wrapped.slice(entry.start,entry.end)};
 }
 return null;
}
function enclosingJsonObject(text,position,key,value){return enclosingJsonScope(text,position,key,value)?.value??null;}
const titleKeys=['subject','offerTitle','offerSubject','productTitle','productName','title'];
function assertProductIdentity(value,offerId){
 for(const key of ['offerId','productId'])if(value[key]!==undefined&&String(value[key])!==offerId)throw Error('상품 원문의 상품 번호가 현재 URL과 다릅니다.');
}
function sourceTitle(scripts,models,offerId){
 const candidates=[];
 const add=value=>{const title=titleKeys.map(key=>plain(value[key],500)).find(Boolean);if(title)candidates.push(title);};
 for(const {text,entry} of models){
  const scope=enclosingJsonObject(text,entry.position,'skuModel',entry.value);
  if(!scope)continue;
  assertProductIdentity(scope,offerId);add(scope);
  for(const key of ['offerBaseInfo','tempModel'])if(object(scope[key])){assertProductIdentity(scope[key],offerId);add(scope[key]);}
 }
 // A separate title container is usable only when its own identity matches.
 if(!candidates.length)for(const text of scripts)for(const key of titleKeys)for(const entry of pageJsonProperties(text,key)){
  const scope=enclosingJsonObject(text,entry.position,key,entry.value);
  if(!scope||scope.offerId===undefined&&scope.productId===undefined)continue;
  if(['offerId','productId'].some(key=>scope[key]!==undefined&&String(scope[key])!==offerId))continue;
  add(scope);
 }
 if(new Set(candidates).size>1)throw Error('현재 상품의 원문 상품명이 여러 개입니다. 상품 본문을 다시 확인해주세요.');
 return candidates[0]??'';
}
function attributeSourceError(){throw Error('현재 상품의 속성 원문이 올바르지 않거나 서로 다릅니다. 상품 본문을 다시 확인해주세요.');}
/** The enclosing object has already parsed as JSON. Retain its literal field
 * spans as well: JSON.parse alone discards duplicate keys, including escaped
 * spellings such as offer\u0049d. Inspect only the exact fields being trusted. */
function literalValueEnd(text,start){
 let quoted=false,escaped=false,depth=0;
 if(!['{','[','"'].includes(text[start])){let end=start;while(end<text.length&&!/[,}\]]/.test(text[end]))end++;return end;}
 for(let end=start;end<text.length&&end-start<=2*1024*1024;end++){
  const character=text[end];
  if(quoted){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character==='"'){quoted=false;if(depth===0)return end+1;}}
  else if(character==='"')quoted=true;
  else if(character==='{'||character==='[')depth++;
  else if(character==='}'||character===']'){if(--depth===0)return end+1;}
 }
 return attributeSourceError();
}
function ownLiteralFields(node){
 if(!object(node?.value))return attributeSourceError();
 const text=node.literal,fields=new Map();let cursor=1;
 while(cursor<text.length){
  while(/[\s,]/.test(text[cursor]??'')&&cursor<text.length)cursor++;
  if(text[cursor]==='}')return fields;
  if(text[cursor]!=='"')return attributeSourceError();
  const end=literalValueEnd(text,cursor),key=JSON.parse(text.slice(cursor,end));cursor=end;
  while(/\s/.test(text[cursor]??'')&&cursor<text.length)cursor++;
  if(text[cursor++]!==':')return attributeSourceError();
  while(/\s/.test(text[cursor]??'')&&cursor<text.length)cursor++;
  const valueEnd=literalValueEnd(text,cursor),literal=text.slice(cursor,valueEnd).trim();
  fields.set(key,[...(fields.get(key)??[]),{value:JSON.parse(literal),literal}]);cursor=valueEnd;
 }
 return attributeSourceError();
}
function literalChild(node,key,required=false){
 const entries=ownLiteralFields(node).get(key)??[];
 if(entries.length>1||required&&!entries.length)return attributeSourceError();
 return entries[0]??null;
}
function literalArrayItems(node){
 if(!Array.isArray(node?.value)||node.value.length>50)return attributeSourceError();
 const items=[],text=node.literal;let cursor=1;
 while(cursor<text.length){
  while(/[\s,]/.test(text[cursor]??'')&&cursor<text.length)cursor++;
  if(text[cursor]===']')return items;
  const end=literalValueEnd(text,cursor),literal=text.slice(cursor,end).trim();items.push({value:JSON.parse(literal),literal});cursor=end;
 }
 return attributeSourceError();
}
/** Recorded product pages use a literal top-level window.__INIT_DATA assignment.
 * Strings, comments, nested executable assignments and computed data are ignored. */
function initialDataLiterals(code){
 const values=[];let quote='',escaped=false,line=false,block=false,depth=0,significant='';
 for(let index=0;index<code.length;index++){
  const character=code[index],next=code[index+1];
  if(line){if(character==='\n'||character==='\r')line=false;continue;}
  if(block){if(character==='*'&&next==='/'){block=false;index++;}continue;}
  if(quote){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character===quote)quote='';continue;}
  if(character==='/'&&next==='/'){line=true;index++;continue;}
  if(character==='/'&&next==='*'){block=true;index++;continue;}
  // A standalone literal assignment needs no slash operator outside strings.
  // Reject such mixed scripts conservatively instead of treating regex text
  // (which can itself contain semicolons) as an executable assignment.
  if(character==='/')return [];
  if(['"',"'",'`'].includes(character)){quote=character;significant='value';continue;}
  if(depth===0&&(!significant||significant===';')&&code.startsWith('window.__INIT_DATA',index)){
   const match=/^window\.__INIT_DATA\s*=\s*/.exec(code.slice(index));
   if(match&&code[index+match[0].length]==='{'){
    const start=index+match[0].length,end=literalValueEnd(code,start),literal=code.slice(start,end);let value;
    try{value=JSON.parse(literal);}catch{continue;}
    if(!/^\s*(?:;|$)/.test(code.slice(end)))return attributeSourceError();
    values.push({value,literal});if(values.length>100)return attributeSourceError();index=end-1;significant='value';continue;
   }
  }
  if(character==='{'||character==='['||character==='(')depth++;
  else if(character==='}'||character===']'||character===')')depth--;
  if(!/\s/.test(character))significant=character;
 }
 return values;
}
/** A detail URL is authoritative only in a literal primary product record.
 * Do not recursively search recommendation/shop objects, evaluate assignments,
 * or infer a CDN token from an offer number. The caller validates the URL and
 * independently binds this read to the current browser document. */
export function readPageSourceDescriptionReference(sourceUrl,scripts){
 const {offerId}=pageSourceUrl(sourceUrl);
 if(!Array.isArray(scripts)||scripts.length>100||scripts.some(text=>typeof text!=='string')||scripts.reduce((size,text)=>size+text.length,0)>4*1024*1024)throw Error('상세 원문 연결의 크기를 확인하지 못했습니다.');
 const references=[];
 const fail=()=>{throw Error('현재 상품의 상세 원문 연결을 확인하지 못했습니다.');};
 const identity=(node,required=true)=>{
  if(!object(node?.value))return fail();
  let found=false;
  for(const key of ['offerId','productId']){
   const field=literalChild(node,key);if(!field)continue;found=true;
   if(!(typeof field.value==='string'&&field.value===offerId||typeof field.value==='number'&&Number.isSafeInteger(field.value)&&String(field.value)===offerId))fail();
  }
  if(required&&!found)fail();
 };
 const publicRecord=node=>{
  for(const key of ['isPicPrivate','isPricePrivate','isDetailForbidden']){const field=literalChild(node,key);if(field&&field.value!==false)fail();}
 };
 const append=node=>{
  const field=literalChild(node,'detailUrl');if(!field)return;
  identity(node);publicRecord(node);
  if(typeof field.value!=='string'||!field.value||field.value.length>2048||/[\u0000-\u0020\u007f]/u.test(field.value))fail();
  references.push(field.value);if(references.length>1)fail();
 };
 for(const text of scripts){
  const trimmed=text.trim(),roots=[];
  if(trimmed.startsWith('{')){try{const value=JSON.parse(trimmed);if(object(value))roots.push({value,literal:trimmed});}catch{continue;}}
  else roots.push(...initialDataLiterals(text));
  for(const root of roots){
   const fields=ownLiteralFields(root);
   // Direct primary JSON requires its own current identity and SKU sibling.
   if(fields.has('detailUrl')&&fields.has('skuModel')){
    const model=literalChild(root,'skuModel',true);identity(root);identity(model,false);publicRecord(model);
    if(!object(model.value.skuInfoMap)&&!Array.isArray(model.value.skuProps))fail();
    append(root);
   }
   // This is a fixed known primary slot, never a descendant/key search.
   if(!fields.has('globalData'))continue;
   const global=literalChild(root,'globalData',true);if(!object(global.value))fail();
   if(!ownLiteralFields(global).has('detailModel'))continue;
   identity(literalChild(global,'offerBaseInfo',true));identity(literalChild(global,'tempModel',true));publicRecord(global);
   const signs=literalChild(global,'offerSigns');if(signs){if(!object(signs.value))fail();const forbidden=literalChild(signs,'isDetailForbidden');if(forbidden&&forbidden.value!==false)fail();}
   append(literalChild(global,'detailModel',true));
  }
 }
 return references.length?{sourceUrl:pageSourceUrl(sourceUrl).sourceUrl,offerId,detailUrl:references[0]}:null;
}
/** Accept direct current-offer propsList containers, and the exact recorded
 * product-attributes component of a fully bound __INIT_DATA envelope. Arbitrary
 * ancestors never authorize nested shop/recommendation attributes. */
function sourceAttributes(scripts,offerId){
 const attributes=[],known=new Map(),fail=attributeSourceError;
 const sameId=value=>typeof value==='string'&&value===offerId||typeof value==='number'&&Number.isSafeInteger(value)&&String(value)===offerId;
 const hasCurrentIdentity=node=>object(node?.value)&&['offerId','productId'].some(key=>(ownLiteralFields(node).get(key)??[]).some(entry=>sameId(entry.value)));
 const verifyIdentity=(node,required=false)=>{
  if(!object(node?.value))return fail();
  for(const key of ['offerId','productId']){const field=literalChild(node,key,required&&key==='offerId');if(field&&!sameId(field.value))fail();}
 };
 const append=scope=>{
  const list=literalChild(scope,'propsList',true);
  for(const pair of literalArrayItems(list)){
   const field=(key,max)=>{const value=literalChild(pair,key,true).value;if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/u.test(value)||!value.trim())return fail();return value.trim();};
   const name=field('name',190),value=field('value',1000),key=name.toLowerCase();
   if(known.has(key)){if(known.get(key)!==value)fail();continue;}
   if(attributes.length>=50)fail();known.set(key,value);attributes.push({name,value});
  }
 };
 for(const text of scripts){
  const pattern=/"propsList"\s*:/g;let containers=0;
  for(let match;(match=pattern.exec(text))!==null;){
   if(++containers>100)fail();
   const scope=enclosingJsonScope(text,match.index,'propsList',undefined,true);if(!scope)continue;
   const fields=ownLiteralFields(scope),identities=['offerId','productId'].filter(key=>fields.has(key));
   if(identities.length){if(!hasCurrentIdentity(scope))continue;verifyIdentity(scope);}
   else{
    if(!(fields.get('skuModel')??[]).some(hasCurrentIdentity))continue;
    verifyIdentity(literalChild(scope,'skuModel',true));
   }
   const model=literalChild(scope,'skuModel');if(model&&object(model.value))verifyIdentity(model);
   append(scope);
  }
  for(const envelope of initialDataLiterals(text)){
   // This is the recorded product-attributes slot, not a generic recursive
   // propsList search. Other components may contain shops/recommendations.
   if(!object(envelope.value.data?.['590893002003']?.data)||!Object.hasOwn(envelope.value.data['590893002003'].data,'propsList'))continue;
   const global=literalChild(envelope,'globalData',true),data=literalChild(envelope,'data',true);
   verifyIdentity(literalChild(global,'offerBaseInfo',true),true);verifyIdentity(literalChild(global,'tempModel',true),true);
   const signs=literalChild(global,'offerSigns');
   if(literalChild(global,'isPicPrivate')?.value===true||literalChild(global,'isPricePrivate')?.value===true||signs&&literalChild(signs,'isDetailForbidden')?.value===true)fail();
   const component=literalChild(data,'590893002003',true),body=literalChild(component,'data',true);verifyIdentity(body);append(body);
  }
 }
 return attributes;
}
const DOM_OPTION_LABELS=['规格','颜色','尺寸','颜色分类','类型','款式','型号','套餐','配置','版本','容量','尺码','花色','口味','颜色规格','材质','风格','图案'];
const DOM_OPTION_ROOT='[class*="sku" i],[class*="prop" i],[class*="spec" i]';
const DOM_OPTION_EXCLUDED='[class*="review" i],[class*="comment" i],[class*="rate" i],[class*="rating" i],[class*="feedback" i],[class*="evaluate" i],[class*="评价"],[class*="评论"],[id*="review" i],[id*="comment" i],[id*="evaluate" i],[id*="rate" i],[class*="recommend" i],[id*="recommend" i]';
const domText=value=>typeof value==='string'?value.replace(/\s+/gu,' ').trim():'';
const domLabel=value=>domText(value).replace(/[:：\s]/gu,'');
function domOptionsError(){return Error('현재 상품의 옵션 영역과 개별 위안 가격을 확인하지 못했습니다. 원문은 임의로 조합하지 않았습니다.');}
function domSourceIdentity(scripts,offerId){
 let bound=false;
 const matches=value=>typeof value==='string'&&value===offerId||typeof value==='number'&&Number.isSafeInteger(value)&&String(value)===offerId;
 for(const text of scripts)for(const entry of pageJsonProperties(text,'globalData')){
  if(!object(entry.value))throw domOptionsError();
  const global={value:entry.value,literal:text.slice(entry.start,entry.end)},base=literalChild(global,'offerBaseInfo',true);
  if(!object(base?.value)||!matches(literalChild(base,'offerId',true)?.value))throw domOptionsError();
  for(const record of [base,literalChild(global,'tempModel')])if(record){
   if(!object(record.value))throw domOptionsError();
   for(const key of ['offerId','productId']){const field=literalChild(record,key);if(field&&!matches(field.value))throw domOptionsError();}
  }
  for(const key of ['isPicPrivate','isPricePrivate']){const field=literalChild(global,key);if(field&&field.value!==false)throw domOptionsError();}
  const signs=literalChild(global,'offerSigns');
  if(signs){if(!object(signs.value))throw domOptionsError();const field=literalChild(signs,'isDetailForbidden');if(field&&field.value!==false)throw domOptionsError();}
  bound=true;
 }
 if(!bound)throw domOptionsError();
}
function domFactsIdentity(scripts,offerId){
 if(scripts.some(text=>pageJsonProperties(text,'globalData').length)){domSourceIdentity(scripts,offerId);return;}
 let bound=false;
 for(const text of scripts)for(const entry of pageJsonProperties(text,'skuModel')){
  if(!object(entry.value))throw domOptionsError();
  const node={value:entry.value,literal:text.slice(entry.start,entry.end)};
  for(const key of ['offerId','productId']){
   const field=literalChild(node,key);if(!field)continue;
   if(!['string','number'].includes(typeof field.value)||String(field.value)!==offerId)throw domOptionsError();bound=true;
  }
 }
 if(!bound)throw domOptionsError();
}
/** DOM facts are separate from script propsList, but need the same current
 * offer binding before they can contribute supplier attributes or packaging. */
export function readPageSourceDomFacts(document,sourceUrl,scripts){
 const identity=pageSourceUrl(sourceUrl);
 if(!Array.isArray(scripts)||scripts.length>100||scripts.some(value=>typeof value!=='string')||scripts.reduce((sum,value)=>sum+value.length,0)>4*1024*1024)throw domOptionsError();
 const observed=readPageDomFacts(document);if(!observed)return null;
 domFactsIdentity(scripts,identity.offerId);
 return validatePageDomFacts({format:'yoofam-page-dom-facts-v1',...identity,...observed});
}
/** Script variants remain authoritative. This separate observation can supply
 * only one missing image for an exact, unique full option name; it cannot
 * contribute variants, prices, supplier IDs, ordering or partial-axis guesses. */
function scriptImageModel(scripts,offerId){
  const declarations=scripts.flatMap(text=>pageJsonProperties(text,'skuModel').map(entry=>({...entry,text})));
  if(!declarations.length||declarations.length>100||declarations.some(entry=>!object(entry.value))
   ||scripts.reduce((count,text)=>count+[...text.matchAll(/"skuModel"\s*:/gu)].length,0)!==declarations.length)throw domOptionsError();
  const models=declarations.map(entry=>entry.value);
  if(new Set(models.map(value=>JSON.stringify(value))).size!==1)throw domOptionsError();
  domFactsIdentity(scripts,offerId);
  for(const entry of declarations){
   const node={value:entry.value,literal:entry.text.slice(entry.start,entry.end)};
   for(const key of ['offerId','productId']){const field=literalChild(node,key);if(field&&!(typeof field.value==='string'&&field.value===offerId||typeof field.value==='number'&&Number.isSafeInteger(field.value)&&String(field.value)===offerId))throw domOptionsError();}
   for(const key of ['isPicPrivate','isPricePrivate','isDetailForbidden']){const field=literalChild(node,key);if(field&&field.value!==false)throw domOptionsError();}
  }
  return models[0];
}
function readScriptOptionImages(document,identity,scripts){
 try{
  const model=scriptImageModel(scripts,identity.offerId),map=model.skuInfoMap??model.skuInfoMapOriginal;
  if(!object(map)||!Object.keys(map).length||Object.keys(map).length>200)return null;
  const expected=new Map();
  for(const [key,row]of Object.entries(map)){
   if(!object(row))return null;
   const name=plain(row.specAttrs??row.name??key,500);if(!name)return null;
   expected.set(name,(expected.get(name)??0)+1);
  }
  const excluded=element=>{
   if(element.closest?.(DOM_OPTION_EXCLUDED))return true;
   for(let current=element,depth=0;current;current=current.parentElement){
    if(++depth>40||['ASIDE','NAV','HEADER','FOOTER','IFRAME','SCRIPT','STYLE','NOSCRIPT'].includes(current.tagName?.toUpperCase())
     ||['navigation','tab','tablist'].includes(current.getAttribute?.('role'))||isUnrelatedProductElement(current))return true;
    for(const key of ['data-offer-id','data-offerid','data-product-id','data-productid']){
     const value=current.getAttribute?.(key);if(value!==null&&value!==undefined&&value!==identity.offerId)return true;
    }
   }
   return false;
  };
  const roots=Array.from(document.querySelectorAll(DOM_OPTION_ROOT));if(roots.length>400)return null;
  const candidates=[];
  for(const root of roots){
   if(excluded(root)||roots.some(other=>other!==root&&other.contains(root)&&!excluded(other)))continue;
   const labels=Array.from(root.querySelectorAll('div,span,dt,th,label,p,b,strong')).filter(element=>!element.children.length&&DOM_OPTION_LABELS.includes(domLabel(element.textContent))&&!excluded(element));
   if(labels.length)candidates.push({root,labels});
  }
  if(candidates.length!==1)return null;
  const {root,labels}=candidates[0];
  if(labels.length>10||new Set(labels.map(label=>domLabel(label.textContent))).size!==labels.length)return null;
  for(const link of root.querySelectorAll('a[href]')){
   const url=new URL(link.getAttribute('href'),identity.sourceUrl);
   if(/\/offer\/\d+\.html$/u.test(url.pathname)&&(url.origin!=='https://detail.1688.com'||url.origin+url.pathname!==identity.sourceUrl))return null;
  }
  const observed=new Map(),containers=[];
  for(const label of labels){
   const container=label.nextElementSibling||label.parentElement?.nextElementSibling||label.parentElement;
   if(!container||!root.contains(container)||excluded(container)||labels.some(other=>other!==label&&container.contains(other))
    ||containers.some(other=>other.contains(container)||container.contains(other)))return null;
   containers.push(container);
   const tiles=Array.from(container.children);if(tiles.length>200)return null;
   for(const tile of tiles){
    if(excluded(tile))continue;
    const images=Array.from(tile.querySelectorAll('img'));if(images.length>200)return null;
    const raw=domText(tile.textContent),textName=raw.split(/[¥￥]/u)[0].replace(/库存.*$/u,'').replace(/[-−+]+\s*\d*\s*$/u,'').trim();
    const title=domText(tile.getAttribute('title')),alt=domText(images[0]?.getAttribute('alt'));
    const name=title||textName||alt;
    if(!name||name.length>500||DOM_OPTION_LABELS.includes(domLabel(name)))continue;
    if(title&&textName&&title!==textName||alt&&alt!==name)return null;
    const previous=observed.get(name);observed.set(name,{count:(previous?.count??0)+1,imageUrl:images.length===1&&!excluded(images[0])?readPageSourceElementImage(images[0]):null});
   }
  }
  const images=[];
  for(const [name,row]of observed)if(expected.get(name)===1&&row.count===1&&row.imageUrl)images.push({name,imageUrl:row.imageUrl});
  return images.length?{format:'yoofam-page-dom-option-images-v1',...identity,images}:null;
 }catch{return null;}
}
/** RS 1.0.88's retained leaf-label/sibling tiles and inventory-row selectors,
 * restricted to one current-offer SKU root. Singletons can qualify one varying
 * axis; multiple varying axes require every explicit full-combination row.
 * No invented variants, headline price, supplier IDs or source fetches.
 * A script SKU declaration always wins, including empty/invalid declarations;
 * valid declarations permit only the separate exact-name image observation. */
export function readPageSourceDomOptions(document,sourceUrl,scripts){
 const identity=pageSourceUrl(sourceUrl);
 if(!Array.isArray(scripts)||scripts.length>100||scripts.some(value=>typeof value!=='string')||scripts.reduce((sum,value)=>sum+value.length,0)>4*1024*1024)throw domOptionsError();
 if(scripts.some(text=>/"skuModel"\s*:/.test(text)))return readScriptOptionImages(document,identity,scripts);
 domSourceIdentity(scripts,identity.offerId);
 const excluded=element=>!!element.closest(DOM_OPTION_EXCLUDED);
 const roots=Array.from(document.querySelectorAll(DOM_OPTION_ROOT));if(roots.length>400)throw domOptionsError();
 const candidates=[];
 for(const root of roots){
  if(excluded(root)||roots.some(other=>other!==root&&other.contains(root)&&!excluded(other)))continue;
  const labels=Array.from(root.querySelectorAll('div,span,dt,th,label,p,b,strong')).filter(element=>!element.children.length&&DOM_OPTION_LABELS.includes(domLabel(element.textContent))&&!excluded(element));
  if(labels.length)candidates.push({root,labels});
 }
 if(!candidates.length)return null;
 if(candidates.length!==1)throw domOptionsError();
 const {root,labels}=candidates[0];
 if(labels.length>10||new Set(labels.map(label=>domLabel(label.textContent))).size!==labels.length)throw domOptionsError();
 for(const link of root.querySelectorAll('a[href]')){
  const href=link.getAttribute('href');if(!href)continue;
  let url;try{url=new URL(href,identity.sourceUrl);}catch{throw domOptionsError();}
  if(/\/offer\/[1-9]\d*\.html$/u.test(url.pathname)&&pageSourceUrl(url.href).offerId!==identity.offerId)throw domOptionsError();
 }
 const inventoryRows=()=>{
  const rows=Array.from(root.querySelectorAll('div,li,tr,label')).filter(element=>!excluded(element)&&domText(element.textContent).length<=80&&(domText(element.textContent).match(/库存/gu)||[]).length===1);
  return rows.filter(element=>!rows.some(other=>other!==element&&element.contains(other)));
 };
 const optionName=element=>{
  const raw=domText(element.textContent),imageElement=element.querySelector('img');
  let name=raw.split(/[¥￥]/u)[0].replace(/库存.*$/u,'').replace(/^颜色[:：]?\s*/u,'').replace(/[-−+]+\s*\d*\s*$/u,'').trim();
  if(!name&&imageElement)name=domText(imageElement.getAttribute('alt'));
  return name;
 };
 const observe=(element,labelText='',maxName=40)=>{
  if(excluded(element))throw domOptionsError();
  const raw=domText(element.textContent),imageElement=element.querySelector('img'),name=optionName(element);
  if(!name||name.length>maxName||domLabel(name)===labelText)throw domOptionsError();
  const prices=[...raw.matchAll(/[¥￥]\s*(\d+(?:\.\d+)?)(?![\d.])/gu)];
  const match=prices.length===1?prices[0]:null;
  const ambiguous=match&&/^\s*(?:[-~～－–—]|起|至)/u.test(raw.slice(match.index+match[0].length));
  const unitPriceCny=match&&!ambiguous?price(match[1]):null;
  const imageUrl=readPageSourceElementImage(imageElement);
  return {name,unitPriceCny,imageUrl};
 };
 const groups=labels.map(label=>{
  const labelText=domLabel(label.textContent),container=label.nextElementSibling||label.parentElement?.nextElementSibling||label.parentElement;
  if(!container||!root.contains(container)||excluded(container))throw domOptionsError();
  let tiles=Array.from(container.children).filter(child=>child!==label&&domLabel(child.textContent)!==labelText&&(domLabel(child.textContent)!==''||child.querySelector('img')||child.tagName?.toLowerCase()==='li'));
  for(let depth=0;tiles.length===1&&tiles[0].children.length>1&&depth<4;depth++){
   // A singleton may contain image/price spans. Unwrap only a wrapper with
   // multiple observed prices/inventory rows, never the singleton itself.
   const text=domText(tiles[0].textContent);
   if((text.match(/[¥￥]/gu)||[]).length<=1&&(text.match(/库存/gu)||[]).length<=1)break;
   tiles=Array.from(tiles[0].children);
  }
  if(!tiles.length&&labels.length===1)tiles=inventoryRows();
  if(tiles.length>200)throw domOptionsError();
  const items=tiles.map(element=>observe(element,labelText));
  if(labels.length>1&&items.some(item=>DOM_OPTION_LABELS.includes(domLabel(item.name))))throw domOptionsError();
  if(labels.length>1)for(let index=0;index<tiles.length;index++){
   // A nested list can concatenate unpriced S/M values into a false fixed
   // singleton. Require each multi-axis tile to have one atomic observed name;
   // price/inventory/stepper-only leaves normalize to empty and do not count.
   const pending=Array.from(tiles[index].children);let visited=0;
   while(pending.length){
    const leaf=pending.pop();if(++visited>4000||excluded(leaf))throw domOptionsError();
    if(leaf.children.length)pending.push(...leaf.children);
    else{const name=optionName(leaf);if(name&&name!==items[index].name)throw domOptionsError();}
   }
  }
  if(new Set(items.map(item=>item.name)).size!==items.length)throw domOptionsError();
  return {container,items,label:labelText};
 });
 if(groups.length===1&&!groups[0].items.length)return null;
 if(groups.some(group=>!group.items.length))throw domOptionsError();
 if(groups.some((group,index)=>labels.some((label,other)=>index!==other&&group.container.contains(label))
  ||groups.some((other,otherIndex)=>index!==otherIndex&&(group.container.contains(other.container)||other.container.contains(group.container)))))throw domOptionsError();
 let count=1;for(const group of groups){count*=group.items.length;if(count>200)throw domOptionsError();}
 const varying=groups.filter(group=>group.items.length>1);
 const combinationRows=groups.length>1?inventoryRows().filter(element=>!groups.some(group=>group.container.contains(element))):[];
 let observations;
 if(groups.length===1)observations=groups[0].items.map(item=>({...item,axisValues:[{label:groups[0].label,value:item.name}]}));
 else if(varying.length===1&&!combinationRows.length){
  const axis=varying[0];
  observations=axis.items.map(item=>({name:groups.map(group=>group===axis?item.name:group.items[0].name).join(' / '),axisValues:groups.map(group=>({label:group.label,value:group===axis?item.name:group.items[0].name})),unitPriceCny:item.unitPriceCny,imageUrl:item.imageUrl??groups.find(group=>group!==axis&&group.items[0].imageUrl)?.items[0].imageUrl??null}));
 }else{
  // Retained RS inventory rows carry their own combination label and amount.
  // Require all observed axes in DOM order and an exact, complete tuple set.
  // Counting possible tuples validates coverage; it never creates variants.
  const rows=combinationRows;
  if(rows.length!==count)throw domOptionsError();
  const tuples=new Set();observations=rows.map(element=>{
   const item=observe(element,'',500),parts=item.name.split(' / ');
   if(parts.length!==groups.length||parts.some((part,index)=>!groups[index].items.some(value=>value.name===part)))throw domOptionsError();
   const tuple=JSON.stringify(parts);if(tuples.has(tuple))throw domOptionsError();tuples.add(tuple);return {...item,axisValues:groups.map((group,index)=>({label:group.label,value:parts[index]}))};
  });
 }
 const names=new Set(),options=observations.map(item=>{
  if(item.name.length>500||names.has(item.name))throw domOptionsError();names.add(item.name);
  return {key:`dom-row:${names.size}`,name:item.name,supplierSku:null,unitPriceCny:item.unitPriceCny,currency:item.unitPriceCny===null?null:'CNY',minimumOrder:null,stock:null,imageUrl:item.imageUrl,axisValues:item.axisValues};
 });
 return {format:'yoofam-page-dom-options-v1',...identity,options};
}
export function extractPageSource(input,now=Date.now()){
 const identity=pageSourceUrl(input.sourceUrl),scripts=Array.isArray(input.scripts)?input.scripts:[];
 if(scripts.length>100||scripts.some(value=>typeof value!=='string')||scripts.reduce((sum,value)=>sum+value.length,0)>4*1024*1024)throw Error('상품 본문이 수집 크기를 초과했습니다.');
 const property=key=>scripts.map(text=>pageJsonProperty(text,key)).find(value=>value!==undefined);
 const models=scripts.flatMap(text=>pageJsonProperties(text,'skuModel').filter(entry=>object(entry.value)).map(entry=>({text,entry})));
 if(models.length>100)throw Error('상품 옵션 원문이 수집 크기를 초과했습니다.');
 if(new Set(models.map(({entry})=>JSON.stringify(entry.value))).size>1)throw Error('상품 옵션 원문이 여러 개입니다. 현재 상품 본문을 다시 확인해주세요.');
 const sm=models[0]?.entry.value;
 for(const {entry} of models)assertProductIdentity(entry.value,identity.offerId);
 const title=sourceTitle(scripts,models,identity.offerId)||plain(input.title,500);
 if(!title)throw Error('상품명이 보이는 상품 본문에서 다시 수집해주세요.');
 const images=[],addImage=(value,role)=>{const url=image(value);if(url&&!images.some(item=>item.url===url&&item.role===role)){if(images.length>=200)throw Error('상품 이미지가 200개를 초과했습니다. 옵션 이미지·상세 이미지를 일부만 담지 않았습니다. 이미지 수를 확인한 뒤 다시 수집해주세요.');images.push({url,role});}};
 for(const key of ['offerImgList','mainImageList']){
  const list=property(key);if(Array.isArray(list))for(const item of list)addImage(typeof item==='string'?item:firstImage(item?.originalImageURI,item?.imageURI,item?.imageUrl,item?.url,item?.fullPathImageURI,item?.fullPathImageUri,item?.image),images.some(item=>item.role==='main')?'additional':'main');
 }
 if(!images.length&&Array.isArray(input.gallery))for(const url of input.gallery)addImage(url,images.length?'additional':'main');
 const details=Array.isArray(input.detailImages)?input.detailImages:[];
 for(const url of details)addImage(url,'detail');
 const valueImages=new Map();
 if(object(sm)&&Array.isArray(sm.skuProps))for(const prop of sm.skuProps)for(const value of Array.isArray(prop.value)?prop.value:[]){const url=firstImage(value.imageUrl,value.image,value.picUrl,value.imageURI);if(url)valueImages.set(plain(value.name,500),url);}
 const currency=/(?:CNY|人民币|[¥￥])/.test(plain(input.priceText,2000))?'CNY':null;
 const order=plain(input.minimumOrderText,1000).match(/(?:^|\s)(\d+)\s*(?:件|顶|个|双|套)?\s*起批/u);
 const minimumOrder=object(sm)?integer(sm.beginAmount??sm.minOrderQuantity)??(order?integer(order[1]):null):order?integer(order[1]):null;
 const map=object(sm)?sm.skuInfoMap??sm.skuInfoMapOriginal:null;
 const options=[];
 if(object(map)&&Object.keys(map).length>200)throw Error('옵션이 200개를 초과했습니다. 원문을 일부만 담지 않았습니다.');
 if(object(map))for(const [key,row] of Object.entries(map)){
  if(!object(row)||options.length>=200)continue;
  const rawSku=row.skuId??row.specId;
  const name=plain(row.specAttrs??row.name??key,500),supplierSku=plain(typeof rawSku==='number'&&Number.isSafeInteger(rawSku)?String(rawSku):rawSku,200)||null;
  const unitPriceCny=price(row.discountPrice??row.price??row.skuPrice??row.consignPrice);
  const imageUrl=firstImage(row.imageUrl,row.image)??valueImages.get(name)??[...valueImages].find(([label])=>optionParts(name).includes(label))?.[1]??null;
  if(imageUrl)addImage(imageUrl,'additional');
  options.push({key:plain(key,200),name,supplierSku,unitPriceCny,currency,minimumOrder,stock:Number.isSafeInteger(row.stock)&&row.stock>=0?row.stock:null,imageUrl});
 }
 if(object(sm)&&input.domOptions?.format==='yoofam-page-dom-option-images-v1'){
  // An invalid/ambiguous optional observation never erases valid script facts.
  let supplement=null;
  try{
   scriptImageModel(scripts,identity.offerId);
   const dom=input.domOptions;
   if(Object.keys(dom).sort().join(',')!=='format,images,offerId,sourceUrl'||dom.sourceUrl!==identity.sourceUrl||dom.offerId!==identity.offerId
    ||pageSourceUrl(dom.sourceUrl).sourceUrl!==dom.sourceUrl||!Array.isArray(dom.images)||dom.images.length>200)throw domOptionsError();
   const entries=new Map();
   for(const row of dom.images){
    if(!object(row)||Object.keys(row).sort().join(',')!=='imageUrl,name'||!plain(row.name,500)||row.name!==plain(row.name,500)
     ||typeof row.imageUrl!=='string'||image(row.imageUrl)!==row.imageUrl||entries.has(row.name))throw domOptionsError();
    entries.set(row.name,row.imageUrl);
   }
   supplement=entries;
  }catch{/* Keep the script-only result when this image evidence cannot qualify. */}
  if(supplement){
   const counts=new Map();for(const row of options)counts.set(row.name,(counts.get(row.name)??0)+1);
   for(const row of options)if(!row.imageUrl&&counts.get(row.name)===1&&supplement.has(row.name)){row.imageUrl=supplement.get(row.name);addImage(row.imageUrl,'additional');}
  }
 }
 if(!models.length&&!scripts.some(text=>/"skuModel"\s*:/.test(text))&&input.domOptions!=null){
  domSourceIdentity(scripts,identity.offerId);
  const dom=input.domOptions;
  if(!object(dom)||Object.keys(dom).some(key=>!['format','sourceUrl','offerId','options'].includes(key))||dom.format!=='yoofam-page-dom-options-v1'||dom.sourceUrl!==identity.sourceUrl||dom.offerId!==identity.offerId||!Array.isArray(dom.options)||!dom.options.length||dom.options.length>200)throw domOptionsError();
  for(const row of dom.options){
   if(row.supplierSku!==null||row.minimumOrder!==null||row.stock!==null||row.key!==`dom-row:${options.length+1}`)throw domOptionsError();
   if(row.axisValues!==undefined&&(!Array.isArray(row.axisValues)||row.axisValues.map(axis=>axis?.value).join(' / ')!==row.name))throw domOptionsError();
   options.push({...row});if(row.imageUrl)addImage(row.imageUrl,'additional');
  }
 }
 let observed={attributes:sourceAttributes(scripts,identity.offerId),options};
 if(input.domFacts!=null){
  const facts=validatePageDomFacts(input.domFacts);
  if(facts.sourceUrl!==identity.sourceUrl||facts.offerId!==identity.offerId)throw domOptionsError();
  domFactsIdentity(scripts,identity.offerId);observed=mergePageDomFacts(observed.attributes,options,facts);
 }
 return validatePageSourceForDelivery({format:'yoofam-page-source-v1',...identity,collectedAt:new Date(now).toISOString(),title,description:plain(input.description,20000),options:observed.options,images,attributes:observed.attributes},now);
}
/** Inert capture evidence only. Counts never authorize reading more of the
 * page or claim that missing product facts were collected. */
export function validatePageSourceCaptureDiagnostics(input){
 const exact=(value,required,optional=[])=>{
  if(!object(value))return false;
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  return required.every(key=>Object.hasOwn(descriptors,key))&&keys.every(key=>typeof key==='string'&&[...required,...optional].includes(key)&&descriptors[key].enumerable&&Object.hasOwn(descriptors[key],'value'));
 };
 const count=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
 const invalid=()=>{throw Error('수집 진단 기록의 형식·범위를 확인해주세요.');};
 if(!exact(input,['format','collectorVersion','sections','description'],['bodyTitles'])||input.format!=='yoofam-page-capture-diagnostics-v1'
  ||typeof input.collectorVersion!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/u.test(input.collectorVersion)
  ||!['not-needed','reference-missing','reference-invalid','unavailable','captured'].includes(input.description))invalid();
 const sections=input.sections;
 if(!exact(sections,['tabCount','knownTabCount','panelCount','linkedKnownPanelCount','unlinkedKnownTabCount'])
  ||!count(sections.tabCount,300)||!count(sections.panelCount,300)||!count(sections.knownTabCount,30)
  ||!count(sections.linkedKnownPanelCount,30)||!count(sections.unlinkedKnownTabCount,30)
  ||sections.knownTabCount>sections.tabCount||sections.linkedKnownPanelCount>sections.panelCount
  ||sections.linkedKnownPanelCount+sections.unlinkedKnownTabCount!==sections.knownTabCount)invalid();
 if(Object.hasOwn(input,'bodyTitles')){
  const titles=input.bodyTitles;
  if(!exact(titles,['attributes','packaging','detail'])||!count(titles.attributes,60)||!count(titles.packaging,60)||!count(titles.detail,60)
   ||titles.attributes+titles.packaging+titles.detail>60)invalid();
 }
 return JSON.parse(JSON.stringify(input));
}
export function validatePageSource(input,now=Date.now()){
 const keys=['format','sourceUrl','offerId','collectedAt','title','description','options','images','attributes','captureDiagnostics'];
 if(!object(input)||Object.keys(input).some(key=>!keys.includes(key))||input.format!=='yoofam-page-source-v1'||JSON.stringify(input).length>PAGE_SOURCE_LIMIT)throw Error('상품 수집 내용의 형식·크기를 확인해주세요.');
 if(Object.hasOwn(input,'captureDiagnostics'))validatePageSourceCaptureDiagnostics(input.captureDiagnostics);
 const identity=pageSourceUrl(input.sourceUrl);
 if(input.sourceUrl!==identity.sourceUrl||input.offerId!==identity.offerId||typeof input.collectedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(input.collectedAt)||!Number.isFinite(Date.parse(input.collectedAt))||Date.parse(input.collectedAt)>now+60000||!plain(input.title,500)||input.title!==plain(input.title,500)||typeof input.description!=='string'||input.description.length>20000)throw Error('상품 번호·상품명·수집 시각을 확인해주세요.');
 if(!Array.isArray(input.options)||input.options.length>200||!Array.isArray(input.images)||!input.images.length||input.images.length>200||!Array.isArray(input.attributes)||input.attributes.length>50)throw Error('현재 상품의 옵션·이미지를 확인해주세요.');
 const seen=new Set();
 for(const row of input.options){
  if(!object(row)||Object.keys(row).some(key=>!['key','name','supplierSku','unitPriceCny','currency','minimumOrder','stock','imageUrl','axisValues','packaging'].includes(key))||!plain(row.key,200)||row.key!==plain(row.key,200)||seen.has(row.key)||!plain(row.name,500)||row.name!==plain(row.name,500)
   ||row.supplierSku!==null&&(!plain(row.supplierSku,200)||row.supplierSku!==plain(row.supplierSku,200))||row.unitPriceCny!==null&&price(row.unitPriceCny)!==row.unitPriceCny||row.currency!==null&&row.currency!=='CNY'||row.minimumOrder!==null&&integer(row.minimumOrder)!==row.minimumOrder||row.stock!==null&&(!Number.isSafeInteger(row.stock)||row.stock<0)||row.imageUrl!==null&&image(row.imageUrl)!==row.imageUrl)throw Error('수집한 옵션 값이 올바르지 않습니다.');
  if(row.axisValues!==undefined){
   const labels=new Set();
   if(!Array.isArray(row.axisValues)||!row.axisValues.length||row.axisValues.length>10)throw Error('수집한 옵션 축을 확인해주세요.');
   for(const axis of row.axisValues){
    if(!object(axis)||Object.keys(axis).length!==2||Object.keys(axis).some(key=>!['label','value'].includes(key))||!DOM_OPTION_LABELS.includes(axis.label)||labels.has(axis.label)
      ||!plain(axis.value,200)||axis.value!==plain(axis.value,200))throw Error('수집한 옵션 축을 확인해주세요.');
    labels.add(axis.label);
   }
  }
  if(Object.hasOwn(row,'packaging'))validatePagePackaging(row.packaging);
  seen.add(row.key);
 }
 const placements=new Set();let mains=0;
 for(const row of input.images){if(!object(row)||Object.keys(row).some(key=>!['url','role'].includes(key))||image(row.url)!==row.url||!['main','additional','detail'].includes(row.role)||placements.has(row.role+row.url)||row.role==='main'&&++mains>1)throw Error('수집 이미지 주소·역할이 올바르지 않습니다.');placements.add(row.role+row.url);}
 for(const row of input.attributes)if(!object(row)||Object.keys(row).some(key=>!['name','value'].includes(key))||!plain(row.name,190)||row.name!==plain(row.name,190)||!plain(row.value,1000)||row.value!==plain(row.value,1000))throw Error('상품 속성을 확인해주세요.');
 return JSON.parse(JSON.stringify(input));
}
/** Keep legacy stored records readable. New captures/reviews/deliveries must
 * fit the receiving UTF-8 byte limit and retain every observed option image. */
export function validatePageSourceForDelivery(input,now=Date.now()){
 const source=validatePageSource(input,now);
 if(new TextEncoder().encode(JSON.stringify(source)).byteLength>PAGE_SOURCE_LIMIT)throw Error('상품 수집 원문은 UTF-8 기준 512KB(524,288바이트) 이하여야 합니다. 옵션·상품 설명의 분량을 확인해주세요. 일부 내용만 담지 않았습니다.');
 if(source.options.some(option=>option.imageUrl!==null&&!source.images.some(image=>image.url===option.imageUrl)))throw Error('수집한 옵션 이미지가 원본 이미지 목록에 없습니다. 옵션 이미지를 일부만 담지 않았으니 상품 본문에서 다시 수집해주세요.');
 return source;
}
export function pageSourceIssues(source){
 const issues=[];if(!source.options.length)issues.push('옵션 원문');
 if(source.options.some(row=>!row.supplierSku))issues.push('공급자 SKU');
 if(new Set(source.options.filter(row=>row.supplierSku).map(row=>row.supplierSku)).size!==source.options.filter(row=>row.supplierSku).length)issues.push('중복 공급자 SKU');
 if(source.options.some(row=>row.unitPriceCny===null))issues.push('옵션 원가');
 if(source.options.some(row=>row.currency!=='CNY'))issues.push('위안(CNY) 통화');
 if(source.options.some(row=>row.minimumOrder===null))issues.push('최소 주문 수량');
 if(source.options.some(row=>row.imageUrl!==null&&!source.images.some(image=>image.url===row.imageUrl)))issues.push('옵션 이미지 원본 연결');
 return issues;
}
