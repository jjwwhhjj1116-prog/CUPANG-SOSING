export const HANDOFF_ORIGINS=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
export function validateHandoff(message,sender){
  let origin;try{origin=new URL(sender?.url).origin;}catch{throw Error('앱 출처를 확인하지 못했습니다.');}
  if(!Number.isSafeInteger(sender?.tab?.id)||sender.tab.id<0||!Number.isSafeInteger(sender.tab.windowId)||sender.tab.windowId<0||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin))throw Error('허용된 앱 탭에서만 전달할 수 있습니다.');
  if(message?.type!=='YOOFAM_PREPARE_PACKAGE'||!/^\w[\w-]{0,99}$/.test(message.productId)||!/^\d{1,20}$/.test(message.categoryId)||!/^[a-f0-9]{64}$/.test(message.fingerprint)||typeof message.base64!=='string'||message.base64.length>40*1024*1024||!message.base64.length||!/^[-a-zA-Z0-9+/]*={0,2}$/.test(message.base64))throw Error('견적서 전달 자료를 확인해주세요.');
  return {productId:message.productId,categoryId:message.categoryId,fingerprint:message.fingerprint,base64:message.base64,createdAt:Date.now(),origin,appTabId:sender.tab.id,windowId:sender.tab.windowId};
}
async function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('yoofam-quotation-handoff',1);request.onupgradeneeded=()=>request.result.createObjectStore('pending');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export function validateResultRequest(message,sender){
  let origin;try{origin=new URL(sender?.url).origin;}catch{throw Error('앱 출처를 확인하지 못했습니다.');}
  if(!sender?.tab||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin)||message?.type!=='YOOFAM_GET_RESULT'||!/^\w[\w-]{0,99}$/.test(message.productId)||!/^\d{1,20}$/.test(message.categoryId)||!/^[a-f0-9]{64}$/.test(message.fingerprint))throw Error('견적서 결과 요청을 확인해주세요.');
  return {origin,productId:message.productId,categoryId:message.categoryId,fingerprint:message.fingerprint};
}
export function resultKey(identity){
  return `result:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`;
}
export function isAcceptedResult(identity,result){
  return Boolean(result&&['origin','productId','categoryId','fingerprint'].every(field=>result[field]===identity[field])
    &&result.filename===`YOOFAM-${identity.fingerprint}.xlsx`&&result.state==='validation-complete'&&result.registered===false
    &&typeof result.quotationId==='string'&&result.quotationId.trim()&&result.quotationId===result.quotationId.trim()&&result.quotationId.length<=200
    &&Number.isSafeInteger(result.includedOptions)&&result.includedOptions>=1&&result.includedOptions<=200
    &&Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},result.company?.code)
    &&({A01526306:'유앤채',A01464742:'와이홉'})[result.company.code]===result.company.name);
}
export function isStoredReceiptResult(identity,result){
  return Boolean(result&&['origin','productId','categoryId','fingerprint'].every(field=>result[field]===identity[field])
    &&['validation-complete','validation-pending','validation-rejected'].includes(result.state)&&result.registered===false
    &&result.filename===`YOOFAM-${identity.fingerprint}.xlsx`&&Number.isSafeInteger(result.includedOptions)&&result.includedOptions>=1&&result.includedOptions<=200
    &&Number.isSafeInteger(result.observedAt)&&result.observedAt>0&&result.observedAt<=Date.now()+60000
    &&Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},result.company?.code)
    &&({A01526306:'유앤채',A01464742:'와이홉'})[result.company.code]===result.company.name
    &&['submittedAt','status','detail','quotationId'].every(field=>result[field]===undefined||(typeof result[field]==='string'&&result[field].length<=20000))
    &&(result.state!=='validation-complete'||isAcceptedResult(identity,result)));
}
export function isRecoverableSupplierHubResult(identity,result){
  return Boolean(result&&['validation-pending','not-found'].includes(result.state)
    &&isStoredReceiptResult(identity,{...result,state:'validation-pending'})&&result.registration===undefined
    &&(result.profileId===undefined||typeof result.profileId==='string'&&/^\w[\w-]{0,99}$/.test(result.profileId))
    &&(result.quotationId===undefined||result.quotationId===''||typeof result.quotationId==='string'
      &&result.quotationId===result.quotationId.trim()&&result.quotationId.length<=200&&!/\.\.\.|…/.test(result.quotationId)));
}
export function canPromoteSupplierHubReceipt(identity,expected,accepted){
  return Boolean(isRecoverableSupplierHubResult(identity,expected)&&isStoredReceiptResult(identity,accepted)&&isAcceptedResult(identity,accepted)
    &&typeof accepted.profileId==='string'&&/^\w[\w-]{0,99}$/.test(accepted.profileId)&&!/\.\.\.|…/.test(accepted.quotationId)
    &&expected.company.code===accepted.company.code&&expected.company.name===accepted.company.name
    &&expected.includedOptions===accepted.includedOptions&&expected.filename===accepted.filename
    &&(expected.profileId===undefined||expected.profileId===accepted.profileId)
    &&(!expected.quotationId||expected.quotationId===accepted.quotationId));
}
/** Only the new read-only validation-status observation uses this CAS. Keep an
 * accepted ID and its SKU observation monotonic while a file table redraws. */
