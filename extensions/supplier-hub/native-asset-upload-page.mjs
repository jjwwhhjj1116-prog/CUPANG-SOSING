/** Injected only by the trusted native adapter into its exact owned new Hub
 * frame. Static SR upload/list contract SHA6fc9c0fa... [2875870,2879318).
 * Does not inspect credentials or claim remote binary persistence/acceptance. */
export async function nativeAssetUploadPage(input){
 if(typeof input==='string'){if(input.length>100*1024*1024)throw Error('원본 업로드 자료가 너무 큽니다.');input=JSON.parse(input);}
 const origin='https://supplier.coupang.com',data=document.documentElement.dataset,HASH=/^[a-f0-9]{64}$/;
 const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}',same=(a,b)=>canon(a)===canon(b);
 const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join(''),digest=value=>sha(new TextEncoder().encode(canon(value))),fail=message=>{throw Error(message||'현재 새 문서의 원본 업로드 확인이 필요합니다.');};
 const binding=input?.binding,target=input?.expectedTarget,plan=input?.plan,group=input?.group;let records,record,ledger;
 const check=()=>{
  if(location.origin!==origin||!(['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname)))fail();
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(codes.length!==1||codes[0]!==binding?.identity?.company?.code||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company.name)fail('현재 Supplier Hub 회사가 다릅니다.');
  try{records=JSON.parse(data.yoofamSingleDocumentRecords||'{}');record=records[binding.packetDigest];}catch{fail();}
  if(!record||!same(record.binding,binding)||!same(record.docId,target?.docId)||record.createOperationId!==target?.createOperationId||record.createOperationId!==binding.requestId+':create'
   ||!same(record.baselineDocIds,target.baselineDocIds)||target.baselineDocIds.some(id=>String(id)===String(record.docId))||record.loadedDocId!==undefined||!['created','update-requested','updated'].includes(record.state)
   ||!HASH.test(binding.nativeAssetSourcePlanSha256||'')||binding.nativeAssetSourcePlanSha256!==input.sourcePlanSha256||target.requestId!==binding.requestId||target.packetDigest!==binding.packetDigest||target.preparedBodySha256!==binding.preparedBodySha256)fail('이 요청에서 생성한 정확한 새 문서만 업로드할 수 있습니다.');
  if(record.watchToken!==undefined)fail('사용자가 불러온 문서에는 원본을 다시 업로드하지 않았습니다.');
  if(record.nativeAssets&&(record.nativeAssets.planSha256!==plan.planSha256||record.nativeAssets.sourcePlanSha256!==input.sourcePlanSha256))fail('원래 업로드 계획이 변경됐습니다.');
 };
 check();
 if(plan?.format!=='yoofam-native-asset-upload-plan-v1'||!HASH.test(plan.planSha256||'')||!same(plan.target,target)||!same(plan.identity.company,binding.identity.company)||plan.identity.ownerId!==binding.identity.ownerId||plan.identity.productId!==binding.identity.productId
  ||plan.identity.categoryId!==binding.identity.categoryId||plan.identity.schemaSha256!==binding.identity.schemaSha256||plan.identity.inputFingerprint!==binding.identity.inputFingerprint||!same(plan.identity.members,binding.identity.members)
  ||!same(plan.identity.source,{...binding.identity.source,profileId:binding.identity.profileId})||['registered','remoteWrites','submissionReady','transportReady'].some(key=>plan[key]!==false)||!Array.isArray(plan.images)||plan.images.length>150)fail();
 const {planSha256:omitted,...manifest}=plan;void omitted;if(new TextEncoder().encode(canon(manifest)).length>1024*1024||await digest(manifest)!==plan.planSha256||await digest(plan.identity)!==plan.identityDigest)fail('원래 원본 파일 계획의 해시가 다릅니다.');check();
 const imageTypes=['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'],legalTypes=['import_type','certificate','additional','categoryCert','adCert','msds'],doc=encodeURIComponent(String(target.docId));
 const isImage=group?.kind==='image',kindKey=isImage?group.imageType:group?.nativeType;
 if(isImage?!imageTypes.includes(kindKey):group?.kind!=='legal'||!legalTypes.includes(kindKey))fail();
 const expected=isImage?plan.images.filter(file=>file.imageType===kindKey):plan.nativeLegalAttachmentPlan?.files.filter(file=>file.nativeType===kindKey);
 const uploadPath=isImage?`/sr/draft/api/upload-images/${doc}?imageType=${kindKey}`:`/sr/draft/api/upload-files-by-type/${doc}?fileType=${kindKey}`;
 if(!expected?.length||!Array.isArray(group.parts)||group.parts.length!==expected.length||group.path!==uploadPath)fail();
 if(plan.images.reduce((sum,file)=>sum+file.byteLength,0)>64*1024*1024)fail('역할별 원본 파일의 전송 용량이 초과됐습니다.');
 const parts=[];let total=0;
 for(let index=0;index<expected.length;index++){
  const file=expected[index],part=group.parts[index],limit=isImage?10*1024*1024:5*1024*1024,field=isImage?'additionalImageFiles':'uploadFiles';
  if(part.fieldName!==field||part.transportName!==file.transportName||part.contentType!==file.contentType||part.byteLength!==file.byteLength||part.sha256!==file.sha256||!HASH.test(part.sha256||'')||!Number.isSafeInteger(part.byteLength)||part.byteLength<1||part.byteLength>limit
   ||typeof part.base64!=='string'||part.base64.length!==4*Math.ceil(part.byteLength/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(part.base64))fail('원본 파일명·길이·해시 연결이 다릅니다.');
  const binary=atob(part.base64),bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));if(bytes.length!==file.byteLength||await sha(bytes)!==file.sha256)fail('전송 직전 실제 원본 바이트가 다릅니다.');check();total+=bytes.length;
  if(total>20*1024*1024)fail('브라우저 프레임 전송 범위를 초과했습니다.');parts.push({field,file,bytes});
 }
 const groupKey=group.kind+':'+kindKey,allKeys=[...imageTypes.filter(type=>plan.images.some(file=>file.imageType===type)).map(type=>'image:'+type),...(plan.nativeLegalAttachmentPlan?.groups??[]).map(item=>'legal:'+item.nativeType)],operationId=binding.requestId+':assets:'+groupKey;
 let ledgerSnapshot=canon(record.nativeAssets??null);
 const save=()=>{check();if(canon(record.nativeAssets??null)!==ledgerSnapshot)fail('다른 원본 업로드 기록이 먼저 변경되어 중복 요청하지 않았습니다.');record.nativeAssets=ledger;records[binding.packetDigest]=record;data.yoofamSingleDocumentRecords=JSON.stringify(records);ledgerSnapshot=canon(ledger);};
 ledger=record.nativeAssets??{sourcePlanSha256:input.sourcePlanSha256,planSha256:plan.planSha256,groups:{},state:'preparing',remoteBytesVerified:false,actualUploadVerified:false,registered:false};
 if(!allKeys.includes(groupKey)||Object.keys(ledger.groups).some(key=>!allKeys.includes(key)))fail();
 function descriptors(rows,files){
  if(!Array.isArray(rows)||rows.length!==files.length||rows.length>150)fail('원본 업로드 응답 배열을 확인하지 못했습니다.');const names=new Set(),result=[];
  for(const row of rows){const name=row?.[isImage?'imageName':'fileName'];if(typeof name!=='string'||!files.some(file=>file.transportName===name)||names.has(name)||typeof row.s3Link!=='string'||!row.s3Link.trim()||row.s3Link.length>4096||/[\u0000-\u001f]/.test(row.s3Link))fail('원본 업로드의 정확한 파일명 확인이 필요합니다.');names.add(name);
   if(isImage){if(typeof row.imageUrl!=='string'||row.imageUrl.length>4096||row.imageUrl.includes('\\')||!(/^(https:\/\/|\/[^/])/.test(row.imageUrl)))fail();let url;try{url=new URL(row.imageUrl,origin);}catch{fail();}if(url.protocol!=='https:'||url.username||url.password)fail();result.push({imageName:name,imageUrl:row.imageUrl,s3Link:row.s3Link,...(row.host===undefined?{}:{host:row.host}),...(row.mainImage===undefined?{}:{mainImage:row.mainImage})});}
   else{if(row.fileType!==kindKey)fail();result.push({fileName:name,fileType:row.fileType,s3Link:row.s3Link});}
  }return result.sort((a,b)=>String(a.imageName??a.fileName).localeCompare(String(b.imageName??b.fileName)));
 }
 async function request(path,method,body,multipart=false){check();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{
  const url=origin+path,response=await fetch(url,{method,credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:'application/json',...(method==='POST'&&!multipart?{'content-type':'application/json;charset=UTF-8'}:{})},...(body===undefined?{}:{body:multipart?body:JSON.stringify(body)})});
  if(!response.ok||response.redirected||response.url!==url||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))fail('원본 업로드 응답의 출처·형식을 확인하지 못했습니다.');
  const reader=response.body?.getReader();if(!reader)fail();const chunks=[];let size=0;try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>6*1024*1024)fail();chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));check();if(!Array.isArray(json))fail('확인되지 않은 업로드 응답 포장은 해석하지 않았습니다.');return json;
 }finally{clearTimeout(timer);}}
 async function list(){const path=isImage?`/sr/draft/api/get-images-by-id/${doc}`:`/sr/draft/api/get-files-by-type/${doc}?fileType=${kindKey}`,rows=await request(path,isImage?'GET':'POST',isImage?undefined:{});
  const known=isImage?plan.images.map(file=>file.transportName):expected.map(file=>file.transportName),nameKey=isImage?'imageName':'fileName',seen=new Set();
  if(rows.length>150||rows.some(row=>typeof row?.[nameKey]!=='string'||!known.includes(row[nameKey])||seen.has(row[nameKey])||!seen.add(row[nameKey])))fail('새 문서에 원래 계획 밖의 파일 또는 중복 파일이 있습니다.');
  return rows.filter(row=>expected.some(file=>file.transportName===row[nameKey]));
 }
 const previous=ledger.groups[groupKey];
 if(previous){
  if(previous.operationId!==operationId||previous.state!=='observed'||!previous.ack)fail('이전 원본 업로드 응답이 미확정입니다. 같은 파일을 다시 업로드하지 않았습니다.');
  const listed=descriptors(await list(),expected);if(!same(listed,previous.ack))fail('저장된 원본 파일 목록이 원래 업로드 응답과 다릅니다.');
 }else{
  if((await list()).length)fail('새 문서에 같은 이름의 파일이 이미 있어 덮어쓰지 않았습니다.');
  ledger.groups[groupKey]={operationId,state:'requested'};save();
  const form=new FormData();for(const part of parts)form.append(part.field,new Blob([part.bytes],{type:part.file.contentType}),part.file.transportName);
  const ack=descriptors(await request(uploadPath,'POST',form,true),expected),listed=descriptors(await list(),expected);if(!same(ack,listed))fail('업로드 응답과 같은 문서의 원본 목록이 다릅니다.');
  ledger.groups[groupKey]={operationId,state:'observed',ack,localParts:expected.map(file=>({transportName:file.transportName,sha256:file.sha256,byteLength:file.byteLength})),remoteBytesVerified:false,actualUploadVerified:false};
  ledger.state=allKeys.every(key=>ledger.groups[key]?.state==='observed')?'complete':'preparing';save();
 }
 return{docId:target.docId,planSha256:plan.planSha256,descriptors:ledger.groups[groupKey].ack,metadataObserved:true,remoteBytesVerified:false,actualUploadVerified:false,registered:false,ownedRecord:record};
}
