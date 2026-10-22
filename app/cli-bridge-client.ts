/** First-party browser transport. The CLI never receives browser credentials. */
export type CliScope={ownerId:string;company:{code:string;name:string}};
export type CliLink={port:number;token:string;sessionId:string;host?:'127.0.0.1'|'localhost'};
export type CliBridgeState={phase:'idle'|'connecting'|'connected'|'stopped';message:string;lastResult?:{command:string;title?:string;optionCount?:number;provider?:string;configured?:boolean;liveVerified?:false;stored:false}};
export type CliBridgeStage='scope'|'pair'|'verify'|'poll'|'command'|'result'|'abort'|'disconnect';
export type CliBridgeDiagnostic={stage:CliBridgeStage;target:'app'|'localhost';outcome:'start'|'response'|'timeout'|'cancelled'|'failed';status?:number};
type DiagnosticCallback=(event:CliBridgeDiagnostic)=>void;
type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;
type LoopbackRequestInit=RequestInit&{targetAddressSpace?:'loopback'};
type JsonRecord=Record<string,unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JSON=2*1024*1024;
const TTL=15*60*1000;
const SERVER_ERRORS:Record<string,string>={INVALID_QUERY_ORIGIN:'로그인된 YOOFAM 앱에서 상품조회를 요청해주세요.',INVALID_QUERY_REQUEST:'상품조회 요청 형식을 확인해주세요.',QUERY_SCOPE_CHANGED:'상품조회 중 로그인 계정·회사가 변경되었습니다.',SOURCE_QUERY_CANCELLED:'상품조회를 취소했습니다.',QUERY_UNAVAILABLE:'상품조회 서버 응답을 확인하지 못했습니다.',INVALID_SOURCE_URL:'1688 상품 상세 URL을 확인해주세요.',SOURCE_CONFIGURATION_REQUIRED:'1688 상품조회 API의 서버 설정이 필요합니다.',SOURCE_PROVIDER_FAILED:'상품조회 API에서 유효한 상품 원문을 받지 못했습니다.',SOURCE_NOT_COLLECTED:'상품 페이지에서 유효한 원문을 받지 못했습니다.',SOURCE_RESULT_INVALID:'상품번호·옵션·가격·이미지 원문을 확인하지 못했습니다.'};
const object=(value:unknown):value is JsonRecord=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
export class CliBridgeError extends Error{constructor(readonly code:string,message:string){super(message);this.name='CliBridgeError';}}
function diagnose(callback:DiagnosticCallback|undefined,event:CliBridgeDiagnostic){try{callback?.(event);}catch{/* Diagnostic observers must not change transport behavior. */}}
/** AbortSignal alone cannot bound a stalled fetch/body implementation. Settle
 * the caller at the deadline as well, and discard any eventual late value. */
