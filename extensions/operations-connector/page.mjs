/** Executed in an isolated world of one already-open, selected origin.
 * No cookie/token inspection, navigation, tab creation, arbitrary URL fetch, or external writes. */
export async function collectOperationsPage(request){
 const {kind,values={},companyCode='',startDate,endDate}=request;
 const began=Date.now(),warnings=[],maxRows=5000,maxPages=Math.min(Math.max(Number(values.maxPages)||40,1),200);
 const allowed={consumer:'https://www.coupang.com',hub:'https://supplier.coupang.com',ads:'https://advertising.coupang.com',wing:'https://wing.coupang.com'};
 const expected=['inventory','adMetrics'].includes(kind)?allowed.ads:['inbound','rocketSales','statements','statementPrepare'].includes(kind)?allowed.hub:kind==='wingEnrich'?allowed.wing:allowed.consumer;
 if(location.origin!==expected)throw Error('현재 수집 탭의 주소가 요청 대상과 다릅니다.');
 const text=value=>String(value??'').replace(/\s+/g,' ').trim();
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const normalizeNumber=value=>{const s=text(value).replace(/[ ,₩원%]/g,'');return /^-?(?:\d+\.?\d*|\.\d+)$/.test(s)?Number(s):null;};
 const http=async(path,options={})=>{
  if(Date.now()-began>115000)throw Error('수집 시간 한도에 도달했습니다. 기간을 줄여 다시 수집해주세요.');
  const url=new URL(path,location.origin);if(url.origin!==expected)throw Error('수집 대상 출처가 바뀌었습니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch(url.href,{method:'GET',...options,credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal});
   if([401,403].includes(response.status))throw Error('대상 사이트의 로그인·접근 권한을 확인해주세요.');
   if(response.status===429)throw Error('대상 사이트가 조회를 제한했습니다. 잠시 뒤 다시 수집해주세요.');
   if(!response.ok)throw Error(`수집 응답 오류 (${response.status})`);
   const reader=response.body?.getReader();if(!reader)throw Error('수집 응답 본문이 없습니다.');
   const decoder=new TextDecoder();let size=0,result='';
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>3500000){await reader.cancel();throw Error('단일 수집 응답 한도를 초과했습니다.');}result+=decoder.decode(part.value,{stream:true});}
   result+=decoder.decode();return result;
  }finally{clearTimeout(timer);}
 };
 const json=async(path,body)=>{const result=await http(path,body?{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify(body)}:{headers:{accept:'application/json'}});try{return JSON.parse(result);}catch{throw Error('대상 사이트가 데이터 대신 로그인·보안 확인 화면을 응답했습니다. 해당 탭에서 직접 확인해주세요.');}};
 const verifyCompany=async()=>{
  const payload=expected===allowed.ads?await json('/marketing/cmg-api/advertiser'):await json('/vendor/');
  const value=expected===allowed.ads?payload?.advertiser:payload;
  const found=String(value?.vendorId??value?.vendorCode??value?.sellerCode??'').trim();
  if(!/^A\d{6,12}$/.test(found)||found!==companyCode)throw Error(found?'회원 회사와 로그인된 쿠팡 회사가 다릅니다.':'쿠팡 계정의 회사코드를 확인하지 못했습니다. 수집을 중단합니다.');
  return found;
 };
 const financial=[allowed.hub,allowed.ads].includes(expected);
 if(financial)await verifyCompany();
 let payload={status:'succeeded',warnings};
 const docOf=source=>{if(/Access Denied|captcha-container|robot-check|비정상적인 접근/i.test(source))throw Error('대상 사이트가 보안 확인을 요구합니다. 확인 화면을 직접 처리해주세요.');return new DOMParser().parseFromString(source,'text/html');};
 const tableOf=(doc,required)=>{
  const canon=s=>text(s).replace(/[\s_()]/g,'').toLowerCase();let best=null,bestScore=0;
  for(const table of doc.querySelectorAll('table')){
   const head=table.querySelector('thead tr')??table.querySelector('tr');if(!head)continue;
   const headers=[...head.querySelectorAll('th,td')].map(cell=>text(cell.textContent));
   const score=required.filter(key=>headers.some(header=>canon(header).includes(canon(key)))).length;
   if(score>bestScore){bestScore=score;best={table,head,headers};}
  }
  if(!best||bestScore<Math.min(4,required.length))throw Error('업무 표의 필수 열을 확인하지 못했습니다. 원본 Excel 파일로 가져와 주세요.');
  const rows=[...best.table.querySelectorAll('tr')].filter(row=>row!==best.head&&!row.closest('thead')).map(row=>[...row.querySelectorAll('td')].map(cell=>text(cell.textContent))).filter(row=>row.length>=best.headers.length-1&&row.some(Boolean));
  return {headers:best.headers,rows};
 };
 const query=text(values.keyword??values.query??values.seed??values.name);
 try{
  if(['keywordSearch','discovery','coupangCompare','relatedKeywords'].includes(kind)){
   if(!query||query.length>80)throw Error('1~80자의 검색어를 입력해주세요.');
   const doc=docOf(await http('/np/search?component=&q='+encodeURIComponent(query)+'&channel=user'));
   if(kind==='relatedKeywords'){
    const unique=new Map();for(const a of doc.querySelectorAll('a[href]')){let url;try{url=new URL(a.getAttribute('href'),allowed.consumer);}catch{continue;}const keyword=text(url.searchParams.get('q'));if(url.origin===allowed.consumer&&url.pathname==='/np/search'&&keyword&&keyword!==query&&keyword.length<=80)unique.set(keyword,{seed:query,keyword,collectedAt:new Date().toISOString().slice(0,10)});if(unique.size>=30)break;}
    payload.rows=[...unique.values()];if(!payload.rows.length&&!/연관검색어|연관 검색어|검색 결과가 없습니다/.test(doc.body.textContent??''))throw Error('연관검색어 구역을 읽지 못했습니다.');
   }else{
    const unique=new Map();let rank=0;
    for(const a of doc.querySelectorAll('a[href*="/vp/products/"]')){
     let url;try{url=new URL(a.getAttribute('href'),allowed.consumer);}catch{continue;}const productId=url.pathname.match(/^\/vp\/products\/(\d+)/)?.[1];if(!productId||url.origin!==allowed.consumer)continue;
     const card=a.closest('li,[data-product-id],article')??a,advertised=Boolean(card.querySelector('[class*="sponsored"],[class*="ad-badge"]'))||[...card.querySelectorAll('span')].some(el=>text(el.textContent)==='광고');if(advertised)continue;
     const optionId=url.searchParams.get('vendorItemId')??'',key=productId+':'+optionId;if(unique.has(key))continue;
     const image=card.querySelector('img'),name=text(card.querySelector('[class*="name"],[class*="Name"]')?.textContent)||text(image?.getAttribute('alt'))||text(a.textContent);if(name.length<2)continue;
     const priceElement=card.querySelector('.price-value,strong[class*="price"],[class*="Price_price"]');const price=normalizeNumber(priceElement?.textContent);
     const reviewText=text(card.querySelector('[class*="rating-total-count"],[class*="ratingCount"]')?.textContent),reviews=normalizeNumber(reviewText.replace(/[()]/g,''));
     const imageUrl=image?.getAttribute('src')??image?.getAttribute('data-img-src')??'';const delivery=[...card.querySelectorAll('img[alt]')].map(el=>el.getAttribute('alt')).find(alt=>/로켓|Rocket/i.test(alt??''))??'';
     unique.set(key,{productId,optionId,name:name.slice(0,500),url:allowed.consumer+url.pathname+(optionId?'?vendorItemId='+encodeURIComponent(optionId):''),image:/^https?:\/\//.test(imageUrl)?imageUrl:'',price,reviews,delivery,rank:++rank,keyword:query,observedAt:new Date().toISOString(),verified:false,source:'coupang-search'});if(unique.size>=60)break;
    }
    payload.rows=[...unique.values()];if(!payload.rows.length&&!/검색결과가 없습니다|검색 결과가 없습니다|찾는 상품이 없습니다/.test(doc.body.textContent??''))throw Error('검색 상품 구조를 읽지 못했습니다. 결과 0건으로 저장하지 않았습니다.');
   }
  }else if(kind==='wingEnrich'){
   if(!query||query.length>80)throw Error('조회할 검색어가 없습니다.');
   const data=await json('/tenants/seller-web/pre-matching/search',{keyword:query,excludedProductIds:[],searchPage:0,searchOrder:'DEFAULT',sortType:'DEFAULT'});
   if(!Array.isArray(data?.result))throw Error('WING 수요 지표 응답을 해석하지 못했습니다.');
   payload.rows=data.result.slice(0,200).map(row=>({productId:String(row.productId??''),optionId:String(row.vendorItemId??''),sales28:normalizeNumber(row.salesLast28d),views:normalizeNumber(row.pvLast28Day),itemCount:normalizeNumber(row.itemCountOfProduct),demandScope:'source-defined'}));
  }else if(kind==='reviews'){
   const raw=text(values.productId??values.url),productId=/^\d+$/.test(raw)?raw:raw.match(/^https:\/\/www\.coupang\.com\/vp\/products\/(\d+)(?:[/?#]|$)/)?.[1];if(!productId)throw Error('쿠팡 상품 URL 또는 상품 ID를 입력해주세요.');
   const rows=[],seen=new Set();let finished=false;
   for(let page=1;page<=Math.min(maxPages,200);page++){
    const doc=docOf(await http(`/vp/product/reviews?productId=${productId}&page=${page}&size=30&sortBy=DATE_DESC&ratingSummary=true&ratings=&market=`));
    const articles=[...doc.querySelectorAll('article.sdp-review__article__list,.sdp-review__article__list[data-review-id],[data-review-id]')];
    if(!articles.length){if(rows.length||/등록된 상품평이 없|상품평이 없습니다|리뷰가 없습니다/.test(doc.body.textContent??'')){finished=true;break;}throw Error('리뷰 구조를 읽지 못했습니다.');}
    let added=0;
    for(const article of articles){const star=article.querySelector('[data-rating]'),rating=normalizeNumber(star?.getAttribute('data-rating')??article.getAttribute('data-rating')),body=text(article.querySelector('.sdp-review__article__list__review__content,[class*="review__content"]')?.textContent),title=text(article.querySelector('.sdp-review__article__list__headline')?.textContent),date=text(article.querySelector('.sdp-review__article__list__info__product-info__reg-date')?.textContent).replaceAll('.','-'),option=text(article.querySelector('.sdp-review__article__list__info__product-info__name')?.textContent);if(rating===null||rating<1||rating>5){warnings.push('별점을 읽지 못한 리뷰가 있어 제외했습니다.');continue;}const externalId=article.getAttribute('data-review-id')??article.getAttribute('id')??`${date}|${title}|${body}`;if(seen.has(externalId))continue;seen.add(externalId);rows.push({externalId,productId,rating,date,option,title,body:body.slice(0,20000),helpful:normalizeNumber(article.querySelector('[class*="help__count"]')?.textContent)??0});added++;}
    payload.rows=rows;if(rows.length>=maxRows){warnings.push('5,000건 한도에 도달했습니다.');payload.status='partial';break;}if(!added||articles.length<30){finished=true;break;}await sleep(200);
   }
   if(!finished){payload.status='partial';warnings.push('페이지·시간 한도 내에서 읽은 리뷰만 분석합니다.');}if(warnings.length&&payload.status==='succeeded')payload.status='partial';
  }else if(kind==='inventory'){
   const items=[],seen=new Set();let finished=false;
   for(let page=0;page<Math.min(maxPages,40);page++){
    const data=await json(`/marketing/cmg-api/vendoritems?page=${page}&size=100&searchBy=all&isColdStartItem=false`);if(!Array.isArray(data?.products))throw Error('광고센터 상품 응답의 products를 확인하지 못했습니다. 광고 만들기의 상품 선택 화면을 열거나 원본 파일을 가져와 주세요.');
    for(const item of data.products){const rawId=item.vendoritemid??item.vendorItemId??'';if(typeof rawId==='number'&&!Number.isSafeInteger(rawId))throw Error('옵션 ID의 숫자 정밀도를 확인하지 못했습니다. 텍스트 ID 파일을 사용해주세요.');const id=String(rawId);if(!id||seen.has(id))continue;seen.add(id);items.push({vendoritemid:id,itemnm:String(item.itemnm??item.itemNm??''),stockQuantity:item.stockQuantity??null,sales_price:item.sales_price??item.salesPrice??null,productType:String(item.productType??''),productId:item.productId??'',skuId:item.skuId??''});}
    payload.items=items;if(!data.products.length||data.products.length<100||Number.isFinite(Number(data.total))&&items.length>=Number(data.total)){finished=true;break;}if(items.length>=maxRows)break;await sleep(200);
   }
   if(!finished){payload.status='partial';warnings.push('재고 조회 한도에 도달해 전체 수집으로 처리하지 않습니다.');}
   const now=new Date();payload.snapshot={date:now.toISOString(),businessDate:text(values.businessDate)||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(now.getTime()-86400000)),complete:finished};
  }else if(kind==='inbound'){
   const rows=[],seen=new Set();let headers=null,pageSize=0,finished=false;
   for(let page=1;page<=Math.min(maxPages,40);page++){
    const doc=docOf(await http(`/scm/receive/detail?requestSeq=&vendorPaymentInfoSeq=&startDate=${startDate}&endDate=${endDate}&page=${page}`));const table=tableOf(doc,['구분','번호','SKU','입고','수량','공급가액']);
    if(!headers)headers=table.headers;else if(JSON.stringify(headers)!==JSON.stringify(table.headers))throw Error('조회 중 입고 표의 열이 바뀌었습니다.');
    if(!pageSize)pageSize=table.rows.length;let added=0;for(const row of table.rows){const key=JSON.stringify(row);if(!seen.has(key)){seen.add(key);rows.push(row);added++;}}
    payload.headers=headers;payload.cells=rows;if(!table.rows.length||!added||table.rows.length<pageSize){finished=true;break;}if(rows.length>=maxRows)break;await sleep(200);
   }
   if(!finished){payload.status='partial';warnings.push('입고 조회 페이지·행 한도에 도달했습니다.');}
  }else if(kind==='rocketSales'){
   const rows=[],seen=new Set();let headers=null,after='',finished=false;
   if(Date.parse(endDate)-Date.parse(startDate)>30*86400000)throw Error('발주 SKU는 한 번에 31일 이내로 조회해주세요.');
   const selected=[['purchaseOrderSeq','발주번호'],['purchaseOrderStatus','발주현황'],['skuId','SKU ID'],['skuName','SKU 이름'],['skuBarcode','SKU Barcode'],['expectedDeliveryDate','입고예정일'],['createdAt','발주일'],['receivedQuantity','입고수량'],['unitPrice','공급가'],['centerName','물류센터']].map(([id,name])=>({id,name}));
   for(let page=1;page<=Math.min(maxPages,40);page++){
    const body=new URLSearchParams({page:String(page),size:'1000',searchDateType:values.dateType==='WAREHOUSING_PLAN_DATE'?'WAREHOUSING_PLAN_DATE':'PURCHASE_ORDER_DATE',searchStartDate:startDate,searchEndDate:endDate,purchaseOrderSeq:'',centerCode:'',skuSeq:'',purchaseOrderStatus:'',purchaseOrderType:'',selected:JSON.stringify(selected),after});
    const source=await http('/scm/purchase/order/sku/list-download',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded; charset=UTF-8',accept:'application/json','X-Requested-With':'XMLHttpRequest'},body:String(body)});let data;try{data=JSON.parse(source);}catch{throw Error('발주 SKU 응답이 JSON이 아닙니다.');}
    if(!String(data?.header??'').trim())throw Error('발주 SKU 응답에 머리글이 없습니다. 요청 조건을 바꾸지 않고 원본 파일 가져오기로 진행해주세요.');
    if(!headers)headers=String(data.header);else if(headers!==String(data.header))throw Error('조회 중 발주 SKU 열이 바뀌었습니다.');
    const part=String(data.data??'');if(!part.trim()){finished=true;break;}if(seen.has(part)){finished=true;break;}seen.add(part);rows.push(part);payload.headerText=headers;payload.dataTexts=rows;after=String(data.after??'');if(!after){finished=true;break;}await sleep(200);
   }
   payload.headerText=headers??'';payload.dataTexts=rows;if(!finished){payload.status='partial';warnings.push('발주 SKU 페이지 한도에 도달했습니다.');}
  }else if(kind==='statements'||kind==='statementPrepare'){
   const items=[],seen=new Set();let finished=false;
   for(let page=1;page<=Math.min(maxPages,40);page++){
    const query=new URLSearchParams({page:String(page),searchDateType:values.dateType==='WAREHOUSING_PLAN_DATE'?'WAREHOUSING_PLAN_DATE':'PURCHASE_ORDER_DATE',searchStartDate:startDate,searchEndDate:endDate,centerCode:'',purchaseOrderIdArray:'',vendorPaymentInfoSeq:'',purchaseOrderStatus:'RI',purchaseOrderType:'',skuIdArray:'',crossdock:'',transportType:''});
    const data=await json('/po-web/app/purchase-order/list?'+query);const candidates=Array.isArray(data?.body?.body)?data.body.body:Array.isArray(data?.body)?data.body:null;if(!candidates)throw Error('거래명세서 발주 목록 구조를 확인하지 못했습니다.');let added=0;
    for(const row of candidates){const seq=String(row.purchaseOrderSeq??'');if(row.purchaseOrderStatus!=='RI'||!seq||seen.has(seq))continue;seen.add(seq);if(kind==='statementPrepare'&&!values.purchaseOrderSeqs?.includes(seq))continue;items.push({purchaseOrderSeq:seq,createdAt:row.createdAt,expectedDeliveryDate:row.expectedDeliveryDate,firstSkuName:row.firstSkuName,skuCount:row.skuCount,receivedAmount:row.receivedAmount,orderedAmount:row.orderedAmount,centerName:row.centerName,vendorPaymentInfoSeq:row.vendorPaymentInfoSeq});added++;}payload.items=items;if(kind==='statementPrepare'&&items.length===values.purchaseOrderSeqs.length){finished=true;break;}if(!candidates.length||kind==='statements'&&!added){finished=true;break;}if(items.length>=maxRows)break;await sleep(200);
   }
   if(!finished){payload.status='partial';warnings.push('명세서 조회 한도에 도달했습니다.');}
  }else if(kind==='adMetrics'){
   if(values.attributionDays!=null&&Number(values.attributionDays)!==14)throw Error('직접 연결은 현재 14일 귀속 지표를 지원합니다. 1일 귀속은 원본 보고서로 가져와 주세요.');
   if(Date.parse(endDate)-Date.parse(startDate)>30*86400000)throw Error('광고 성과는 한 번에 31일 이내로 조회해주세요.');
   let ids=Array.isArray(values.campaignIds)?values.campaignIds.map(String).filter(id=>/^\d+$/.test(id)):[];
   if(!ids.length){const data=await json('/marketing/tetris-api/campaigns/campaign-active-status');const walk=(node,depth=0)=>{if(!node||typeof node!=='object'||depth>8)return;if(Array.isArray(node)){node.slice(0,500).forEach(item=>walk(item,depth+1));return;}if(/^\d+$/.test(String(node.campaignId??'')))ids.push(String(node.campaignId));for(const[key,value]of Object.entries(node))if(['activePa','inactivePa','activeBpa','inactiveBpa','campaigns','data','result'].includes(key))walk(value,depth+1);};walk(data);}
   ids=[...new Set(ids)].slice(0,100);if(!ids.length)throw Error('캠페인 ID를 확인하지 못했습니다. YOOFAM 캠페인 설정에 광고센터 ID를 입력하거나 원본 광고보고서를 가져와 주세요.');
   if(ids.some(id=>!Number.isSafeInteger(Number(id))||String(Number(id))!==id))throw Error('숫자형 광고 API에 전달할 캠페인 ID의 정밀도를 확인하지 못했습니다. 원본 보고서로 가져와 주세요.');
   const metrics=[];for(let time=Date.parse(startDate);time<=Date.parse(endDate);time+=86400000){const day=new Date(time).toISOString().slice(0,10);for(let offset=0;offset<ids.length;offset+=10){const part=ids.slice(offset,offset+10);const result=await json('/marketing/cmg-api/tableMetric',{campaignIds:part.map(Number),creativeId:null,start:day,end:day,tableType:'campaign_sales',targetList:part.map(Number),isMatchTypeEnabled:false});
    for(const id of part){const value=result?.[id]??result?.data?.[id];if(!value||typeof value!=='object')throw Error('광고 캠페인의 일별 응답을 확인하지 못했습니다.');metrics.push({campaignId:id,date:day,metrics:value});}payload.metrics=metrics;await sleep(250);}}
  }else throw Error('이 버전에서 지원하지 않는 수집입니다.');
 }catch(error){if((payload.rows?.length??payload.items?.length??payload.cells?.length??payload.metrics?.length??payload.dataTexts?.length??0)>0){payload.status='partial';warnings.push(error instanceof Error?error.message:'일부 자료만 읽었습니다.');}else throw error;}
 if(financial)await verifyCompany();
 if(location.origin!==expected)throw Error('수집 중 탭의 출처가 바뀌었습니다.');
 if(financial)payload.companyCode=companyCode;
 return payload;
}

/** Called only after a one-time extension-owned approval window accepts a trusted click. */
export async function confirmStatementPage(request){
 const {companyCode,purchaseOrderSeq,startDate,endDate}=request,origin='https://supplier.coupang.com';let dispatched=false;
 if(location.origin!==origin||!/^A\d{6,12}$/.test(companyCode)||!/^\d{1,24}$/.test(purchaseOrderSeq))throw Error('승인 대상과 회사코드를 확인해주세요.');
 const http=async(path,method='GET')=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const response=await fetch(origin+path,{method,credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});if(!response.ok)throw Error(`승인 응답 오류 (${response.status})`);const source=await response.text();if(source.length>2000000)throw Error('승인 응답 크기를 초과했습니다.');return JSON.parse(source);}finally{clearTimeout(timer);}};
 const verify=async()=>{if(location.origin!==origin)throw Error('승인 탭의 주소가 바뀌었습니다.');const company=await http('/vendor/'),actual=String(company?.vendorId??company?.vendorCode??company?.sellerCode??'').trim();if(actual!==companyCode)throw Error('현재 Supplier Hub 회사가 승인 요청과 다르거나 확인되지 않습니다.');};
 try{
  await verify();
  const params=new URLSearchParams({page:'1',searchDateType:'PURCHASE_ORDER_DATE',searchStartDate:startDate,searchEndDate:endDate,centerCode:'',purchaseOrderIdArray:purchaseOrderSeq,vendorPaymentInfoSeq:'',purchaseOrderStatus:'RI',purchaseOrderType:'',skuIdArray:'',crossdock:'',transportType:''});
  const list=await http('/po-web/app/purchase-order/list?'+params),rows=Array.isArray(list?.body?.body)?list.body.body:Array.isArray(list?.body)?list.body:null;
  if(!rows||!rows.some(row=>(typeof row.purchaseOrderSeq==='string'||Number.isSafeInteger(row.purchaseOrderSeq))&&String(row.purchaseOrderSeq)===purchaseOrderSeq&&row.purchaseOrderStatus==='RI'))throw Error('선택한 발주가 현재 승인 대기 RI 상태인지 재확인하지 못했습니다.');
  await verify();dispatched=true;
  const response=await http('/scm/purchase/order/confirmInvoice?purchaseOrderSeq='+encodeURIComponent(purchaseOrderSeq),'POST');
  await verify();
  if(response?.success===true||response?.result==='SUCCESS'||response?.code===0)return {purchaseOrderSeq,status:'succeeded',approvedAt:new Date().toISOString(),companyCode};
  if(response?.success===false||response?.result==='FAILURE')return {purchaseOrderSeq,status:'failed',error:'Supplier Hub가 승인을 거절했습니다.',companyCode};
  return {purchaseOrderSeq,status:'unknown',error:'승인 응답의 성공 여부를 확인하지 못했습니다. 자동 재시도하지 않습니다.',companyCode};
 }catch(error){return {purchaseOrderSeq,status:dispatched?'unknown':'failed',error:error instanceof Error?error.message:'승인 응답을 확인하지 못했습니다.',companyCode};}
}
