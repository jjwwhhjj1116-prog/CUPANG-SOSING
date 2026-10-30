import {DATASETS,type Dataset,type Values,type OpsRecord,type OperationsDocument,type OperationsCommand,type DerivedViews} from './types';

export class OperationsError extends Error {constructor(message:string,public status=400,public code='OPERATIONS_INVALID'){super(message);this.name='OperationsError';}}
// One workspace is stored as one D1 TEXT value; reserve room below its 2 MB
// row/value ceiling for the scope, revision and timestamps.
export const OPERATIONS_LIMIT=1_800_000, ROW_LIMIT=20_000, IMPORT_LIMIT=5000;
const text=(v:unknown)=>v==null?'':String(v), n=(v:unknown)=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const truth=(v:unknown)=>v===true||v==='true'||v===1||v==='1';
const amt=(v:Values,...keys:string[])=>{for(const k of keys)if(v[k]!==undefined&&v[k]!==null&&v[k]!=='')return n(v[k]);return 0;};
const first=(v:Values,...keys:string[])=>{for(const k of keys)if(v[k]!==undefined&&v[k]!==null&&v[k]!=='')return text(v[k]);return '';};
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const nowDefault=()=>new Date().toISOString();
const businessDate=(at:string)=>new Date(Date.parse(at)+9*3600000).toISOString().slice(0,10);
const isoDate=(v:unknown)=>{const s=text(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number(s.slice(0,4))<2000||Number(s.slice(0,4))>2200)return false;try{return new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}catch{return false;}};
const month=(v:unknown)=>text(v).slice(0,7);
const validMonth=(v:unknown)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(text(v));
const row=(id:string,values:Values,at:string):OpsRecord=>({id,values,createdAt:at,updatedAt:at});
const idFrom=(parts:unknown[])=>'op_'+parts.map(x=>encodeURIComponent(text(x))).join('|');
const safeId=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=250&&!/[\u0000-\u001f]/.test(v)&&!['__proto__','prototype','constructor'].includes(v);
const forbidden=new Set(['__proto__','prototype','constructor']);
const numeric=new Set(['qty','quantity','stock','price','unitPrice','supply','supplyPrice','salePrice','cost','costPrice','amount','total','vat','fx','setQty','agentFee','agent','localShipping','cnship','cnCost','krCost','inspectionCost','inspCost','extraCost','shipping','freight','clicks','impressions','revenue','orders','units','budget','targetRoas','rating','helpful','sales28','views','rank','year','cnyPrice','priceCny','openingQty','openingAmount','weight']);
const dated=new Set(['date','businessDate','orderDate','remitDate','paymentDate','receivedDate','expectedDate','effectiveDate']);
function safeValue(value:unknown,depth=0):unknown{
 if(depth>6)throw new OperationsError('자료의 중첩 깊이가 한도를 넘었습니다.');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value)||Math.abs(value)>1e12)throw new OperationsError('금액·수량은 유한한 범위의 숫자로 입력해주세요.');return value;}
 if(typeof value==='string'){if(value.length>20000||/[\u0000]/.test(value))throw new OperationsError('입력 문자열이 너무 길거나 올바르지 않습니다.');return value;}
 if(Array.isArray(value)){if(value.length>5000)throw new OperationsError('행의 세부값이 너무 많습니다.');return value.map(x=>safeValue(x,depth+1));}
 if(value&&typeof value==='object'){const entries=Object.entries(value);if(entries.length>100)throw new OperationsError('행의 열이 너무 많습니다.');const out:Values={};for(const [k,v]of entries){if(forbidden.has(k)||k.length>100)throw new OperationsError('지원하지 않는 열 이름입니다.');out[k]=safeValue(v,depth+1);}return out;}
 throw new OperationsError('지원하지 않는 자료 값입니다.');
}
export function emptyOperationsDocument():OperationsDocument{
 const records=Object.fromEntries(DATASETS.map(k=>[k,[]])) as unknown as Record<Dataset,OpsRecord[]>;
 for(const [id,name,group]of [['cat-sga','판매비와관리비','sga'],['cat-income','영업외수익','income'],['cat-other','영업외비용','other'],['cat-tax','소득세/법인세','tax']])records.expenseCategories.push(row(id,{name,group},'1970-01-01T00:00:00.000Z'));
 return{schemaVersion:1,records};
}
export function parseOperationsDocument(value:unknown):OperationsDocument{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationsError('저장된 운영 자료 형식을 확인할 수 없습니다.',503);
 const d=value as OperationsDocument;if(d.schemaVersion!==1||!d.records||DATASETS.some(k=>!Array.isArray(d.records[k])))throw new OperationsError('저장된 운영 자료 버전이 다릅니다.',503);
 let total=0;for(const key of DATASETS){const seen=new Set<string>();for(const r of d.records[key]){if(!safeId(r.id)||seen.has(r.id)||!r.values||typeof r.values!=='object'||Array.isArray(r.values))throw new OperationsError('저장된 운영 행을 확인할 수 없습니다.',503);seen.add(r.id);total++;}}
 if(total>ROW_LIMIT||d.records.skus.length>5000)throw new OperationsError('운영 자료의 행 수가 저장 한도를 넘었습니다.',413);
 if(new TextEncoder().encode(JSON.stringify(d)).length>OPERATIONS_LIMIT)throw new OperationsError('운영 자료는 UTF-8 기준 1,800,000바이트까지 저장할 수 있습니다. 자료를 나누거나 불필요한 행을 정리해주세요.',413,'OPERATIONS_SIZE_LIMIT');return d;
}
function normalize(dataset:Dataset,input:Values):Values{
 const v=safeValue(input) as Values;
 delete v.id;delete v.createdAt;delete v.updatedAt;
 if(dataset==='purchaseOrders'&&!v.date&&v.orderDate)v.date=v.orderDate;
 if(dataset==='inboundEvents'){
  // Editors retain hidden canonical fields. Explicit editable aliases must win
  // over those old values; internal purchase receipts keep their own identity.
  if(v.kind!=='purchase-receipt'){
   if(v.type)v.kind=v.type==='outbound'?'return-out':v.type;
   if(own(v,'po'))v.poNumber=v.po;
   if(own(v,'occurredAt'))v.time=v.occurredAt;
  }
  if(!v.date&&v.occurredAt&&isoDate(text(v.occurredAt).slice(0,10)))v.date=text(v.occurredAt).slice(0,10);
 }
 if(dataset==='statementApprovals'&&!v.poNumber&&v.purchaseOrderSeq)v.poNumber=v.purchaseOrderSeq;
 if(dataset==='sourcingCandidates'&&!v.koName&&v.nameKo)v.koName=v.nameKo;
 if(dataset==='expenseCategories'&&v.group==='nonOperatingIncome')v.group='income';
 if(dataset==='expenseCategories'&&v.group==='nonOperatingExpense')v.group='other';
 for(const [key,value]of Object.entries(v)){
  if(numeric.has(key)&&value!==''&&value!==null){if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))throw new OperationsError(`${key}: 숫자를 입력해주세요.`);const x=Number(value);if(!Number.isFinite(x)||Math.abs(x)>1e12)throw new OperationsError(`${key}: 숫자 범위를 확인해주세요.`);v[key]=x;}
  if(dated.has(key)&&value!==''&&value!==null&&!isoDate(value))throw new OperationsError(`${key}: YYYY-MM-DD 날짜를 입력해주세요.`);
  if((key.endsWith('Id')||key==='barcode'||key==='supplierSkuId'||key==='optionId'||key==='approvalNo')&&value!==null&&value!==''){if(typeof value!=='string'||value.length>250)throw new OperationsError(`${key}: 식별번호는 텍스트로 입력해주세요.`);}
 }
 const required:Partial<Record<Dataset,string[]>>={skus:['name'],watchTargets:['keyword'],keywords:['seed','keyword'],reviews:['productId','rating'],sourcingCandidates:['name'],purchaseOrders:['skuId','date'],importBatches:['date'],purchaseLines:['batchId','skuId','qty'],inventorySnapshots:['businessDate'],inventoryLines:['snapshotId','skuId'],inboundEvents:['skuId','date','qty'],sales:['date','type'],salesDeductions:['month','amount'],adMetrics:['date','campaignId'],campaigns:['name'],campaignSkus:['campaignId','skuId'],expenseCategories:['name','group'],expenses:['date','vendor'],openingBalances:['skuId','year'],statementApprovals:['poNumber'],periodClosures:['month'],jobs:['kind','status']};
 for(const k of required[dataset]??[])if(v[k]===undefined||v[k]===null||v[k]==='')throw new OperationsError(`${k} 항목을 입력해주세요.`);
 if(v.month!==undefined&&!validMonth(v.month))throw new OperationsError('월은 YYYY-MM 형식으로 입력해주세요.');
 if(dataset==='sales'){
  if(!['rocket','general','subsidiary','other'].includes(text(v.type)))throw new OperationsError('매출 유형을 확인해주세요.');
  if(v.type!=='other'&&!v.skuId)throw new OperationsError('매출에 연결할 SKU를 선택해주세요.');
  if(v.type==='rocket')v.supply=amt(v,'supply','supplyPrice');
  else {const gross=amt(v,'price','total');v.price=gross;v.supply=Math.round(gross/1.1);v.vat=gross-n(v.supply);}
 }
 if(dataset==='expenses'){
  for(const key of ['total','supply','vat'])if(v[key]==='')delete v[key];
  if(v.status===undefined||v.status==='')v.status='pending';
  if(!['pending','confirmed','excluded'].includes(text(v.status)))throw new OperationsError('경비 상태를 확인해주세요.');
  if(v.total===undefined)v.total=amt(v,'supply')+amt(v,'vat');
  if(v.supply===undefined){v.supply=v.vat===undefined?Math.round(n(v.total)/1.1):n(v.total)-n(v.vat);v.vat=n(v.total)-n(v.supply);}
  if(v.vat===undefined)v.vat=n(v.total)-n(v.supply);
  if(Math.abs(n(v.supply)+n(v.vat)-n(v.total))>1)throw new OperationsError('경비 공급가+세액과 합계가 일치하지 않습니다.');
 }
 if(dataset==='reviews'&&(n(v.rating)<1||n(v.rating)>5))throw new OperationsError('별점은 1~5점입니다.');
 if(dataset==='adMetrics'&&v.attributionDays!==undefined&&![1,14].includes(n(v.attributionDays)))throw new OperationsError('광고 전환기준은 1일 또는 14일입니다.');
 if(dataset==='skus'&&v.priceHistory!==undefined){if(!Array.isArray(v.priceHistory))throw new OperationsError('가격 이력 형식을 확인해주세요.');for(const p of v.priceHistory as Values[]){if(!p||!isoDate(p.date)||['supplyPrice','salePrice','costPrice'].some(k=>p[k]!==undefined&&(!Number.isFinite(Number(p[k]))||Math.abs(Number(p[k]))>1e12)))throw new OperationsError('가격 이력의 날짜·금액을 확인해주세요.');}}
 if(dataset==='openingBalances'&&(!Number.isInteger(n(v.year))||n(v.year)<2000||n(v.year)>2200))throw new OperationsError('기초재고 연도는 2000~2200년입니다.');
 if(dataset==='purchaseLines'&&(v.setQty!==undefined&&n(v.setQty)<=0||n(v.qty)===0))throw new OperationsError('구매수량은 0이 아니어야 하며 세트구성은 양수여야 합니다.');
 if((dataset==='importBatches'||dataset==='purchaseLines')&&v.fx!==undefined&&v.fx!==''&&v.fx!==null&&n(v.fx)<0)throw new OperationsError('환율은 음수가 될 수 없습니다.');
 if(dataset==='purchaseOrders'&&(amt(v,'qty')<=0||amt(v,'receivedQty')<0||amt(v,'receivedQty')>amt(v,'qty')))throw new OperationsError('주문수량은 양수이며 누적입고는 0~주문수량이어야 합니다.');
 if(dataset==='campaignSkus'&&v.weight!==undefined&&(n(v.weight)<0||n(v.weight)>1))throw new OperationsError('캠페인 배분비율은 0~1입니다.');
 if(dataset==='sales'&&v.type==='rocket'&&Math.abs(amt(v,'qty')*amt(v,'supply'))>1e12)throw new OperationsError('행 매출금액이 한도를 넘었습니다.');
 if(dataset==='purchaseLines'&&Math.abs(amt(v,'qty')*amt(v,'unitPrice','unit'))>1e12)throw new OperationsError('행 구매금액이 한도를 넘었습니다.');
 if(dataset==='inventoryLines'&&v.stock!==null&&v.stock!==undefined&&n(v.stock)<0)throw new OperationsError('관측 재고는 0 이상 또는 미수집 빈값입니다.');
 if(dataset==='expenseCategories'&&!['sga','income','other','tax'].includes(text(v.group)))throw new OperationsError('경비 대항목을 확인해주세요.');
 return v;
}
function validateReferences(d:OperationsDocument,dataset:Dataset,v:Values){
 const map:Record<string,Dataset>={skuId:'skus',batchId:'importBatches',snapshotId:'inventorySnapshots',campaignId:'campaigns',categoryId:'expenseCategories',candidateId:'sourcingCandidates',parentId:'expenseCategories'};
 for(const [key,target]of Object.entries(map))if(v[key]&&!d.records[target].some(r=>r.id===v[key]))throw new OperationsError(`${key}: 연결된 자료가 없습니다. 먼저 기준 자료를 저장해주세요.`);
 if(dataset==='expenseCategories'&&v.parentId&&d.records.expenseCategories.find(r=>r.id===v.parentId)?.values.group!==v.group)throw new OperationsError('상위 경비항목의 대분류와 같아야 합니다.');
}
function periods(d:OperationsDocument,dataset:Dataset,v:Values):string[]{
 if(dataset==='openingBalances')return Array.from({length:12},(_,i)=>text(v.year)+'-'+String(i+1).padStart(2,'0'));
 if(dataset==='purchaseLines'){const b=d.records.importBatches.find(r=>r.id===v.batchId);return b?periods(d,'importBatches',b.values):[];}
 if(dataset==='inventoryLines'){const b=d.records.inventorySnapshots.find(r=>r.id===v.snapshotId);return b?periods(d,'inventorySnapshots',b.values):[];}
 const direct=dataset==='inventorySnapshots'?first(v,'businessDate','date'):dataset==='salesDeductions'?first(v,'month'):dataset==='skus'?first(v,'effectiveDate'):first(v,'date','month','businessDate','effectiveDate');if(direct)return[month(direct)];
 return[];
}
function assertUnlocked(d:OperationsDocument,dataset:Dataset,...values:(Values|undefined)[]){
 const locked=new Set(d.records.periodClosures.filter(r=>r.values.status!=='open').map(r=>text(r.values.month)));
 for(const v of values)if(v)for(const p of periods(d,dataset,v))if(locked.has(p))throw new OperationsError(`${p}은 마감된 월입니다. 마감 취소 후 수정해주세요.`,409,'OPERATIONS_PERIOD_CLOSED');
}
function identity(dataset:Dataset,v:Values):string[]{
 const keys:Partial<Record<Dataset,string[]>>={skus:['supplierSkuId'],watchTargets:['keyword'],discoveries:['watchId','productId','optionId'],keywords:['seed','keyword'],reviews:['productId','reviewId'],sourcingCandidates:['offerId'],comparisons:['candidateId','productId','optionId'],inventorySnapshots:['businessDate','capturedAt'],inventoryLines:['snapshotId','skuId'],inboundEvents:['poNumber','skuId','date','time','qty'],sales:['externalId','date','skuId','type'],adMetrics:['date','campaignId','skuId','keyword','placement','attributionDays'],campaignSkus:['campaignId','skuId'],openingBalances:['year','skuId'],expenses:['approvalNo'],statementApprovals:['poNumber']};
 const fields=keys[dataset];if(!fields)return[];if(dataset==='inboundEvents'&&!v.poNumber||dataset==='sales'&&!v.externalId||dataset==='reviews'&&!v.reviewId||dataset==='expenses'&&!v.approvalNo||dataset==='skus'&&!v.supplierSkuId||dataset==='sourcingCandidates'&&!v.offerId)return[];
 return fields.some(k=>v[k]!==undefined&&v[k]!=='')?fields.map(k=>text(v[k]).trim()):[];
}
export function applyOperationsCommand(input:OperationsDocument,command:OperationsCommand,now=nowDefault()):OperationsDocument{
 const d=clone(parseOperationsDocument(input));
 if(!command||typeof command!=='object'||Array.isArray(command))throw new OperationsError('작업 내용을 확인해주세요.');
 const at=now,id=()=>crypto.randomUUID();
 const upsert=(dataset:Dataset,raw:Values,requestedId?:string)=>{
  const values=normalize(dataset,raw);validateReferences(d,dataset,values);
  if(dataset==='keywords'&&!values.expiresAt){const collected=first(values,'collectedAt')||at,timestamp=Date.parse(collected);if(!Number.isFinite(timestamp))throw new OperationsError('키워드 수집시각을 확인해주세요.');values.expiresAt=new Date(timestamp+7*86400000).toISOString();}
  if(dataset==='purchaseLines'){
   const batch=d.records.importBatches.find(r=>r.id===values.batchId)?.values??{},converted=(amt(values,'unitPrice','unit')*amt(values,'qty')+amt(values,'agentFee','agent')+amt(values,'localShipping','cnship'))*(amt(values,'fx')||amt(batch,'fx'));
   if(!Number.isFinite(converted)||Math.abs(converted)>1e12)throw new OperationsError('환율이 적용된 행 구매금액이 한도를 넘었습니다.');
  }
  const ids=identity(dataset,values),existing=d.records[dataset].find(r=>requestedId?r.id===requestedId:ids.length&&JSON.stringify(identity(dataset,r.values))===JSON.stringify(ids));
  if(dataset==='expenseCategories'&&values.parentId){let parent=text(values.parentId);const visited=new Set<string>();while(parent){if(parent===requestedId||visited.has(parent))throw new OperationsError('경비 항목의 상위 연결이 순환할 수 없습니다.');visited.add(parent);parent=text(d.records.expenseCategories.find(r=>r.id===parent)?.values.parentId);}}
  if(dataset==='skus'&&values.supplierSkuId&&d.records.skus.some(r=>r.id!==existing?.id&&r.values.supplierSkuId===values.supplierSkuId))throw new OperationsError('같은 공급사 SKU ID가 이미 있습니다. 기존 SKU에 연결해주세요.',409);
  if(requestedId&&!safeId(requestedId))throw new OperationsError('행 식별번호가 올바르지 않습니다.');
  assertUnlocked(d,dataset,...(dataset==='skus'?[values]:[existing?.values,values]));
  if(dataset==='skus'&&existing&&Array.isArray(values.priceHistory)&&JSON.stringify(values.priceHistory)!==JSON.stringify(existing.values.priceHistory??[])){
   const before=new Map((Array.isArray(existing.values.priceHistory)?existing.values.priceHistory as Values[]:[]).map(p=>[text(p.date),JSON.stringify(p)])),after=new Map((values.priceHistory as Values[]).map(p=>[text(p.date),JSON.stringify(p)]));
   for(const date of new Set([...before.keys(),...after.keys()]))if(before.get(date)!==after.get(date))assertUnlocked(d,'skus',{effectiveDate:date});
  }
  if(dataset==='expenses'&&existing&&!requestedId&&values.approvalNo){
   const key=(v:Values)=>JSON.stringify([v.approvalNo,v.date,v.vendor,n(v.supply),n(v.vat),n(v.total)]);
   if(key(existing.values)!==key(values))throw new OperationsError('같은 승인번호의 경비 금액·거래처가 다릅니다. 기존 행을 열어 확인해주세요.',409,'OPERATIONS_DUPLICATE_CONFLICT');
   return existing;
  }
  if(dataset==='expenses'&&values.status==='confirmed'&&!values.categoryId)throw new OperationsError('확정할 경비의 항목을 지정해주세요.');
  if(dataset==='jobs'&&['succeeded','completed'].includes(text(values.status))&&(!values.resultVerified||!values.completedAt))throw new OperationsError('실제 수집 결과가 확인되지 않은 작업을 완료 처리할 수 없습니다.');
  if(dataset==='campaignSkus'){
   const weights=d.records.campaignSkus.filter(r=>r.id!==existing?.id&&r.values.skuId===values.skuId).reduce((sum,r)=>sum+(r.values.weight===undefined?1:n(r.values.weight)),0)+(values.weight===undefined?1:n(values.weight));
   if(weights>1.000001)throw new OperationsError('같은 SKU의 전체 캠페인 배분비율 합계는 1 이하이어야 합니다.');
  }
  if(existing){
   if(dataset==='skus'&&['supplyPrice','salePrice','costPrice'].some(k=>own(values,k)&&n(values[k])!==n(existing.values[k]))){
    const effective=first(values,'effectiveDate')||businessDate(at);assertUnlocked(d,'skus',{effectiveDate:effective});
    const history=Array.isArray(existing.values.priceHistory)?clone(existing.values.priceHistory) as Values[]:[];
    if(!history.length)history.push({date:existing.createdAt.slice(0,10),supplyPrice:n(existing.values.supplyPrice),salePrice:n(existing.values.salePrice),costPrice:n(existing.values.costPrice)});
    const changed={date:effective,supplyPrice:own(values,'supplyPrice')?n(values.supplyPrice):n(existing.values.supplyPrice),salePrice:own(values,'salePrice')?n(values.salePrice):n(existing.values.salePrice),costPrice:own(values,'costPrice')?n(values.costPrice):n(existing.values.costPrice)};
    const idx=history.findIndex(x=>x.date===effective);if(idx<0)history.push(changed);else history[idx]=changed;values.priceHistory=history.sort((a,b)=>text(a.date).localeCompare(text(b.date)));
   }
   existing.values={...existing.values,...values};existing.updatedAt=at;return existing;
  }
  const added=row(requestedId??id(),values,at);d.records[dataset].push(added);return added;
 };
 switch(command.type){
  case'upsert':case'import':{
   if(!DATASETS.includes(command.dataset as Dataset))throw new OperationsError('지원하지 않는 자료 종류입니다.');
   const ds=command.dataset as Dataset;if(['periodClosures'].includes(ds))throw new OperationsError('마감 작업 버튼을 사용해주세요.');
   if(command.type==='upsert'){if(!command.values)throw new OperationsError('저장할 값을 입력해주세요.');upsert(ds,command.values,command.id);}
   else {if(!Array.isArray(command.rows)||command.rows.length<1||command.rows.length>IMPORT_LIMIT)throw new OperationsError('한 번에 1~5000행을 가져올 수 있습니다.');for(const values of command.rows){if(!values||typeof values!=='object'||Array.isArray(values))throw new OperationsError('가져올 행의 형식을 확인해주세요.');upsert(ds,values,typeof values.id==='string'?values.id:undefined);}}
   break;
  }
  case'remove':{
   const ds=command.dataset;if(!ds||!DATASETS.includes(ds)||ds==='periodClosures')throw new OperationsError('삭제할 자료 종류를 확인해주세요.');
   const ids=new Set(command.ids??(command.id?[command.id]:[]));if(!ids.size)throw new OperationsError('삭제할 행을 선택해주세요.');
   for(const r of d.records[ds].filter(x=>ids.has(x.id))){assertUnlocked(d,ds,r.values);for(const key of DATASETS)for(const ref of d.records[key])if(!(key===ds&&ids.has(ref.id))&&Object.entries(ref.values).some(([k,v])=>k.endsWith('Id')&&v===r.id))throw new OperationsError('다른 자료에서 사용 중인 행입니다. 연결을 먼저 해제해주세요.',409);}
   d.records[ds]=d.records[ds].filter(r=>!ids.has(r.id));break;
  }
  case'promote-candidate':{
   const c=d.records.sourcingCandidates.find(r=>r.id===command.id);if(!c)throw new OperationsError('후보를 찾을 수 없습니다.');
   const seed=Object.fromEntries(Object.entries({name:c.values.koName||c.values.name,sourceUrl:c.values.url||c.values.sourceUrl,offerId:c.values.offerId,sourceProductId:c.values.sourceProductId,...command.values}).filter(([,value])=>value!==undefined));
   const sku=upsert('skus',seed,idFrom(['candidate',c.id]));c.values={...c.values,status:'registered',skuId:sku.id};c.updatedAt=at;break;
  }
  case'confirm-expenses':{
   const ids=new Set(command.ids??[]);if(!ids.size)throw new OperationsError('확정할 경비를 선택해주세요.');
   for(const expense of d.records.expenses.filter(r=>ids.has(r.id))){if(expense.values.status==='excluded')continue;if(!expense.values.categoryId)throw new OperationsError('모든 선택 경비의 항목을 먼저 지정해주세요.');assertUnlocked(d,'expenses',expense.values);expense.values.status='confirmed';expense.updatedAt=at;}break;
  }
  case'close-period':case'reopen-period':{
   if(!validMonth(command.month))throw new OperationsError('마감할 월을 선택해주세요.');const id=idFrom(['close',command.month]),existing=d.records.periodClosures.find(r=>r.id===id);const values={month:command.month,status:command.type==='close-period'?'closed':'open',changedAt:at};if(existing){existing.values=values;existing.updatedAt=at;}else d.records.periodClosures.push(row(id,values,at));break;
  }
  case'receive-order':{
   const p=d.records.purchaseOrders.find(r=>r.id===command.id);if(!p)throw new OperationsError('입고할 구매주문을 찾을 수 없습니다.');
   const receiptId=typeof command.values?.receiptId==='string'?idFrom(['receipt',p.id,command.values.receiptId]):idFrom(['receipt',p.id,id()]);if(d.records.inboundEvents.some(r=>r.id===receiptId))break;
   const ordered=amt(p.values,'qty','orderQty'),received=amt(p.values,'receivedQty'),qty=amt(command.values??{},'qty','receivedQty')||ordered-received;
   if(qty<=0||qty>ordered-received)throw new OperationsError('입고수량은 아직 입고되지 않은 주문수량 이하여야 합니다.');
   const values={...command.values,skuId:p.values.skuId,date:first(command.values??{},'date','receivedDate')||businessDate(at),qty,poNumber:p.id,kind:'purchase-receipt'};
   assertUnlocked(d,'purchaseOrders',p.values,values);upsert('inboundEvents',values,receiptId);p.values.receivedQty=received+qty;p.values.status=received+qty===ordered?'received':'partial';p.values.receivedDate=values.date;p.updatedAt=at;break;
  }
  case'queue-job':{
   if(!command.kind||command.kind.length>100)throw new OperationsError('수집 작업 종류를 확인해주세요.');const active=d.records.jobs.some(r=>r.values.kind===command.kind&&['queued','running'].includes(text(r.values.status))&&JSON.stringify(r.values.params)===JSON.stringify(command.values??{}));if(active)throw new OperationsError('같은 조건의 작업이 대기 또는 실행 중입니다.',409);
   if(command.kind==='statementConfirm'&&(command.values?.confirmed!==true||!Array.isArray(command.values?.purchaseOrderSeqs)||command.values.purchaseOrderSeqs.length<1||command.values.purchaseOrderSeqs.length>1000))throw new OperationsError('승인할 거래명세서를 선택하고 승인 실행에 동의해주세요.');
   upsert('jobs',{kind:command.kind,status:'queued',params:command.values??{},queuedAt:at,source:command.source??'operations'});break;
  }
  case'cancel-job':{const j=d.records.jobs.find(r=>r.id===command.id);if(!j)throw new OperationsError('작업을 찾을 수 없습니다.');if(['completed','succeeded'].includes(text(j.values.status)))throw new OperationsError('완료된 작업은 취소할 수 없습니다.');j.values.status='cancelled';j.updatedAt=at;break;}
  case'sync-products':{if(!Array.isArray(command.rows))throw new OperationsError('서버에서 읽은 SKU 자료가 필요합니다.');for(const v of command.rows){const existing=v.supplierSkuId?d.records.skus.find(r=>r.values.supplierSkuId===v.supplierSkuId):null;upsert('skus',v,existing?.id??(typeof v.id==='string'?v.id:undefined));}break;}
  case'ingest-collection':{
   const payload=command.values??{},job=RJob(d,text(payload.jobId));if(!job)throw new OperationsError('수집 작업을 찾을 수 없습니다.');
   if(job.values.resultVerified&&job.values.ingestedAt)break;
   if(job.values.status==='cancelled')throw new OperationsError('취소한 수집 작업입니다. 결과를 검토한 뒤 새 작업으로 가져오세요.',409);
   if(payload.kind!==job.values.kind)throw new OperationsError('수집 결과의 작업 종류가 다릅니다.');
   const status=text(payload.resultStatus);if(!['succeeded','partial','failed','unknown'].includes(status))throw new OperationsError('수집 결과 상태를 확인해주세요.');
   const datasets=payload.datasets;if(!datasets||typeof datasets!=='object'||Array.isArray(datasets))throw new OperationsError('수집 결과 형식을 확인해주세요.');
   const allowed:Record<string,Dataset[]>={keywordSearch:['discoveries'],discovery:['discoveries'],relatedKeywords:['keywords'],reviews:['reviews'],coupangCompare:['comparisons'],statements:['statementApprovals'],statementConfirm:['statementApprovals'],inventory:['inventorySnapshots','inventoryLines'],inbound:['inboundEvents'],rocketSales:['sales'],adMetrics:['adMetrics']};
   if(!allowed[text(payload.kind)])throw new OperationsError('지원하지 않는 수집 작업 종류입니다.');
   const entries=Object.entries(datasets as Record<string,unknown>);let count=0;
   for(const [key,rows]of entries){if(!allowed[text(payload.kind)].includes(key as Dataset)||!Array.isArray(rows))throw new OperationsError('수집 결과의 자료 종류를 확인해주세요.');count+=rows.length;}
   if(count>IMPORT_LIMIT)throw new OperationsError('한 수집 결과는 5000행까지 반영할 수 있습니다.',413);
   if(['failed','unknown'].includes(status)&&count)throw new OperationsError('실패 또는 결과 불명인 수집은 확정 자료로 반영할 수 없습니다.');
   const order:Dataset[]=['skus','watchTargets','sourcingCandidates','importBatches','inventorySnapshots','campaigns','expenseCategories',...DATASETS.filter(k=>!['skus','watchTargets','sourcingCandidates','importBatches','inventorySnapshots','campaigns','expenseCategories','jobs','periodClosures'].includes(k))];
   const counts:Values={};for(const dataset of order){const rows=(datasets as Record<string,unknown>)[dataset];if(!Array.isArray(rows))continue;counts[dataset]=rows.length;for(const values of rows){if(!values||typeof values!=='object'||Array.isArray(values))throw new OperationsError('수집 결과의 행 형식을 확인해주세요.');upsert(dataset,values as Values,typeof values.id==='string'?values.id:undefined);}}
   job.values={...job.values,status,resultVerified:status==='succeeded'||status==='partial',ingestedAt:at,finishedAt:at,completedAt:at,resultCounts:counts,warnings:safeValue(Array.isArray(payload.warnings)?payload.warnings.slice(0,30):[]),rejectedRows:safeValue(Array.isArray(payload.rejectedRows)?payload.rejectedRows.slice(0,200):[]),error:text(payload.error).slice(0,4000)};job.updatedAt=at;break;
  }
  default:throw new OperationsError('지원하지 않는 작업입니다.');
 }
 // Expiry applies only to transient keyword rows, never accounting ledgers.
 d.records.keywords=d.records.keywords.filter(r=>!r.values.expiresAt||Date.parse(text(r.values.expiresAt))>=Date.parse(at));
 parseOperationsDocument(d);return d;
}
function RJob(d:OperationsDocument,id:string){return d.records.jobs.find(r=>r.id===id);}

