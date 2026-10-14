import {SingleDocumentError} from './single-document.mjs';
const ORIGIN='https://supplier.coupang.com';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const failure=message=>new SingleDocumentError('LOAD_OBSERVATION_UNCONFIRMED',message);

/** Observe the selected page's own draft loader. No request headers/body or
 * cookies are requested, retained or rewritten; response headers are discarded
 * after inspecting Content-Type.
 * The callback must perform only the read-only UI load, with no own API GET. */
export async function observeSingleDraftLoad({api,tabId,documentId,docId,timeoutMs=15000},dispatch){
  const names=['onBeforeRequest','onCompleted','onErrorOccurred','onBeforeRedirect'];
  if(!Number.isSafeInteger(tabId)||tabId<0||!UUID.test(documentId||'')||typeof dispatch!=='function'
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||names.some(name=>typeof api?.webRequest?.[name]?.addListener!=='function'||typeof api.webRequest[name].removeListener!=='function'))
    throw failure('문서 불러오기 요청을 관찰할 수 없습니다. 다음 단계는 실행하지 않았습니다.');
  if(!(typeof docId==='string'&&docId&&docId===docId.trim()&&docId.length<=200||Number.isSafeInteger(docId)&&docId>0))throw failure('소유한 새 문서 번호를 확인해주세요.');
  const url=ORIGIN+'/sr/draft/api/get-by-id/'+encodeURIComponent(String(docId)),filter={urls:[ORIGIN+'/sr/draft/api/get-by-id/*'],types:['xmlhttprequest'],tabId};
  let settle,settleFailure,done=false,seen=null,timer,invalid=null;const installed=[];
  const pending=new Promise(resolve=>{settle=resolve;});
  const rejected=new Promise(resolve=>{settleFailure=resolve;});
  const reject=message=>{invalid??=failure(message);settleFailure(invalid);if(!done){done=true;settle({error:invalid});}};
  const scope=details=>details?.tabId===tabId&&details.frameId===0;
  const valid=details=>details.documentId===documentId&&details.documentLifecycle==='active'&&details.frameType==='outermost_frame'
    &&details.initiator===ORIGIN&&details.method==='GET'&&details.type==='xmlhttprequest'&&details.url===url
    &&typeof details.requestId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(details.requestId)&&Number.isFinite(details.timeStamp)&&details.timeStamp>0;
  const before=details=>{
    if(!scope(details))return;
    if(!valid(details)||seen){reject('선택한 새 문서와 불러오기 요청·화면이 일치하지 않습니다.');return;}
    seen={requestId:details.requestId,timeStamp:details.timeStamp};
  };
  const completed=details=>{
    if(!scope(details))return;
    const types=Array.isArray(details.responseHeaders)?details.responseHeaders.filter(header=>typeof header?.name==='string'&&header.name.toLowerCase()==='content-type').map(header=>header.value):[];
    if(done||!valid(details)||!seen||seen.requestId!==details.requestId||details.timeStamp<seen.timeStamp||details.statusCode!==200||details.fromCache!==false
      ||types.length!==1||typeof types[0]!=='string'||!/^application\/json(?:\s*;|$)/i.test(types[0])){
      reject('새 문서 불러오기의 직접 JSON 응답을 확인하지 못했습니다.');return;
    }
    done=true;settle({observation:{docId,requestId:seen.requestId,documentId,tabId,frameId:0,statusCode:200,fromCache:false,contentType:types[0],url}});
  };
  const failed=details=>{if(scope(details))reject('문서 불러오기 요청이 실패하거나 다른 주소로 이동했습니다.');};
  const callbacks=[before,completed,failed,failed];
  try{
    for(let i=0;i<names.length;i++){
      const event=api.webRequest[names[i]];
      installed.push([event,callbacks[i]]);
      if(names[i]==='onCompleted')event.addListener(callbacks[i],filter,['responseHeaders']);else event.addListener(callbacks[i],filter);
    }
    const deadline=new Promise((_,rejectDeadline)=>{timer=setTimeout(()=>{
      reject('문서번호와 연결된 불러오기 응답이 없습니다. 다시 선택하거나 진행하지 않았습니다.');rejectDeadline(invalid);
    },timeoutMs);});
    const operation=(async()=>{
      const loaded=await dispatch();
      const result=await pending;if(invalid||result.error)throw invalid??result.error;
      return {loaded,observation:result.observation};
    })();
    return await Promise.race([operation,deadline,rejected.then(error=>{throw error;})]);
  }finally{
    clearTimeout(timer);
    let cleanupFailed=false;for(const [event,callback] of installed.reverse())try{event.removeListener(callback);}catch{cleanupFailed=true;}
    if(cleanupFailed)throw failure('문서 조회 관찰 정리를 확인하지 못했습니다. 다음 단계는 실행하지 않았습니다.');
  }
}
