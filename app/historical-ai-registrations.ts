export const historicalAiCompany={code:'A01464742',name:'와이홉'} as const;
export type HistoricalAiRow={cells:string[];images:{alt:string;src:string}[];links:string[]};
export type HistoricalAiQuote={source:string;companyCode:string;sourceRegistrationId:string;sourceOptionId:string;categoryCode:string;collectedAt:string;controls:{index:number;label:string;tag:string;type:string;value:string|boolean}[]};
export type HistoricalAiEntry={kind:'registration'|'quotation';registrationId:string;optionId:string;title:string;optionCount:number;sourceUrl:string;status:string;payload:string;sourceName:string;sourceSha256:string;sourceRow:number};
export type HistoricalAiImport={entries:HistoricalAiEntry[];sha256:string};
export type HistoricalAiCounts={total:number;registrations:number;quotations:number;added:number;unchanged:number;conflicts:number;unlinked:number};
export type HistoricalAiRecord={registrationId:string;title:string;optionCount:number;sourceUrl:string;status:string;raw:HistoricalAiRow;quoteCount:number;sourceName:string;importedAt:string};
export type HistoricalAiList={company:typeof historicalAiCompany;records:HistoricalAiRecord[];total:number;page:number;pageSize:number;reportedOptions:number;accountContext?:string};
export type HistoricalAiUrlReuse={sourceUrl:string;registrationId:string;company:typeof historicalAiCompany;accountContext:string};
export function canonicalHistoricalAiSourceUrl(value:unknown):string|null{return typeof value==='string'&&/^https:\/\/detail\.1688\.com\/offer\/[1-9]\d{0,19}\.html$/.test(value)?value:null;}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export class HistoricalAiInputError extends Error {
 constructor(message:string,public readonly code:'INVALID_FORMAT'|'INPUT_LIMIT'|'DUPLICATE_KEY'|'INVALID_OPTION_MARKER'='INVALID_FORMAT'){super(message);this.name='HistoricalAiInputError';}
}
const fail=():never=>{throw new HistoricalAiInputError('쿠플러스 원본 기록 형식을 확인해주세요. 등록번호·옵션번호와 원문을 변경하지 않은 JSON 파일이 필요합니다.');};
const tooLarge=():never=>{throw new HistoricalAiInputError('한 번에 가져올 원본 파일의 크기나 개수 한도를 넘었습니다. 페이지를 나누어 가져와주세요.','INPUT_LIMIT');};
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
const registration=(v:unknown):v is string=>typeof v==='string'&&/^\d{12}(?:_[1-9]\d*){0,2}$/.test(v);
export async function historicalAiHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');}
export function historicalAiAccountContext(ownerId:string){return historicalAiHash(JSON.stringify(['sourceflow-historical-ai-account-v1',ownerId,historicalAiCompany.code,historicalAiCompany.name]));}
function row(input:unknown):HistoricalAiRow{
 if(!object(input)||!exact(input,['cells','images','links'])||!Array.isArray(input.cells)||input.cells.length!==15||!input.cells.every(v=>text(v,5000))
  ||!Array.isArray(input.images)||input.images.length>5||!Array.isArray(input.links)||input.links.length>20||!input.links.every(v=>text(v,2048)))return fail();
 const images=input.images.map(value=>{if(!object(value)||!exact(value,['alt','src'])||!text(value.alt,2000)||!text(value.src,2048))return fail();
  let url:URL;try{url=new URL(value.src);}catch{return fail();}if(url.protocol!=='https:'||url.hostname!=='cbu01.alicdn.com'||url.username||url.password||url.port)return fail();return{alt:value.alt,src:value.src};});
 return {cells:[...input.cells] as string[],images,links:[...input.links] as string[]};
}
function quote(input:unknown):HistoricalAiQuote{
 if(!object(input)||!exact(input,['source','companyCode','sourceRegistrationId','sourceOptionId','categoryCode','collectedAt','controls'])
  ||input.source!=='https://www.couplus.co.kr/AIRocketReg'||input.companyCode!==historicalAiCompany.code||!registration(input.sourceRegistrationId)
  ||typeof input.sourceOptionId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.sourceOptionId)||typeof input.categoryCode!=='string'||!/^\d{1,20}$/.test(input.categoryCode)
  ||typeof input.collectedAt!=='string'||!Number.isFinite(Date.parse(input.collectedAt))||!Array.isArray(input.controls)||!input.controls.length||input.controls.length>400)return fail();
 const seen=new Set<number>(),controls=input.controls.map(value=>{
  if(!object(value)||!exact(value,['index','label','tag','type','value'])||!Number.isSafeInteger(value.index)||Number(value.index)<0||Number(value.index)>399||seen.has(Number(value.index))
   ||!text(value.label,500)||!['INPUT','SELECT','TEXTAREA'].includes(String(value.tag))||!['text','number','checkbox','select-one','textarea'].includes(String(value.type))
   ||!(value.type==='checkbox'?typeof value.value==='boolean':text(value.value,150000)))return fail();
  seen.add(Number(value.index));return{index:Number(value.index),label:value.label,tag:String(value.tag),type:String(value.type),value:value.value as string|boolean};
 });
 return {source:input.source,companyCode:input.companyCode,sourceRegistrationId:input.sourceRegistrationId,sourceOptionId:input.sourceOptionId,categoryCode:input.categoryCode,collectedAt:input.collectedAt,controls};
}
/** Import observed DOM text only. No product/SKU/receipt or image is fabricated. */
export async function parseHistoricalAiImport(input:unknown):Promise<HistoricalAiImport>{
 if(!Array.isArray(input)||!input.length)return fail();if(input.length>100)return tooLarge();
 const entries:HistoricalAiEntry[]=[],seen=new Set<string>();let totalBytes=0;
 for(const document of input){
  if(!object(document)||!exact(document,['name','text'])||!text(document.name,160)||!document.name.endsWith('.json')||/[\\/]/.test(document.name)||!text(document.text,1500000))return fail();
  totalBytes+=new TextEncoder().encode(document.text).length;if(totalBytes>1500000)return tooLarge();
  let raw:unknown;try{raw=JSON.parse(document.text);}catch{return fail();}
  const sourceSha256=await historicalAiHash(document.text),common={sourceName:document.name,sourceSha256};
  if(Array.isArray(raw)){
   if(!raw.length||raw.length>500)return fail();
   for(const [index,value]of raw.entries()){
    const parsed=row(value),registrationId=parsed.cells[1];
    // Recorded innerText uses newlines; recorded textContent keeps DOM spacing.
    // Accept their unambiguous option boundary without rewriting the raw cell.
    const markers=[...parsed.cells[3].matchAll(/(?:\n| {2,})옵션 ([1-9]\d{0,4})개(?=\n| {2,}|$)/g)];
    if(markers.length!==1)throw new HistoricalAiInputError('상품명 셀의 표시 옵션 수를 정확히 확인할 수 없습니다. 원본 목록 페이지 형식을 확인해주세요.','INVALID_OPTION_MARKER');
    const optionMatch=markers[0],title=parsed.cells[3].slice(0,optionMatch.index).split('\n')[0].trim();
    const urls=[...new Set(parsed.links.filter(url=>canonicalHistoricalAiSourceUrl(url)!==null))];
    if(!registration(registrationId)||!title||urls.length!==1||!['등록완료','등록대기','등록실패'].includes(parsed.cells[13]))return fail();
    entries.push({kind:'registration',registrationId,optionId:'',title,optionCount:Number(optionMatch[1]),sourceUrl:urls[0],status:parsed.cells[13],payload:JSON.stringify(parsed),...common,sourceRow:index+1});
   }
  }else{
   const parsed=quote(raw);entries.push({kind:'quotation',registrationId:parsed.sourceRegistrationId,optionId:parsed.sourceOptionId,title:'',optionCount:0,sourceUrl:'',status:'부분 견적자료',payload:JSON.stringify(parsed),...common,sourceRow:0});
  }
 }
 const payload=JSON.stringify(entries);
 // D1 has a per-value size limit; repeated imports have no lifetime row cap.
 if(entries.length>5000||new TextEncoder().encode(payload).length>1800000)return tooLarge();
 for(const entry of entries){const key=JSON.stringify([entry.kind,entry.registrationId,entry.optionId]);if(seen.has(key))throw new HistoricalAiInputError('파일 안에 같은 등록번호·옵션번호의 기록이 중복되어 있습니다. 원본 페이지를 확인해주세요.','DUPLICATE_KEY');seen.add(key);}
 return {entries,sha256:await historicalAiHash(payload)};
}
