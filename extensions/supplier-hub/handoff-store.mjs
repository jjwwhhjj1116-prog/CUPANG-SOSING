export const HANDOFF_ORIGINS=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
export function validateHandoff(message,sender){
  let origin;try{origin=new URL(sender?.url).origin;}catch{throw Error('앱 출처를 확인하지 못했습니다.');}
  if(!sender?.tab||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin))throw Error('허용된 앱 탭에서만 전달할 수 있습니다.');
  if(message?.type!=='YOOFAM_PREPARE_PACKAGE'||!/^\w[\w-]{0,99}$/.test(message.productId)||!/^\d{1,20}$/.test(message.categoryId)||!/^[a-f0-9]{64}$/.test(message.fingerprint)||typeof message.base64!=='string'||message.base64.length>40*1024*1024||!message.base64.length||!/^[-a-zA-Z0-9+/]*={0,2}$/.test(message.base64))throw Error('견적서 전달 자료를 확인해주세요.');
  return {productId:message.productId,categoryId:message.categoryId,fingerprint:message.fingerprint,base64:message.base64,createdAt:Date.now(),origin};
}
async function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('yoofam-quotation-handoff',1);request.onupgradeneeded=()=>request.result.createObjectStore('pending');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function pendingPackage(action,value){
  const db=await database();try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction('pending',action==='get'?'readonly':'readwrite'),store=transaction.objectStore('pending');let result;
    const request=action==='put'?store.put(value,'package'):store.get('package');
    request.onsuccess=()=>{result=request.result;if(action==='delete'){const matches=result?.fingerprint===value;if(matches)store.delete('package');result=matches;}};
    transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('패키지 저장이 중단되었습니다.'));
  });}finally{db.close();}
}
