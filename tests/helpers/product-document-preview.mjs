/** Scope the production dispatcher's Chrome surface to the isolated fixture.
 * Preserve a getter descriptor as well as a normal existing property. */
export async function withProductDocumentChrome(api,run,store){
  const prior=Object.getOwnPropertyDescriptor(globalThis,'chrome'),priorDb=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'chrome',{configurable:true,writable:true,value:api});
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,writable:true,value:{open:()=>{const open={};queueMicrotask(()=>{open.result={close:()=>{},transaction:(_name,mode)=>{if(mode!=='readonly')throw Error('Preview cannot write checkpoint records');const transaction={objectStore:()=>({get:key=>{const request={};queueMicrotask(async()=>{try{request.result=await store?.get(key);request.onsuccess?.();transaction.oncomplete?.();}catch(error){transaction.error=error;transaction.onabort?.();}});return request;}})};return transaction;}};open.onsuccess?.();});return open;}}});
  try{return await run();}finally{if(prior)Object.defineProperty(globalThis,'chrome',prior);else delete globalThis.chrome;if(priorDb)Object.defineProperty(globalThis,'indexedDB',priorDb);else delete globalThis.indexedDB;}
}
