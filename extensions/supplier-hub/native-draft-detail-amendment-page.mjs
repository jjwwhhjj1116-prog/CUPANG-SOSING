/** Trusted same-tab amendment boundary. The parent task record is immutable;
 * this separate mirror records actual dispatches/ACKs, never authorizes replay. */
export async function nativeDraftDetailAmendmentPage(input){
 if(typeof input==='string')input=JSON.parse(input);
 const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 const same=(a,b)=>canonical(a)===canonical(b),copy=value=>JSON.parse(canonical(value)),fail=code=>{throw Object.assign(Error('같은 저장 문서의 상세 수정 확인을 중단했습니다.'),{code});};
 const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),byte=>byte.toString(16).padStart(2,'0')).join('');
 const origin='https://supplier.coupang.com',root=document.documentElement,binding=input.parentBinding,doc=input.docId,key='yoofam-detail-amendment-v1:'+input.amendmentId;
 const originalRecords=()=>{const text=root.dataset.yoofamSingleDocumentRecords||'{}';if(text.length>8*1024*1024)fail('AMENDMENT_RECORD_SIZE');return JSON.parse(text);};
 let parentRecord,ledger;
 const fence=()=>{
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(document.documentElement!==root||location.origin!==origin||location.search||location.hash||!(['/dashboard/KR','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname))
   ||codes.length!==1||codes[0]!==binding?.identity?.company?.code||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company.name)fail('AMENDMENT_PAGE_SCOPE');
  let record=originalRecords()[binding.packetDigest];
  if(!record&&input.parentRecord){
   const saved=JSON.parse(sessionStorage.getItem('yoofam-owned-document-mirror-v1:'+binding.packetDigest)||'null');
   if(saved?.format!=='yoofam-owned-document-mirror-v1'||!same(saved.binding,binding)||!same(saved.record,input.parentRecord))fail('AMENDMENT_PARENT_RECORD');
   const all=originalRecords();all[binding.packetDigest]=copy(saved.record);root.dataset.yoofamSingleDocumentRecords=JSON.stringify(all);record=all[binding.packetDigest];
  }
  const recovered=record?.state==='updated'&&record.updateOperationId===undefined&&record.nativeAssets===undefined&&record.validation===undefined&&record.currentReadRecovery?.fileBodyWritesAllowed===false&&record.currentReadRecovery.historicalAckRecovered===false&&record.currentReadRecovery.proof?.readOnly===true&&record.currentReadRecovery.proof.remoteWrites===false;
  if(!record||!same(record.binding,binding)||!same(record.docId,doc)||record.createOperationId!==binding.requestId+':create'||record.state!=='validated'&&!recovered||record.submitOperationId||record.baselineDocIds?.some(id=>String(id)===String(doc))
    ||input.parentRecord&&!same(input.parentRecord,record)||parentRecord&&!same(parentRecord,record))fail('AMENDMENT_PARENT_RECORD');
  parentRecord=copy(record);
  const stored=sessionStorage.getItem(key),shown=root.dataset.yoofamDetailAmendments?JSON.parse(root.dataset.yoofamDetailAmendments)[input.amendmentId]:undefined;
  if(stored!==null){const parsed=JSON.parse(stored);if(parsed.format!=='yoofam-detail-amendment-page-v1'||parsed.amendmentId!==input.amendmentId||!same(parsed.parentBinding,binding)||!same(parsed.parentRecord,parentRecord)||!same(parsed.docId,doc)||shown&&!same(shown,parsed)||ledger&&!same(ledger,parsed))fail('AMENDMENT_CHILD_RECORD');ledger=parsed;}
  else if(ledger||shown)fail('AMENDMENT_CHILD_RECORD');
 };
 const save=value=>{fence();ledger=copy(value);const text=JSON.stringify(ledger);if(text.length>8*1024*1024)fail('AMENDMENT_RECORD_SIZE');sessionStorage.setItem(key,text);const all=JSON.parse(root.dataset.yoofamDetailAmendments||'{}');all[input.amendmentId]=ledger;root.dataset.yoofamDetailAmendments=JSON.stringify(all);};
 const request=async(path,method='GET',body,multipart=false)=>{
  fence();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{
   const url=origin+path,response=await fetch(url,{method,credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:'application/json',...(method==='POST'&&!multipart?{'content-type':'application/json;charset=UTF-8'}:{})},...(body!==undefined?{body:multipart?body:JSON.stringify(body)}:{})});
   fence();if(!response.ok||response.redirected||response.url!==url||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))fail('AMENDMENT_HTTP');
   const reader=response.body?.getReader();if(!reader)fail('AMENDMENT_HTTP');const chunks=[];let total=0;try{for(;;){const chunk=await reader.read();fence();if(chunk.done)break;total+=chunk.value.byteLength;if(total>6*1024*1024||controller.signal.aborted)fail('AMENDMENT_HTTP');chunks.push(chunk.value);}}finally{await reader.cancel();}
   const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(result&&typeof result==='object'&&!Array.isArray(result)&&(result.errorCode!==undefined&&result.errorCode!==null&&result.errorCode!==''||result.code!==undefined&&result.code!==200))fail('AMENDMENT_HTTP');return result;
  }finally{clearTimeout(timer);controller.abort();}
 };
 const read=async()=>{
  const id=encodeURIComponent(String(doc)),drafts=await request('/sr/draft/api/drafts'),requested=await request('/sr/draft/api/drafts/register-requested');
  if(!Array.isArray(drafts)||!Array.isArray(requested)||drafts.length>10000||requested.length>10000||drafts.filter(row=>same(row.docId,doc)&&row.status==='UNFINISHED'&&row.scope==='Retail_Categorized_Single').length!==1||requested.some(row=>String(row.docId)===String(doc)))fail('AMENDMENT_NOT_UNFINISHED');
  const remote=await request('/sr/draft/api/get-by-id/'+id);if(remote.status!=='UNFINISHED'||!same(remote.docId,doc))fail('AMENDMENT_NOT_UNFINISHED');
  const body=Object.fromEntries(['docId','productName','categoryPath','categoryId','displayCategoryCode','jsonDocument','scope','productNoticeNumber','version','remark'].filter(name=>Object.hasOwn(remote,name)).map(name=>[name,remote[name]]));
  const images=await request('/sr/draft/api/get-images-by-id/'+id),legal=await request('/sr/draft/api/get-files-by-type/'+id,'POST',{});
  const validImage=row=>{if(typeof row?.imageName!=='string'||!row.imageName||row.imageName.length>512||typeof row.s3Link!=='string'||!row.s3Link.trim()||row.s3Link.length>4096||/[\u0000-\u001f]/.test(row.s3Link)||typeof row.imageUrl!=='string'||row.imageUrl.length>4096||row.imageUrl.includes('\\')||!(/^(https:\/\/|\/[^/])/.test(row.imageUrl))||row.mainImage!==undefined&&typeof row.mainImage!=='boolean')return false;try{const url=new URL(row.imageUrl,origin);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}};
  if(!Array.isArray(images)||images.length>1000||!Array.isArray(legal)||legal.length>1000||images.some(row=>!validImage(row))||new Set(images.map(row=>row.imageName)).size!==images.length)fail('AMENDMENT_INVENTORY');
  return{body,images,legal};
 };
 fence();const before=await read();fence();
 if(input.action==='read')return{parentRecord,remote:before,ledger:ledger??null,readOnly:true};
 if(input.expectedRemote&&!same(before,input.expectedRemote))fail('AMENDMENT_REMOTE_CHANGED');
 const base=ledger??{format:'yoofam-detail-amendment-page-v1',amendmentId:input.amendmentId,parentBinding:copy(binding),parentRecord,docId:doc,state:'editing',validation:{}};
 if(input.action==='upload'){
  if(ledger)fail('AMENDMENT_ALREADY_REQUESTED');
  if(input.operationId!==binding.requestId+':amend:'+input.amendmentId+':assets:DETAIL')fail('AMENDMENT_OPERATION');
  const parts=input.parts;if(!Array.isArray(parts)||parts.length>150||parts.reduce((sum,part)=>sum+part.byteLength,0)>64*1024*1024)fail('AMENDMENT_PARTS');
  const names=new Set(before.images.map(row=>row.imageName)),form=new FormData();
  for(const part of parts){if(names.has(part.transportName)||typeof part.base64!=='string'||!['image/png','image/jpeg'].includes(part.contentType))fail('AMENDMENT_PARTS');names.add(part.transportName);const binary=atob(part.base64),bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));if(bytes.length!==part.byteLength||await hash(bytes)!==part.sha256)fail('AMENDMENT_PARTS');form.append('additionalImageFiles',new File([bytes],part.transportName,{type:part.contentType}));}
  const pending={...base,state:'upload-requested',uploadOperationId:input.operationId,expectedRemote:before,newFiles:parts.map(({base64:omitted,...metadata})=>{void omitted;return metadata;})};save(pending);
  const ack=parts.length?await request('/sr/draft/api/upload-images/'+encodeURIComponent(String(doc))+'?imageType=DETAIL','POST',form,true):[];
  if(!Array.isArray(ack)||ack.length!==parts.length||ack.some(row=>!parts.some(part=>part.transportName===row.imageName)||typeof row.imageUrl!=='string'||typeof row.s3Link!=='string'||row.mainImage!==undefined&&row.mainImage!==false)||new Set(ack.map(row=>row.imageName)).size!==ack.length)fail('AMENDMENT_UPLOAD_ACK');
  const after=await read(),expected={...before,images:[...before.images,...ack]};
  const sorted=value=>({...value,images:[...value.images].sort((a,b)=>a.imageName.localeCompare(b.imageName))});
  if(!same(sorted(after),sorted(expected))){save({...pending,state:'blocked',uploadAck:ack});fail('AMENDMENT_APPEND_UNCONFIRMED');}
  save({...pending,state:'files-saved',uploadAck:ack,remote:after});return{parentRecord,remote:after,ledger:copy(ledger),readOnly:parts.length===0};
 }
 if(input.action==='update'){
  if(ledger?.state!=='files-saved'||!same(before,ledger.remote)||!same(input.body?.docId,doc)||input.operationId!==binding.requestId+':amend:'+input.amendmentId+':update')fail('AMENDMENT_UPDATE_SCOPE');
  save({...ledger,state:'update-requested',updateOperationId:input.operationId,body:copy(input.body)});await request('/sr/draft/api/update','POST',input.body);save({...ledger,state:'updated',updateAck:true});
 }else if(input.action==='validate'){
  const step=input.step;if(!['updated','validated'].includes(ledger?.state)||![2,3,4,5].includes(step)||Object.keys(ledger.validation).length!==step-2||ledger.validation[step]||input.operationId!==binding.requestId+':amend:'+input.amendmentId+':validate:'+step)fail('AMENDMENT_VALIDATE_SCOPE');
  save({...ledger,state:'validation-requested',validation:{...ledger.validation,[step]:{state:'requested',operationId:input.operationId}}});
  const response=await request('/sr/qvt/api/validate-step/'+step,'POST',{docId:doc,version:input.version});
  const valid=response?.code===200&&Array.isArray(response.data)&&response.data.length>0&&response.data.length<=200&&response.data.every(row=>row&&row.success===true&&(row.errors===undefined||Array.isArray(row.errors)&&row.errors.length===0));
  save({...ledger,state:valid?'validated':'blocked',validation:{...ledger.validation,[step]:{state:'observed',operationId:input.operationId,response}}});if(!valid)fail('AMENDMENT_VALIDATION_REJECTED');
 }else if(input.action==='bind'){
  if(ledger?.state!=='validated'||Object.keys(ledger.validation).length!==4||!input.derivedRecord||input.derivedRecord.binding?.requestId!==binding.requestId||!same(input.derivedRecord.docId,doc))fail('AMENDMENT_BIND_SCOPE');
  const records=originalRecords(),nextKey=input.derivedRecord.binding.packetDigest;if(nextKey===binding.packetDigest||records[nextKey]&&!same(records[nextKey],input.derivedRecord))fail('AMENDMENT_BIND_SCOPE');records[nextKey]=copy(input.derivedRecord);root.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);
 }else fail('AMENDMENT_ACTION');
 return{parentRecord,remote:await read(),ledger:copy(ledger),readOnly:input.action==='bind'};
}