export function canObserveSupplierHubValidation(expected,observation){
  if(!observation||!HANDOFF_ORIGINS.includes(observation.origin)||!/^\w[\w-]{0,99}$/.test(observation.productId||'')
    ||!/^\d{1,20}$/.test(observation.categoryId||'')||!/^[a-f0-9]{64}$/.test(observation.fingerprint||'')
    ||observation.purpose!=='validation-status'||!/^\w[\w-]{0,99}$/.test(observation.profileId||'')
    ||!Number.isSafeInteger(observation.recoveredAt)||observation.recoveredAt<=0||observation.recoveredAt>Date.now()+60000
    ||observation.validationResume!==undefined||observation.attachmentNames!==undefined
    ||!(isStoredReceiptResult(observation,observation)||isRecoverableSupplierHubResult(observation,observation)))return false;
  if(expected===undefined||expected===null)return observation.registration===undefined;
  if(!(isStoredReceiptResult(observation,expected)||isRecoverableSupplierHubResult(observation,expected))
    ||expected.company.code!==observation.company.code||expected.company.name!==observation.company.name
    ||expected.includedOptions!==observation.includedOptions||(expected.profileId!==undefined&&expected.profileId!==observation.profileId)
    ||expected.observedAt>observation.observedAt||expected.quotationId&&expected.quotationId!==observation.quotationId)return false;
  if(expected.state==='validation-complete'&&!isAcceptedResult(observation,observation))return false;
  if((expected.registration!==undefined||observation.registration!==undefined)&&(expected.state!=='validation-complete'||observation.state!=='validation-complete'
    ||expected.quotationId!==observation.quotationId||JSON.stringify(expected.registration)!==JSON.stringify(observation.registration)))return false;
  return true;
}
/** A SKU lookup may replace only the accepted receipt it started from. File
 * identity and validation evidence stay intact; a competing observation wins. */
