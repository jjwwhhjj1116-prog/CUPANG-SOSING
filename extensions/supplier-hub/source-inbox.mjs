import {validatePageSourceForDelivery,pageSourceUrl} from './page-source.mjs';
const origins=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
const companies={A01526306:'유앤채',A01464742:'와이홉'};
const identifier=value=>typeof value==='string'&&/^\w[\w-]{0,99}$/.test(value);
const pending=new Map();
const flushing=new Map();
const opening=new Map();
const appUrl=origins[0]+'/';
const failure=(code,message)=>Object.assign(Error(message),{code});
const contextMessages={
 YOOFAM_LOGIN_REQUIRED:'YOOFAM 앱에서 로그인이 필요하다는 응답을 받았습니다. 같은 Chrome 창의 앱에 로그인한 뒤 상품 수집을 다시 눌러주세요.',
 YOOFAM_COMPANY_REQUIRED:'YOOFAM 계정의 승인 회사정보를 확인해주세요. 계정 관리에서 회사코드·회사명을 확인한 뒤 상품 수집을 다시 눌러주세요.',
 YOOFAM_CONTEXT_UNAVAILABLE:'YOOFAM 앱과 확장의 연결을 확인하지 못했습니다. 같은 Chrome 창의 앱을 새로고침한 뒤 상품 수집을 다시 눌러주세요.',
 YOOFAM_CONTEXT_INVALID:'YOOFAM 앱의 회원·회사 확인 응답이 올바르지 않습니다. 앱을 새로고침한 뒤 상품 수집을 다시 눌러주세요.',
 YOOFAM_CONTEXT_SERVICE_ERROR:'YOOFAM 서버의 회원·회사 확인 요청에 실패했습니다. 앱 연결 상태를 확인한 뒤 상품 수집을 다시 눌러주세요.',
 YOOFAM_CONTEXT_TIMEOUT:'YOOFAM 서버의 회원·회사 확인 응답 시간이 초과되었습니다. 앱 연결 상태를 확인한 뒤 상품 수집을 다시 눌러주세요.',
 YOOFAM_TAB_TIMEOUT:'같은 Chrome 창의 YOOFAM 앱 탭 응답 시간이 초과되었습니다. 응답하지 않는 앱 탭을 새로고침하거나 닫은 뒤 상품 수집을 다시 눌러주세요.',
};
const contextError=code=>failure(Object.hasOwn(contextMessages,code)?code:'YOOFAM_CONTEXT_UNAVAILABLE',contextMessages[code]??contextMessages.YOOFAM_CONTEXT_UNAVAILABLE);
function readinessError(errors=[]){
 // Only an explicit HTTP 401 proves that login is required. A missing bridge,
 // loading tab, network failure or timeout must not masquerade as logout.
 const priority=['YOOFAM_TAB_TIMEOUT','YOOFAM_CONTEXT_TIMEOUT','YOOFAM_CONTEXT_SERVICE_ERROR','YOOFAM_CONTEXT_INVALID','YOOFAM_CONTEXT_UNAVAILABLE','YOOFAM_COMPANY_REQUIRED','YOOFAM_LOGIN_REQUIRED'];
 const code=priority.find(code=>errors.some(error=>error?.code===code))??'YOOFAM_TAB_TIMEOUT';
 return failure(code,contextMessages[code]+' 아직 수집함에 저장하지 않았습니다.');
}
function limitedApi(api,deadline,error=readinessError){
 const timeout=()=>{const failure=error();failure.code='YOOFAM_TAB_TIMEOUT';return failure;};
 const call=async(method,args)=>{
  const remaining=deadline-Date.now();if(remaining<=0)throw timeout();let timer;
  try{return await Promise.race([Promise.resolve().then(()=>api.tabs[method](...args)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeout()),remaining);})]);}
  finally{clearTimeout(timer);}
 };
 return {tabs:Object.fromEntries(['query','get','create','sendMessage','update'].map(method=>[method,(...args)=>call(method,args)]))};
}
const appOrigin=url=>{try{const origin=new URL(url).origin;return origins.includes(origin)?origin:null;}catch{return null;}};
function appCandidates(tabs,windowId){return tabs.filter(tab=>tab.windowId===windowId&&(appOrigin(tab.url)||appOrigin(tab.pendingUrl)));}
function candidateTab(tab){return {...tab,url:appOrigin(tab.url)?tab.url:tab.pendingUrl};}
async function candidateContexts(api,windowId,expected=new Map()){
 const candidates=appCandidates(await api.tabs.query({windowId}),windowId);
 let lastContextTabId;
 // Start every candidate together: a slow background tab cannot spend the
 // entire window budget before the intended receiver is even inspected.
 const results=await Promise.allSettled(candidates.map(async candidate=>{
  const tab=expected.get(candidate.id)??candidateTab(candidate);expected.set(tab.id,tab);
  const scope=await context(api,tab);lastContextTabId=tab.id;return {tab:{...tab,active:candidate.active},scope};
 }));
 const contexts=results.filter(result=>result.status==='fulfilled').map(result=>result.value),errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
 if(contexts.some(item=>!same(item.scope,contexts[0].scope)))throw Error('이 창의 YOOFAM 회원이 서로 다릅니다. 수집할 회사의 앱 탭 하나만 열어주세요.');
 // An unresponsive/invalid authenticated endpoint may conceal another owner.
 // Do not turn first-success selection into an authorization bypass.
 if(errors.some(error=>['YOOFAM_TAB_TIMEOUT','YOOFAM_CONTEXT_TIMEOUT','YOOFAM_CONTEXT_SERVICE_ERROR','YOOFAM_CONTEXT_INVALID'].includes(error?.code)))throw contextError(readinessError(errors).code);
 return {contexts,errors,lastContextTabId};
}
async function appReceiver(api,windowId,timeoutMs,pollMs){
 const existing=opening.get(windowId);if(existing)return existing;
 const run=(async()=>{
  const deadline=Date.now()+timeoutMs,bounded=limitedApi(api,deadline),expected=new Map();let createdId;
  const initial=appCandidates(await bounded.tabs.query({windowId}),windowId);
  for(const tab of initial)expected.set(tab.id,candidateTab(tab));
  if(!initial.length){
   const tab=await bounded.tabs.create({windowId,url:appUrl,active:true});
   if(!Number.isSafeInteger(tab?.id)||tab.windowId!==windowId)throw Error('같은 Chrome 창에 YOOFAM 앱을 열지 못했습니다. 상품 수집을 다시 눌러주세요.');
   createdId=tab.id;expected.set(tab.id,{id:tab.id,windowId,url:appUrl});
  }
  for(;;){
   let checked;try{checked=await candidateContexts(bounded,windowId,expected);}catch(error){if(Object.hasOwn(contextMessages,error?.code))throw readinessError([error]);throw error;}
   const {contexts,errors}=checked;
   const receiver=createdId===undefined?(contexts.find(item=>item.tab.active)??contexts[0]):contexts.find(item=>item.tab.id===createdId);
   if(receiver)return receiver;
   const remaining=deadline-Date.now();if(remaining<=0)throw readinessError(errors);
   await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,remaining)));
   if(Date.now()>=deadline)throw readinessError(errors);
  }
 })();
 opening.set(windowId,run);try{return await run;}finally{if(opening.get(windowId)===run)opening.delete(windowId);}
}
async function recheckReceiver(receiver,api){
 const {contexts,lastContextTabId}=await candidateContexts(api,receiver.tab.windowId,new Map([[receiver.tab.id,receiver.tab]]));
 const current=contexts.find(item=>item.tab.id===receiver.tab.id);
 if(!current||!same(current.scope,receiver.scope))throw Error('수집할 앱 창 또는 로그인 회사가 변경되었습니다. 같은 회사의 앱에서 상품 수집을 다시 눌러주세요.');
 // If another candidate took longer, refresh the selected receiver after that
 // wait. Only this immediate check may replace deliver's adjacent extra read.
 const scope=lastContextTabId===receiver.tab.id?current.scope:await context(api,receiver.tab);
 if(!same(scope,receiver.scope))throw Error('수집할 앱 창 또는 로그인 회사가 변경되었습니다. 같은 회사의 앱에서 상품 수집을 다시 눌러주세요.');
 return scope;
}
async function activateReceiver(receiver,api){
 // A focus/tab-close failure cannot undo the durable matching storage ACK.
 try{await recheckReceiver(receiver,api);await api.tabs.update(receiver.tab.id,{active:true});}catch{}
}
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
 let result;
 try{result=await api.tabs.sendMessage(tab.id,{type:'YOOFAM_READ_CATALOG_CONTEXT'},{frameId:0});}
 catch(error){if(error?.code==='YOOFAM_TAB_TIMEOUT')throw error;throw contextError('YOOFAM_CONTEXT_UNAVAILABLE');}
 const after=await api.tabs.get(tab.id);if(after.windowId!==tab.windowId||after.pendingUrl||new URL(after.url).origin!==new URL(tab.url).origin)throw Error('앱 창이 변경되었습니다.');
 if(result?.ok!==true)throw contextError(result?.code);
 if(!identifier(result.ownerId)||!Object.hasOwn(companies,result.company?.code)||companies[result.company?.code]!==result.company?.name)throw contextError('YOOFAM_CONTEXT_INVALID');
 return {ownerId:result.ownerId,company:{code:result.company.code,name:result.company.name},origin:new URL(current.url).origin};
}
const same=(left,right)=>left.ownerId===right.ownerId&&left.origin===right.origin&&left.company.code===right.company.code&&left.company.name===right.company.name;
function storedSourceReceipt(result,record){
 if(!Object.hasOwn(result,'storedReceipt'))return undefined;
 const receipt=result.storedReceipt,keys=['ownerId','company','sourceUrl','fingerprint','storedId','captureVersion','receivedAt','collectedAt'];
 const fail=()=>{throw Error('실제 저장된 수집본의 확인 응답이 다릅니다. 확장 보관본은 유지됩니다.');};
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||Object.keys(receipt).length!==keys.length||Object.keys(receipt).some(key=>!keys.includes(key)))return fail();
 const timestamp=value=>{
  if(typeof value!=='string'||value.length>40||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))return null;
  const time=Date.parse(value),canonical=value.replace(/(?:\.(\d{1,3}))?Z$/,(_match,decimal)=>'.'+(decimal||'').padEnd(3,'0')+'Z');
  return Number.isFinite(time)&&time>0&&time<=Date.now()+60000&&new Date(time).toISOString()===canonical?time:null;
 };
 const received=timestamp(receipt.receivedAt),collected=timestamp(receipt.collectedAt);let source;
 try{source=pageSourceUrl(receipt.sourceUrl);}catch{return fail();}
 if(receipt.ownerId!==record.ownerId||!receipt.company||typeof receipt.company!=='object'||Array.isArray(receipt.company)||Object.keys(receipt.company).sort().join(',')!=='code,name'
  ||receipt.company.code!==record.company.code||receipt.company.name!==record.company.name||source.sourceUrl!==receipt.sourceUrl||receipt.sourceUrl!==record.snapshot.sourceUrl
  ||receipt.fingerprint!==record.fingerprint||!/^[a-f0-9-]{36}$/.test(receipt.storedId||'')||!Number.isSafeInteger(receipt.captureVersion)||receipt.captureVersion<1
  ||received===null||collected===null||received<collected-60000||receipt.collectedAt!==record.snapshot.collectedAt)return fail();
 return {...receipt,company:{code:receipt.company.code,name:receipt.company.name}};
}
async function deliver(record,tab,api,store,verifiedScope){
 validatePageSourceForDelivery(record.snapshot);
 const before=verifiedScope??await context(api,tab);if(!same(before,record))throw Error('수집 당시 회원·회사로 로그인한 앱에서 불러오세요.');
 const result=await api.tabs.sendMessage(tab.id,{type:'YOOFAM_SAVE_SOURCE_CAPTURE',record},{frameId:0});
 if(result?.ok!==true||result.id!==record.id||result.fingerprint!==record.fingerprint||result.ownerId!==record.ownerId||result.company?.code!==record.company.code||result.company?.name!==record.company.name)throw Error(result?.error||'웹 수집함의 저장 확인을 받지 못했습니다. 확장 보관본은 유지됩니다.');
 const storedReceipt=storedSourceReceipt(result,record);
 if(!same(await context(api,tab),record))throw Error('저장 중 로그인 회사가 변경되었습니다. 확장 보관본은 유지됩니다.');
 await store('delete',record.id);return {...result,...(storedReceipt?{storedReceipt}:{})};
}
/** Called by the isolated top-frame button only. No source page read/fetch here. */
export async function savePageSource(message,sender,api=chrome,store=sourceInboxStore,options={}){
 if(sender?.frameId!==0||!Number.isSafeInteger(sender.tab?.id)||!Number.isSafeInteger(sender.tab?.windowId))throw Error('상품 본문에서 수집해주세요.');
 const page=pageSourceUrl(sender.url),snapshot=validatePageSourceForDelivery(message.snapshot);
 if(page.sourceUrl!==snapshot.sourceUrl)throw Error('클릭한 상품과 수집 원문이 다릅니다.');
 const fingerprint=await sourceFingerprint(snapshot),active=pending.get(sender.tab.id);
 const timeoutMs=Number.isFinite(options.timeoutMs)?Math.max(1,Math.min(12000,options.timeoutMs)):12000;
 const pollMs=Number.isFinite(options.pollMs)?Math.max(1,Math.min(250,options.pollMs)):250;
 if(active){
  if(active.windowId!==sender.tab.windowId||active.sourceUrl!==snapshot.sourceUrl||active.offerId!==snapshot.offerId||active.fingerprint!==fingerprint)throw Error('이 상품 탭에서 이전 상품 수집이 진행 중입니다. 완료 후 현재 상품의 수집 버튼을 다시 눌러주세요. 현재 상품은 아직 수집하지 않았습니다.');
  // An exact retry can share only this operation's original receiver and scope.
  // Recheck again after waiting so a late ACK cannot become another owner's success.
  const receiver=await active.receiver,bounded=limitedApi(api,Date.now()+timeoutMs,()=>Error('YOOFAM 앱의 응답 시간이 초과되었습니다. 수집 결과를 확인하고 다시 시도해주세요.'));
  await recheckReceiver(receiver,bounded);const result=await active.promise;
  await recheckReceiver(receiver,bounded);return result;
 }
 const receiving=appReceiver(api,sender.tab.windowId,timeoutMs,pollMs);
 const run=(async()=>{
  const receiver=await receiving,{tab,scope}=receiver;
  const bounded=limitedApi(api,Date.now()+timeoutMs,()=>Error('YOOFAM 앱의 응답 시간이 초과되었습니다. 수집 결과를 확인하고 다시 시도해주세요.'));
  const records=await store('list'),previous=records.find(row=>row.windowId===sender.tab.windowId&&same(row,scope)&&row.snapshot.offerId===snapshot.offerId);
  // A repeated click retries the first immutable snapshot. It cannot overwrite
  // an uncertain server save or an operating product with newly read values.
  const record=previous??{id:crypto.randomUUID(),...scope,windowId:sender.tab.windowId,snapshot,fingerprint};
  // A successful retry acknowledges this retained payload, not a newer page
  // the user may have just read. Report that distinction so a second trusted
  // collection click can explicitly save the current page as its own version.
  const pendingSnapshotReplayed=Boolean(previous&&previous.fingerprint!==fingerprint);
  if(!previous){if(records.length>=40)throw Error('확장 수집함이 가득 찼습니다. 앱에서 보관된 상품을 불러와주세요.');await recheckReceiver(receiver,bounded);await store('put',record);}
  try{const before=await recheckReceiver(receiver,bounded);const result=await deliver(record,tab,bounded,store,before);await activateReceiver(receiver,bounded);return {ok:true,delivered:true,duplicate:result.duplicate===true,id:record.id,ownerId:record.ownerId,company:{code:record.company.code,name:record.company.name},fingerprint:record.fingerprint,...(result.storedReceipt?{storedReceipt:result.storedReceipt}:{}),...(pendingSnapshotReplayed?{pendingSnapshotReplayed:true,newCaptureStored:false}:{})};}
  catch(error){return {ok:true,delivered:false,id:record.id,message:error.message,...(pendingSnapshotReplayed?{pendingSnapshotReplayed:true,newCaptureStored:false}:{})};}
 })();pending.set(sender.tab.id,{promise:run,receiver:receiving,windowId:sender.tab.windowId,sourceUrl:snapshot.sourceUrl,offerId:snapshot.offerId,fingerprint});try{return await run;}finally{if(pending.get(sender.tab.id)?.promise===run)pending.delete(sender.tab.id);}
}
export async function flushPageSources(_message,sender,api=chrome,store=sourceInboxStore){
 const origin=appSender(sender),tab={id:sender.tab.id,windowId:sender.tab.windowId,url:sender.url},scope=await context(api,tab);
 if(scope.origin!==origin)throw Error('앱 출처가 변경되었습니다.');
 // A lost app result may be retried from another tab in the same window.
 // Revalidate its current identity before sharing only this exact queue run.
 const key=JSON.stringify([tab.windowId,origin,scope.ownerId,scope.company.code,scope.company.name]);
 const existing=flushing.get(key);if(existing)return existing;
 const run=(async()=>{
  const records=(await store('list')).filter(record=>record.windowId===tab.windowId&&same(record,scope));
  let delivered=0;const errors=[];
  for(const record of records){try{await deliver(record,tab,api,store);delivered++;}catch(error){errors.push(error.message);}}
  return {ok:true,ownerId:scope.ownerId,company:scope.company,delivered,pending:records.length-delivered,errors};
 })();
 flushing.set(key,run);try{return await run;}finally{if(flushing.get(key)===run)flushing.delete(key);}
}
