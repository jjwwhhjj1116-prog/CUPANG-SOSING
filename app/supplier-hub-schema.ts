import type {QuotationField,QuotationSection} from '@/app/quotation-schema';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {couplusScalarDraftDefault} from '@/app/couplus-quotation-defaults';
import {couplusQuotationInput} from '@/app/couplus-quotation-inputs';

export const HUB_SCHEMA_LIMIT=200_000;
export type HubSchemaSnapshot={format:'supplier-hub-schema-v1';categoryId:string;categoryPath:string[];company:SupplierHubCompany;observedAt:number;schemaString:string;metadata:Record<string,string|number>;draftInitialization?:'couplus-required-v1';inputBindings?:'couplus-paths-v1'};
export type HubWireField={path:string[];nameKey?:string;valueKey?:string;name?:string};
export type LiveQuotationField=QuotationField&{hubWire:HubWireField;draftDefault?:string;schemaDefault?:string};
const companies:Record<string,string>={A01464742:'와이홉',A01526306:'유앤채'};
const pages:Record<string,QuotationSection>={startPage:'start',productPage:'product',imagePage:'image',legalPage:'legal',logisticsPage:'logistics'};
const metadataKeys=['categoryId','kanCategoryId','displayCategoryCode','scope','scopeType','noticeNumber','productNoticeNumber','version'];
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const safeText=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
function schemaDocument(text:string):Record<string,unknown>{
  if(!safeText(text,HUB_SCHEMA_LIMIT)||new TextEncoder().encode(text).length>HUB_SCHEMA_LIMIT)throw Error('상세 견적 양식의 크기 또는 문자를 확인해주세요.');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw Error('상세 견적 양식 JSON이 올바르지 않습니다.');}
  let count=0;
  function inspect(value:unknown,depth:number){
    if(++count>12000||depth>24)throw Error('상세 견적 양식이 처리 한도를 초과했습니다.');
    if(typeof value==='string'&&!safeText(value,HUB_SCHEMA_LIMIT))throw Error('상세 견적 양식 문자를 확인해주세요.');
    if(object(value))for(const [key,item] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw Error('상세 견적 양식의 항목 이름을 확인해주세요.');inspect(item,depth+1);}
    else if(Array.isArray(value))for(const item of value)inspect(item,depth+1);
  }
  inspect(raw,0);
  if(!object(raw)||!object(raw.properties)||!object(raw.properties.productPage)||!object(raw.properties.legalPage))throw Error('Supplier Hub 상품·법적 정보 양식이 필요합니다.');
  return raw;
}
/** Validate stored snapshots again; fields and defaults are compiled, never accepted from callers. */
export function validateHubSchemaSnapshot(value:unknown,categoryId:string,categoryPath:readonly string[]):HubSchemaSnapshot{
  const item=value as HubSchemaSnapshot;
  if(!item||item.format!=='supplier-hub-schema-v1'||item.categoryId!==categoryId||!/^[1-9]\d{0,19}$/.test(categoryId)
    ||!Array.isArray(item.categoryPath)||!item.categoryPath.length||item.categoryPath.length>10||item.categoryPath.some(name=>!safeText(name,120)||!name.trim()||name!==name.trim())
    ||JSON.stringify(item.categoryPath)!==JSON.stringify(categoryPath)||!Object.hasOwn(companies,item.company?.code)||companies[item.company.code]!==item.company.name
    ||!Number.isSafeInteger(item.observedAt)||item.observedAt<=0||item.observedAt>Date.now()+60000||typeof item.schemaString!=='string'||!object(item.metadata))throw Error('선택한 회사·분류코드·경로의 상세 양식인지 확인해주세요.');
  const metadata:Record<string,string|number>={};
  if(item.draftInitialization!==undefined&&item.draftInitialization!=='couplus-required-v1')throw Error('상세 견적 양식의 초안 초기화 버전을 확인해주세요.');
  if(item.inputBindings!==undefined&&item.inputBindings!=='couplus-paths-v1')throw Error('상세 견적 양식의 입력 연결 버전을 확인해주세요.');
  for(const [key,val] of Object.entries(item.metadata)){
    if(!metadataKeys.includes(key)||!(safeText(val,500)||typeof val==='number'&&Number.isSafeInteger(val)&&val>=0))throw Error('상세 견적 양식 버전정보를 확인해주세요.');
    metadata[key]=val;
  }
  if(metadata.displayCategoryCode!==undefined&&String(metadata.displayCategoryCode)!==categoryId)throw Error('상세 견적 양식의 표시 분류코드가 다릅니다.');
  schemaDocument(item.schemaString);
  return {format:item.format,categoryId,categoryPath:[...categoryPath],company:{...item.company},observedAt:item.observedAt,schemaString:item.schemaString,metadata,...(item.draftInitialization?{draftInitialization:item.draftInitialization}:{}),...(item.inputBindings?{inputBindings:item.inputBindings}:{})};
}
function stableId(categoryId:string,wire:HubWireField){
  const text=JSON.stringify(wire);let a=2166136261,b=2246822519;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489917);}
  return `live_${categoryId}_${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}`;
}
/** Public /sr convertAllOfToItems contract: named arrays contain a name enum and value schema. */
export function compileHubQuotationSchema(snapshot:HubSchemaSnapshot,base:readonly QuotationField[]=[]){
  const raw=schemaDocument(snapshot.schemaString),fields:LiveQuotationField[]=[],unsupported:string[]=[],used=new Set<string>();
  const issue=(path:string[])=>{const text=path.join(' / ');if(!unsupported.includes(text))unsupported.push(text);};
  function hasSchemaPath(path:readonly string[]){
    let node:unknown=raw;
    for(const key of path){if(!object(node)||!object(node.properties)||!Object.hasOwn(node.properties,key))return false;node=node.properties[key];}
    return true;
  }
  function requiredKeys(node:Record<string,unknown>,path:string[]):string[]{
    if(!Object.hasOwn(node,'required'))return [];
    if(!Array.isArray(node.required)||node.required.some(key=>!safeText(key,500)||!key.trim())){issue([...path,'required']);return [];}
    const keys=node.required as string[];
    if(new Set(keys).size!==keys.length||!object(node.properties)||keys.some(key=>!Object.hasOwn(node.properties as Record<string,unknown>,key)))issue([...path,'required']);
    return keys;
  }
  function scalar(node:Record<string,unknown>,path:string[],section:QuotationSection,visibility:QuotationField['visibility'],wire:HubWireField,label:string,required:boolean,draftDefault?:string,initialize=false){
    if(!safeText(label,500)||!label.trim())return issue(path);
    const types=Array.isArray(node.type)?node.type:[node.type],enums=node.enum??node.dropdown;
    if(types.some(type=>!['string','number','integer','null','boolean',undefined].includes(type)))return issue(path);
    if(['$ref','oneOf','anyOf','allOf','if','not','const'].some(key=>Object.hasOwn(node,key)))issue(path);
    let choices:{value:string;label:string}[]|undefined;
    if(enums!==undefined){
      if(!Array.isArray(enums)||!enums.length||enums.length>300||enums.some(value=>value!==null&&!safeText(value,2000)&&!(typeof value==='number'&&Number.isFinite(value))&&typeof value!=='boolean'))return issue(path);
      choices=enums.map(value=>({value:value===null?'':String(value),label:value===null||value===''?'해당사항없음':String(value)}));
      if(new Set(choices.map(choice=>choice.value)).size!==choices.length)return issue(path);
    }
    if(types.includes('boolean')&&!choices){
      if(types.some(type=>type!=='boolean'&&type!=='null'))issue(path);
      choices=[{value:'true',label:'true'},{value:'false',label:'false'},...(types.includes('null')?[{value:'',label:'해당사항없음'}]:[])];
    }
    const numeric=types.includes('number')||types.includes('integer')
      ||types.every(type=>type===undefined||type==='null')&&Array.isArray(enums)&&enums.some(value=>typeof value==='number')&&enums.every(value=>value===null||typeof value==='number');
    const pathBinding=snapshot.inputBindings==='couplus-paths-v1'&&!wire.name?couplusQuotationInput(wire.path):undefined;
    const labelKey=(value:string)=>value.normalize('NFKC').replace(/\s+/gu,'');
    const candidates=base.filter(item=>item.section===section&&item.visibility===visibility
      &&(pathBinding?item.id===pathBinding:(!snapshot.inputBindings||wire.name)&&labelKey(item.label)===labelKey(label)));
    let canonical=candidates.length===1?candidates[0]:undefined;
    if(pathBinding&&canonical){
      const compatible=canonical.type==='number'?numeric&&!types.some(type=>type==='string'||type==='boolean')
        :!numeric&&!types.includes('boolean');
      if(!compatible){issue(path);canonical=undefined;}
    }
    const secondaryPrice=pathBinding==='msrp'&&wire.path.at(-1)==='osrp'&&hasSchemaPath(['productPage','commonAttributes','msrp']);
    const id=canonical&&!secondaryPrice?canonical.id:stableId(snapshot.categoryId,wire);
    if(used.has(id))return issue(path);used.add(id);
    if(numeric&&types.some(type=>type==='string'||type==='boolean'))issue(path);
    if(numeric&&Array.isArray(enums)&&enums.some(value=>value!==null&&typeof value!=='number'))issue(path);
    // Only the required ancestor chain creates scalar placeholders. Named
    // arrays supply their own N/A or null defaults through the existing path.
    const imageAgreement=snapshot.draftInitialization==='couplus-required-v1'&&node.type==='boolean'
      &&wire.path.length===2&&wire.path[0]==='imagePage'&&['msrpAgree','labelContactAgreed'].includes(wire.path[1]);
    if(draftDefault===undefined&&imageAgreement)draftDefault='true';
    else if(draftDefault===undefined&&initialize)draftDefault=couplusScalarDraftDefault(wire.path.at(-1)!,node);
    if(node.enum!==undefined&&node.dropdown!==undefined&&JSON.stringify(node.enum)!==JSON.stringify(node.dropdown))issue(path);
    const stringValue=!numeric&&!types.includes('boolean');
    const result:LiveQuotationField={id,section,label,type:canonical?.type==='images'?'images':choices?'select':numeric?'number':canonical?.type==='textarea'?'textarea':'text',required,visibility,reviewRequired:true,hubWire:wire,
      ...(canonical?.readOnly?{readOnly:true}:{}),...(canonical?.contentField?{contentField:canonical.contentField}:{}),
      ...(pathBinding&&canonical?{hubInput:pathBinding,...(canonical.unit?{unit:canonical.unit}:{})}:{}),
      ...(canonical?.type==='images'&&canonical.maxItems?{maxItems:canonical.maxItems}:{}),
      maxLength:canonical?.type==='images'||pathBinding&&canonical?canonical?.maxLength??2000:2000,
      ...(choices?{choices}:{}),...(numeric?{integer:types.includes('integer')&&!types.includes('number'),...(choices?{numericValue:true as const}:{})}:{}),...(draftDefault!==undefined?{draftDefault}:{}),
      help:'선택한 회사의 Supplier Hub 상세 양식에서 가져온 항목입니다. 기본값과 상품정보를 확인·수정해주세요.'};
    for(const key of ['minLength','maxLength'] as const)if(Object.hasOwn(node,key)){
      const limit=node[key];
      if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<0||limit>150000)issue(path);
      else if(stringValue)result[key]=limit;
    }
    if(result.minLength!==undefined&&result.maxLength!==undefined&&result.minLength>result.maxLength)issue(path);
    for(const [source,target] of [['minimum','min'],['maximum','max'],['exclusiveMinimum','exclusiveMinimum'],['exclusiveMaximum','exclusiveMaximum'],['multipleOf','multipleOf']] as const)if(Object.hasOwn(node,source)){
      const limit=node[source];
      if(typeof limit!=='number'||!Number.isFinite(limit)||source==='multipleOf'&&limit<=0)issue(path);
      else if(numeric)result[target]=limit;
    }
    const lower=Math.max(result.min??-Infinity,result.exclusiveMinimum??-Infinity),upper=Math.min(result.max??Infinity,result.exclusiveMaximum??Infinity);
    if(lower>upper||lower===upper&&(result.exclusiveMinimum===lower||result.exclusiveMaximum===upper))issue(path);
    if(node.pattern!==undefined||node.format!==undefined)issue(path);
    if(node.default!==undefined&&(node.default===null||safeText(node.default,2000)||typeof node.default==='number'&&Number.isFinite(node.default)||typeof node.default==='boolean'))result.schemaDefault=node.default===null?'':String(node.default);
    fields.push(result);if(fields.length>400)throw Error('상세 견적 항목이 400개를 초과했습니다.');
  }
  function visit(node:unknown,path:string[],section:QuotationSection,required=false,initialize=false){
    if(!object(node))return issue(path);
    if(['$ref','oneOf','anyOf','if','not','dependentRequired','dependencies','patternProperties'].some(key=>Object.hasOwn(node,key)))issue(path);
    if(object(node.properties)){
      if(Object.hasOwn(node,'allOf')||Object.hasOwn(node,'additionalProperties')&&node.additionalProperties!==false)issue(path);
      const required=requiredKeys(node,path);
      for(const [key,value] of Object.entries(node.properties))visit(value,[...path,key],section,required.includes(key),initialize&&required.includes(key));return;
    }
    const group=path.at(-1)!;
    if(Array.isArray(node.allOf)&&node.type==='array'){
      if(['minItems','maxItems','uniqueItems','items'].some(key=>Object.hasOwn(node,key)))issue(path);
      if(node.allOf.length>400)throw Error('상세 견적 배열의 항목 수가 너무 많습니다.');
      for(const entry of node.allOf){
        const properties=object(entry)&&object(entry.contains)&&object(entry.contains.properties)?entry.contains.properties:null;
        if(!properties||Object.keys(properties).length!==2){issue(path);continue;}
        const [namePair,valuePair]=Object.entries(properties);
        if(!object(namePair[1])||!Array.isArray(namePair[1].enum)||namePair[1].enum.length!==1||!safeText(namePair[1].enum[0],500)||!object(valuePair[1])){issue(path);continue;}
        const label=namePair[1].enum[0],visibility=group==='exposedAttributes'?'exposed':group==='unexposedAttributes'?'hidden':'common';
        const optionalHidden=group==='unexposedAttributes';
        const wire={path,nameKey:namePair[0],valueKey:valuePair[0],name:label};
        const na=Array.isArray(valuePair[1].enum)?valuePair[1].enum.find(value=>value===null||value==='해당사항없음'):undefined;
        scalar(valuePair[1],[...path,label],section,visibility,wire,label,!optionalHidden&&(required||namePair[1].requirement==='필수'),optionalHidden?'':na===null?'':'해당사항없음');
      }return;
    }
    if(node.type==='array'||node.type==='object')return issue(path);
    const label=typeof node.title==='string'?node.title:group;
    scalar(node,path,section,'common',{path},label,required,undefined,initialize);
  }
  if(['$ref','oneOf','anyOf','allOf','if','not','dependentRequired','dependencies','patternProperties'].some(key=>Object.hasOwn(raw,key)))issue(['schema']);
  const requiredPages=requiredKeys(raw,[]);
  for(const [page,node] of Object.entries(raw.properties as Record<string,unknown>)){if(Object.hasOwn(pages,page))visit(node,[page],pages[page],false,snapshot.draftInitialization==='couplus-required-v1'&&requiredPages.includes(page));else issue([page]);}
  if(!fields.length)throw Error('상세 견적 양식의 입력 항목이 없습니다.');
  return {fields,unsupported};
}
