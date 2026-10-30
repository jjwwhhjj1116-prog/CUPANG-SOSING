export const VERSION='1.0.0';
export const CAPABILITIES=Object.freeze({keywordSearch:true,relatedKeywords:true,reviews:true,discovery:true,coupangCompare:true,inventory:true,inbound:true,adMetrics:true,rocketSales:true,statements:true,statementConfirm:true});
export const FINANCIAL=new Set(['inventory','inbound','adMetrics','rocketSales','statements','statementConfirm']);
export const LIMITS=Object.freeze({rows:5000,requestBytes:24000,responseBytes:2200000,history:100,totalMs:135000,pages:40});
export function allowedAppUrl(input){try{const u=new URL(input);return !u.username&&!u.password&&(u.origin==='https://sourceflow.jjwwhhjj1116.workers.dev'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname));}catch{return false;}}
export function validateSender(sender){if(sender?.frameId!==0||!Number.isSafeInteger(sender?.tab?.id)||!allowedAppUrl(sender.url)||!allowedAppUrl(sender.tab.url)||new URL(sender.url).origin!==new URL(sender.tab.url).origin)throw Error('YOOFAM 운영관리의 최상위 탭에서 요청해주세요.');return new URL(sender.url).origin;}
export function validCompany(value){return typeof value==='string'&&/^A\d{6,12}$/.test(value);}
export function assertCompany(actual,expected){if(!validCompany(actual)||actual!==expected)throw Error(actual?'회원 회사와 현재 쿠팡 로그인 회사가 다릅니다.':'현재 쿠팡 로그인 회사코드를 확인하지 못해 수집을 중단했습니다.');return actual;}
export function validateRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>LIMITS.requestBytes)throw Error('요청 형식 또는 크기를 확인해주세요.');
 if(input.source!=='YOOFAM_OPS_PAGE'||typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId))throw Error('수집 요청 ID가 올바르지 않습니다.');
 if(input.kind!=='ping'&&!Object.hasOwn(CAPABILITIES,input.kind))throw Error('지원하지 않는 수집 종류입니다.');
 if(FINANCIAL.has(input.kind)&&!validCompany(input.companyCode))throw Error('승인된 회원 회사코드가 필요합니다.');
 const values=input.values??{};if(typeof values!=='object'||Array.isArray(values)||values===null)throw Error('수집 조건을 확인해주세요.');
 return {source:'YOOFAM_OPS_PAGE',requestId:input.requestId,kind:input.kind,companyCode:validCompany(input.companyCode)?input.companyCode:'',values:structuredClone(values)};
}
export function dateRange(values,today=new Date().toISOString().slice(0,10)){
 const start=String(values.startDate??values.from??values.date??today),end=String(values.endDate??values.to??values.date??today);
 const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 if(!valid(start)||!valid(end)||start>end)throw Error('조회 시작일·종료일을 확인해주세요.');
 const days=(Date.parse(end)-Date.parse(start))/86400000;
 if(days>365)throw Error('한 번에 최대 366일을 조회할 수 있습니다.');
 return {start,end,days:Array.from({length:days+1},(_,i)=>new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10))};
}
export function requestKey(request,sender){return `${sender.tab.id}:${request.requestId}`;}
export function claimRequest(history,request,sender,now=Date.now()){
 const key=requestKey(request,sender);if(history.some(row=>row.key===key))throw Error('이미 처리한 수집 요청입니다. 다시 수집하려면 새 요청을 실행해주세요.');
 return [...history.filter(row=>now-row.at<86400000),{key,kind:request.kind,companyCode:request.companyCode,origin:new URL(sender.url).origin,at:now,status:'running'}].slice(-LIMITS.history);
}
export function boundedResult(result,request){
 if(!result||typeof result!=='object'||Array.isArray(result))throw Error('수집 결과를 읽지 못했습니다.');
 const safe=(value,depth=0)=>{if(depth>8)throw Error('수집 결과 구조가 너무 깊습니다.');if(value===null||typeof value==='boolean')return value;if(typeof value==='number'){if(!Number.isFinite(value))throw Error('수집 금액이 올바르지 않습니다.');return value;}if(typeof value==='string'){if(value.length>20000)throw Error('수집 항목이 너무 깁니다.');return value;}if(Array.isArray(value)){if(value.length>LIMITS.rows)throw Error('수집 행 한도를 초과했습니다.');return value.map(x=>safe(x,depth+1));}if(typeof value==='object'){const entries=Object.entries(value);if(entries.length>100)throw Error('수집 열 한도를 초과했습니다.');const out={};for(const[k,v]of entries){if(/cookie|token|authorization|password|rawhtml|headers|__proto__|prototype|constructor/i.test(k))throw Error('수집 결과에 허용하지 않는 필드가 있습니다.');out[k]=safe(v,depth+1);}return out;}throw Error('수집 결과 값이 올바르지 않습니다.');};
 const rows=safe(result.rows??[]),datasets=result.datasets?safe(result.datasets):undefined;
 const status=['succeeded','partial','failed','unknown'].includes(result.status)?result.status:'failed';
 const out={ok:status==='succeeded'||status==='partial',status,rows,kind:request.kind,version:VERSION,...(request.companyCode?{companyCode:request.companyCode}:{}),...(datasets?{datasets}:{}),...(result.warnings?{warnings:safe(result.warnings)}:{}),...(result.error?{error:String(result.error).slice(0,1000)}:{})};
 if(JSON.stringify(out).length>LIMITS.responseBytes)throw Error('수집 결과가 너무 큽니다. 기간을 줄여 다시 조회해주세요.');
 return out;
}
