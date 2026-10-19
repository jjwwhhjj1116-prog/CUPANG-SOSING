import {validatePageSource,pageSourceUrl} from './page-source.mjs';
const origins=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
const companies={A01526306:'유앤채',A01464742:'와이홉'};
const identifier=value=>typeof value==='string'&&/^\w[\w-]{0,99}$/.test(value);
const pending=new Map();
export function sourceInboxStore(action,value){
 return new Promise((resolve,reject)=>{
  const open=indexedDB.open('yoofam-page-source-inbox',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('captures',{keyPath:'id'});
  open.onerror=()=>reject(Error('수집함 보관소를 열지 못했습니다.'));
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('captures',action==='list'?'readonly':'readwrite'),store=tx.objectStore('captures');
   const query=action==='list'?store.getAll():action==='put'?store.put(value):store.delete(value);let result;
   query.onsuccess=()=>{result=query.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(Error('수집함 저장 결과를 확인하지 못했습니다.'));};tx.onabort=tx.onerror;
  };
 });
}
export async function sourceFingerprint(snapshot){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))))].map(value=>value.toString(16).padStart(2,'0')).join('');}
function appSender(sender){
 if(sender?.frameId!==0||!Number.isSafeInteger(sender.tab?.id)||!Number.isSafeInteger(sender.tab?.windowId))throw Error('같은 Chrome 창에서 YOOFAM을 열어주세요.');
 const origin=new URL(sender.url).origin;if(!origins.includes(origin))throw Error('YOOFAM 앱에서 수집함을 열어주세요.');return origin;
}
async function context(api,tab){
 const current=await api.tabs.get(tab.id);
 if(current.windowId!==tab.windowId||current.pendingUrl||new URL(current.url).origin!==new URL(tab.url).origin)throw Error('앱 창이 변경되었습니다.');
 const result=await api.tabs.sendMessage(tab.id,{type:'YOOFAM_READ_CATALOG_CONTEXT'},{frameId:0});
 if(result?.ok!==true||!identifier(result.ownerId)||companies[result.company?.code]!==result.company?.name)throw Error('같은 창의 YOOFAM에 승인된 회사 계정으로 로그인해주세요.');
 return {ownerId:result.ownerId,company:{code:result.company.code,name:result.company.name},origin:new URL(current.url).origin};
}
const same=(left,right)=>left.ownerId===right.ownerId&&left.origin===right.origin&&left.company.code===right.company.code&&left.company.name===right.company.name;
async function deliver(record,tab,api,store){
 const before=await context(api,tab);if(!same(before,record))throw Error('수집 당시 회원·회사로 로그인한 앱에서 불러오세요.');
 const result=await api.tabs.sendMessage(tab.id,{type:'YOOFAM_SAVE_SOURCE_CAPTURE',record},{frameId:0});
 if(result?.ok!==true||result.id!==record.id||result.fingerprint!==record.fingerprint||result.ownerId!==record.ownerId||result.company?.code!==record.company.code||result.company?.name!==record.company.name)throw Error(result?.error||'웹 수집함의 저장 확인을 받지 못했습니다. 확장 보관본은 유지됩니다.');
 if(!same(await context(api,tab),record))throw Error('저장 중 로그인 회사가 변경되었습니다. 확장 보관본은 유지됩니다.');
 await store('delete',record.id);return result;
}
/** Called by the isolated top-frame button only. No source page read/fetch here. */
export async function savePageSource(message,sender,api=chrome,store=sourceInboxStore){
 if(sender?.frameId!==0||!Number.isSafeInteger(sender.tab?.id)||!Number.isSafeInteger(sender.tab?.windowId))throw Error('상품 본문에서 수집해주세요.');
 const page=pageSourceUrl(sender.url),snapshot=validatePageSource(message.snapshot);
 if(page.sourceUrl!==snapshot.sourceUrl)throw Error('클릭한 상품과 수집 원문이 다릅니다.');
 if(pending.has(sender.tab.id))return pending.get(sender.tab.id);
 const run=(async()=>{
  const candidates=(await api.tabs.query({windowId:sender.tab.windowId})).filter(tab=>{try{return origins.includes(new URL(tab.url).origin)&&!tab.pendingUrl;}catch{return false;}});
  if(!candidates.length)throw Error('같은 Chrome 창에서 YOOFAM에 먼저 로그인해주세요.');
  const contexts=[];for(const tab of candidates){try{contexts.push({tab,scope:await context(api,tab)});}catch{}}
  if(!contexts.length)throw Error('같은 Chrome 창의 YOOFAM 로그인 상태를 확인해주세요.');
  if(contexts.some(item=>!same(item.scope,contexts[0].scope)))throw Error('이 창의 YOOFAM 회원이 서로 다릅니다. 수집할 회사의 앱 탭 하나만 열어주세요.');
  const {tab,scope}=contexts.find(item=>item.tab.active)??contexts[0];
  const records=await store('list'),previous=records.find(row=>row.windowId===sender.tab.windowId&&same(row,scope)&&row.snapshot.offerId===snapshot.offerId);
  // A repeated click retries the first immutable snapshot. It cannot overwrite
  // an uncertain server save or an operating product with newly read values.
  const record=previous??{id:crypto.randomUUID(),...scope,windowId:sender.tab.windowId,snapshot,fingerprint:await sourceFingerprint(snapshot)};
  if(!previous){if(records.length>=40)throw Error('확장 수집함이 가득 찼습니다. 앱에서 보관된 상품을 불러와주세요.');await store('put',record);}
  try{const result=await deliver(record,tab,api,store);return {ok:true,delivered:true,duplicate:result.duplicate===true,id:record.id};}
  catch(error){return {ok:true,delivered:false,id:record.id,message:error.message};}
 })();pending.set(sender.tab.id,run);try{return await run;}finally{pending.delete(sender.tab.id);}
}
export async function flushPageSources(_message,sender,api=chrome,store=sourceInboxStore){
 const origin=appSender(sender),tab={id:sender.tab.id,windowId:sender.tab.windowId,url:sender.url},scope=await context(api,tab);
 if(scope.origin!==origin)throw Error('앱 출처가 변경되었습니다.');
 const records=(await store('list')).filter(record=>record.windowId===tab.windowId&&same(record,scope));
 let delivered=0;const errors=[];
 for(const record of records){try{await deliver(record,tab,api,store);delivered++;}catch(error){errors.push(error.message);}}
 return {ok:true,ownerId:scope.ownerId,company:scope.company,delivered,pending:records.length-delivered,errors};
}
