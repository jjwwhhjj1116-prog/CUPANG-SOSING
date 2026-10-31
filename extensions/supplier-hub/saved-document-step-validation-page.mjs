/** Executed only in the original request's reserved, empty Hub dashboard tab.
 * This submits a validation request, not a read-only request. Its only outbound
 * mutation-shaped operation is validate-step with {docId,version}; it never
 * loads a form, changes consent, saves a body/file, navigates or registers. */
export async function savedDocumentStepValidationPage(input){
 let sent=false;const controllers=new Set();
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
 const same=(a,b)=>canon(a)===canon(b),HASH=/^[a-f0-9]{64}$/;
 const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
 const fail=code=>{throw Object.assign(Error('SAVED_DOCUMENT_STEP_VALIDATION'),{savedStepCode:code});};
 let stage;
 try{
  if(typeof input==='string'){if(input.length>8*1024*1024)fail('response');input=JSON.parse(input);}
  if(!exact(input,['binding','target','docId','expectedBody','audit','stage'])||![2,3,4,5].includes(input.stage))fail('response');
  stage=input.stage;input=JSON.parse(canon(input));const {binding,target,docId,expectedBody:expected,audit}=input;
  if(!exact(binding,['identity','identityDigest','packetDigest','preparedBodySha256','originalBodySha256','nativeAssetSourcePlanSha256','sessionId','requestId'])
   ||!object(binding.identity)||!['identityDigest','packetDigest','preparedBodySha256','originalBodySha256','nativeAssetSourcePlanSha256'].every(key=>HASH.test(binding[key]||''))
   ||!/^\w[\w-]{0,99}$/.test(binding.requestId||'')||!/^\w[\w-]{0,99}$/.test(binding.sessionId||'')
   ||!exact(target,['tabId','windowId'])||!Number.isSafeInteger(target.tabId)||target.tabId<0||target.tabId===binding.identity.appTabId||target.windowId!==binding.identity.windowId
   ||!object(expected)||!same(docId,expected.docId)||!(Number.isSafeInteger(docId)&&docId>0||typeof docId==='string'&&/^[1-9]\d{0,29}$/.test(docId))
   ||expected.scope!=='Retail_Categorized_Single'||!Array.isArray(expected.jsonDocument)||!Array.isArray(binding.identity.members)||expected.jsonDocument.length!==binding.identity.members.length
   ||!(Number.isSafeInteger(expected.version)&&expected.version>=0||typeof expected.version==='string'&&/^\d{1,20}$/.test(expected.version))
   ||!exact(audit,['rawBodySha256','fileSetSha256','legalSetSha256','observedAt'])||!['rawBodySha256','fileSetSha256','legalSetSha256'].every(key=>HASH.test(audit[key]||''))
   ||!Number.isSafeInteger(audit.observedAt)||audit.observedAt<1||audit.observedAt>Date.now()+5000||Date.now()-audit.observedAt>300000)fail('source-changed');
  const prepared=JSON.parse(canon(expected));prepared.docId=null;
  const logicalIdentity=Object.fromEntries(Object.entries(binding.identity).filter(([key])=>!['appTabId','windowId'].includes(key)));
  if(await hash(binding.identity)!==binding.identityDigest||await hash(prepared)!==binding.preparedBodySha256||binding.nativeAssetSourcePlanSha256!==binding.identity.fingerprint
   ||await hash({identity:logicalIdentity,bodySha256:binding.preparedBodySha256,originalBodySha256:binding.originalBodySha256})!==binding.packetDigest)fail('source-changed');
  const origin='https://supplier.coupang.com',root=document.documentElement,recordSnapshot=root.dataset.yoofamSingleDocumentRecords??'{}',started=Date.now();
  const fence=()=>{
   const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
   if(document.documentElement!==root||location.origin!==origin||location.pathname!=='/dashboard/KR'||location.search||location.hash
    ||codes.length!==1||codes[0]!==binding.identity.company?.code||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company?.name
    ||(root.dataset.yoofamSingleDocumentRecords??'{}')!==recordSnapshot||Array.from(document.querySelectorAll('.rsc-text-input input')).some(node=>String(node.value||'').trim()))fail('source-changed');
   if(Date.now()-started>45000)fail('timeout');
  };
  const request=async(path,{validate=false,legal=false}={})=>{
   fence();const controller=new AbortController();controllers.add(controller);let timer;
   const remaining=Math.max(1,45000-(Date.now()-started));
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('SAVED_DOCUMENT_STEP_VALIDATION'),{savedStepCode:'timeout'}));},Math.min(validate?20000:10000,remaining));});
   const consume=async()=>{
    const url=origin+path,post=validate||legal;let response;
    if(validate)sent=true;
    try{response=await fetch(url,{method:post?'POST':'GET',credentials:'include',redirect:'manual',cache:'no-store',signal:controller.signal,
      headers:{accept:'application/json',...(post?{'content-type':'application/json;charset=UTF-8'}:{})},...(post?{body:validate?JSON.stringify({docId,version:expected.version}):'{}'}:{})});}
    catch{fail(controller.signal.aborted?'timeout':'network');}
    fence();if(controller.signal.aborted)fail('timeout');
    if(!response||response.redirected||response.type==='opaqueredirect'||response.status===0||response.status>=300&&response.status<400||response.url!==url)fail('http');
    if(!response.ok||response.status!==200)fail('http');
    if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))fail('response');
    const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>6*1024*1024))fail('response');
    let text;try{text=await response.text();}catch{fail(controller.signal.aborted?'timeout':'network');}
    fence();if(controller.signal.aborted)fail('timeout');if(new TextEncoder().encode(text).length>6*1024*1024)fail('response');
    try{return JSON.parse(text);}catch{fail('response');}
   };
   try{return await Promise.race([consume(),timeout]);}finally{clearTimeout(timer);controller.abort();controllers.delete(controller);}
  };
  const doc=encodeURIComponent(String(docId)),bodyKeys=['docId','productName','categoryPath','categoryId','displayCategoryCode','jsonDocument','scope','productNoticeNumber','version','remark'];
  const observation=async()=>{
   const body=await request('/sr/draft/api/get-by-id/'+doc);
   if(!object(body)||body.status!=='UNFINISHED'||bodyKeys.filter(key=>key!=='remark').some(key=>!Object.hasOwn(body,key))
    ||['docId','productName','categoryPath','categoryId','displayCategoryCode','scope','productNoticeNumber','version'].some(key=>!same(body[key],expected[key]))
    ||!Array.isArray(body.jsonDocument)||body.jsonDocument.length!==expected.jsonDocument.length)fail('source-changed');
   const bodyValue=Object.fromEntries(bodyKeys.filter(key=>Object.hasOwn(body,key)).map(key=>[key,body[key]]));
   const listed=await request('/sr/draft/api/get-images-by-id/'+doc);
   if(!Array.isArray(listed)||listed.length<1||listed.length>150)fail('source-changed');
   const names=new Set(),files=listed.map(row=>{
    if(!object(row)||!['imageName','imageUrl','s3Link','host'].every(key=>typeof row[key]==='string')||row.imageName.length>512||names.has(row.imageName)
     ||row.host!=='supplier.coupang.com'||row.mainImage!==undefined&&typeof row.mainImage!=='boolean')fail('source-changed');
    names.add(row.imageName);
    return {imageName:row.imageName,imageUrl:row.imageUrl,s3Link:row.s3Link,host:row.host,...(row.mainImage===undefined?{}:{mainImage:row.mainImage})};
   }).sort((a,b)=>a.imageName<b.imageName?-1:a.imageName>b.imageName?1:0);
   const legal=await request('/sr/draft/api/get-files-by-type/'+doc,{legal:true});
   if(!(Array.isArray(legal)&&legal.length<=2000||object(legal)&&Object.keys(legal).length===0))fail('source-changed');
   if(await hash(bodyValue)!==audit.rawBodySha256||await hash(files)!==audit.fileSetSha256||await hash(legal)!==audit.legalSetSha256)fail('source-changed');
   fence();
  };
  await observation();
  const response=await request('/sr/qvt/api/validate-step/'+stage,{validate:true});
  if(!object(response)||response.code!==200||!Array.isArray(response.data)||response.data.length<1||response.data.length>200||Object.keys(response.data).length!==response.data.length)fail('response');
  const errors=[];let rejected=false,total=0;
  const safeColumn=value=>typeof value==='string'&&value.length>0&&value.length<=160&&/^[\p{L}\p{N} _*().,·%+\-:［］\[\]]+$/u.test(value)
    &&!/(?:https?:|www\.|\.(?:png|jpe?g|pdf|gif|webp|xlsx?|csv|txt|zip)\b|password|cookie|authorization|access.?token|api.?key)/i.test(value)?value:'확인할 항목';
  const category=value=>/agree|consent|동의/i.test(value)?'consent':/required|missing|empty|필수|누락|비어|입력해/i.test(value)?'required':/price|msrp|osrp|가격|공급가|판매가/i.test(value)?'price':/image|이미지|사진/i.test(value)?'image':/file|파일|첨부|인증서/i.test(value)?'file':/invalid|유효|형식|잘못/i.test(value)?'invalid':'unclassified';
  for(const [rowIndex,row] of response.data.entries()){
   if(!object(row)||typeof row.success!=='boolean'||row.errors!==undefined&&(!Array.isArray(row.errors)||Object.keys(row.errors).length!==row.errors.length||row.success&&row.errors.length))fail('response');
   if(!row.success)rejected=true;
   for(const error of row.errors??[]){
    if(++total>200||!object(error)||typeof error.columnName!=='string'||error.columnName.length>500||typeof error.message!=='string'||error.message.length>2000)fail('response');
    if(errors.length<40)errors.push({rowIndex,columnName:safeColumn(error.columnName),category:category(error.columnName+' '+error.message)});
   }
  }
  await observation();
  return {stage,state:rejected?'rejected':'passed',responseRows:response.data.length,errors,errorCount:total,errorsTruncated:total>40,cached:false,requested:true,failureCode:null};
 }catch(error){
  const code=['timeout','network','http','response','source-changed','cancelled'].includes(error?.savedStepCode)?error.savedStepCode:'response';
  return {stage,state:'uncertain',responseRows:null,errors:[],errorCount:0,errorsTruncated:false,cached:false,requested:sent,failureCode:code};
 }finally{for(const controller of controllers)controller.abort();}
}
