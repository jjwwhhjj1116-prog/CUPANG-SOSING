export type CliLoopbackPermission='granted'|'prompt'|'denied'|'unsupported'|'unavailable'|'timeout';
export type CliBrowserEnvironmentReport={secureContext:boolean;visibility:'visible'|'hidden'|'unknown';loopbackPermission:CliLoopbackPermission};
type ReadOnlyEnvironment={secureContext?:unknown;visibility?:unknown;permissions?:unknown};
type PermissionReader={query(descriptor:{name:'loopback-network'}):unknown};

function browserEnvironment():ReadOnlyEnvironment{
 const value:ReadOnlyEnvironment={};
 try{value.secureContext=globalThis.isSecureContext;}catch{}
 try{value.visibility=typeof document==='undefined'?undefined:document.visibilityState;}catch{}
 try{value.permissions=typeof navigator==='undefined'?undefined:navigator.permissions;}catch{}
 return value;
}
function rejectionState(error:unknown):'unsupported'|'unavailable'{
 // Never inspect or return exception messages; they may contain runtime URLs.
 try{const name=error&&typeof error==='object'?'name' in error?error.name:undefined:undefined;return name==='TypeError'||name==='NotSupportedError'?'unsupported':'unavailable';}catch{return'unavailable';}
}

/** Read-only browser capability diagnosis. It neither asks for permission nor
 * makes a request to a local socket. Do not fall back to the legacy permission
 * name: old Chromium versions can fail while querying that alias. */
export async function readCliBrowserEnvironment(options:{environment?:ReadOnlyEnvironment;timeoutMs?:number}={}):Promise<CliBrowserEnvironmentReport>{
 const environment=options.environment??browserEnvironment();
 let secureContext=false,visibility:CliBrowserEnvironmentReport['visibility']='unknown',permissions:unknown;
 try{secureContext=environment.secureContext===true;}catch{}
 try{visibility=environment.visibility==='visible'?'visible':environment.visibility==='hidden'?'hidden':'unknown';}catch{}
 try{permissions=environment.permissions;}catch{return{secureContext,visibility,loopbackPermission:'unavailable'};}
 const result=(loopbackPermission:CliLoopbackPermission):CliBrowserEnvironmentReport=>({secureContext,visibility,loopbackPermission});
 let reader:PermissionReader;
 try{if(!permissions||typeof permissions!=='object'||!('query' in permissions)||typeof permissions.query!=='function')return result('unsupported');reader=permissions as PermissionReader;}catch{return result('unavailable');}
 if(!secureContext)return result('unavailable');
 const requested=options.timeoutMs,timeoutMs=typeof requested==='number'&&Number.isFinite(requested)?Math.min(2000,Math.max(20,Math.trunc(requested))):1000;
 return new Promise(resolve=>{
  let complete=false;
  const finish=(state:CliLoopbackPermission)=>{if(complete)return;complete=true;clearTimeout(timer);resolve(result(state));};
  const timer=setTimeout(()=>finish('timeout'),timeoutMs);
  void Promise.resolve().then(()=>reader.query({name:'loopback-network'})).then(status=>{
   if(complete)return;
   try{const state=status&&typeof status==='object'&&'state' in status?status.state:undefined;finish(state==='granted'||state==='prompt'||state==='denied'?state:'unavailable');}catch{finish('unavailable');}
  },error=>finish(rejectionState(error)));
 });
}
