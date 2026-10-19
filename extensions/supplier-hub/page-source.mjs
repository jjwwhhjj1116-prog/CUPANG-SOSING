// Independent, inert interpretation of the current product document. No vendor
// code, requests, cookies, globals, eval or executable script injection.
export const PAGE_SOURCE_LIMIT=512*1024;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const plain=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';
const price=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1e8?value:typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())?price(Number(value)):null;
const integer=value=>Number.isSafeInteger(Number(value))&&Number(value)>=1?Number(value):null;
export function pageSourceUrl(value){
 const url=new URL(value);
 const match=url.pathname.match(/^\/offer\/([1-9]\d{0,29})\.html$/);
 if(url.protocol!=='https:'||url.hostname!=='detail.1688.com'||url.port||url.username||url.password||!match)throw Error('1688 상품 본문에서 수집해주세요.');
 return {sourceUrl:`https://detail.1688.com/offer/${match[1]}.html`,offerId:match[1]};
}
function image(value){
 try{const url=new URL(String(value).startsWith('//')?'https:'+value:value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&(url.hostname==='alicdn.com'||url.hostname.endsWith('.alicdn.com'))&&url.href.length<=2048?url.href:null;}catch{return null;}
}
/** Read a JSON value after an exact quoted property; never evaluate scripts. */
export function pageJsonProperty(text,key){
 const pattern=new RegExp('"'+key+'"\\s*:', 'g');
 while(pattern.exec(text)!==null){
  let start=pattern.lastIndex;while(/\s/.test(text[start]??'')&&start<text.length)start++;
  if(!['{','[','"'].includes(text[start]))continue;
  let quoted=false,escaped=false,depth=0;
  for(let end=start;end<text.length&&end-start<=2*1024*1024;end++){
   const char=text[end];
   if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"'){quoted=false;if(end>start&&depth===0){try{return JSON.parse(text.slice(start,end+1));}catch{break;}}}}
   else if(char==='"')quoted=true;
   else if(char==='{'||char==='[')depth++;
   else if(char==='}'||char===']'){if(--depth===0){try{return JSON.parse(text.slice(start,end+1));}catch{break;}}}
  }
 }
 return undefined;
}
export function extractPageSource(input,now=Date.now()){
 const identity=pageSourceUrl(input.sourceUrl),scripts=Array.isArray(input.scripts)?input.scripts:[];
 if(scripts.length>100||scripts.some(value=>typeof value!=='string')||scripts.reduce((sum,value)=>sum+value.length,0)>4*1024*1024)throw Error('상품 본문이 수집 크기를 초과했습니다.');
 const property=key=>scripts.map(text=>pageJsonProperty(text,key)).find(value=>value!==undefined);
 const models=scripts.map(text=>pageJsonProperty(text,'skuModel')).filter(object);
 if(new Set(models.map(value=>JSON.stringify(value))).size>1)throw Error('상품 옵션 원문이 여러 개입니다. 현재 상품 본문을 다시 확인해주세요.');
 const sm=models[0];
 if(sm&&(sm.offerId!==undefined||sm.productId!==undefined)&&String(sm.offerId??sm.productId)!==identity.offerId)throw Error('옵션 원문의 상품 번호가 현재 URL과 다릅니다.');
 const title=plain(input.title||['subject','subjectTrans','offerTitle','offerSubject','productTitle','productName'].map(property).find(value=>typeof value==='string'&&value.trim()),500);
 if(!title)throw Error('상품명이 보이는 상품 본문에서 다시 수집해주세요.');
 const images=[],addImage=(value,role)=>{const url=image(value);if(url&&!images.some(item=>item.url===url&&item.role===role)&&images.length<200)images.push({url,role});};
 for(const key of ['offerImgList','mainImageList']){
  const list=property(key);if(Array.isArray(list))for(const item of list)addImage(typeof item==='string'?item:item?.originalImageURI??item?.imageURI??item?.imageUrl??item?.url,images.some(item=>item.role==='main')?'additional':'main');
 }
 if(!images.length&&Array.isArray(input.gallery))for(const url of input.gallery)addImage(url,images.length?'additional':'main');
 const details=Array.isArray(input.detailImages)?input.detailImages:[];
 for(const url of details)addImage(url,'detail');
 const valueImages=new Map();
 if(object(sm)&&Array.isArray(sm.skuProps))for(const prop of sm.skuProps)for(const value of Array.isArray(prop.value)?prop.value:[]){const url=image(value.imageUrl??value.image??value.picUrl??value.imageURI);if(url)valueImages.set(plain(value.name,500),url);}
 const currency=/(?:CNY|人民币|[¥￥])/.test(plain(input.priceText,2000))?'CNY':null;
 const order=plain(input.minimumOrderText,1000).match(/(?:^|\s)(\d+)\s*(?:件|顶|个|双|套)?\s*起批/u);
 const minimumOrder=object(sm)?integer(sm.beginAmount??sm.minOrderQuantity)??(order?integer(order[1]):null):order?integer(order[1]):null;
 const map=object(sm)?sm.skuInfoMap??sm.skuInfoMapOriginal:null;
 const options=[];
 if(object(map)&&Object.keys(map).length>200)throw Error('옵션이 200개를 초과했습니다. 원문을 일부만 담지 않았습니다.');
 if(object(map))for(const [key,row] of Object.entries(map)){
  if(!object(row)||options.length>=200)continue;
  const rawSku=row.skuId??row.specId;
  const name=plain(row.specAttrs??row.name??key,500),supplierSku=plain(typeof rawSku==='number'&&Number.isSafeInteger(rawSku)?String(rawSku):rawSku,200)||null;
  const unitPriceCny=price(row.discountPrice??row.price??row.skuPrice??row.consignPrice);
  const imageUrl=image(row.imageUrl??row.image)??valueImages.get(name)??[...valueImages].find(([label])=>name.split(/[;，,>|]/).some(part=>part.trim()===label))?.[1]??null;
  if(imageUrl)addImage(imageUrl,'additional');
  options.push({key:plain(key,200),name,supplierSku,unitPriceCny,currency,minimumOrder,stock:Number.isSafeInteger(row.stock)&&row.stock>=0?row.stock:null,imageUrl});
 }
 return validatePageSource({format:'yoofam-page-source-v1',...identity,collectedAt:new Date(now).toISOString(),title,description:plain(input.description,20000),options,images,attributes:[]},now);
}
export function validatePageSource(input,now=Date.now()){
 const keys=['format','sourceUrl','offerId','collectedAt','title','description','options','images','attributes'];
 if(!object(input)||Object.keys(input).some(key=>!keys.includes(key))||input.format!=='yoofam-page-source-v1'||JSON.stringify(input).length>PAGE_SOURCE_LIMIT)throw Error('상품 수집 내용의 형식·크기를 확인해주세요.');
 const identity=pageSourceUrl(input.sourceUrl);
 if(input.sourceUrl!==identity.sourceUrl||input.offerId!==identity.offerId||typeof input.collectedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(input.collectedAt)||!Number.isFinite(Date.parse(input.collectedAt))||Date.parse(input.collectedAt)>now+60000||!plain(input.title,500)||input.title!==plain(input.title,500)||typeof input.description!=='string'||input.description.length>20000)throw Error('상품 번호·상품명·수집 시각을 확인해주세요.');
 if(!Array.isArray(input.options)||input.options.length>200||!Array.isArray(input.images)||!input.images.length||input.images.length>200||!Array.isArray(input.attributes)||input.attributes.length>50)throw Error('현재 상품의 옵션·이미지를 확인해주세요.');
 const seen=new Set();
 for(const row of input.options){
  if(!object(row)||Object.keys(row).some(key=>!['key','name','supplierSku','unitPriceCny','currency','minimumOrder','stock','imageUrl'].includes(key))||!plain(row.key,200)||row.key!==plain(row.key,200)||seen.has(row.key)||!plain(row.name,500)||row.name!==plain(row.name,500)
   ||row.supplierSku!==null&&(!plain(row.supplierSku,200)||row.supplierSku!==plain(row.supplierSku,200))||row.unitPriceCny!==null&&price(row.unitPriceCny)!==row.unitPriceCny||row.currency!==null&&row.currency!=='CNY'||row.minimumOrder!==null&&integer(row.minimumOrder)!==row.minimumOrder||row.stock!==null&&(!Number.isSafeInteger(row.stock)||row.stock<0)||row.imageUrl!==null&&image(row.imageUrl)!==row.imageUrl)throw Error('수집한 옵션 값이 올바르지 않습니다.');
  seen.add(row.key);
 }
 const placements=new Set();let mains=0;
 for(const row of input.images){if(!object(row)||Object.keys(row).some(key=>!['url','role'].includes(key))||image(row.url)!==row.url||!['main','additional','detail'].includes(row.role)||placements.has(row.role+row.url)||row.role==='main'&&++mains>1)throw Error('수집 이미지 주소·역할이 올바르지 않습니다.');placements.add(row.role+row.url);}
 for(const row of input.attributes)if(!object(row)||Object.keys(row).some(key=>!['name','value'].includes(key))||!plain(row.name,190)||row.name!==plain(row.name,190)||!plain(row.value,1000)||row.value!==plain(row.value,1000))throw Error('상품 속성을 확인해주세요.');
 return JSON.parse(JSON.stringify(input));
}
export function pageSourceIssues(source){
 const issues=[];if(!source.options.length)issues.push('옵션 원문');
 if(source.options.some(row=>!row.supplierSku))issues.push('공급자 SKU');
 if(new Set(source.options.filter(row=>row.supplierSku).map(row=>row.supplierSku)).size!==source.options.filter(row=>row.supplierSku).length)issues.push('중복 공급자 SKU');
 if(source.options.some(row=>row.unitPriceCny===null))issues.push('옵션 원가');
 if(source.options.some(row=>row.currency!=='CNY'))issues.push('위안(CNY) 통화');
 if(source.options.some(row=>row.minimumOrder===null))issues.push('최소 주문 수량');
 return issues;
}
