import {VERSION,CAPABILITIES,FINANCIAL,LIMITS,validateSender,validateRequest,assertCompany,dateRange,claimRequest,boundedResult,requestKey} from './protocol.mjs';
import {normalizeInventoryItem,normalizeTabular,normalizeStatement,normalizeAdMetric,parseCsv} from './normalizers.mjs';
import {collectOperationsPage} from './page.mjs';
import {createStatementApprovals} from './approval.mjs';

const originFor=kind=>['inventory','adMetrics'].includes(kind)?'https://advertising.coupang.com':['inbound','rocketSales','statements'].includes(kind)?'https://supplier.coupang.com':'https://www.coupang.com';
const collectKinds=new Set(Object.keys(CAPABILITIES).filter(key=>CAPABILITIES[key]));
let queue=Promise.resolve(),waiting=0;
const clone=value=>structuredClone(value);

function normalizePayload(raw,request){
 const warnings=[...(raw.warnings??[])];let status=raw.status??'succeeded',rows=[],datasets;
 const convert=(items,normalizer)=>{const valid=[];let failures=0;for(const item of items){try{valid.push(normalizer(item));}catch(error){failures++;if(failures<=3)warnings.push(error instanceof Error?error.message:'한 항목을 해석하지 못했습니다.');}}if(failures){if(!valid.length)throw Error(warnings[warnings.length-1]);status='partial';warnings.push(`${failures}개 항목을 해석하지 못해 정상 자료만 반환했습니다.`);}return valid;};
 if(request.kind==='inventory'){
  const normalized=convert(raw.items??[],normalizeInventoryItem),snapshotId='inv_'+crypto.randomUUID();
  const snapshot={id:snapshotId,...raw.snapshot,complete:raw.snapshot?.complete===true&&status==='succeeded'};
  rows=normalized.map(row=>({...row,snapshotId}));datasets={inventorySnapshots:[snapshot],inventoryLines:rows};
 }else if(request.kind==='inbound')rows=normalizeTabular('inbound',raw.headers??[],raw.cells??[]);
 else if(request.kind==='rocketSales'){
  const headerRows=parseCsv(raw.headerText??'');if(headerRows.length!==1)throw Error('발주 SKU 머리글이 올바르지 않습니다.');
  const cells=(raw.dataTexts??[]).flatMap(text=>parseCsv(text));if(cells.length>LIMITS.rows){status='partial';warnings.push('5,000행 한도 내에서 읽은 발주 SKU만 반환합니다.');}rows=normalizeTabular('rocketSales',headerRows[0],cells.slice(0,LIMITS.rows));
 }else if(request.kind==='statements')rows=convert(raw.items??[],normalizeStatement);
 else if(request.kind==='adMetrics')rows=convert(raw.metrics??[],item=>normalizeAdMetric(item.metrics,item.campaignId,item.date));
 else rows=raw.rows??[];
 return boundedResult({status,rows,...(datasets?{datasets}:{}),warnings:[...new Set(warnings)].slice(0,20)},request);
}

async function targetTab(api,sender,kind){
 const origin=originFor(kind),tabs=await api.tabs.query({url:origin+'/*',windowId:sender.tab.windowId});
 const valid=tabs.filter(tab=>Number.isSafeInteger(tab.id)&&new URL(tab.url??origin).origin===origin&&!/^\/(?:login|auth)(?:\/|$)/.test(new URL(tab.url??origin).pathname));
 valid.sort((a,b)=>Number(b.active)-Number(a.active)||(b.lastAccessed??0)-(a.lastAccessed??0));
 if(!valid.length)throw Error(`${origin.replace('https://','')}에 로그인한 탭을 YOOFAM과 같은 Chrome 창에 열어주세요.`);
 return valid[0];
}

