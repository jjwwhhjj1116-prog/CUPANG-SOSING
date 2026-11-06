import {currentDetailContent,type ContentField,type LabelField,type ProductContent} from '@/app/product-content';
import {unsupportedProductMaterial} from '@/app/product-material-evidence';
import {parseFragment,type DefaultTreeAdapterMap} from 'parse5';
import {translationNumbers} from '@/app/translation-attribute-evidence';

const aliases:Partial<Record<LabelField,readonly string[]>>={
 material:['material','composition','fabric composition','재질','소재','섬유 조성','혼용률','원료명 및 성분명(재질)','材质','面料','面料成分','主面料成分','主面料成分含量','成分'],
 components:['components','package contents','구성품','제품 구성품','包装清单'],
 dimensions:['dimensions','product dimensions','제품 크기','제품 치수','产品尺寸'],
 netContents:['netContents','net contents','내용량','净含量'],
 productType:['productType','product type','상품 유형','产品类型'],
};
export const productFactKey=(name:string):string=>Object.entries(aliases).find(([,names])=>names!.some(alias=>alias.toLowerCase()===name.trim().toLowerCase()))?.[0]??name.trim().toLowerCase();
type Attribute={name:string;value:string;provenance?:string;sourceName?:string};
export function productFactDetailDescription(content:ProductContent):ContentField<string>{
 const detail=currentDetailContent(content).description;
 return detail.provenance==='unverified'&&!detail.value?content.seo.description:detail;
}
function detailText(description:string):string{
 if(!/<\/?[a-z][^>]*>/iu.test(description))return description;
 const parts:string[]=[],nodes:(DefaultTreeAdapterMap['node']|string)[]=[parseFragment(description)];let count=0;
 while(nodes.length){
  const node=nodes.pop()!;if(++count>50000)return '';
  if(typeof node==='string'){parts.push(node);continue;}
  if('tagName'in node){
   if(['script','style','template','noscript','iframe','object','embed','svg','math'].includes(node.tagName)||node.attrs.some(attr=>attr.name==='hidden'||attr.name==='style'&&/(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attr.value)))continue;
   if(['p','div','br','li','tr','section','h1','h2','h3','table'].includes(node.tagName)){parts.push('\n');nodes.push('\n');}
   if(node.tagName==='td'||node.tagName==='th')nodes.push(' ');
  }
  if(node.nodeName==='#text'&&'value'in node)parts.push(node.value);
  if('childNodes'in node)for(let i=node.childNodes.length-1;i>=0;i--)nodes.push(node.childNodes[i]);
 }
 return parts.join('');
}
const fibers='cotton|棉|면|코튼|spandex|elastane|氨纶|스판덱스|엘라스테인|nylon|尼龙|锦纶|나일론|polyester|聚酯纤维|聚酯|涤纶|폴리에스테르';
const quantityUnits=[['개','个|個|件|支|片|枚|粒|张|本|只|台|pcs?|pieces?|개'],['쌍','双|對|对|pairs?|쌍'],['세트','套|sets?|세트'],['팩','包|袋|packs?|팩|봉지|봉'],['g','克|grams?|그램|g'],['kg','千克|公斤|kilograms?|킬로그램|kg'],['ml','毫升|밀리리터|ml'],['l','升|리터|l'],['cm','厘米|센티미터|cm'],['mm','毫米|밀리미터|mm'],['m','米|미터|m']];
export const productFactQuantityTokens=(value:string)=>quantityUnits.flatMap(([kind,aliases])=>[...value.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*(?:${aliases})(?![a-z가-힣])`,'giu'))].map(match=>kind+':'+match[1]));
function composition(value:string):string[]|null{
 if(/(?:^|[^\d])\.\s*\d/u.test(value))return null;
 const atom=new RegExp(`(?:(\\d+(?:\\.\\d+)?)\\s*[%％]\\s*(${fibers})|(${fibers})\\s*(\\d+(?:\\.\\d+)?)\\s*[%％])`,'giu'),parts:string[]=[];
 const rest=value.replace(atom,(_match,before:string,left:string,right:string,after:string)=>{
  const fiber=(left??right).toLowerCase(),key=/^(?:cotton|棉|면|코튼)$/u.test(fiber)?'cotton':/^(?:spandex|elastane|氨纶|스판덱스|엘라스테인)$/u.test(fiber)?'spandex':/^(?:nylon|尼龙|锦纶|나일론)$/u.test(fiber)?'nylon':'polyester';
  parts.push(`${key}:${Number(before??after)}`);return '';
 });
 return parts.length&&!rest.replace(/[\s,，、/·()（）:：;；.。]/gu,'')?parts.sort():null;
}
/** Translate only whole literal fiber evidence; never fill an absent ratio. */
export function canonicalProductMaterialLiteral(raw:string):string|null{
 const names:Record<string,string>={cotton:'면',spandex:'스판덱스',nylon:'나일론',polyester:'폴리에스테르'};
 const key=(fiber:string)=>composition('100% '+fiber)?.[0].split(':')[0];
 if(composition(raw)){
  const atom=new RegExp(`(?:(\\d+(?:\\.\\d+)?)\\s*([%％])\\s*(${fibers})|(${fibers})\\s*(\\d+(?:\\.\\d+)?)\\s*([%％]))`,'giu');
  const parts=[...raw.matchAll(atom)].map(match=>({fiber:key(match[3]??match[4])!,number:match[1]??match[5],percent:match[2]??match[6]}));
  if(new Set(parts.map(part=>part.fiber)).size!==parts.length||parts.some(part=>Number(part.number)<=0||Number(part.number)>100)||parts.reduce((total,part)=>total+Number(part.number),0)>100.000001)return null;
  return parts.map(part=>`${names[part.fiber]} ${part.number}${part.percent}`).join(', ');
 }
 const pattern=new RegExp(fibers,'giu'),matches=[...raw.matchAll(pattern)],keys=new Set(matches.map(match=>key(match[0])));
 return matches.length&&keys.size===1&&!raw.replace(pattern,'').replace(/[\s,，、/·()（）:：;；.。]/gu,'')?names[[...keys][0]!]:null;
}
/** A fixed main-material choice is separate from the complete composition text. */
export function productMaterialChoice(value:string,choices:readonly{value:string;label:string}[]):string|null{
 const exact=new Set(choices.filter(choice=>choice.value===value||choice.label===value).map(choice=>choice.value));
 if(exact.size)return exact.size===1?[...exact][0]:null;
 const parts=composition(value)?.map(part=>{const [fiber,percent]=part.split(':');return{fiber,percent:Number(percent)};});
 if(!parts?.length||new Set(parts.map(part=>part.fiber)).size!==parts.length
  ||parts.some(part=>!Number.isFinite(part.percent)||part.percent<=0||part.percent>100)
  ||Math.abs(parts.reduce((total,part)=>total+part.percent,0)-100)>0.000001)return null;
 const majority=parts.filter(part=>part.percent>50);if(majority.length!==1)return null;
 const name=majority[0].fiber+':100';
 const matches=new Set(choices.filter(choice=>[choice.value,choice.label].some(label=>{
  const parsed=composition('100% '+label);return parsed?.length===1&&parsed[0]===name;
 })).map(choice=>choice.value));
 return matches.size===1?[...matches][0]:null;
}
/** Only exact headings or complete literal composition statements establish a
 * detail fact. Marketing copy and inferred material never do. */
function detailFacts(description:string,attributes:readonly Attribute[]=[]){
 const headings=new Map<string,string>();
 for(const [key,names]of Object.entries(aliases))for(const name of [key,...names!])headings.set(name.toLowerCase(),key);
 for(const pair of attributes)if(!/^(?:option|option-color|option-size):/u.test(pair.name))headings.set(pair.name.trim().toLowerCase(),productFactKey(pair.name));
 const candidates=new Map<string,Set<string>>();
 const add=(key:string,value:string)=>{if(value&&value.length<=2000){if(!candidates.has(key))candidates.set(key,new Set());candidates.get(key)!.add(value);}};
 for(const raw of detailText(description).split(/[\r\n;；]/u)){
  const line=raw.trim();if(!line)continue;
  const heading=/^([^:：=]{1,200})\s*[:：=]\s*(.+)$/u.exec(line);
  if(heading){const key=headings.get(heading[1].trim().toLowerCase());if(key)add(key,heading[2].trim());}
  else if(composition(line))add('material',line);
  else for(const [name,key]of headings)if(line.toLowerCase().startsWith(name+' ')){add(key,line.slice(name.length).trim());break;}
 }
 return new Map([...candidates].map(([key,values])=>[key,values.size===1?[...values][0]:'']));
}
export function prioritizedProductAttributes(description:string,attributes:readonly Attribute[]):Attribute[]{
 const details=detailFacts(description,attributes),seen=new Set<string>();
 const selected=attributes.map(pair=>{
  const key=productFactKey(pair.name);seen.add(key);
  if(pair.provenance==='manual'||!details.has(key))return {...pair};
  const value=details.get(key)!;return {name:pair.name,value,provenance:value?'detail-explicit':'detail-conflict',sourceName:'detail description'};
 });
 for(const [name,value]of details)if(!seen.has(name))selected.push({name,value,provenance:value?'detail-explicit':'detail-conflict',sourceName:'detail description'});
 return selected;
}
export function prioritizedContentLabelFields(content:ProductContent):ProductContent['label']{
 const description=productFactDetailDescription(content);
 if(description.provenance==='generated'||description.provenance==='unverified')return content.label;
 const details=detailFacts(description.value);
 return Object.fromEntries(Object.entries(content.label).map(([key,stored])=>[key,
  stored.provenance!=='manual'&&details.has(key)?{...description,value:details.get(key)!}:stored])) as ProductContent['label'];
}
export function prioritizedContentLabelField(content:ProductContent,key:LabelField):ContentField<string>{
 return prioritizedContentLabelFields(content)[key];
}
/** Reject a lower-priority conflicting AI material even if the raw attributes
 * still contain it. Raw references remain in the plan for review. */
export function productFactPriorityIssue(value:string,name:string,description:string,preferredAttributes?:readonly Attribute[]):string|null{
 const key=productFactKey(name),details=detailFacts(description);
 for(const pair of preferredAttributes??[])if(pair.provenance?.startsWith('detail-'))details.set(productFactKey(pair.name),pair.value);
 if(!details.has(key))return null;
 const preferred=details.get(key)!;if(!preferred)return '상세페이지의 명시된 값이 서로 상충합니다';
 if(key==='material'){
  if(unsupportedProductMaterial(value,preferred,true))return '상세페이지에 명시된 재질과 일치하지 않습니다';
  const expected=composition(preferred),actual=composition(value);
  if(expected&&/순면|pure\s*cotton/iu.test(value)&&JSON.stringify(expected)!==JSON.stringify(['cotton:100']))return '상세페이지에 명시된 성분 비율과 일치하지 않습니다';
  if(expected&&/[％%]/u.test(value)&&JSON.stringify(expected)!==JSON.stringify(actual))return '상세페이지에 명시된 성분 비율과 일치하지 않습니다';
 }
 const numbers=new Set(translationNumbers(preferred));
 if(translationNumbers(value).some(number=>!numbers.has(number)))return '상세페이지에 명시된 숫자와 일치하지 않습니다';
 if(key==='netContents'||key==='dimensions'){
  const expected=productFactQuantityTokens(preferred),actual=productFactQuantityTokens(value);
  if((key==='netContents'||expected.length)&&(!actual.length||actual.some(token=>!expected.includes(token))))return '상세페이지에 명시된 수치·단위와 일치하지 않습니다';
 }
 return null;
}
