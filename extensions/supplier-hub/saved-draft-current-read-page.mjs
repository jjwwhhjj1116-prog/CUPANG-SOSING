/** Serialized into the receiver's fresh owned tab. These are current server
 * observations, never reconstructed upload/update/validation acknowledgements.
 * Only the DOM task record may be bound; every remote operation is a query. */
export async function savedDraftCurrentReadPage(input){
 const serialized=typeof input==='string';let phase='input',safeDiagnostics;const controllers=new Set();
 const failure=code=>Object.assign(Error('CURRENT_SAVED_DRAFT_READ'),{currentReadCode:code});
 const fail=code=>{throw failure(code);};
 try{
  if(serialized){if(input.length>8*1024*1024)fail('input-size');input=JSON.parse(input);}
  const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const exact=(value,keys,optional=[])=>object(value)&&keys.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>keys.includes(key)||optional.includes(key));
  const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  const same=(a,b)=>canon(a)===canon(b),copy=value=>JSON.parse(canon(value));
  const hashBytes=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const hash=value=>hashBytes(new TextEncoder().encode(canon(value))),HASH=/^[a-f0-9]{64}$/;
  const identifier=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
  const origin='https://supplier.coupang.com',root=document.documentElement,data=root.dataset;
  const required=['binding','expectedTarget','docId','baselineDocIds','expectedImages','expectedBody','previousTarget','mode'];
  if(!exact(input,required,['proof','expectedObservation','authorizedStages','audit'])||!['read','bind','check','audit'].includes(input.mode)
   ||(input.mode==='audit')!==Object.hasOwn(input,'audit')||input.mode==='audit'&&(Object.hasOwn(input,'proof')||Object.hasOwn(input,'expectedObservation'))
   ||input.authorizedStages!==undefined&&(input.mode!=='check'||!Array.isArray(input.authorizedStages)||!same(input.authorizedStages,['productPage','imagePage'].slice(0,input.authorizedStages.length))||input.authorizedStages.length>2))fail('input-fields');
  input=copy(input);const {binding,expectedTarget:target,docId,baselineDocIds:baseline,expectedImages:images,expectedBody:expected,previousTarget:previous,mode}=input;
  const audit=input.audit;
  if(mode==='audit'&&(!exact(audit,['checkpointSequence','schemaBindingComplete','certificateBindings'])||!Number.isSafeInteger(audit.checkpointSequence)||audit.checkpointSequence<1||audit.checkpointSequence>100000
   ||typeof audit.schemaBindingComplete!=='boolean'||!Array.isArray(audit.certificateBindings)||audit.certificateBindings.length>400||!audit.schemaBindingComplete&&audit.certificateBindings.length
   ||audit.certificateBindings.some((row,index)=>!exact(row,['schemaIndex','nameKey','valueKey','name','value'])||row.schemaIndex!==index||!['nameKey','valueKey'].every(key=>typeof row[key]==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(row[key]))||row.nameKey===row.valueKey||typeof row.name!=='string'||row.name.length>2000||!(row.value===null||['string','boolean','number'].includes(typeof row.value)))))fail('audit-input');
  if(!exact(binding,['identity','identityDigest','packetDigest','preparedBodySha256','originalBodySha256','nativeAssetSourcePlanSha256','sessionId','requestId'])
   ||!object(binding.identity)||!['identityDigest','packetDigest','preparedBodySha256','originalBodySha256','nativeAssetSourcePlanSha256'].every(key=>HASH.test(binding[key]||''))
   ||!/^\w[\w-]{0,99}$/.test(binding.requestId||'')||!/^\w[\w-]{0,99}$/.test(binding.sessionId||'')||!identifier(docId)
   ||!exact(target,['tabId','windowId'])||!Number.isSafeInteger(target.tabId)||target.tabId<0||target.tabId===binding.identity.appTabId||target.windowId!==binding.identity.windowId
   ||!exact(previous,['tabId','windowId','origin','requestId','packetDigest'])||!Number.isSafeInteger(previous.tabId)||previous.tabId<0||mode!=='check'&&previous.tabId===target.tabId||previous.tabId===binding.identity.appTabId
   ||previous.windowId!==target.windowId||previous.origin!==origin||previous.requestId!==binding.requestId||previous.packetDigest!==binding.packetDigest
   ||!Array.isArray(baseline)||baseline.length>10000||baseline.some(id=>!identifier(id)||String(id)===String(docId))||new Set(baseline.map(String)).size!==baseline.length)fail('binding');
  const members=binding.identity.members;
  if(!Array.isArray(members)||members.length<1||members.length>200||members.some((member,index)=>!object(member)||member.documentIndex!==index)
   ||!object(expected)||!same(expected.docId,docId)||expected.scope!=='Retail_Categorized_Single'||!Array.isArray(expected.jsonDocument)||expected.jsonDocument.length!==members.length
   ||typeof expected.productName!=='string'||!expected.productName.trim()||typeof expected.categoryPath!=='string'||!expected.categoryPath.trim()
   ||binding.nativeAssetSourcePlanSha256!==binding.identity.fingerprint)fail('source-scope');
  if(await hash(binding.identity)!==binding.identityDigest)fail('binding-hash');
  const normalized=copy(expected);normalized.docId=null;
  const logicalIdentity=Object.fromEntries(Object.entries(binding.identity).filter(([key])=>!['appTabId','windowId'].includes(key)));
  if(await hash(normalized)!==binding.preparedBodySha256||await hash({identity:logicalIdentity,bodySha256:binding.preparedBodySha256,originalBodySha256:binding.originalBodySha256})!==binding.packetDigest)fail('binding-hash');
  if(!Array.isArray(images)||images.length<1||images.length>150)fail('source-images');
  const names=new Set();let expectedTotal=0;
  for(const file of images){if(!exact(file,['transportName','contentType','byteLength','sha256'])||typeof file.transportName!=='string'||!file.transportName.trim()||file.transportName.length>512||/[\u0000-\u001f]/.test(file.transportName)||names.has(file.transportName)
    ||!['image/png','image/jpeg'].includes(file.contentType)||!Number.isSafeInteger(file.byteLength)||file.byteLength<1||file.byteLength>10*1024*1024||!HASH.test(file.sha256||''))fail('source-images');
   names.add(file.transportName);expectedTotal+=file.byteLength;
  }
  if(expectedTotal>64*1024*1024)fail('source-size');
  let recordSnapshot;
  const records=()=>{const raw=data.yoofamSingleDocumentRecords||'{}';if(typeof raw!=='string'||raw.length>8*1024*1024)fail('record-size');let value;try{value=JSON.parse(raw);}catch{fail('record-json');}if(!object(value)||Object.keys(value).length>1000)fail('record-shape');return value;};
  const proofKeys=['format','requestId','docId','tabId','windowId','identityDigest','packetDigest','preparedBodySha256','sourcePlanSha256','baselineSha256','bodySha256','fileSetSha256','byteSetSha256','filesCount','duplicateMatches','documentState','readOnly','remoteWrites','historicalAckRecovered','observedAt'];
  const baselineSha256=await hash(baseline);
  const validProof=proof=>exact(proof,proofKeys)&&proof.format==='yoofam-current-saved-draft-target-v1'&&proof.requestId===binding.requestId&&same(proof.docId,docId)
   &&proof.tabId===target.tabId&&proof.windowId===target.windowId&&proof.identityDigest===binding.identityDigest&&proof.packetDigest===binding.packetDigest
   &&proof.preparedBodySha256===binding.preparedBodySha256&&proof.bodySha256===binding.preparedBodySha256&&proof.sourcePlanSha256===binding.nativeAssetSourcePlanSha256
   &&proof.baselineSha256===baselineSha256&&HASH.test(proof.fileSetSha256||'')&&HASH.test(proof.byteSetSha256||'')&&proof.filesCount===images.length
   &&proof.duplicateMatches===0&&proof.documentState==='UNFINISHED'&&proof.readOnly===true&&proof.remoteWrites===false&&proof.historicalAckRecovered===false
   &&Number.isSafeInteger(proof.observedAt)&&proof.observedAt>0&&proof.observedAt<=Date.now()+5000;
  const validRecord=record=>object(record)&&same(record.binding,binding)&&same(record.docId,docId)&&same(record.baselineDocIds,baseline)&&record.createOperationId===binding.requestId+':create'
   &&record.updateOperationId===undefined&&record.nativeAssets===undefined&&['updated','validated','validation-rejected','submit-requested'].includes(record.state)
   &&exact(record.currentReadRecovery,['proof','proofSha256','fileSetSha256','byteSetSha256','rawBodySha256','filesCount','fileBodyWritesAllowed','historicalAckRecovered'])
   &&validProof(record.currentReadRecovery.proof)&&['proofSha256','fileSetSha256','byteSetSha256','rawBodySha256'].every(key=>HASH.test(record.currentReadRecovery[key]||''))
   &&record.currentReadRecovery.fileBodyWritesAllowed===false&&record.currentReadRecovery.historicalAckRecovered===false&&record.currentReadRecovery.filesCount===images.length
   &&record.currentReadRecovery.proof.fileSetSha256===record.currentReadRecovery.fileSetSha256&&record.currentReadRecovery.proof.byteSetSha256===record.currentReadRecovery.byteSetSha256;
  const advanced=record=>record.state!=='updated'||Object.keys(record).some(key=>!['binding','docId','baselineDocIds','createOperationId','state','currentReadRecovery'].includes(key));
  const fence=()=>{
   const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
   const path=location.pathname,allowed=mode==='check'?['/dashboard/KR','/sr/registration'].includes(path)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(path):path==='/dashboard/KR';
   if(document.documentElement!==root||location.origin!==origin||!allowed||location.search||location.hash||codes.length!==1||codes[0]!==binding.identity.company?.code
    ||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company?.name)fail('page-guard');
   if(mode!=='check'&&Array.from(document.querySelectorAll('.rsc-text-input input')).some(node=>String(node.value||'').trim()))fail('form-conflict');
   const all=records(),record=all[binding.packetDigest];
   if(Object.keys(all).some(key=>key!==binding.packetDigest))fail('record-conflict');
   if(record!==undefined&&(!validRecord(record)||mode!=='check'&&advanced(record)))fail('record-conflict');
   if(mode==='check'&&record===undefined)fail('record-missing');
   const snapshot=canon(all);if(recordSnapshot!==undefined&&snapshot!==recordSnapshot)fail('record-changed');return{all,record,snapshot};
  };
  phase='record-before';recordSnapshot=fence().snapshot;
  const existing=fence().record;
  if(existing&&await hash(existing.currentReadRecovery.proof)!==existing.currentReadRecovery.proofSha256)fail('record-proof');
  const authorizedStages=input.authorizedStages??[];
  if(authorizedStages.some(stage=>existing?.stageConsentOperations?.[stage]?.state!=='observed'||existing.stageConsentOperations[stage].operationId!==binding.requestId+':stage-consent:'+stage))fail('stage-consent');
  const read=async(path,{bytes=false,expectedFile,legal=false}={})=>{
   fence();const controller=new AbortController();controllers.add(controller);let timer;
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('http-timeout'));},30000);});
   const consume=async()=>{
    const url=origin+path;let response;try{response=await fetch(url,{method:legal?'POST':'GET',credentials:'include',redirect:'manual',cache:'no-store',signal:controller.signal,
     headers:{accept:bytes?expectedFile.contentType:'application/json',...(legal?{'content-type':'application/json;charset=UTF-8'}:{})},...(legal?{body:'{}'}:{})});}catch{fail(controller.signal.aborted?'http-timeout':'http-network');}
    fence();if(!response)fail('http-response');
    // Never follow an SSO/login redirect or inspect its target, headers or body.
    if(response.redirected||response.type==='opaqueredirect'||response.status===0||response.status>=300&&response.status<400)fail('http-redirect');
    if(response.url!==url)fail('http-response');
    if(!response.ok||response.status!==200)fail([401,403,404,429,500,502,503,504].includes(response.status)?'http-'+response.status:'http-response');
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();if(mime!==(bytes?expectedFile.contentType:'application/json'))fail(mime==='application/octet-stream'?'http-type-octet-stream':'http-type-other');
    const limit=bytes?10*1024*1024:6*1024*1024,size=response.headers.get('content-length');
    if(size!==null&&(!/^\d+$/.test(size)||Number(size)>limit||bytes&&Number(size)!==expectedFile.byteLength))fail('http-size');
    const reader=response.body?.getReader();if(!reader)fail('http-body');const chunks=[];let length=0;
    try{for(;;){const chunk=await reader.read();fence();if(controller.signal.aborted)fail('http-timeout');if(chunk.done)break;if(!(chunk.value instanceof Uint8Array))fail('http-body');length+=chunk.value.byteLength;if(length>limit||bytes&&length>expectedFile.byteLength)fail('http-size');chunks.push(chunk.value);}}
    finally{void reader.cancel().catch(()=>{});}
    const raw=new Uint8Array(length);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}fence();
    if(bytes){if(length!==expectedFile.byteLength)fail('byte-length');const sha256=await hashBytes(raw);fence();if(sha256!==expectedFile.sha256)fail('byte-sha');return{transportName:expectedFile.transportName,contentType:mime,byteLength:length,sha256};}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('http-json');}
   };
   try{return await Promise.race([consume(),timeout]);}finally{clearTimeout(timer);controllers.delete(controller);}
  };
  const listValid=rows=>Array.isArray(rows)&&rows.length<=10000&&rows.every(row=>object(row)&&identifier(row.docId)&&typeof row.productName==='string'&&typeof row.categoryPath==='string')&&new Set(rows.map(row=>String(row.docId))).size===rows.length;
  phase='draft-list';const drafts=await read('/sr/draft/api/drafts');if(!listValid(drafts))fail('draft-list');
  const selected=drafts.filter(row=>same(row.docId,docId));if(selected.length!==1||selected[0].status!=='UNFINISHED'||selected[0].scope!=='Retail_Categorized_Single')fail('document-state');
  const row=selected[0];if(row.productName!==expected.productName||row.categoryPath!==expected.categoryPath||!['categoryId','displayCategoryCode','productNoticeNumber','version'].every(key=>Object.hasOwn(row,key)&&String(row[key])===String(expected[key])))fail('document-identity');
  phase='requested-list';const requested=await read('/sr/draft/api/drafts/register-requested');if(!listValid(requested))fail('requested-list');
  const duplicate=row=>row.productName===expected.productName&&(row.categoryPath===expected.categoryPath||row.categoryId!==undefined&&String(row.categoryId)===String(expected.categoryId)||row.displayCategoryCode!==undefined&&String(row.displayCategoryCode)===String(expected.displayCategoryCode));
  if(drafts.some(row=>!same(row.docId,docId)&&duplicate(row))||requested.some(row=>String(row.docId)===String(docId)||duplicate(row)))fail('duplicate-document');
  const doc=encodeURIComponent(String(docId));phase='body';const remote=await read('/sr/draft/api/get-by-id/'+doc);
  const bodyKeys=['docId','productName','categoryPath','categoryId','displayCategoryCode','jsonDocument','scope','productNoticeNumber','version','remark'];
  if(!object(remote)||bodyKeys.filter(key=>key!=='remark').some(key=>!Object.hasOwn(remote,key))||remote.status!=='UNFINISHED'||!same(remote.docId,docId)||remote.scope!=='Retail_Categorized_Single'
   ||remote.productName!==expected.productName||remote.categoryPath!==expected.categoryPath||!Array.isArray(remote.jsonDocument)||remote.jsonDocument.length!==members.length||remote.jsonDocument.some(member=>!object(member)))fail('body-shape');
  const body=Object.fromEntries(bodyKeys.filter(key=>Object.hasOwn(remote,key)).map(key=>[key,remote[key]]));
  phase='image-list';const listed=await read('/sr/draft/api/get-images-by-id/'+doc);
  if(!Array.isArray(listed)||listed.length!==images.length)fail('image-list');const listedNames=new Set(),paths=new Map();
  const files=listed.map(row=>{
   if(!object(row)||!['imageName','imageUrl','s3Link','host'].every(key=>Object.hasOwn(row,key))||typeof row.imageName!=='string'||!names.has(row.imageName)||listedNames.has(row.imageName)
    ||typeof row.imageUrl!=='string'||row.imageUrl.length>8192||row.imageUrl.includes('\\')||typeof row.s3Link!=='string'||!row.s3Link||row.s3Link.length>4096||/[\u0000-\u001f]/.test(row.s3Link)
    ||row.host!=='supplier.coupang.com'||row.mainImage!==undefined&&typeof row.mainImage!=='boolean')fail('image-descriptor');
   let url;try{url=new URL(row.imageUrl,origin);}catch{fail('image-url');}
   if(url.origin!==origin||url.username||url.password||url.hash||url.pathname!=='/sr/api/image/get-by-key'||Array.from(url.searchParams.keys()).length!==1||!url.searchParams.has('key')||url.searchParams.get('key')!==row.s3Link
    ||!(row.imageUrl.startsWith('/sr/api/image/get-by-key?')||row.imageUrl.startsWith(origin+'/sr/api/image/get-by-key?')))fail('image-url');
   listedNames.add(row.imageName);paths.set(row.imageName,url.pathname+url.search);return{imageName:row.imageName,imageUrl:row.imageUrl,s3Link:row.s3Link,host:row.host,...(row.mainImage===undefined?{}:{mainImage:row.mainImage})};
  }).sort((a,b)=>a.imageName<b.imageName?-1:a.imageName>b.imageName?1:0);
  // The shipped native caller omits fileType and consumes the complete
  // collection. Only a literal empty array or empty plain object proves that
  // this document has no legal files of any type; envelopes are not unwrapped.
  phase='legal-lists';const legal=await read('/sr/draft/api/get-files-by-type/'+doc,{legal:true});
  if(Array.isArray(legal)){if(legal.length>2000&&mode==='audit')fail('legal-list-size');if(legal.length!==0&&mode!=='audit'){
   // Classify a bounded sample without returning any filename, URL, S3 key,
   // unknown enum, body or byte value. Even unknown own-key names are hidden:
   // a credential can itself have been used as a property name.
   const keyNames=new Set(['attachmentType','byteLength','categoryId','certificateType','code','contentType','createdAt','data','disabled','docId','documentId','errorCode','fileId','fileName','fileSize','fileType','host','id','imageData','imageName','imageUrl','mainImage','message','mimeType','modifiedAt','name','productId','s3Link','sha256','size','status','type','version']);
   const knownTypes=new Set(['import_type','certificate','additional','categoryCert','adCert','msds','MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL']);
   const expectedLinks=new Set(files.map(file=>file.s3Link));
   const fieldType=(row,key)=>{if(!object(row)||!Object.hasOwn(row,key))return'missing';const value=row[key];return value===null?'null':Array.isArray(value)?'array':typeof value==='string'?(value.trim()===''?'string-empty':'string'):typeof value;};
   const matchProbe=(row,key,expected)=>({type:fieldType(row,key),expectedImageMatch:object(row)&&Object.hasOwn(row,key)&&typeof row[key]==='string'&&row[key].trim()!==''&&expected.has(row[key])});
   const valueType=value=>value===null?'null':Array.isArray(value)?'array':typeof value==='string'?(value.trim()===''?'string-empty':'string'):typeof value;
   const normalizeLegal=(actual,wanted)=>{const value=copy(actual);if(object(value)&&object(wanted)&&wanted.adCert===''&&!Object.hasOwn(value,'adCert'))value.adCert='';return value;};
   const legalOf=member=>object(member)&&Object.hasOwn(member,'legalPage')?member.legalPage:undefined;
   const certificatesOf=member=>object(legalOf(member))&&Object.hasOwn(legalOf(member),'certificates')?legalOf(member).certificates:undefined;
   const legalEqual=(actual,wanted)=>actual===undefined||wanted===undefined?actual===wanted:same(normalizeLegal(actual,wanted),wanted);
   // These paths are distinct in the shipped SR client. certificateFile is
   // an assembled UI cell, not a stored-body field, so it is never probed.
   const labelReferences=(documents,name)=>{let count=0;for(const member of documents){if(!Object.hasOwn(member,'imagePage'))continue;const page=member.imagePage;if(!object(page))return null;if(!Object.hasOwn(page,'images'))continue;const group=page.images;if(!object(group))return null;if(!Object.hasOwn(group,'labelImages'))continue;const rows=group.labelImages;if(rows===null)continue;if(!Array.isArray(rows)||rows.length>200)return null;
     for(const row of rows){if(!object(row)||!Object.hasOwn(row,'labelImageFiles'))return null;const value=row.labelImageFiles;if(value===null||value==='')continue;if(typeof value!=='string'||value.length>8192)return null;const parts=value.split(',');if(parts.length>200)return null;count+=parts.filter(part=>part===name).length;if(count>40000)return null;}}
    return count;};
   const prefixProbe=row=>{const type=fieldType(row,'fileName'),name=object(row)?row.fileName:undefined;if(typeof name!=='string'||name.length>512)return{type,matchedIndex:null,ambiguous:false,scanComplete:typeof name!=='string',memberRowMatches:0};
    const indices=new Set();let unsupported=false;for(const match of name.matchAll(/cert(0|[1-9]\d*)-/g)){const index=Number(match[1]);if(!Number.isSafeInteger(index)||index>199)unsupported=true;else indices.add(index);}
    const matchedIndex=!unsupported&&indices.size===1?[...indices][0]:null;
    return{type,matchedIndex,ambiguous:indices.size>1,scanComplete:!unsupported,memberRowMatches:matchedIndex===null?0:body.jsonDocument.filter(member=>Array.isArray(certificatesOf(member))&&certificatesOf(member).length>matchedIndex).length};};
   let rowBudget=12;
   const bodyRelations={format:'yoofam-saved-draft-legal-body-relations-v1',memberCount:body.jsonDocument.length,truncated:body.jsonDocument.length>12,
    remoteLegalMatchesExpected:body.jsonDocument.every((member,index)=>legalEqual(legalOf(member),legalOf(expected.jsonDocument[index]))),members:body.jsonDocument.slice(0,12).map((member,index)=>{
     const actual=certificatesOf(member),wanted=certificatesOf(expected.jsonDocument[index]),rows=Array.isArray(actual)?actual:[],samples=rows.slice(0,rowBudget);rowBudget-=samples.length;
     return{index,remoteLegalType:fieldType(member,'legalPage'),expectedLegalType:fieldType(expected.jsonDocument[index],'legalPage'),remoteCertificatesType:fieldType(legalOf(member),'certificates'),expectedCertificatesType:fieldType(legalOf(expected.jsonDocument[index]),'certificates'),
      remoteCount:Array.isArray(actual)?actual.length:null,expectedCount:Array.isArray(wanted)?wanted.length:null,matchesExpected:actual===undefined||wanted===undefined?actual===wanted:same(actual,wanted),truncated:rows.length>samples.length,
      rows:samples.map((row,rowIndex)=>{const values=object(row)?Object.values(row):[],kinds={null:0,array:0,object:0,'string-empty':0,string:0,number:0,boolean:0};for(const value of values){const type=valueType(value);if(Object.hasOwn(kinds,type))kinds[type]++;}
       return{index:rowIndex,type:valueType(row),fieldCount:values.length,fieldKinds:kinds,expectedRowMatch:Array.isArray(wanted)&&rowIndex<wanted.length&&same(row,wanted[rowIndex])};})};
    })};
   safeDiagnostics={format:'yoofam-saved-draft-legal-diagnostics-v2',collection:'array',count:legal.length,truncated:legal.length>12,bodyRelations,rows:legal.slice(0,12).map((row,index)=>{
    const ownKeys=object(row)?Object.keys(row):[],keys=ownKeys.filter(key=>keyNames.has(key)).sort().slice(0,12),type=row===null?'null':Array.isArray(row)?'array':typeof row;
    const fileType=object(row)&&Object.hasOwn(row,'fileType')?row.fileType:undefined;
    return{index,type,keys,keyCount:ownKeys.length,keysTruncated:ownKeys.length>keys.length,
     fileType:{type:fieldType(row,'fileType'),knownType:typeof fileType==='string'&&knownTypes.has(fileType)?fileType:null,identifier:typeof fileType==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(fileType)},
     fileName:matchProbe(row,'fileName',names),imageName:matchProbe(row,'imageName',names),s3Link:matchProbe(row,'s3Link',expectedLinks),
     docId:{type:fieldType(row,'docId'),same:object(row)&&Object.hasOwn(row,'docId')&&(typeof row.docId==='string'||typeof row.docId==='number')&&row.docId===docId},
     certificateNamePrefix:prefixProbe(row),pairedImageDescriptorMatch:object(row)&&typeof row.fileName==='string'&&typeof row.s3Link==='string'&&files.some(file=>file.imageName===row.fileName&&file.s3Link===row.s3Link),
     expectedLabelReferences:object(row)&&typeof row.fileName==='string'&&row.fileName.trim()!==''?labelReferences(expected.jsonDocument,row.fileName):null};
   })};
   fail('legal-array-nonempty');
  }}
  else if(object(legal)&&Object.getPrototypeOf(legal)===Object.prototype){if(Object.keys(legal).length!==0)fail('legal-object-nonempty');}
  else fail('legal-response-shape');
  phase='image-bytes';const observations=new Array(images.length);let next=0;
  await Promise.all(Array.from({length:Math.min(3,images.length)},async()=>{for(;;){const index=next++;if(index>=images.length)return;const file=images[index];observations[index]=await read(paths.get(file.transportName),{bytes:true,expectedFile:file});}}));
  observations.sort((a,b)=>a.transportName<b.transportName?-1:a.transportName>b.transportName?1:0);
  phase='hashes';const fileSetSha256=await hash(files),byteSetSha256=await hash(observations),rawBodySha256=await hash(body);fence();
  if(mode==='audit'){
   // Evidence only: this branch never binds the DOM record or reconstructs a
   // write acknowledgement. All image bytes were checked above even when an
   // unexpected legal file is present.
   const normalized=copy(body);
   const integer=(actual,wanted)=>typeof wanted==='string'&&/^(0|[1-9]\d*)$/.test(wanted)&&Number.isSafeInteger(actual)&&actual>=0&&String(actual)===wanted?wanted:actual;
   if(Object.hasOwn(normalized,'displayCategoryCode'))normalized.displayCategoryCode=integer(normalized.displayCategoryCode,expected.displayCategoryCode);
   if(normalized.remark===null&&!Object.hasOwn(expected,'remark'))delete normalized.remark;
   for(const [index,member]of normalized.jsonDocument.entries()){
    const wanted=expected.jsonDocument[index],common=member.productPage?.commonAttributes,wantedCommon=wanted.productPage?.commonAttributes;
    if(object(common)&&object(wantedCommon))for(const key of ['purchasePrice','coupangSalePrice','msrp','osrp'])if(Object.hasOwn(common,key))common[key]=integer(common[key],wantedCommon[key]);
    if(object(member.legalPage)&&object(wanted.legalPage)&&wanted.legalPage.adCert===''&&!Object.hasOwn(member.legalPage,'adCert'))member.legalPage.adCert='';
   }
   const type=value=>value===undefined?'missing':value===null?'null':Array.isArray(value)?'array':typeof value==='string'?(value===''?'string-empty':'string'):typeof value;
   const equal=(a,b)=>a===undefined||b===undefined?a===b:same(a,b),differences=[];let differenceCount=0;
   const kind=value=>value===undefined?'missing':value===''?'empty':['해당사항없음','N/A'].includes(value)?'na':'present';
   const add=(path,wanted,actual,documentIndex=null,schemaIndex=null)=>{differenceCount++;if(differences.length<24)differences.push({documentIndex,schemaIndex,path,expectedType:type(wanted),actualType:type(actual),expectedValueKind:path==='legalPage.certificates.value'?kind(wanted):'not-applicable',actualValueKind:path==='legalPage.certificates.value'?kind(actual):'not-applicable'});};
   const certificateBindings=audit.certificateBindings;
   // A trusted schema read is still checked against every original member.
   const schemaBindingComplete=audit.schemaBindingComplete;
   if(schemaBindingComplete)for(const member of expected.jsonDocument){const rows=member.legalPage?.certificates;if(certificateBindings.length===0&&(rows===undefined||Array.isArray(rows)&&rows.length===0))continue;
    if(!Array.isArray(rows)||rows.length!==certificateBindings.length||certificateBindings.some(binding=>{const hits=rows.filter(row=>object(row)&&row[binding.nameKey]===binding.name);return hits.length!==1||Object.keys(hits[0]).length!==2||!Object.hasOwn(hits[0],binding.valueKey)||!equal(hits[0][binding.valueKey],binding.value);}))fail('audit-schema');}
   const head=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='jsonDocument'));
   if(!equal(head(expected),head(normalized)))add('document-header',head(expected),head(normalized));
   for(const [index,member]of normalized.jsonDocument.entries()){
    const wanted=expected.jsonDocument[index],pageKeys=['startPage','productPage','imagePage','logisticsPage','sourcingPage','legalPage'];
    if(!equal(Object.keys(member).sort(),Object.keys(wanted).sort())||Object.keys(member).some(key=>!pageKeys.includes(key)))if(!equal(member,wanted))add('member-shape',wanted,member,index);
    for(const page of pageKeys.filter(key=>key!=='legalPage'))if(!equal(wanted[page],member[page]))add(page,wanted[page],member[page],index);
    const wantedLegal=wanted.legalPage,actualLegal=member.legalPage;
    if(equal(wantedLegal,actualLegal))continue;
    if(!object(wantedLegal)||!object(actualLegal)){add('legalPage',wantedLegal,actualLegal,index);continue;}
    const withoutCert=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='certificates'));
    if(!equal(withoutCert(wantedLegal),withoutCert(actualLegal)))add('legalPage.other',withoutCert(wantedLegal),withoutCert(actualLegal),index);
    const expectedRows=wantedLegal.certificates,actualRows=actualLegal.certificates;
    if(equal(expectedRows,actualRows))continue;
    if(!schemaBindingComplete||!Array.isArray(expectedRows)||!Array.isArray(actualRows)){add('legalPage.certificates',expectedRows,actualRows,index);continue;}
    const consumed=new Set();let orderMismatch=false;
    for(const binding of certificateBindings){
     const hits=actualRows.map((row,rowIndex)=>({row,rowIndex})).filter(({row})=>object(row)&&row[binding.nameKey]===binding.name),expectedRow=expectedRows.find(row=>row[binding.nameKey]===binding.name);
     if(hits.length!==1){add('legalPage.certificates.name',binding.name,hits.length?null:undefined,index,binding.schemaIndex);continue;}
     const {row,rowIndex}=hits[0];consumed.add(rowIndex);if(rowIndex!==expectedRows.indexOf(expectedRow))orderMismatch=true;
     if(Object.keys(row).length!==2||!Object.hasOwn(row,binding.valueKey))add('legalPage.certificates.row-shape',expectedRow,row,index,binding.schemaIndex);
     if(!equal(expectedRow[binding.valueKey],row[binding.valueKey]))add('legalPage.certificates.value',expectedRow[binding.valueKey],row[binding.valueKey],index,binding.schemaIndex);
    }
    if(consumed.size!==actualRows.length)add('legalPage.certificates',expectedRows,actualRows,index);
    if(orderMismatch)add('legalPage.certificates.order',expectedRows,actualRows,index);
   }
   const prepared=copy(normalized);prepared.docId=null;const normalizedBodySha256=await hash(prepared),bodyMatchesExpected=normalizedBodySha256===binding.preparedBodySha256;
   if(!bodyMatchesExpected&&!differenceCount)add('member-shape',expected.jsonDocument,normalized.jsonDocument);
   const labelReferences=name=>{let count=0;for(const member of expected.jsonDocument){const page=member.imagePage;if(page===undefined)continue;if(!object(page))return null;const group=page.images;if(group===undefined)continue;if(!object(group))return null;const rows=group.labelImages;if(rows===undefined||rows===null)continue;if(!Array.isArray(rows)||rows.length>200)return null;
     for(const row of rows){if(!object(row)||!Object.hasOwn(row,'labelImageFiles'))return null;const value=row.labelImageFiles;if(value===null||value==='')continue;if(typeof value!=='string'||value.length>8192)return null;const parts=value.split(',');if(parts.length>200)return null;count+=parts.filter(part=>part===name).length;if(count>40000)return null;}}return count;};
   const certificateRowsMatch=schemaBindingComplete&&normalized.jsonDocument.every(member=>{const rows=member.legalPage?.certificates;return certificateBindings.length===0&&(rows===undefined||Array.isArray(rows)&&rows.length===0)||Array.isArray(rows)&&rows.length===certificateBindings.length&&certificateBindings.every(binding=>{const hits=rows.filter(row=>object(row)&&row[binding.nameKey]===binding.name);return hits.length===1&&Object.keys(hits[0]).length===2&&Object.hasOwn(hits[0],binding.valueKey)&&equal(hits[0][binding.valueKey],binding.value);});});
   const legalRows=Array.isArray(legal)?legal:[],legalEntries=[];
   for(const [index,row]of legalRows.slice(0,12).entries()){
    const name=object(row)?row.fileName:undefined,kind=object(row)&&row.fileType==='certificate'?'certificate':'other';let association='unknown',schemaIndex=null;
    if(kind==='certificate'&&certificateRowsMatch&&typeof name==='string'&&name.length>0&&name.length<=512){
     const hits=certificateBindings.filter(binding=>name.includes('cert'+binding.schemaIndex+'-'));
     // Coverage proves schema indices, but a malformed/duplicate prefix is
     // still unknown rather than proof that a file is unused.
     const prefixes=[...name.matchAll(/cert(0|[1-9]\d*)-/g)].map(match=>Number(match[1]));
     const unsupported=prefixes.some(value=>!Number.isSafeInteger(value)||value>=certificateBindings.length);
     const collisions=hits.length===1?legalRows.filter(other=>object(other)&&other.fileType==='certificate'&&typeof other.fileName==='string'&&other.fileName.includes('cert'+hits[0].schemaIndex+'-')).length:0;
     if(hits.length>1||collisions>1)association='ambiguous';else if(!unsupported){association=hits.length===1?'linked':'unlinked';schemaIndex=hits.length===1?hits[0].schemaIndex:null;}
    }
    legalEntries.push({index,kind,descriptorSha256:await hash(row),association,schemaIndex,pairedImageDescriptorMatch:object(row)&&typeof name==='string'&&typeof row.s3Link==='string'&&files.some(file=>file.imageName===name&&file.s3Link===row.s3Link),expectedLabelReferences:typeof name==='string'&&name.length>0&&name.length<=512?labelReferences(name):null});
   }
   const report={format:'yoofam-unexpected-legal-audit-v1',requestId:binding.requestId,docId,identityDigest:binding.identityDigest,packetDigest:binding.packetDigest,originalBodySha256:binding.originalBodySha256,preparedBodySha256:binding.preparedBodySha256,sourcePlanSha256:binding.nativeAssetSourcePlanSha256,checkpointSequence:audit.checkpointSequence,target,observedAt:Date.now(),imageCount:files.length,legalCount:legalRows.length,bodyMatchesExpected,schemaBindingComplete,rawBodySha256,normalizedBodySha256,fileSetSha256,byteSetSha256,legalSetSha256:await hash(legal),legalEntries,legalEntriesTruncated:legalRows.length>12,differences,differenceCount,differencesTruncated:differenceCount>24,readOnly:true,remoteWrites:false,checkpointWrites:false,canResume:false,canDelete:false,registered:false,historicalAckRecovered:false};
   fence();return serialized?JSON.stringify(report):report;
  }
  const observation={body,files,fileSetSha256,byteSetSha256,rawBodySha256,filesCount:files.length,duplicateMatches:0,documentState:'UNFINISHED',readOnly:true,remoteWrites:false,historicalAckRecovered:false,observedAt:Date.now()};
  if(existing){
   if(['fileSetSha256','byteSetSha256','filesCount'].some(key=>existing.currentReadRecovery[key]!==observation[key]))fail('record-observation');
   if(existing.currentReadRecovery.rawBodySha256!==rawBodySha256){
    if(mode!=='check'||!authorizedStages.length)fail('record-observation');
    const deferred=copy(body),flags={productPage:'msrpAgree',imagePage:'labelContactAgreed'};
    for(const member of deferred.jsonDocument)for(const stage of authorizedStages){const key=flags[stage];if(typeof member.imagePage?.[key]!=='boolean')fail('stage-consent-body');member.imagePage[key]=false;}
    if(await hash(deferred)!==existing.currentReadRecovery.rawBodySha256)fail('record-observation');fence();
   }
  }
  if(mode==='bind'){
   phase='bind-proof';const expectedObservation=input.expectedObservation,proof=input.proof;
   if(!exact(expectedObservation,['fileSetSha256','byteSetSha256','rawBodySha256','filesCount'])||Object.keys(expectedObservation).some(key=>expectedObservation[key]!==observation[key])
    ||!validProof(proof)||Date.now()-proof.observedAt>60000||proof.fileSetSha256!==fileSetSha256||proof.byteSetSha256!==byteSetSha256)fail('bind-proof');
   const proofSha256=await hash(proof);const {all,record:prior}=fence();
   if(prior&&advanced(prior))fail('record-advanced');
   const record={binding,docId,baselineDocIds:baseline,createOperationId:binding.requestId+':create',state:'updated',currentReadRecovery:{proof,proofSha256,fileSetSha256,byteSetSha256,rawBodySha256,filesCount:files.length,fileBodyWritesAllowed:false,historicalAckRecovered:false}};
   if(!prior||!same(prior,record)){all[binding.packetDigest]=record;data.yoofamSingleDocumentRecords=JSON.stringify(all);recordSnapshot=canon(all);}
   fence();observation.record=copy(record);
  }
  phase='record-after';fence();return serialized?JSON.stringify(observation):observation;
 }catch(error){for(const controller of controllers)controller.abort();const result={currentReadFailure:{format:'yoofam-current-saved-draft-read-failure-v1',phase,code:typeof error?.currentReadCode==='string'?error.currentReadCode:'unrecognized',...(safeDiagnostics?{diagnostics:safeDiagnostics}:{})}};return serialized?JSON.stringify(result):result;}
}