async function run(api,request,sender,approvals){
 if(request.kind==='ping')return {ok:true,status:'succeeded',rows:[],kind:'ping',version:VERSION,capabilities:clone(CAPABILITIES),warnings:['실제 사이트의 응답·로그인 상태에 따라 읽기가 제한될 수 있습니다.','거래명세서 승인은 별도 확장 확인 창에서 회사·발주번호를 확인하고 직접 승인해야 실행됩니다.']};
 if(!collectKinds.has(request.kind))return {ok:false,status:'failed',rows:[],kind:request.kind,version:VERSION,error:'지원하지 않는 수집입니다.',capabilities:clone(CAPABILITIES)};
 const saved=await api.storage.local.get('ops_requests'),history=claimRequest(Array.isArray(saved.ops_requests)?saved.ops_requests:[],request,sender);
 await api.storage.local.set({ops_requests:history});
 const record=async status=>{const current=await api.storage.local.get('ops_requests');await api.storage.local.set({ops_requests:(current.ops_requests??history).map(row=>row.key===requestKey(request,sender)?{...row,status}:row).slice(-LIMITS.history)});};
 try{
  const range=dateRange(request.values,new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()));
  if(request.kind==='statementConfirm'){const output=await approvals.request(request,sender,range);try{await record(output.status);}catch{/* Per-order checkpoints are already persisted; retain the actual external receipt. */}return output;}
  const tab=await targetTab(api,sender,request.kind);
  const args={...request,startDate:range.start,endDate:range.end};
  const response=await api.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:collectOperationsPage,args:[args]});
  const raw=response?.[0]?.result;if(!raw)throw Error('수집 탭의 응답을 받지 못했습니다. 탭이 닫히거나 이동했는지 확인해주세요.');
  const current=await api.tabs.get(tab.id);if(new URL(current.url??'about:blank').origin!==originFor(request.kind))throw Error('수집 중 대상 탭이 이동했습니다. 결과를 반영하지 않았습니다.');
  if(FINANCIAL.has(request.kind))assertCompany(raw.companyCode,request.companyCode);
  // WING is an optional demand source. Only an unambiguous same-option match is attached.
  if(['keywordSearch','discovery','coupangCompare'].includes(request.kind)&&raw.rows?.length){
   try{
    const tabs=await api.tabs.query({url:'https://wing.coupang.com/*',windowId:sender.tab.windowId});
    if(tabs.length){const enrichment=await api.scripting.executeScript({target:{tabId:tabs[0].id,frameIds:[0]},world:'ISOLATED',func:collectOperationsPage,args:[{...args,kind:'wingEnrich'}]});const demand=enrichment?.[0]?.result?.rows??[];
     raw.rows=raw.rows.map(row=>{const matches=demand.filter(item=>item.productId===row.productId&&(!row.optionId||item.optionId===row.optionId));return matches.length===1&&Number(matches[0].itemCount??1)<=1?{...row,sales28:matches[0].sales28,views:matches[0].views,demandScope:'source-defined'}:row;});
     raw.warnings??=[];raw.warnings.push('28일 수요는 외부 집계 범위가 확정되지 않은 참고 지표입니다.');
    }else{raw.warnings??=[];raw.warnings.push('WING 탭이 없어 28일 판매량을 보강하지 않았습니다.');}
   }catch{raw.warnings??=[];raw.warnings.push('WING 수요 보강에 실패했습니다. 검색 관측은 유지합니다.');}
  }
  const output=normalizePayload(raw,request);await record(output.status);return output;
 }catch(error){await record('failed');return {ok:false,status:'failed',rows:[],kind:request.kind,version:VERSION,error:error instanceof Error?error.message:'수집하지 못했습니다. 원본 파일 가져오기를 사용할 수 있습니다.'};}
}

export function installOperationsWorker(api=globalThis.chrome){
 const approvals=createStatementApprovals(api,targetTab);
 api.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(['YOOFAM_OPS_APPROVAL_STATE','YOOFAM_OPS_APPROVAL_CANCEL','YOOFAM_OPS_APPROVAL_ACK'].includes(message?.type)){void approvals.message(message,sender).then(sendResponse).catch(error=>sendResponse({ok:false,error:error instanceof Error?error.message:'승인 확인이 거절되었습니다.'}));return true;}
  if(message?.type!=='YOOFAM_OPS_COLLECT')return false;
  let request;try{validateSender(sender);request=validateRequest(message.request);}catch(error){sendResponse({ok:false,status:'failed',rows:[],version:VERSION,error:error instanceof Error?error.message:'요청이 거절되었습니다.'});return false;}
  if(request.kind==='ping'){void run(api,request,sender,approvals).then(sendResponse);return true;}
  if(waiting>=3){sendResponse({ok:false,status:'failed',rows:[],kind:request.kind,version:VERSION,error:'수집 요청이 진행 중입니다. 완료 후 다시 실행해주세요.'});return false;}
  waiting++;let answered=false;
  const timer=setTimeout(()=>{if(answered)return;answered=true;sendResponse({ok:false,status:'unknown',rows:[],kind:request.kind,version:VERSION,error:'수집 응답을 확인하지 못했습니다. 진행 중인 조회가 끝난 뒤 다시 확인해주세요.'});},request.kind==='statementConfirm'?435000:LIMITS.totalMs);
  queue=queue.catch(()=>{}).then(async()=>{if(answered)return;return run(api,request,sender,approvals);}).then(result=>{if(!answered){answered=true;sendResponse(result);}}).catch(()=>{if(!answered){answered=true;sendResponse({ok:false,status:'failed',rows:[],kind:request.kind,version:VERSION,error:'수집 결과를 전달하지 못했습니다.'});}}).finally(()=>{clearTimeout(timer);waiting--;});
  return true;
 });
}
if(globalThis.chrome?.runtime?.onMessage)installOperationsWorker();
export {normalizePayload};
