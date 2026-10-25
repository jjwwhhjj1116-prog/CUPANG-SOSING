import {readPreparedDocumentPreviewCheckpoint} from './single-document.mjs';
import {createProductDocumentStore} from './product-document-receiver.mjs';
import {currentSourceAppTab} from './product-document-source.mjs';

const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const logical=identity=>Object.fromEntries(Object.entries(identity).filter(([key])=>!['appTabId','windowId'].includes(key)));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

/** A closed source tab may be replaced for the exact durable operation only.
 * Keep the original operation identity, hashes, nonce, target and request UUID;
 * independently bind current-source reads to the caller's live same-window
 * app tab. An existing original tab is never taken over or impersonated.
 */
export async function resolveProductSourceContext(context,{api=globalThis.chrome,store=createProductDocumentStore()}={}){
 const prior=await store.get(context.key);
 if(!prior||prior.identity?.appTabId===context.identity.appTabId)return context;
 const old=prior.identity;
 if(!old||!Number.isSafeInteger(old.appTabId)||old.appTabId<0||old.windowId!==context.identity.windowId||canon(logical(old))!==canon(logical(context.identity))
  ||prior.identityDigest!==await digest(old))throw Error('기존 전송 요청의 회원·회사·상품 또는 Chrome 창이 다릅니다.');
 const restored={...context,identity:structuredClone(old),identityDigest:prior.identityDigest,
  packet:{...context.packet,appTabId:old.appTabId,windowId:old.windowId},sourceAppTabId:context.identity.appTabId};
 // This validates the entire private checkpoint, including its original UUID,
 // body, source, mode and immutable operation sequence before any bridge use.
 await readPreparedDocumentPreviewCheckpoint(restored,{get:async()=>prior});
 await currentSourceAppTab(api,restored.identity,restored.sourceAppTabId);
 return freeze(restored);
}