export function canObserveSupplierHubRegistration(expected,observation){
  if(!expected||!observation||!HANDOFF_ORIGINS.includes(observation.origin)||!/^\w[\w-]{0,99}$/.test(observation.productId||'')
    ||!/^\d{1,20}$/.test(observation.categoryId||'')||!/^[a-f0-9]{64}$/.test(observation.fingerprint||'')
    ||!isStoredReceiptResult(observation,expected)||!isStoredReceiptResult(observation,observation)
    ||!isAcceptedResult(observation,expected)||!isAcceptedResult(observation,observation))return false;
  const ignored=new Set(['registration','profileId','receiptRecovered']),before=Object.keys(expected).filter(key=>!ignored.has(key)).sort(),after=Object.keys(observation).filter(key=>!ignored.has(key)).sort();
  if(JSON.stringify(before)!==JSON.stringify(after)||before.some(key=>JSON.stringify(expected[key])!==JSON.stringify(observation[key]))
    ||(expected.profileId!==undefined&&expected.profileId!==observation.profileId)
    ||(observation.profileId!==undefined&&(typeof observation.profileId!=='string'||!/^\w[\w-]{0,99}$/.test(observation.profileId)))
    ||(expected.receiptRecovered!==undefined&&expected.receiptRecovered!==observation.receiptRecovered)
    ||(observation.receiptRecovered!==undefined&&observation.receiptRecovered!==true))return false;
  const registration=observation.registration;
  return Boolean(registration&&registration.quotationId===expected.quotationId&&registration.registered===false
    &&registration.includedOptions===expected.includedOptions&&['visible-page','queried-pages'].includes(registration.scope)
    &&Number.isSafeInteger(registration.observedAt)&&registration.observedAt>0&&registration.observedAt<=Date.now()+60000
    &&Array.isArray(registration.rows)&&registration.rows.length<=expected.includedOptions
    &&registration.rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row))
    &&(!Number.isSafeInteger(expected.registration?.observedAt)||registration.observedAt>=expected.registration.observedAt));
}
export async function transferRecord(action,key,value){
  if(action==='history'){
    const origin=HANDOFF_ORIGINS.find(origin=>typeof key==='string'&&key.startsWith(`history:${origin}:`));
    if(!origin||value!==undefined)throw Error('상품 전송 이력 요청을 확인해주세요.');
    return productTransferRecords(origin,key.slice(`history:${origin}:`.length));
  }
  if(!['get','put','claim','promote','observe','register'].includes(action)||typeof key!=='string'||!(/^(attempt:\d+$|(?:result|transmission):https?:\/\/)/.test(key)))throw Error('전송 기록을 확인해주세요.');
  if(action==='register'&&(!value||key!==resultKey(value.observation)||!canObserveSupplierHubRegistration(value.expected,value.observation)))throw Error('상품별 결과의 조건부 조회 기록을 확인해주세요.');
  if(action==='observe'&&(!value||key!==resultKey(value.observation)||!canObserveSupplierHubValidation(value.expected,value.observation)))throw Error('검증 결과의 조건부 조회 기록을 확인해주세요.');
  if(action==='promote'&&!(HANDOFF_ORIGINS.includes(value?.accepted?.origin)&&/^\w[\w-]{0,99}$/.test(value.accepted.productId||'')
    &&/^\d{1,20}$/.test(value.accepted.categoryId||'')&&/^[a-f0-9]{64}$/.test(value.accepted.fingerprint||'')
    &&key===resultKey(value.accepted)&&canPromoteSupplierHubReceipt(value.accepted,value.expected,value.accepted)))throw Error('접수 결과의 조건부 복구 정보를 확인해주세요.');
  if(action==='claim'&&!key.startsWith('transmission:')&&!/^attempt:\d+$/.test(key)
    &&!(HANDOFF_ORIGINS.includes(value?.origin)&&/^\w[\w-]{0,99}$/.test(value.productId||'')&&/^\d{1,20}$/.test(value.categoryId||'')
      &&/^[a-f0-9]{64}$/.test(value.fingerprint||'')&&key===resultKey(value)&&isStoredReceiptResult(value,value)))throw Error('전송 시도 기록을 확인해주세요.');
  const db=await database();try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction('pending',action==='get'?'readonly':'readwrite'),store=transaction.objectStore('pending');let result;
    const request=action==='put'?store.put(value,key):store.get(key);
    request.onsuccess=()=>{result=request.result;if(action==='claim'){if(result!==undefined){result=false;}else{store.put(value,key);result=true;}}
      else if(action==='promote'){
        // Compare and replace in one transaction: a newer accepted/rejected
        // observation wins over recovery of the previously read pending row.
        if(!canPromoteSupplierHubReceipt(value.accepted,result,value.accepted)||JSON.stringify(result)!==JSON.stringify(value.expected))result=false;
        else{store.put(value.accepted,key);result=true;}
      }
      else if(action==='observe'){
        if(JSON.stringify(result)!==JSON.stringify(value.expected)||!canObserveSupplierHubValidation(result,value.observation))result=false;
        else{store.put(value.observation,key);result=true;}
      }
      else if(action==='register'){
        if(JSON.stringify(result)!==JSON.stringify(value.expected)||!canObserveSupplierHubRegistration(result,value.observation))result=false;
        else{store.put(value.observation,key);result=true;}
      }
    };transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('전송 기록 저장 실패'));
  });}finally{db.close();}
}
/** Read every fingerprint for this app/product, including an upload whose
 * acknowledgement was lost before a server receipt could be stored. */
export async function productTransferRecords(origin,productId){
  if(!HANDOFF_ORIGINS.includes(origin)||!/^\w[\w-]{0,99}$/.test(productId||''))throw Error('상품 전송 이력의 출처를 확인해주세요.');
  const db=await database();try{return await new Promise((resolve,reject)=>{
    const rows=[],prefixes=[`transmission:${origin}:${productId}:`,`result:${origin}:${productId}:`],transaction=db.transaction('pending','readonly');
    const cursor=transaction.objectStore('pending').openCursor();
    cursor.onsuccess=()=>{const current=cursor.result;if(!current)return;
      if(typeof current.key==='string'&&prefixes.some(prefix=>current.key.startsWith(prefix))){rows.push({key:current.key,value:current.value});
        if(rows.length>200||new TextEncoder().encode(JSON.stringify(rows)).length>512*1024){transaction.abort();return;}}
      current.continue();
    };transaction.oncomplete=()=>resolve(rows);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(Error('상품의 전체 Chrome 전송 이력을 확인하지 못했습니다. 기존 기록은 유지됩니다.'));
  });}finally{db.close();}
}
export async function pendingPackage(action,value){
  if(!['get','put','delete'].includes(action))throw Error('지원하지 않는 패키지 작업입니다.');
  if(action==='delete'&&(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))throw Error('삭제할 견적서 식별값을 확인해주세요.');
  const db=await database();try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction('pending',action==='get'?'readonly':'readwrite'),store=transaction.objectStore('pending');let result;
    const request=action==='put'?store.put(value,'package'):store.get('package');
    request.onsuccess=()=>{result=request.result;if(action==='delete'){const matches=Boolean(result&&result.fingerprint===value);if(matches)store.delete('package');result=matches;}};
    transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('패키지 저장이 중단되었습니다.'));
  });}finally{db.close();}
}