function allocate(bases:number[],pool:number):number[]{
 pool=Math.round(pool);const sum=bases.reduce((a,b)=>a+Math.max(0,b),0);if(sum<=0||!pool)return bases.map(()=>0);
 const raw=bases.map(b=>pool*Math.max(0,b)/sum),out=raw.map(Math.floor),order=raw.map((x,i)=>({i,frac:x-Math.floor(x)})).sort((a,b)=>b.frac-a.frac||a.i-b.i);
 let left=pool-out.reduce((a,b)=>a+b,0);for(let k=0;left>0;k++,left--)out[order[k%order.length].i]++;return out;
}
const round=(x:number)=>Math.round((x+Number.EPSILON)*1000000)/1000000;
const ratio=(a:number,b:number)=>b?a/b*100:0;
export function deriveOperations(d:OperationsDocument,year:number):DerivedViews{
 if(!Number.isInteger(year)||year<2000||year>2200)throw new OperationsError('조회 연도를 확인해주세요.');
 const R=d.records,flat=(ds:Dataset)=>R[ds].map(r=>({id:r.id,...r.values})),name=(id:unknown)=>text(R.skus.find(s=>s.id===id)?.values.name)||text(id),months=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
 // Attribution windows describe one spend observation. Preserve both raw reports;
 // financial aggregates prefer the 14-day row, then 1-day, then unspecified.
 const adObservations=new Map<string,OpsRecord>();
 const attributionRank=(r:OpsRecord)=>n(r.values.attributionDays)===14?2:n(r.values.attributionDays)===1?1:0;
 for(const metric of R.adMetrics){const key=JSON.stringify(['date','campaignId','skuId','placement','keyword'].map(k=>text(metric.values[k]))),previous=adObservations.get(key);if(!previous||attributionRank(metric)>attributionRank(previous)||attributionRank(metric)===attributionRank(previous)&&metric.updatedAt>previous.updatedAt)adObservations.set(key,metric);}
 const ads=[...adObservations.values()];
 const costs:Values[]=[];
 for(const batch of R.importBatches){const lines=R.purchaseLines.filter(r=>r.values.batchId===batch.id),b=batch.values;
  const buy=lines.map(r=>{const v=r.values;return Math.round((amt(v,'unitPrice','unit','cnyPrice')*amt(v,'qty')+amt(v,'agentFee','agent')+amt(v,'localShipping','cnship'))*(amt(v,'fx')||amt(b,'fx')));});
  const cn=allocate(buy,amt(b,'cnCost')),kr=allocate(buy,amt(b,'krCost')),ins=allocate(lines.map((r,i)=>truth(r.values.inspection)||truth(r.values.insp)?buy[i]:0),amt(b,'inspectionCost','inspCost'));
  const any=lines.some(r=>truth(r.values.extra)),extra=allocate(lines.map((r,i)=>!any||truth(r.values.extra)?buy[i]:0),amt(b,'extraCost'));
  const wanted=Math.round(amt(b,'cnCost'))+Math.round(amt(b,'krCost'))+Math.round(amt(b,'inspectionCost','inspCost'))+Math.round(amt(b,'extraCost')),allocated=[...cn,...kr,...ins,...extra].reduce((a,z)=>a+z,0),unallocatedCost=wanted-allocated;
  lines.forEach((r,i)=>{const v=r.values,qty=amt(v,'qty'),setQty=amt(v,'setQty')||1,sets=qty/setQty,total=buy[i]+cn[i]+kr[i]+ins[i]+extra[i];costs.push({id:r.id,batchId:batch.id,date:b.date,month:month(b.date),skuId:v.skuId,name:name(v.skuId),qty,setQty,sets,buyKRW:buy[i],cnCost:cn[i],krCost:kr[i],inspectionCost:ins[i],extraCost:extra[i],total,unitCost:sets?Math.round(total/sets):0,allocationMissing:unallocatedCost!==0,unallocatedCost});});
 }
 const sales=R.sales.filter(r=>!['cancelled','scheduled','취소','예정'].includes(text(r.values.status)));
 const supply=(v:Values)=>v.type==='rocket'?own(v,'amount')?n(v.amount):amt(v,'qty')*amt(v,'supply','supplyPrice'):own(v,'supply')?n(v.supply):Math.round(amt(v,'price','total')/1.1);
 const ledger:Values[]=[];
 const purchaseTotals=new Map<string,{qty:number;amount:number}>(),saleTotals=new Map<string,{qty:number;subsidiary:number}>();
 for(const c of costs){const key=`${c.skuId}:${c.month}`,v=purchaseTotals.get(key)??{qty:0,amount:0};v.qty+=n(c.sets);v.amount+=n(c.total);purchaseTotals.set(key,v);}
 for(const s of sales){if(s.values.type==='other')continue;const key=`${s.values.skuId}:${month(s.values.date)}`,v=saleTotals.get(key)??{qty:0,subsidiary:0};v.qty+=amt(s.values,'qty');if(s.values.type==='subsidiary')v.subsidiary+=amt(s.values,'qty');saleTotals.set(key,v);}
 for(const sku of R.skus){
  let q=0,a=0;const opening=R.openingBalances.filter(r=>r.values.skuId===sku.id).sort((x,y)=>n(x.values.year)-n(y.values.year));const oldest=opening.length?Math.min(year,n(opening[0].values.year)):Math.min(year,...costs.filter(r=>r.skuId===sku.id).map(r=>Number(text(r.date).slice(0,4))).filter(Boolean),...sales.filter(r=>r.values.skuId===sku.id).map(r=>Number(text(r.values.date).slice(0,4))).filter(Boolean));
  for(let y=oldest;y<=year;y++){
   const op=opening.find(r=>n(r.values.year)===y);if(op){q=amt(op.values,'qty','openingQty');a=amt(op.values,'amount','openingAmount');}
   for(let mi=1;mi<=12;mi++){const m=`${y}-${String(mi).padStart(2,'0')}`,p=purchaseTotals.get(`${sku.id}:${m}`),s=saleTotals.get(`${sku.id}:${m}`),bq=p?.qty??0,ba=p?.amount??0,oq=s?.qty??0,sq=s?.subsidiary??0,available=q+bq,amount=a+ba,avg=available?amount/available:0,eq=round(available-oq),issue=eq===0?amount:oq*avg,ea=amount-issue,excluded=oq?Math.min(1,Math.max(0,sq/oq)):0;
    if(y===year)ledger.push({id:`${sku.id}:${m}`,skuId:sku.id,name:name(sku.id),month:m,openingQty:q,openingAmount:a,buyQty:bq,buyAmount:ba,issueQty:oq,subsidiaryQty:sq,averageCost:avg,issueAmount:issue,endingQty:eq,endingAmount:ea,cogs:issue*(1-excluded),negative:eq<0});q=eq;a=ea;
   }
  }
 }
 const inventory:Values[]=[],snapshots=R.inventorySnapshots.filter(r=>r.values.complete!==false).sort((a,b)=>first(a.values,'businessDate','date').localeCompare(first(b.values,'businessDate','date'))||a.createdAt.localeCompare(b.createdAt));
 const latest=snapshots[snapshots.length-1];for(const s of R.skus){const l=latest&&R.inventoryLines.find(r=>r.values.snapshotId===latest.id&&r.values.skuId===s.id);inventory.push({id:s.id,skuId:s.id,name:name(s.id),barcode:s.values.barcode,optionId:s.values.optionId,date:latest?.values.businessDate??null,stock:l&&l.values.stock!==null&&l.values.stock!==undefined?n(l.values.stock):null,price:amt(s.values,'salePrice'),quality:l?'observed':'missing'});}
 const byDay=new Map<string,Map<string,number|null>>();for(const snap of snapshots){const date=first(snap.values,'businessDate','date');if(!isoDate(date))continue;byDay.set(date,new Map(R.inventoryLines.filter(l=>l.values.snapshotId===snap.id).map(l=>[text(l.values.skuId),l.values.stock===null||l.values.stock===undefined?null:n(l.values.stock)])));}
 const days=new Set([...byDay.keys(),...R.inboundEvents.map(r=>first(r.values,'date')), ...ads.map(r=>first(r.values,'date'))]);
 const daily:Values[]=[],margins:Values[]=[];
 for(const date of [...days].filter(x=>x.startsWith(String(year))&&isoDate(x)).sort()){
  const prev=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10),today=byDay.get(date),yesterday=byDay.get(prev);
  const relevant=new Set([...(today?.keys()??[]),...(yesterday?.keys()??[]),...R.inboundEvents.filter(r=>r.values.date===date).map(r=>text(r.values.skuId)),...ads.filter(r=>r.values.date===date).map(r=>text(r.values.skuId))]);
  for(const sku of R.skus.filter(r=>relevant.has(r.id))){const curr=today?.get(sku.id),before=yesterday?.get(sku.id),ib=R.inboundEvents.filter(r=>r.values.skuId===sku.id&&r.values.date===date&&r.values.kind!=='purchase-receipt').reduce((z,r)=>z+(['outbound','return-out','반출'].includes(text(r.values.kind))?-Math.abs(amt(r.values,'qty')):amt(r.values,'qty')),0),estimated=curr==null||before==null?null:before-curr+ib;
   const h=Array.isArray(sku.values.priceHistory)?(sku.values.priceHistory as Values[]).filter(v=>text(v.date)<=date).sort((a,b)=>text(a.date).localeCompare(text(b.date))).pop():null,p={...sku.values,...h};
   const ad=ads.filter(r=>r.values.skuId===sku.id&&r.values.date===date),adcost=ad.reduce((z,r)=>z+amt(r.values,'cost'),0),unitMargin=amt(p,'supplyPrice')-amt(p,'costPrice'),margin=estimated===null?null:estimated*unitMargin-adcost;
   daily.push({id:`${sku.id}:${date}`,date,skuId:sku.id,name:name(sku.id),previousStock:before??null,stock:curr??null,inbound:ib,estimatedSales:estimated,adCost:adcost,unitMargin,netMargin:margin,quality:estimated===null?'missing':'estimated'});
  }
 }
 const campaignSummaries:Values[]=[];
 for(const c of R.campaigns){const metrics=ads.filter(r=>r.values.campaignId===c.id&&text(r.values.date).startsWith(String(year))),sum=(k:string)=>metrics.reduce((z,r)=>z+amt(r.values,k),0),cost=sum('cost'),revenue=sum('revenue'),clicks=sum('clicks'),impressions=sum('impressions'),orders=sum('orders'),units=sum('units');campaignSummaries.push({id:c.id,name:c.values.name,cost,revenue,clicks,impressions,orders,units,roas:ratio(revenue,cost),ctr:ratio(clicks,impressions),cvr:ratio(orders,clicks),cpc:clicks?cost/clicks:0,attributionPolicy:'14-day-preferred'});
  const links=R.campaignSkus.filter(r=>r.values.campaignId===c.id);for(const date of [...new Set(metrics.map(r=>text(r.values.date)))] ){
   const cm=metrics.filter(r=>r.values.date===date),cost=cm.reduce((a,r)=>a+amt(r.values,'cost'),0),skuDaily=daily.filter(r=>r.date===date&&links.some(l=>l.values.skuId===r.skuId)),weight=(r:Values)=>{const link=links.find(l=>l.values.skuId===r.skuId);return link?.values.weight===undefined?1:n(link.values.weight);},unknown=!skuDaily.length||skuDaily.some(r=>r.estimatedSales===null),gross=skuDaily.reduce((a,r)=>a+n(r.estimatedSales)*n(r.unitMargin)*weight(r),0);margins.push({id:`${c.id}:${date}`,campaignId:c.id,name:c.values.name,date,estimatedSales:unknown?null:skuDaily.reduce((a,r)=>a+n(r.estimatedSales)*weight(r),0),adCost:cost,grossMargin:unknown?null:gross,netMargin:unknown?null:gross-cost-amt(c.values,'otherCost'),quality:unknown?'missing':'estimated'});
  }
 }
 const categoryGroup=(id:unknown)=>text(R.expenseCategories.find(r=>r.id===id)?.values.group)||'sga';
 const expense=R.expenses.filter(r=>r.values.status==='confirmed'),expenseAmount=(v:Values)=>truth(v.novat)?amt(v,'total'):amt(v,'supply');
 const detail:Values[]=[];for(const cat of R.expenseCategories)for(const m of months){const amount=expense.filter(r=>r.values.categoryId===cat.id&&month(r.values.date)===m).reduce((a,r)=>a+expenseAmount(r.values),0);detail.push({id:`${cat.id}:${m}`,categoryId:cat.id,name:cat.values.name,group:cat.values.group,month:m,amount});}
 const pnl:Values[]=months.map(m=>{const ss=sales.filter(r=>month(r.values.date)===m),rocket=ss.filter(r=>r.values.type==='rocket').reduce((z,r)=>z+supply(r.values),0),general=ss.filter(r=>r.values.type==='general').reduce((z,r)=>z+supply(r.values),0),other=ss.filter(r=>r.values.type==='other').reduce((z,r)=>z+supply(r.values),0),subsidiary=ss.filter(r=>r.values.type==='subsidiary').reduce((z,r)=>z+supply(r.values),0),deductions=R.salesDeductions.filter(r=>r.values.month===m).reduce((z,r)=>z+amt(r.values,'amount'),0),revenue=rocket+general+other-deductions,cogs=Math.round(ledger.filter(r=>r.month===m).reduce((z,r)=>z+n(r.cogs),0)),eg=(g:string)=>expense.filter(r=>month(r.values.date)===m&&categoryGroup(r.values.categoryId)===g).reduce((z,r)=>z+expenseAmount(r.values),0),sga=eg('sga'),nonOperatingIncome=eg('income'),nonOperatingExpense=eg('other'),tax=eg('tax'),grossProfit=revenue-cogs,operatingProfit=grossProfit-sga,ordinaryProfit=operatingProfit+nonOperatingIncome-nonOperatingExpense;return{id:m,month:m,rocket,general,other,subsidiaryExcluded:subsidiary,deductions,revenue,cogs,grossProfit,sga,operatingProfit,nonOperatingIncome,nonOperatingExpense,ordinaryProfit,tax,netProfit:ordinaryProfit-tax,costRatio:ratio(cogs,revenue),operatingMargin:ratio(operatingProfit,revenue)};});
 const reviews:Values[]=[];for(const productId of [...new Set(R.reviews.map(r=>text(r.values.productId)))]){const items=R.reviews.filter(r=>r.values.productId===productId),positive=items.filter(r=>n(r.values.rating)>=4).length,negative=items.filter(r=>n(r.values.rating)<=2).length;reviews.push({id:productId,productId,count:items.length,average:items.reduce((a,r)=>a+n(r.values.rating),0)/items.length,positiveRate:ratio(positive,items.length),negativeRate:ratio(negative,items.length),rating1:items.filter(r=>n(r.values.rating)===1).length,rating2:items.filter(r=>n(r.values.rating)===2).length,rating3:items.filter(r=>n(r.values.rating)===3).length,rating4:items.filter(r=>n(r.values.rating)===4).length,rating5:items.filter(r=>n(r.values.rating)===5).length});}
 const keywordSummary=R.discoveries.map(r=>({id:r.id,...r.values,estimatedRevenue:amt(r.values,'sales28')>0&&amt(r.values,'price')>0?amt(r.values,'sales28')*amt(r.values,'price'):null}));
 const discoverySummary=R.watchTargets.map(r=>({id:r.id,...r.values,count:R.discoveries.filter(x=>x.values.watchId===r.id||x.values.keyword===r.values.keyword).length,newCount:R.discoveries.filter(x=>(x.values.watchId===r.id||x.values.keyword===r.values.keyword)&&x.values.status==='new').length}));
 const duplicateExpenses=R.expenses.map(r=>{const key=[text(r.values.date),text(r.values.vendor).trim().toLowerCase(),Math.round(amt(r.values,'total'))].join('|');return{id:r.id,...r.values,duplicateSuspected:R.expenses.some(x=>x.id!==r.id&&[text(x.values.date),text(x.values.vendor).trim().toLowerCase(),Math.round(amt(x.values,'total'))].join('|')===key)};});
 const procurementCosts=costs.map(v=>({...v,buyAmount:v.buyKRW,allocatedChina:v.cnCost,allocatedDomestic:v.krCost,allocatedInspection:v.inspectionCost,allocatedExtra:v.extraCost,saleQty:v.sets,totalCost:v.total}));
 const monthlyLedger=ledger.map(v=>({...v,closingQty:v.endingQty,closingAmount:v.endingAmount,unitCost:v.averageCost}));
 return{procurementCosts,monthlyLedger,inventoryRows:inventory,salesDaily:daily,campaignSummaries,dailyMargins:margins,pnl,costDetails:detail,reviewSummary:reviews,keywordSummary,discoverySummary,expenseRows:duplicateExpenses,salesRows:sales.map(r=>({id:r.id,...r.values,name:name(r.values.skuId),netSupply:supply(r.values)})),skuRows:flat('skus')};
}
