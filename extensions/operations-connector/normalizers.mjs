const string=value=>value==null?'':String(value).trim();
const identifier=value=>{if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('숫자 식별자의 정밀도를 확인하지 못했습니다. 원본 텍스트 ID가 필요합니다.');return string(value);};
export function readNumber(value){if(value==null||value==='')return null;const raw=typeof value==='object'?value.value??value.total??value.count:value;const text=String(raw).replace(/[\s,₩원%]/g,'');if(!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text))return null;const n=Number(text);return Number.isFinite(n)&&Math.abs(n)<=1e15?n:null;}
const pick=(object,keys)=>{for(const key of keys)if(object[key]!=null&&object[key]!=='')return object[key];return null;};
const scalar=(object,keys)=>readNumber(pick(object,keys));
const date=value=>{const match=string(value).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);return match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:'';};
export function normalizeInventoryItem(item){
 const optionId=identifier(pick(item,['vendoritemid','vendorItemId','vendoritemId','optionId']));if(!/^\d+$/.test(optionId))throw Error('광고 상품의 옵션 ID를 확인하지 못했습니다.');
 return {optionId,name:string(pick(item,['itemnm','itemNm','name'])),stock:scalar(item,['stockQuantity','stock']),price:scalar(item,['sales_price','salesPrice','price']),delivery:string(item.productType),productId:identifier(item.productId),externalSkuId:identifier(item.skuId),barcode:identifier(item.barcode),quality:'observed'};
}
const headerAliases={
 inbound:{type:['구분'],po:['번호','발주번호'],externalSkuId:['SKU번호','SKU ID','SKUID'],name:['SKU명','SKU 이름'],occurredAt:['입고/반출시각','입고반출시각','입고시각'],center:['물류센터'],qty:['수량'],unitPrice:['단가'],supply:['총공급가액','공급가액'],vat:['총세액','세액'],invoice:['계산서번호'],payday:['지급일']},
 rocketSales:{po:['발주번호'],status:['발주현황','발주상태'],externalSkuId:['SKU ID','SKUID','SKU번호'],name:['SKU 이름','SKU명'],barcode:['SKU Barcode','바코드'],expectedDate:['입고예정일'],orderedAt:['발주일'],qty:['입고수량'],supply:['공급가'],center:['물류센터']}
};
const canon=value=>string(value).replace(/[\s_()]/g,'').toLowerCase();
export function normalizeTabular(kind,headers,rows){
 const definitions=headerAliases[kind];if(!definitions)throw Error('지원하지 않는 표입니다.');
 const columns=Object.fromEntries(Object.entries(definitions).map(([key,aliases])=>[key,headers.findIndex(h=>aliases.some(alias=>canon(alias)===canon(h)))]));
 for(const key of kind==='inbound'?['externalSkuId','occurredAt','qty','po']:['externalSkuId','qty','supply','po'])if(columns[key]<0)throw Error(`원본 표에 ${key} 열이 없습니다. 원본 파일로 가져와 주세요.`);
 return rows.map((cells,index)=>{
  const out={};for(const[key,col]of Object.entries(columns))if(col>=0)out[key]=cells[col]??'';
  if(!out.externalSkuId&&!out.po)return null;
  out.externalSkuId=string(out.externalSkuId);out.po=string(out.po);out.qty=readNumber(out.qty);out.supply=readNumber(out.supply);if(out.qty===null)throw Error(`${index+1}행 수량이 올바르지 않습니다.`);
  if(kind==='inbound'){out.date=date(out.occurredAt);out.type=/반출|출고/.test(out.type)?'outbound':'inbound';if(!out.date)throw Error(`${index+1}행 입고일을 확인하지 못했습니다.`);out.vat=readNumber(out.vat);out.unitPrice=readNumber(out.unitPrice);}
  else{out.date=date(out.expectedDate)||date(out.orderedAt);out.type='rocket';out.status=/취소/.test(out.status)?'cancelled':out.qty!==0?'received':'scheduled';if(!out.date||out.supply===null)throw Error(`${index+1}행 매출 기준일 또는 공급단가를 확인하지 못했습니다.`);}
  out.source='supplier-hub';return out;
 }).filter(Boolean);
}
export function normalizeStatement(item){
 const seq=identifier(item.purchaseOrderSeq);if(!/^\d+$/.test(seq))throw Error('거래명세서 발주번호를 확인하지 못했습니다.');
 return {purchaseOrderSeq:seq,date:date(item.createdAt),expectedDate:date(item.expectedDeliveryDate),name:string(item.firstSkuName??item.skuName),qty:scalar(item,['receivedQuantity','qty','skuCount']),amount:scalar(item,['receivedAmount','amount','orderedAmount']),center:string(item.centerName),status:'requested',externalStatus:'RI',invoice:string(item.vendorPaymentInfoSeq)};
}
export function normalizeAdMetric(input,campaignId,businessDate){
 const number=(keys)=>scalar(input,keys);
 const cost=number(['adCost','cost','spend','advertisingCost']),revenue=number(['adSales','revenue','salesAmount','conversionSales']),clicks=number(['clicks','clickCount','clk']),impressions=number(['impressions','impressionCount','imp']);
 if(cost===null||revenue===null||clicks===null||impressions===null)throw Error('광고 지표 응답의 비용·매출·클릭·노출 필드를 확인하지 못했습니다. 원본 광고보고서를 가져와 주세요.');
 return {date:businessDate,externalCampaignId:string(campaignId),impressions,clicks,cost,revenue,orders:number(['orders','orderCount','adOrders']),units:number(['units','salesCount','adUnits']),attributionDays:14,source:'ad-center'};
}
export function parseCsv(text){
 if(typeof text!=='string'||text.length>3000000)throw Error('표 응답 크기를 확인해주세요.');let rows=[],row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=ch;}
 if(quoted)throw Error('표 응답의 따옴표가 닫히지 않았습니다.');row.push(cell);if(row.some(Boolean))rows.push(row);if(rows.length>5001)throw Error('표 응답 행 한도를 초과했습니다.');return rows;
}
