/** Keep an observed owned-document record across a reload of that same tab.
 * Storage is only a mirror: it never proves a remote ACK or authorizes replay.
 * The observer runs outside the API response path. A local storage failure can
 * block the next write, but cannot turn an already received remote ACK into a
 * failed request. This function performs no network request or native click.
 */
export function singleRecordMirrorPage(input){
 if(typeof input==='string')input=JSON.parse(input);
 const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
 const same=(a,b)=>canon(a)===canon(b),object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),id=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
 const binding=input?.binding,target=input?.target,known=input?.knownDocId,root=document.documentElement,limit=8*1024*1024;
 const validPath=location.pathname==='/dashboard/KR'||location.pathname==='/sr/registration'||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname);
 if(location.origin!=='https://supplier.coupang.com'||!validPath||!object(binding)||!object(binding.identity)||!object(target)
  ||!Number.isSafeInteger(target.tabId)||target.tabId<0||target.tabId===binding.identity.appTabId||target.windowId!==binding.identity.windowId
  ||target.origin!==location.origin||target.requestId!==binding.requestId||target.packetDigest!==binding.packetDigest
  ||typeof binding.requestId!=='string'||!/^\w[\w-]{0,99}$/.test(binding.requestId)||!['packetDigest','identityDigest','preparedBodySha256','originalBodySha256'].every(key=>/^[a-f0-9]{64}$/.test(binding[key]||''))
  ||known!==null&&known!==undefined&&!id(known))throw Error('원래 문서의 탭·요청 연결을 확인해주세요.');
 const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
 if(codes.length!==1||codes[0]!==binding.identity.company?.code)throw Error('원래 문서의 로그인 회사를 확인해주세요.');
 const scope={tabId:target.tabId,windowId:target.windowId,origin:target.origin,requestId:target.requestId,packetDigest:target.packetDigest};
 const validRecord=record=>object(record)&&same(record.binding,binding)&&record.createOperationId===binding.requestId+':create'
  &&(record.docId===null&&record.state==='create-requested'||id(record.docId))&&Array.isArray(record.baselineDocIds)&&record.baselineDocIds.length<=10000
  &&record.baselineDocIds.every(value=>id(value)&&String(value)!==String(record.docId));
 const parse=text=>{if(typeof text!=='string'||text.length>limit)throw Error('기록 크기');return JSON.parse(text);};
 const key='yoofam-owned-document-mirror-v1:'+binding.packetDigest;
 const registry=globalThis.__yoofamOwnedDocumentMirrorsV1??(globalThis.__yoofamOwnedDocumentMirrorsV1=new Map());
 let state=registry.get(key);
 if(state&&(!same(state.binding,binding)||!same(state.target,scope)))throw Error('이 탭의 이전 문서 연결이 다릅니다.');
 if(!state){
  state={binding:JSON.parse(canon(binding)),target:scope,seen:false,ready:true,monitorReady:false,code:null};
  const records=()=>{const value=parse(root.dataset.yoofamSingleDocumentRecords||'{}');if(!object(value))throw Error('기록 형식');return value;};
  state.persist=()=>{
   try{const record=records()[binding.packetDigest];
    if(record===undefined){if(state.seen){state.ready=false;state.code='OWNED_RECORD_REMOVED';}return;}
    if(!validRecord(record))throw Error('문서 연결');
    const value={format:'yoofam-owned-document-mirror-v1',binding:state.binding,target:scope,record};
    const text=JSON.stringify(value);if(text.length>limit)throw Error('기록 크기');
    sessionStorage.setItem(key,text);state.seen=true;state.ready=state.monitorReady;state.code=state.ready?null:'OWNED_RECORD_STORAGE';
   }catch{state.ready=false;state.code='OWNED_RECORD_STORAGE';}
  };
  try{
   if(typeof MutationObserver!=='function')throw Error('기록 관찰');
   state.observer=new MutationObserver(()=>state.persist());
   state.observer.observe(root,{attributes:true,attributeFilter:['data-yoofam-single-document-records']});
   state.monitorReady=true;
  }catch{state.ready=false;state.code='OWNED_RECORD_STORAGE';}
  registry.set(key,state);
 }
 let restored=false;
 try{
  const records=parse(root.dataset.yoofamSingleDocumentRecords||'{}');if(!object(records))throw Error('기록 형식');
  const current=records[binding.packetDigest];
  const text=sessionStorage.getItem(key),saved=text===null?null:parse(text);
  if(saved!==null&&(!object(saved)||Object.keys(saved).sort().join(',')!=='binding,format,record,target'||saved.format!=='yoofam-owned-document-mirror-v1'
   ||!same(saved.binding,binding)||!same(saved.target,scope)||!validRecord(saved.record)))throw Error('보관 연결');
  if(current===undefined&&known!==null&&known!==undefined&&saved!==null){
   // A new page may restore an exact accepted-create document. Deleting a
   // record in a still-running page is a conflict, not permission to rewind.
   if(state.seen||String(saved.record.docId)!==String(known)
    ||Object.values(records).some(record=>record?.binding?.requestId===binding.requestId||String(record?.docId)===String(known)))throw Error('다른 관찰 기록');
   records[binding.packetDigest]=saved.record;root.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);restored=true;
  }else if(current!==undefined&&(!validRecord(current)||known!==null&&known!==undefined&&String(current.docId)!==String(known)
   ||!state.seen&&saved!==null&&!same(current,saved.record)))throw Error('현재 문서 연결');
  state.persist();
 }catch{state.ready=false;state.code='OWNED_RECORD_STORAGE';}
 return {format:'yoofam-owned-document-mirror-result-v1',ready:state.ready===true,restored,code:state.code};
}
