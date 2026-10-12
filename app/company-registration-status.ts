import {exchange} from '@/app/supplier-hub-handoff';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
export const REGISTRATION_REVIEW_STATUSES=['전체','상품 검수중','상품 검수 완료','상품 검수 반려'] as const;
export type CompanyRegistrationQuery={startDate:string;endDate:string;status:typeof REGISTRATION_REVIEW_STATUSES[number];title:string};
export type CompanyRegistrationRow={title:string;submittedAt:string;category:string;barcode:string;sourceQuotation:string;quotationId:string;skuId:string;status:string;stage:string};
export type CompanyRegistrationStatus={source:'supplier-hub-company-registration-v1';scope:'queried-pages';mutated:false;ownerId:string;company:SupplierHubCompany;query:CompanyRegistrationQuery;rows:CompanyRegistrationRow[];total:number;pagesRead:number;observedAt:number};
export type CompanyRegistrationContext={ownerId:string;company:SupplierHubCompany};
const queryKeys=['startDate','endDate','status','title'] as const;
function date(value:unknown):value is string{try{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}}
export function validateCompanyRegistrationQuery(value:unknown):CompanyRegistrationQuery{
 const query=value as CompanyRegistrationQuery;
 if(!query||Array.isArray(query)||Object.keys(query).length!==4||!queryKeys.every(key=>Object.hasOwn(query,key))||!date(query.startDate)||!date(query.endDate)||query.startDate>query.endDate||!REGISTRATION_REVIEW_STATUSES.includes(query.status)||typeof query.title!=='string'||query.title!==query.title.trim()||query.title.length>200||/[\u0000-\u001f]/.test(query.title))throw Error('등록 상태의 기간·검수상태·상품명을 확인해주세요.');
 return {startDate:query.startDate,endDate:query.endDate,status:query.status,title:query.title};
}
export function defaultCompanyRegistrationQuery(now=Date.now()):CompanyRegistrationQuery{
 const end=new Date(now+9*60*60*1000).toISOString().slice(0,10),start=new Date(Date.parse(end+'T00:00:00Z')-120*86400000).toISOString().slice(0,10);
 return {startDate:start,endDate:end,status:'전체',title:''};
}
export async function readCompanyRegistrationContext(signal:AbortSignal):Promise<CompanyRegistrationContext>{
 const response=await fetch('/api/supplier-hub/catalog-context',{signal,cache:'no-store',credentials:'same-origin',redirect:'error'}),body=await response.json() as CompanyRegistrationContext&{error?:string};
 if(!response.ok)throw Error(body.error??'로그인 회원 회사정보를 확인하지 못했습니다.');
 const company=supplierHubCompany(body.company?.code,body.company?.name);
 if(!company||typeof body.ownerId!=='string'||!/^\w[\w-]{0,99}$/.test(body.ownerId))throw Error('승인된 회원 회사정보를 확인하지 못했습니다.');
 return {ownerId:body.ownerId,company};
}
export function validateCompanyRegistrationStatus(value:unknown,query:CompanyRegistrationQuery,context:CompanyRegistrationContext):CompanyRegistrationStatus{
 const result=value as CompanyRegistrationStatus;
 if(!result||result.source!=='supplier-hub-company-registration-v1'||result.scope!=='queried-pages'||result.mutated!==false||result.ownerId!==context.ownerId||result.company?.code!==context.company.code||result.company?.name!==context.company.name
  ||!result.query||!queryKeys.every(key=>validateCompanyRegistrationQuery(result.query)[key]===query[key])||!Number.isSafeInteger(result.total)||result.total<0||result.total>2000||!Array.isArray(result.rows)||result.rows.length!==result.total
  ||!Number.isSafeInteger(result.pagesRead)||result.pagesRead<1||result.pagesRead>200||!Number.isSafeInteger(result.observedAt)||result.observedAt<=0||result.observedAt>Date.now()+60000
  ||new TextEncoder().encode(JSON.stringify(result)).length>4*1024*1024)throw Error('회원 회사의 현재 조회 결과를 확인하지 못했습니다.');
 const fields=['title','submittedAt','category','barcode','sourceQuotation','quotationId','skuId','status','stage'] as const;
 const issued=new Set<string>(),placeholder=(value:string)=>!value||/^(?:-|—|n\/a|미표시|해당사항없음)$/i.test(value);
 for(const row of result.rows){if(!row||fields.some(field=>typeof row[field]!=='string'||row[field].length>20000)||!row.title||/\.\.\.|…/.test(row.quotationId+' '+row.skuId))throw Error('등록 상태의 상품·식별값을 확인하지 못했습니다.');const match=row.submittedAt.match(/^(\d{4})[/-](\d{2})[/-](\d{2})\b/),day=match?.slice(1).join('-');if(!date(day)||day<query.startDate||day>query.endDate||query.status!=='전체'&&row.status!==query.status||query.title&&!row.title.toLowerCase().includes(query.title.toLowerCase()))throw Error('입력한 범위와 등록 상태 결과가 다릅니다.');}
 for(const row of result.rows)if(!placeholder(row.quotationId)&&!placeholder(row.skuId)){const identity=JSON.stringify([row.quotationId,row.skuId]);if(issued.has(identity))throw Error('조회 페이지의 견적서·SKU가 중복되었습니다. 다시 조회해주세요.');issued.add(identity);}
 return result;
}
/** Independent company-level observation. Never creates a YOOFAM receipt or changes a draft. */
export async function loadCompanyRegistrationStatus(query:CompanyRegistrationQuery,signal:AbortSignal):Promise<CompanyRegistrationStatus>{
 const request=validateCompanyRegistrationQuery(query),before=await readCompanyRegistrationContext(signal),capability=await exchange('PING',null,signal);
 if(capability.companyRegistrationStatus!==true)throw Error('등록 상태 조회를 지원하는 YOOFAM PLUS 확장 0.2.61을 적용해주세요.');
 const reply=await exchange('COMPANY_REGISTRATIONS',{query:request},signal),after=await readCompanyRegistrationContext(signal);
 if(before.ownerId!==after.ownerId||before.company.code!==after.company.code||before.company.name!==after.company.name)throw Error('조회 중 로그인 계정 또는 회사정보가 변경되었습니다. 다시 조회해주세요.');
 if(signal.aborted)throw Error('조회가 취소되었습니다.');return validateCompanyRegistrationStatus(reply.observation,request,after);
}
export function registrationStageSummary(row:CompanyRegistrationRow):{stage:string;reason:string}{
 const labels=['가격/정책','상품 정보','발주서 발행'],parts=labels.map((label,index)=>{const start=row.stage.indexOf(label);if(start<0)return null;const end=index<labels.length-1?row.stage.indexOf(labels[index+1],start+label.length):-1;return {stage:label,reason:row.stage.slice(start+label.length,end<0?undefined:end).trim()};}).filter((value):value is {stage:string;reason:string}=>Boolean(value));
 const active=parts.find(part=>/반려|거절|실패|검수중|진행중/.test(part.reason)&&!/진행전/.test(part.reason))??parts.find(part=>part.reason&&!/진행전/.test(part.reason));
 return active??{stage:row.stage||'—',reason:'—'};
}
