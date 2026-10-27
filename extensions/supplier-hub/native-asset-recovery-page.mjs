/** Read-only observation of this request's upload ledger. The trusted prepared
 * mode additionally requires an updated, fully observed original upload plan.
 * The default keeps the earlier pre-update lost-ACK recovery contract. A list
 * row proves neither the remote byte length/type/SHA nor a successful update.
 * This function never edits the ledger, document, agreements or files. */
export function decodeNativeAssetRecoveryResult(value){
 if(typeof value!=='string'||value.length>6*1024*1024||new TextEncoder().encode(value).byteLength>6*1024*1024)return null;
 try{const result=JSON.parse(value);return result&&typeof result==='object'&&!Array.isArray(result)?result:null;}catch{return null;}
}

export async function nativeAssetRecoveryPage(input,prepared=false){
 if(typeof input==='string'){if(input.length>8*1024*1024)throw Error('원본 파일 조회 자료가 너무 큽니다.');input=JSON.parse(input);}
 const origin='https://supplier.coupang.com',data=document.documentElement.dataset,HASH=/^[a-f0-9]{64}$/;
 const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}',same=(a,b)=>canon(a)===canon(b);
 const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
 const fail=message=>{throw Error(message||'이 요청의 원본 업로드 목록을 읽기로 확인하지 못했습니다. 미확정 상태를 유지했습니다.');};
 const binding=input?.binding,target=input?.target,plan=input?.plan;let initialRecord;
 const readRecord=()=>{let record;try{record=JSON.parse(data.yoofamSingleDocumentRecords||'{}')[binding?.packetDigest];}catch{fail();}
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(location.origin!==origin||(prepared?!(['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname)):location.pathname!=='/dashboard/KR')||codes.length!==1||codes[0]!==binding?.identity?.company?.code
   ||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company.name||!record||!same(record.binding,binding)
   ||(prepared?!['updated','validated'].includes(record.state)||record.updateOperationId!==binding.requestId+':update'||record.loadedDocId!==undefined&&!same(record.loadedDocId,record.docId)||record.watchToken!==undefined&&(record.watchState!=='active'||Date.now()>=record.watchExpiresAt):record.state!=='created'||record.loadedDocId!==undefined||record.watchToken!==undefined||record.updateOperationId!==undefined)
   ||!same(record.docId,target?.docId)||record.createOperationId!==target.createOperationId||record.createOperationId!==binding.requestId+':create'
   ||!same(record.baselineDocIds,target.baselineDocIds)||record.baselineDocIds.some(id=>String(id)===String(record.docId))
   ||target.requestId!==binding.requestId||target.packetDigest!==binding.packetDigest||target.preparedBodySha256!==binding.preparedBodySha256
   ||!HASH.test(binding.nativeAssetSourcePlanSha256||'')||!record.nativeAssets||record.nativeAssets.sourcePlanSha256!==binding.nativeAssetSourcePlanSha256
   ||record.nativeAssets.planSha256!==plan?.planSha256||(prepared?record.nativeAssets.state!=='complete':!['preparing','complete'].includes(record.nativeAssets.state))
   ||record.nativeAssets.remoteBytesVerified!==false||record.nativeAssets.actualUploadVerified!==false||record.nativeAssets.registered!==false)fail();
  if(initialRecord!==undefined&&canon(record)!==initialRecord)fail('조회 중 원래 업로드 요청 기록이 변경됐습니다. 미확정 상태를 유지했습니다.');return record;
 };
 const record=readRecord();initialRecord=canon(record);
 if(plan?.format!=='yoofam-native-asset-upload-plan-v1'||!same(plan.target,target)||!same(plan.identity.company,binding.identity.company)
  ||plan.identity.ownerId!==binding.identity.ownerId||plan.identity.productId!==binding.identity.productId||plan.identity.categoryId!==binding.identity.categoryId
  ||plan.identity.schemaSha256!==binding.identity.schemaSha256||plan.identity.inputFingerprint!==binding.identity.inputFingerprint||!same(plan.identity.members,binding.identity.members)
  ||!same(plan.identity.source,{...binding.identity.source,profileId:binding.identity.profileId})||!Array.isArray(plan.images)||plan.images.length>150
  ||['registered','remoteWrites','submissionReady','transportReady'].some(key=>plan[key]!==false))fail();
 const {planSha256:omitted,...manifest}=plan;void omitted;if(!HASH.test(plan.planSha256||'')||await sha(manifest)!==plan.planSha256||await sha(plan.identity)!==plan.identityDigest)fail();readRecord();
 const imageTypes=['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'],legalTypes=['import_type','certificate','additional','categoryCert','adCert','msds'];
 const groups=[...imageTypes.filter(type=>plan.images.some(file=>file.imageType===type)).map(type=>({key:'image:'+type,kind:'image',type,files:plan.images.filter(file=>file.imageType===type)})),
  ...(plan.nativeLegalAttachmentPlan?.groups??[]).map(group=>({key:'legal:'+group.nativeType,kind:'legal',type:group.nativeType,files:plan.nativeLegalAttachmentPlan.files.filter(file=>file.nativeType===group.nativeType)}))];
 const ledger=record.nativeAssets.groups;if(!ledger||typeof ledger!=='object'||Array.isArray(ledger)||Object.keys(ledger).some(key=>!groups.some(group=>group.key===key)))fail();
 const allNames=new Set();for(const group of groups){if(!group.files.length||group.kind==='legal'&&!legalTypes.includes(group.type))fail();
  for(const file of group.files){const limit=group.kind==='image'?10*1024*1024:5*1024*1024;
   if(typeof file.transportName!=='string'||!file.transportName||file.transportName.length>512||allNames.has(file.transportName)||!HASH.test(file.sha256||'')
    ||!Number.isSafeInteger(file.byteLength)||file.byteLength<1||file.byteLength>limit||!(group.kind==='image'?['image/png','image/jpeg']:['application/pdf']).includes(file.contentType))fail();allNames.add(file.transportName);}
  const prior=ledger[group.key];if(prepared&&prior?.state!=='observed')fail('원래 새 문서의 완료된 파일 업로드 기록이 없습니다.');if(prior&&(prior.operationId!==binding.requestId+':assets:'+group.key||!['requested','observed'].includes(prior.state)
   ||Object.keys(prior).sort().join(',')!==(prior.state==='requested'?'operationId,state':'ack,actualUploadVerified,localParts,operationId,remoteBytesVerified,state')))fail();
  if(prior?.state==='observed'){
   if(!Array.isArray(prior.ack)||!Array.isArray(prior.localParts)||prior.localParts.length!==group.files.length||prior.actualUploadVerified!==false||prior.remoteBytesVerified!==false)fail();
   for(let index=0;index<group.files.length;index++){const expected=group.files[index],part=prior.localParts[index];if(!part||Object.keys(part).sort().join(',')!=='byteLength,sha256,transportName'||part.transportName!==expected.transportName||part.byteLength!==expected.byteLength||part.sha256!==expected.sha256)fail('보관된 원본 파일명·길이·SHA가 현재 원본 계획과 다릅니다.');}
  }
 }
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),doc=encodeURIComponent(String(target.docId));
 const read=async(path,legal=false)=>{readRecord();const url=origin+path,response=await fetch(url,{method:legal?'POST':'GET',credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal,
  headers:{accept:'application/json',...(legal?{'content-type':'application/json;charset=UTF-8'}:{})},...(legal?{body:'{}'}:{})});
  if(!response.ok||response.status!==200||response.redirected||response.url!==url||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail();
  const reader=response.body?.getReader();if(!reader)fail();const chunks=[];let length=0;try{for(;;){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>6*1024*1024)fail();chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));readRecord();if(!Array.isArray(rows)||rows.length>150)fail('원래 문서의 파일 목록 배열을 확인하지 못했습니다.');return rows;
 };
 const descriptors=(rows,kind,type)=>{const names=new Set(),allowed=prepared?new Set(groups.filter(group=>group.kind===kind&&(kind==='image'||group.type===type)).flatMap(group=>group.files.map(file=>file.transportName))):allNames;return rows.map(row=>{const name=row?.[kind==='image'?'imageName':'fileName'];if(typeof name!=='string'||!allowed.has(name)||names.has(name)||typeof row.s3Link!=='string'||!row.s3Link.trim()||row.s3Link.length>4096||/[\u0000-\u001f]/.test(row.s3Link))fail();names.add(name);
   if(kind==='legal'){if(row.fileType!==type)fail();return{fileName:name,fileType:type,s3Link:row.s3Link};}
   if(typeof row.imageUrl!=='string'||row.imageUrl.length>4096||row.imageUrl.includes('\\')||!(/^(https:\/\/|\/[^/])/.test(row.imageUrl)))fail();let url;try{url=new URL(row.imageUrl,origin);}catch{fail();}if(url.protocol!=='https:'||url.username||url.password)fail();
   return{imageName:name,imageUrl:row.imageUrl,s3Link:row.s3Link,...(row.host===undefined?{}:{host:row.host}),...(row.mainImage===undefined?{}:{mainImage:row.mainImage})};
  }).sort((a,b)=>String(a.imageName??a.fileName).localeCompare(String(b.imageName??b.fileName)));};
 try{
  const images=groups.some(group=>group.kind==='image')?descriptors(await read('/sr/draft/api/get-images-by-id/'+doc),'image'):[];
  const observations=[];for(const group of groups){const prior=ledger[group.key];
   const listed=group.kind==='image'?images.filter(row=>group.files.some(file=>file.transportName===row.imageName)):descriptors(await read('/sr/draft/api/get-files-by-type/'+doc+'?fileType='+group.type,true),'legal',group.type);
   if(listed.some(row=>!group.files.some(file=>file.transportName===(row.imageName??row.fileName))))fail();
   if(prior?.state==='observed'&&!same(listed,descriptors(prior.ack,group.kind,group.type)))fail('현재 파일 목록이 원래 확인한 업로드 응답과 다릅니다.');
   if(!prior&&listed.length)fail('요청하지 않은 파일이 원래 새 문서에 있어 미확정 상태를 유지했습니다.');
   observations.push({groupKey:group.key,operationId:prior?.operationId??null,requestState:prior?.state??'not-requested',
    state:prior?.state==='observed'?'metadata-current':listed.length===group.files.length?'listed-unconfirmed':listed.length?'partial-unconfirmed':prior?'not-observed':'not-requested',
    expectedFiles:group.files.map(file=>({transportName:file.transportName,sha256:file.sha256,byteLength:file.byteLength,contentType:file.contentType})),listedFiles:listed,
    remoteByteLengthVerified:false,remoteContentTypeVerified:false,remoteBytesVerified:false});
  }
  readRecord();if(controller.signal.aborted)fail();return JSON.stringify({format:prepared?'yoofam-native-prepared-files-v1':'yoofam-native-asset-recovery-observation-v1',requestId:binding.requestId,docId:target.docId,packetDigest:binding.packetDigest,identityDigest:binding.identityDigest,
   sourcePlanSha256:binding.nativeAssetSourcePlanSha256,planSha256:plan.planSha256,groups:observations,observedAt:Date.now(),readOnly:true,ledgerMutated:false,
   unresolved:!prepared,canContinue:false,remoteWrites:false,actualUploadVerified:false,remoteBytesVerified:false,registered:false});
 }finally{clearTimeout(timer);}
}
