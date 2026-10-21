/** Scope the production dispatcher's Chrome surface to the isolated fixture.
 * Preserve a getter descriptor as well as a normal existing property. */
export async function withProductDocumentChrome(api,run){
  const prior=Object.getOwnPropertyDescriptor(globalThis,'chrome');
  Object.defineProperty(globalThis,'chrome',{configurable:true,writable:true,value:api});
  try{return await run();}finally{if(prior)Object.defineProperty(globalThis,'chrome',prior);else delete globalThis.chrome;}
}
