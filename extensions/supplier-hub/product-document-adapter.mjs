import {createSupplierHubDocumentBrowserAdapter} from './single-document-adapter.mjs';
import {readAppDocumentSource,sourceReadError,currentSourceAppTab} from './product-document-source.mjs';
import {withNativeProductAssetRecovery} from './native-product-recovery.mjs';

/** Same owned-tab adapter and native operations, with a trusted full-product
 * source verifier. Packet fields cannot select a looser adapter contract. */
export function createProductDocumentBrowserAdapter(options={}){
  const adapter=createSupplierHubDocumentBrowserAdapter(options,{wholeProduct:true});
  return options.nativeAssets?withNativeProductAssetRecovery(adapter,{api:options.api??globalThis.chrome,nativeSha:options.nativeAssets.sourcePlanSha256,now:options.now??Date.now,sourceAppTabId:options.sourceAppTabId}):adapter;
}

/** Select native construction only after the current authenticated app source
 * independently proves the reviewed filename body. Packet fields alone never
 * select it. Legacy is selected only by its own positive source proof; an
 * unavailable native reader is never evidence of a legacy document. */
export async function createVerifiedProductDocumentBrowserAdapter(context,{api=globalThis.chrome,now=Date.now}={}){
 const identity=context?.identity,sourceAppTabId=context?.sourceAppTabId,input={identity,bodySha256:context?.originalBodySha256,preparedBodySha256:context?.bodySha256,packetDigest:context?.packetDigest,requestId:context?.packet?.requestId,docId:null};
 const current=async()=>{try{await currentSourceAppTab(api,identity,sourceAppTabId);}catch{throw sourceReadError({code:'SOURCE_CHANGED'});}};
 const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 const same=(a,b)=>canonical(a)===canonical(b);
 const matches=result=>result?.current===true&&same(result.identity,identity)&&result.bodySha256===input.bodySha256&&result.preparedBodySha256===input.preparedBodySha256;
 try{
  await current();const result=await readAppDocumentSource(api,identity,input,'native',sourceAppTabId);await current();
  if(!matches(result)||result.sourcePlan?.sourcePlanSha256!==identity.fingerprint)throw sourceReadError({code:'SOURCE_CHANGED'});
  return{adapter:createProductDocumentBrowserAdapter({api,now,sourceAppTabId,nativeAssets:{sourcePlanSha256:identity.fingerprint}}),nativeAssets:true,sourcePlanSha256:identity.fingerprint};
 }catch(error){
  if(error?.code!=='SOURCE_CONTRACT_MISMATCH'||sourceAppTabId!==undefined)throw error;
  await current();const result=await readAppDocumentSource(api,identity,input,'legacy');await current();
  if(!matches(result))throw sourceReadError({code:'SOURCE_CHANGED'});
  return{adapter:createProductDocumentBrowserAdapter({api,now}),nativeAssets:false,sourcePlanSha256:null};
 }
}
