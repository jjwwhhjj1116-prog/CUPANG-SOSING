import {DATASETS,type Dataset,type OperationsSnapshot,type Values} from './types';
export type CollectorResult={ok:boolean;status?:'succeeded'|'partial'|'failed'|'unknown';rows?:Values[];datasets?:Partial<Record<Dataset,Values[]>>;version?:string;capabilities?:string[]|Record<string,boolean>;error?:string;warnings?:string[];companyCode?:string};
export function supportsCollection(result:CollectorResult,kind:string){const capabilities=result.capabilities;return capabilities==null|| (Array.isArray(capabilities)?capabilities.includes(kind):capabilities[kind]===true);}
export function requestCollector(kind:string,companyCode:string,values:Values,timeout=180000):Promise<CollectorResult>{
 return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();
  const cleanup=()=>{window.removeEventListener('message',receive);clearTimeout(timer);};
  const receive=(event:MessageEvent)=>{if(event.source!==window||event.origin!==location.origin)return;const data=event.data;if(!data||data.source!=='YOOFAM_OPS_EXTENSION'||data.requestId!==requestId)return;cleanup();const r=data.result;if(!r||typeof r.ok!=='boolean')reject(Error('수집 연결의 응답을 확인할 수 없습니다.'));else resolve(r as CollectorResult);};
  window.addEventListener('message',receive);const timer=setTimeout(()=>{cleanup();reject(Error(kind==='ping'?'운영관리 수집 연결이 없습니다. 전용 연결 확장을 설치한 뒤 이 페이지를 새로고침하세요. 파일·표 가져오기는 바로 사용할 수 있습니다.':'수집 응답 시간이 지났습니다. 원본 사이트의 상태를 먼저 확인하세요. 승인 작업은 응답이 없었다고 다시 실행하면 안 됩니다.'));},timeout);
  window.postMessage({source:'YOOFAM_OPS_PAGE',requestId,kind,companyCode,values},location.origin);
 });
}
/** Resolve only unique, explicit external IDs. Failed matches remain in the job diagnostic. */
export function collectorRows(kind:string,result:CollectorResult,snapshot:OperationsSnapshot,values:Values):{datasets:Partial<Record<Dataset,Values[]>>;warnings:string[];rejectedRows:Values[]}{
 const warnings=[...(result.warnings??[])],datasets:Partial<Record<Dataset,Values[]>>={},rejectedRows:Values[]=[];
 const index=new Map<string,Set<string>>();for(const r of snapshot.document.records.skus)for(const k of [r.id,r.values.optionId,r.values.supplierSkuId,r.values.barcode])if(k!=null&&String(k)){const key=String(k),set=index.get(key)??new Set<string>();set.add(r.id);index.set(key,set);}
 const resolve=(r:Values)=>{const matches=new Set<string>();for(const k of [r.skuId,r.externalSkuId,r.supplierSkuId,r.optionId,r.barcode,r.code])for(const id of index.get(String(k??''))??[])matches.add(id);return matches.size===1?[...matches][0]:undefined;};
 const reject=(r:Values,reason:string)=>{if(rejectedRows.length<200)rejectedRows.push({...r,reason});};
 const add=(dataset:Dataset,rows:Values[])=>{datasets[dataset]=[...(datasets[dataset]??[]),...rows];};
 const financial=['inventory','inbound','adMetrics','rocketSales','statements','statementConfirm'];
 if(financial.includes(kind)&&result.companyCode!==snapshot.scope.companyCode)throw Error('수집 원본의 회사 확인값이 현재 회사와 일치하지 않습니다. 반영하지 않았습니다.');
 let input:Partial<Record<Dataset,Values[]>>=result.datasets??{};
 const allowed:Record<string,Dataset[]>={keywordSearch:['discoveries'],discovery:['discoveries'],relatedKeywords:['keywords'],reviews:['reviews'],coupangCompare:['comparisons'],statements:['statementApprovals'],statementConfirm:['statementApprovals'],inbound:['inboundEvents'],rocketSales:['sales'],adMetrics:['adMetrics'],inventory:['inventorySnapshots','inventoryLines']};
 if(!allowed[kind])throw Error('지원하지 않는 수집 유형입니다.');
 const rows=result.rows??[];
 if(!result.datasets){
  const target:Record<string,Dataset>={keywordSearch:'discoveries',discovery:'discoveries',relatedKeywords:'keywords',reviews:'reviews',coupangCompare:'comparisons',statements:'statementApprovals',statementConfirm:'statementApprovals',inbound:'inboundEvents',rocketSales:'sales',adMetrics:'adMetrics'};
  if(kind==='inventory'){
   const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()),id='snapshot-'+crypto.randomUUID();
   input={inventorySnapshots:[{id,date,businessDate:String(values.businessDate??date),complete:result.status!=='partial',source:'advertising',observedAt:new Date().toISOString()}],inventoryLines:rows.map(r=>({...r,snapshotId:id}))};
  }else if(target[kind])input={[target[kind]]:rows};else throw Error('지원하지 않는 수집 유형입니다.');
 }
 let missing=0;
 for(const [key,sourceRows]of Object.entries(input)){
  if(!DATASETS.includes(key as Dataset)||!allowed[kind].includes(key as Dataset)||!Array.isArray(sourceRows))throw Error('수집 자료 종류를 확인할 수 없습니다.');
  const dataset=key as Dataset,prepared:Values[]=[];
  for(const raw of sourceRows){const r={...raw};
   if(['inventoryLines','inboundEvents','sales'].includes(dataset)){
    const id=resolve(r);if(!id){missing++;reject(r,'공통 SKU의 외부 식별번호와 유일하게 연결되지 않음');continue;}r.skuId=id;
   }
   if(dataset==='discoveries'){r.keyword??=values.keyword;r.observedAt??=new Date().toISOString();}
   if(dataset==='keywords'){r.seed??=values.keyword;r.keyword??=r.kw;r.collectedAt??=new Date().toISOString();}
   if(dataset==='reviews')r.productId??=values.productId;
   if(dataset==='comparisons')r.candidateId??=values.candidateId;
   if(dataset==='sales')r.type='rocket';
   if(dataset==='adMetrics'){
    const external=r.externalCampaignId??r.campaignId;const campaign=external==null||String(external).trim()===''?[]:snapshot.document.records.campaigns.filter(c=>c.id===external||(c.values.externalId!=null&&String(c.values.externalId).trim()!==''&&String(c.values.externalId)===String(external)));
    if(campaign.length!==1){missing++;reject(r,'광고 캠페인 코드를 연결하지 못함');continue;}r.campaignId=campaign[0].id;
    if(r.skuId||r.externalSkuId||r.optionId||r.supplierSkuId||r.barcode||r.code){const skuId=resolve(r);if(!skuId){missing++;reject(r,'광고 상품 SKU를 연결하지 못함');continue;}r.skuId=skuId;}
   }
   prepared.push(r);
  }
  add(dataset,prepared);
 }
 if(missing){warnings.push(`공통 상품·캠페인에 연결하지 못한 ${missing}건을 반영하지 않았습니다. 최대 200건의 원본 식별값을 수집 기록에 보존합니다.`);for(const s of datasets.inventorySnapshots??[])s.complete=false;}
 const count=Object.values(datasets).reduce((a,r)=>a+(r?.length??0),0);if(count>5000)throw Error('한 번에 5,000행을 반영할 수 있습니다. 조회 기간을 나눠 주세요.');
 return{datasets,warnings,rejectedRows};
}
