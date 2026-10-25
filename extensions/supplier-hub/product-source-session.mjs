import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {createProductDocumentStore} from './product-document-receiver.mjs';
import {currentSourceAppTab} from './product-document-source.mjs';

const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const fail=()=>{throw Error('원래 앱 탭·회원·전송 요청의 연결 기록을 확인하지 못했습니다.');};

/** Restore only an operation nonce from the extension's private checkpoint.
 * The trusted isolated content script calls this after independently verifying
 * current authentication, account, full source and receipt history. No cookie,
 * authorization token, Hub request, checkpoint write or new scope is involved.
 * An open original tab, another window, account, source or operation cannot
 * inherit it. Closed-tab handoff retains the original private operation and
 * requires the original source tab to remain absent at both read boundaries.
 */
export async function readProductSourceSession(message,sender,{api=globalThis.chrome,store=createProductDocumentStore()}={}){
 const value=message?.expected,identity=value?.identity;
 if(message?.type!=='YOOFAM_READ_PRODUCT_SOURCE_SESSION'||Object.keys(message).sort().join(',')!=='expected,type'
  ||!value||Object.keys(value).sort().join(',')!=='bodySha256,docId,identity,packetDigest,preparedBodySha256,requestId'
  ||!identity||Object.hasOwn(identity,'optionId')||!Array.isArray(identity.members)||!identity.members.length
  ||!['bodySha256','preparedBodySha256','packetDigest'].every(key=>HASH.test(value[key]||''))||!ID.test(value.requestId||'')
  ||sender?.id!==api?.runtime?.id||sender?.frameId!==0||!Number.isSafeInteger(sender?.tab?.id)||sender.tab.id<0||sender.tab.windowId!==identity.windowId)fail();
 const current=async()=>{
  let url;try{url=new URL(sender.url);}catch{fail();}
  if(!HANDOFF_ORIGINS.includes(url.origin)||url.origin!==identity.origin||url.username||url.password)fail();
  await currentSourceAppTab(api,identity,sender.tab.id);
 };
 await current();
 const key='product-document:'+value.packetDigest,state=await store.get(key);
 await current();
 if(state===null||state===undefined)return{sessionId:null};
 if(state.format!=='yoofam-supplier-hub-product-document-v1'||state.draftOnly!==true||state.key!==key
  ||canonical(state.identity)!==canonical(identity)||state.identityDigest!==await hash(identity)
  ||state.packetDigest!==value.packetDigest||state.requestId!==value.requestId
  ||state.originalBodySha256!==value.bodySha256||state.bodySha256!==value.preparedBodySha256
  ||canonical(state.docId)!==canonical(value.docId))fail();
 if(state.sessionId===null&&state.state==='prepared'&&state.docId===null&&state.tab===null&&state.ownedTarget===null)return{sessionId:null};
 if(!ID.test(state.sessionId||''))fail();
 return{sessionId:state.sessionId};
}