function withDeadline<T>(operation:(signal:AbortSignal)=>Promise<T>,options:{timeoutMs:number;signals:(AbortSignal|undefined)[];timeoutError:CliBridgeError;onDiagnostic?:DiagnosticCallback;stage:CliBridgeStage;target:'app'|'localhost'}):Promise<T>{
 const {onDiagnostic,stage,target}=options;
 return new Promise<T>((resolve,reject)=>{
  const controller=new AbortController();let settled=false;const parents=options.signals.filter((signal):signal is AbortSignal=>Boolean(signal));
  const cleanup=()=>{clearTimeout(timer);for(const signal of parents)signal.removeEventListener('abort',cancel);};
  const finish=(ok:boolean,value:unknown)=>{if(settled)return;settled=true;cleanup();if(ok)resolve(value as T);else reject(value);};
  const cancel=()=>{if(settled)return;controller.abort();diagnose(onDiagnostic,{stage,target,outcome:'cancelled'});finish(false,new CliBridgeError('REQUEST_CANCELLED','현재 연결 요청을 취소했습니다.'));};
  const timer=setTimeout(()=>{if(settled)return;controller.abort();diagnose(onDiagnostic,{stage,target,outcome:'timeout'});finish(false,options.timeoutError);},options.timeoutMs);
  for(const signal of parents)signal.addEventListener('abort',cancel,{once:true});
  diagnose(onDiagnostic,{stage,target,outcome:'start'});
  if(parents.some(signal=>signal.aborted)){cancel();return;}
  void Promise.resolve().then(()=>{if(settled)return undefined;return operation(controller.signal);}).then(value=>{if(!settled)finish(true,value);},error=>{if(!settled){diagnose(onDiagnostic,{stage,target,outcome:'failed'});finish(false,error);}});
 });
}
export function parseCliLink(hash:string):CliLink{
 const query=new URLSearchParams(hash.replace(/^#/,''));
 if([...query.keys()].some(key=>!['port','token','session','host'].includes(key))||['port','token','session'].some(key=>query.getAll(key).length!==1)||query.getAll('host').length>1)throw new CliBridgeError('LINK_INVALID','CLI에서 출력한 연결 주소를 다시 열어주세요.');
 const rawPort=query.get('port')??'',token=query.get('token')??'',sessionId=query.get('session')??'';
 if(!/^[1-9]\d{3,4}$/.test(rawPort)||Number(rawPort)<1024||Number(rawPort)>65535||!/^[0-9a-f]{64}$/i.test(token)||!UUID.test(sessionId))throw new CliBridgeError('LINK_INVALID','CLI 연결 주소의 포트 또는 일회용 세션을 확인해주세요.');
 const host=query.get('host');if(host!==null&&host!=='127.0.0.1'&&host!=='localhost')throw new CliBridgeError('LINK_INVALID','이 컴퓨터의 로컬 CLI 주소만 연결할 수 있습니다.');
 return{port:Number(rawPort),token,sessionId,...(host===null?{}:{host})};
}
export function parseCliScope(value:unknown):CliScope{
 if(!object(value)||typeof value.ownerId!=='string'||!value.ownerId.trim()||value.ownerId.length>256||/[\u0000-\u001f]/.test(value.ownerId)||!object(value.company)||typeof value.company.code!=='string'||typeof value.company.name!=='string'||!((value.company.code==='A01526306'&&value.company.name==='유앤채')||(value.company.code==='A01464742'&&value.company.name==='와이홉')))throw new CliBridgeError('SCOPE_UNCONFIRMED','현재 로그인 계정의 승인 회사를 확인하지 못했습니다.');
 return{ownerId:value.ownerId,company:{code:value.company.code,name:value.company.name}};
}
export function sameCliScope(left:CliScope,right:CliScope){return left.ownerId===right.ownerId&&left.company.code===right.company.code&&left.company.name===right.company.name;}
async function boundedJson(response:Response):Promise<unknown>{
 if(response.redirected||response.type==='opaqueredirect'||!/^(application\/json|application\/[\w.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??''))throw new CliBridgeError('RESPONSE_UNCERTAIN','로그인 또는 JSON 응답을 확인하지 못했습니다. 연결을 다시 확인해주세요.');
 const advertised=response.headers.get('content-length');if(advertised&&(!/^\d+$/.test(advertised)||Number(advertised)>MAX_JSON))throw new CliBridgeError('RESPONSE_TOO_LARGE','응답이 허용 크기를 초과했습니다.');
 const reader=response.body?.getReader();if(!reader)throw new CliBridgeError('RESPONSE_UNCERTAIN','응답 본문을 확인하지 못했습니다.');
 let length=0;const parts:Uint8Array[]=[];
 try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>MAX_JSON)throw new CliBridgeError('RESPONSE_TOO_LARGE','응답이 허용 크기를 초과했습니다.');parts.push(next.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new CliBridgeError('RESPONSE_UNCERTAIN','JSON 응답을 해석하지 못했습니다.');}
}
export async function readCliScope(fetcher:Fetcher=fetch,signal?:AbortSignal,diagnostic?:{onDiagnostic?:DiagnosticCallback;stage?:'scope'|'verify'}):Promise<CliScope>{
 const stage=diagnostic?.stage??'scope';
 try{return await withDeadline(async guardedSignal=>{
  const response=await fetcher('/api/supplier-hub/catalog-context',{credentials:'same-origin',cache:'no-store',redirect:'manual',signal:guardedSignal});
  if(guardedSignal.aborted)throw new CliBridgeError('REQUEST_CANCELLED','현재 연결 요청을 취소했습니다.');
  diagnose(diagnostic?.onDiagnostic,{stage,target:'app',outcome:'response',status:response.status});
  if(!response.ok)throw new CliBridgeError('SCOPE_UNCONFIRMED','YOOFAM 앱의 로그인 또는 승인 회사가 변경되었습니다. 다시 로그인 상태를 확인해주세요.');return parseCliScope(await boundedJson(response));
 },{timeoutMs:10000,signals:[signal],timeoutError:new CliBridgeError('APP_SCOPE_TIMEOUT','YOOFAM 앱의 로그인 회사 확인 응답이 지연되었습니다. 앱 로그인 상태를 확인한 뒤 다시 연결해주세요.'),onDiagnostic:diagnostic?.onDiagnostic,stage,target:'app'});}
 catch(error){if(error instanceof CliBridgeError)throw error;throw new CliBridgeError('APP_SCOPE_NETWORK','YOOFAM 앱의 로그인 회사 확인에 연결하지 못했습니다. 앱 연결 상태를 확인해주세요.');}
}
function commandRequest(command:unknown,payload:unknown,queryApproved:boolean):{path:string;method:'GET'|'POST';body?:unknown}{
 if(!object(payload))throw new CliBridgeError('COMMAND_INVALID','CLI 명령의 입력 형식이 올바르지 않습니다.');
 const keys=Object.keys(payload);
 if(command==='status'&&keys.length===0)return{path:'/api/product-query',method:'GET'};
 if(command==='product-query'){
  if(!queryApproved)throw new CliBridgeError('QUERY_NOT_APPROVED','브라우저 연결 화면에서 상품조회를 별도로 허용해주세요.');
  if(keys.length!==1||keys[0]!=='sourceUrl'||typeof payload.sourceUrl!=='string'||payload.sourceUrl.length>2000)throw new CliBridgeError('COMMAND_INVALID','1688 상품 주소 하나가 필요합니다.');
  let url:URL;try{url=new URL(payload.sourceUrl);}catch{throw new CliBridgeError('COMMAND_INVALID','1688 상품 주소를 확인해주세요.');}
  if(url.protocol!=='https:'||url.hostname!=='detail.1688.com'||url.port||url.username||url.password||!/^\/offer\/\d{8,20}\.html$/.test(url.pathname))throw new CliBridgeError('COMMAND_INVALID','1688의 HTTPS 상품 상세 주소만 조회할 수 있습니다.');
  return{path:'/api/product-query',method:'POST',body:{sourceUrl:url.toString()}};
 }
 if(command==='category-profiles/list'&&keys.length===0)return{path:'/api/cli-read?resource=category-profiles',method:'GET'};
 if(command==='collection-job/status'&&keys.length===1&&keys[0]==='jobId'&&typeof payload.jobId==='string'&&UUID.test(payload.jobId))return{path:'/api/cli-read?resource=collection-job&jobId='+encodeURIComponent(payload.jobId),method:'GET'};
 throw new CliBridgeError('COMMAND_NOT_ALLOWED','이 연결에서는 상품조회와 읽기 전용 상태 확인만 지원합니다.');
}
type Job={jobId:string;command:string;payload:JsonRecord;scope:CliScope;deadline:number};
function parseJob(value:unknown,scope:CliScope,now:number):Job{
 if(!object(value)||typeof value.jobId!=='string'||!UUID.test(value.jobId)||typeof value.command!=='string'||!object(value.payload)||!sameCliScope(parseCliScope(value.scope),scope)||typeof value.createdAt!=='number'||!Number.isSafeInteger(value.createdAt)||value.createdAt>now+60000||typeof value.deadline!=='number'||!Number.isSafeInteger(value.deadline)||value.deadline<=now||value.deadline<=value.createdAt||value.deadline>now+TTL)throw new CliBridgeError('JOB_UNCERTAIN','CLI 요청의 회사 또는 유효 시간을 확인하지 못했습니다.');
 return{jobId:value.jobId,command:value.command,payload:value.payload,scope,deadline:value.deadline};
}
export function createCliBridge(options:{link:CliLink;scope:CliScope;queryApproved:()=>boolean;fetcher?:Fetcher;onState?:(state:CliBridgeState)=>void;onDiagnostic?:DiagnosticCallback;now?:()=>number;contextIntervalMs?:number}){
 const fetcher=options.fetcher??fetch,now=options.now??Date.now,scope=parseCliScope(options.scope),controller=new AbortController();
 if(options.link.host!==undefined&&options.link.host!=='127.0.0.1'&&options.link.host!=='localhost')throw new CliBridgeError('LINK_INVALID','이 컴퓨터의 로컬 CLI 주소만 연결할 수 있습니다.');
 const local='http://'+(options.link.host??'127.0.0.1')+':'+options.link.port;let active=false,used=false,epoch=0,timer:ReturnType<typeof setInterval>|undefined,expiryTimer:ReturnType<typeof setTimeout>|undefined,expiresAt=0,checking=false,inflightQuery:AbortController|null=null;
 const emit=(state:CliBridgeState)=>options.onState?.(state);
 const stop=(message='CLI 연결을 해제했습니다.')=>{if(!active&&used)return;active=false;epoch++;controller.abort();clearInterval(timer);clearTimeout(expiryTimer);emit({phase:'stopped',message});};
 function current(generation:number){if(!active||generation!==epoch||controller.signal.aborted||now()>=expiresAt)throw new CliBridgeError('SESSION_STOPPED','CLI 연결이 끝났습니다.');}
 async function json(path:string,init:RequestInit,loopback=false,timeoutMs=30000,extraSignal?:AbortSignal){
  const stage:CliBridgeStage=loopback?path==='/pair'?'pair':path==='/result'?'result':path==='/abort'?'abort':'poll':'command',target=loopback?'localhost' as const:'app' as const;
  try{return await withDeadline(async guardedSignal=>{
   // Declare the destination address space without changing permission, CORS,
   // credentials or the exact host/token contract. Older browsers ignore it.
   const request:LoopbackRequestInit={...init,...(loopback?{targetAddressSpace:'loopback' as const}:{}),credentials:loopback?'omit':'same-origin',cache:'no-store',redirect:'manual',signal:guardedSignal,headers:{'content-type':'application/json',...(loopback?{authorization:'Bearer '+options.link.token}:{}),...init.headers}};
   const response=await fetcher((loopback?local:'')+path,request);
   if(guardedSignal.aborted)throw new CliBridgeError('REQUEST_CANCELLED','현재 연결 요청을 취소했습니다.');
   diagnose(options.onDiagnostic,{stage,target,outcome:'response',status:response.status});
   const value=await boundedJson(response);if(!response.ok){if(!loopback&&object(value)&&typeof value.code==='string'&&Object.hasOwn(SERVER_ERRORS,value.code))throw new CliBridgeError(value.code,SERVER_ERRORS[value.code]);throw new CliBridgeError('REQUEST_FAILED',loopback?'로컬 CLI 응답을 확인하지 못했습니다.':'상품조회 서버가 요청을 완료하지 못했습니다.');}return value;
  },{timeoutMs,signals:[controller.signal,extraSignal],timeoutError:new CliBridgeError(loopback?'LOCAL_CLI_TIMEOUT':'APP_REQUEST_TIMEOUT',loopback?'내 컴퓨터 CLI의 응답 시간을 초과했습니다. 현재 컴퓨터에서 CLI가 실행 중인지 확인해주세요.':'YOOFAM 앱 서버의 응답 시간을 초과했습니다. 앱 연결 상태를 확인해주세요.'),onDiagnostic:options.onDiagnostic,stage,target});}
  catch(error){if(error instanceof CliBridgeError)throw error;throw new CliBridgeError(loopback?'LOCAL_CLI_NETWORK':'APP_REQUEST_NETWORK',loopback?'내 컴퓨터 CLI에 연결하지 못했습니다. CLI 실행 상태와 브라우저 연결 설정을 확인해주세요.':'YOOFAM 앱 서버에 연결하지 못했습니다. 앱 연결 상태를 확인해주세요.');}
 }
 async function checkScope(generation:number,stage:'scope'|'verify'='verify'){current(generation);const actual=await readCliScope(fetcher,controller.signal,{onDiagnostic:options.onDiagnostic,stage});current(generation);if(!sameCliScope(actual,scope)){stop('계정 또는 회사가 변경되어 CLI 연결을 해제했습니다.');throw new CliBridgeError('SCOPE_CHANGED','현재 로그인 회사가 달라졌습니다.');}}
 async function deliver(job:Job,generation:number,reply:JsonRecord){current(generation);await checkScope(generation);current(generation);const ack=await json('/result',{method:'POST',body:JSON.stringify({sessionId:options.link.sessionId,jobId:job.jobId,scope,...reply})},true);current(generation);if(!object(ack)||ack.ok!==true)throw new CliBridgeError('RESULT_ACK_UNCERTAIN','CLI 결과 수신을 확인하지 못했습니다.');}
 async function processJob(job:Job,generation:number){
  await checkScope(generation);let result:unknown;let reply:JsonRecord;const queryController=job.command==='product-query'?new AbortController():null;
  try{
   const request=commandRequest(job.command,job.payload,options.queryApproved());current(generation);
   if(job.deadline<=now())throw new CliBridgeError('JOB_EXPIRED','CLI 요청의 유효 시간이 끝났습니다.');
   const body=request.body?{...request.body as JsonRecord,expectedOwnerId:scope.ownerId,expectedCompany:scope.company}:undefined;
   inflightQuery=queryController;
   result=await json(request.path,{method:request.method,headers:{'x-yoofam-cli-scope':encodeURIComponent(JSON.stringify(scope))},...(body?{body:JSON.stringify(body)}:{})},false,Math.max(1,Math.min(55000,job.deadline-now(),expiresAt-now())),queryController?.signal);
   await checkScope(generation);if(job.deadline<=now())throw new CliBridgeError('JOB_EXPIRED','CLI 요청의 유효 시간이 끝났습니다.');
   if(queryController?.signal.aborted||job.command==='product-query'&&!options.queryApproved())throw new CliBridgeError('QUERY_CANCELLED','상품조회 허용을 해제해 진행 중인 조회를 취소했습니다.');
   if(!object(result)||!sameCliScope(parseCliScope(result),scope))throw new CliBridgeError('RESULT_SCOPE_UNCERTAIN','CLI 조회 결과의 회사를 확인하지 못했습니다.');
   if(job.command==='product-query'&&(!object(result)||result.sourceStored!==false||result.draftCreated!==false))throw new CliBridgeError('RESULT_UNCERTAIN','상품조회 결과의 저장 여부를 확인하지 못했습니다.');
   if(job.command==='product-query'){
    const expected=new URL(String(job.payload.sourceUrl)).pathname.match(/^\/offer\/(\d+)\.html$/)?.[1];
    let returned:URL|undefined;try{if(object(result)&&object(result.source)&&typeof result.source.sourceUrl==='string')returned=new URL(result.source.sourceUrl);}catch{}
    if(!object(result)||!object(result.source)||result.offerId!==expected||result.source.offerId!==expected||returned?.protocol!=='https:'||returned.hostname!=='detail.1688.com'||returned.pathname!==`/offer/${expected}.html`||returned.port||returned.username||returned.password)throw new CliBridgeError('RESULT_OFFER_UNCERTAIN','요청한 상품번호와 조회 원문이 다릅니다.');
   }
   if(job.command==='status'&&(!object(result)||!object(result.service)||result.service.format!=='yoofam-product-query-service-v1'||!['public-page','alibaba-api','unavailable'].includes(String(result.service.provider))||typeof result.service.configured!=='boolean'||result.service.liveVerified!==false||result.service.queryPath!=='/api/product-query'))throw new CliBridgeError('RESULT_UNCERTAIN','상품조회 서버의 구성 상태를 확인하지 못했습니다.');
   reply={ok:true,result};
  }catch(error){
   if(error instanceof CliBridgeError&&error.code==='QUERY_SCOPE_CHANGED'){stop(error.message);throw error;}
   current(generation);await checkScope(generation);
   const cancelled=queryController?.signal.aborted,code=cancelled?'QUERY_CANCELLED':error instanceof CliBridgeError?error.code:'REQUEST_FAILED',message=cancelled?'상품조회 허용을 해제해 진행 중인 조회를 취소했습니다.':error instanceof CliBridgeError?error.message:'요청 결과를 확인하지 못했습니다.';
   reply={ok:false,error:{code,message}};
  }finally{if(inflightQuery===queryController)inflightQuery=null;}
  if(object(reply.error)&&reply.error.code==='QUERY_CANCELLED'){
   await checkScope(generation);current(generation);const ack=await json('/abort',{method:'POST',body:JSON.stringify({sessionId:options.link.sessionId,jobId:job.jobId,scope})},true);current(generation);
   if(!object(ack)||ack.ok!==true)throw new CliBridgeError('ABORT_UNCERTAIN','CLI 조회 취소를 확인하지 못했습니다.');emit({phase:'connected',message:'상품조회 허용을 해제해 진행 중인 조회를 취소했습니다.'});return;
  }
  // An uncertain /result response stops the session; it is never replayed as a second result.
  await deliver(job,generation,reply);
  if(reply.ok!==true){emit({phase:'connected',message:object(reply.error)&&typeof reply.error.message==='string'?reply.error.message:'요청 결과를 확인하지 못했습니다.'});return;}
  const source=object(result)&&object(result.source)?result.source:null;
  const service=job.command==='status'&&object(result)&&object(result.service)?result.service:null;
  emit({phase:'connected',message:job.command==='product-query'?'상품조회가 끝났습니다. 수집함 저장과 초안 생성은 아직 하지 않았습니다.':'CLI 읽기 요청을 처리했습니다.',lastResult:{command:job.command,...(source&&typeof source.title==='string'?{title:source.title.slice(0,200)}:{}),...(source&&Array.isArray(source.options)?{optionCount:source.options.length}:{}),...(service?{provider:String(service.provider),configured:service.configured===true,liveVerified:false as const}:{}),stored:false}});
 }
 async function poll(generation:number){
  try{while(active){await checkScope(generation);const response=await json('/next?sessionId='+encodeURIComponent(options.link.sessionId)+'&waitMs=25000',{method:'GET'},true);current(generation);if(!object(response)||response.ok!==true||!Object.hasOwn(response,'job'))throw new CliBridgeError('RESPONSE_UNCERTAIN','CLI 대기 응답을 확인하지 못했습니다.');if(response.job!==null)await processJob(parseJob(response.job,scope,now()),generation);}}
  catch(error){if(active)stop(error instanceof CliBridgeError?error.message:'CLI 연결이 끊어졌습니다. 로컬 CLI와 로그인 상태를 확인해주세요.');}
 }
 return{
  async start(){
   if(used)throw new CliBridgeError('SESSION_USED','새 CLI 연결 주소로 다시 연결해주세요.');used=true;active=true;const generation=++epoch;expiresAt=now()+TTL;emit({phase:'connecting',message:'현재 회사와 로컬 CLI를 확인하고 있습니다.'});
   try{await checkScope(generation,'scope');const response=await json('/pair',{method:'POST',body:JSON.stringify({sessionId:options.link.sessionId,scope})},true);current(generation);
    if(!object(response)||response.ok!==true||response.protocolVersion!=='1.0'||response.sessionId!==options.link.sessionId||!sameCliScope(parseCliScope(response.scope),scope)||typeof response.expiresAt!=='number'||!Number.isSafeInteger(response.expiresAt)||response.expiresAt<=now()||response.expiresAt>expiresAt+1000)throw new CliBridgeError('PAIR_UNCERTAIN','CLI의 연결 세션 또는 회사를 확인하지 못했습니다.');
    expiresAt=Math.min(expiresAt,response.expiresAt);await checkScope(generation);current(generation);
    timer=setInterval(()=>{if(checking||!active)return;checking=true;void checkScope(generation).catch(error=>{if(active)stop(error instanceof CliBridgeError?error.message:'로그인 상태를 확인하지 못해 연결을 해제했습니다.');}).finally(()=>{checking=false;});},options.contextIntervalMs??5000);
    expiryTimer=setTimeout(()=>stop('15분 연결 시간이 끝났습니다. CLI에서 새 연결 주소를 만들어주세요.'),Math.max(1,expiresAt-now()));
    emit({phase:'connected',message:'로컬 CLI가 현재 회사에 연결되었습니다. 상품조회는 별도 허용 후 실행됩니다.'});void poll(generation);
   }catch(error){stop(error instanceof CliBridgeError?error.message:'로컬 CLI 연결을 확인하지 못했습니다. 실행 중인 CLI와 브라우저의 로컬 네트워크 권한을 확인해주세요.');throw error;}
  },
  stop,
  cancelProductQuery(){inflightQuery?.abort();},
  async disconnect(){
   if(!active){stop();return;}const wasScope=scope;stop();
   // No cookies and no job result may be sent after stop; only revoke this exact local pairing.
   try{await withDeadline(async signal=>{const request:LoopbackRequestInit={method:'POST',targetAddressSpace:'loopback',credentials:'omit',redirect:'manual',signal,headers:{'content-type':'application/json',authorization:'Bearer '+options.link.token},body:JSON.stringify({sessionId:options.link.sessionId,scope:wasScope})};const response=await fetcher(local+'/disconnect',request);if(!signal.aborted)diagnose(options.onDiagnostic,{stage:'disconnect',target:'localhost',outcome:'response',status:response.status});},{timeoutMs:3000,signals:[],timeoutError:new CliBridgeError('LOCAL_CLI_TIMEOUT','로컬 CLI 연결 해제 응답을 확인하지 못했습니다.'),onDiagnostic:options.onDiagnostic,stage:'disconnect',target:'localhost'});}catch{}
  },
 };
}
