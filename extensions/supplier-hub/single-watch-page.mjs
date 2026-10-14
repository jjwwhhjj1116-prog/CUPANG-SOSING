/** An isolated-world guard for this task's own page state. Trusted input in
 * the Hub interrupts automation; the human consent surface is in the app.
 * This does not inspect vendor state, cookies, tokens, or request bodies. */
export function singleDocumentWatchPage(input){
  const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
  const b=input.binding,data=document.documentElement.dataset,all=()=>JSON.parse(data.yoofamSingleDocumentRecords||'{}');
  const read=()=>{
    const r=all()[b.packetDigest];
    if(location.origin!=='https://supplier.coupang.com'||!/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname)
      ||!r||canon(r.binding)!==canon(b)||canon(r.docId)!==canon(input.docId)||canon(r.loadedDocId)!==canon(input.docId)||r.loadObservation?.documentId!==input.documentId)throw Error('현재 불러온 소유 문서와 브라우저 문서가 다릅니다.');
    return r;
  };
  const key=b.packetDigest,slots=globalThis.__yoofamSinglePageWatches??=new Map();
  const save=r=>{const records=all();records[key]=r;data.yoofamSingleDocumentRecords=JSON.stringify(records);};
  if(input.action==='close'||input.action==='invalid'){
    const r=all()[key];if(r?.watchToken===input.token&&canon(r.binding)===canon(b)&&canon(r.docId)===canon(input.docId)){r.watchState='invalid';r.watchReason=input.action==='close'?'closed':'browser-observation-changed';save(r);}
    const s=slots.get(key);if(s?.token===input.token){s.stop();slots.delete(key);}return {closed:true};
  }
  const record=read();
  if(input.action==='arm'){
    if(typeof input.token!=='string'||!/^[a-f0-9-]{36}$/i.test(input.token)||!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=Date.now()||input.expiresAt>Date.now()+600000
      ||typeof document.addEventListener!=='function'||typeof document.removeEventListener!=='function'||record.watchToken!==undefined||slots.has(key))throw Error('새 문서의 현재 관찰을 시작하지 못했습니다.');
    const events=['pointerdown','keydown','input','change'],oldTimer={value:null};
    const stop=()=>{clearTimeout(oldTimer.value);for(const name of events)document.removeEventListener(name,handle,true);};
    const invalid=reason=>{
      const current=all()[key];if(current?.watchToken===input.token){current.watchState='invalid';current.watchReason=reason;save(current);}stop();slots.delete(key);
    };
    const handle=event=>{if(event.isTrusted===true)invalid('hub-user-interaction');};
    try{for(const name of events)document.addEventListener(name,handle,true);}catch{stop();throw Error('문서 입력 관찰을 준비하지 못했습니다.');}
    oldTimer.value=setTimeout(()=>invalid('expired'),Math.max(1,input.expiresAt-Date.now()));oldTimer.value?.unref?.();
    record.watchToken=input.token;record.watchDocumentId=input.documentId;record.watchExpiresAt=input.expiresAt;record.watchState='active';save(record);
    slots.set(key,{token:input.token,stop});
  }else if(input.action!=='check')throw Error('알 수 없는 문서 관찰 동작입니다.');
  const current=read();
  if(current.watchState!=='active'||current.watchToken!==input.token||current.watchDocumentId!==input.documentId||Date.now()>=current.watchExpiresAt||slots.get(key)?.token!==input.token)throw Error('소유 문서의 현재 입력 관찰이 중단됐습니다. 다시 클릭하지 않았습니다.');
  return {current:true,token:current.watchToken,docId:current.docId,documentId:current.watchDocumentId,expiresAt:current.watchExpiresAt};
}
