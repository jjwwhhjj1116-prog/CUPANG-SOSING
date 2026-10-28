import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {singleBrowserFixture} from './supplier-hub-single-document-adapter.mjs';
import {SINGLE_COMPANIES} from './supplier-hub-single-document.mjs';
import {createProductDocumentPacket} from '../../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../../extensions/supplier-hub/product-document-receiver.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../../extensions/supplier-hub/product-document-adapter.mjs';
const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}',copy=value=>JSON.parse(JSON.stringify(value)),sha=value=>createHash('sha256').update(value).digest('hex'),digest=value=>sha(canon(value));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
const pdf=Buffer.from('%PDF-1.7\nSynthetic private immutable certificate\n%%EOF\n');
const jsonResponse=(url,value,headers={})=>{const response=Response.json(value,{headers});Object.defineProperty(response,'url',{value:url});return response;};
export async function nativeRecoveryFixture(company=SINGLE_COMPANIES[0],options={}){
 const imageBytes=options.imageBytes??png;
 const f=await singleBrowserFixture(company,options.browser),p=f.packet,owner=p.ownerId,member={optionId:'native-option',optionLabel:'검정',documentIndex:0},identity={ownerId:owner,productId:p.productId,company:copy(company),categoryId:p.categoryId,categoryPath:['합성','카테고리'],schemaSha256:p.schemaSha256,sourceFingerprint:'d'.repeat(64),inputFingerprint:'e'.repeat(64),source:{...p.source,profileId:p.profileId},members:[member]};
 const body=copy(p.body),types=['MAIN','ADDITIONAL','LABEL','DETAIL'],paths={MAIN:['imagePage','images','mainImage'],ADDITIONAL:['imagePage','images','additionalImage'],DETAIL:['imagePage','details','detailedImage'],LABEL:['imagePage','images','labelImages']};
 const images=types.map((imageType,index)=>({key:owner+'/native-'+index+'.png',originalName:'native-'+index+'.png',transportName:imageType.toLowerCase()+'-'+sha(imageBytes)+'.png',imageType,contentType:'image/png',byteLength:imageBytes.length,sha256:sha(imageBytes),references:[{optionId:member.optionId,documentIndex:0,wire:imageType==='LABEL'?{path:paths.LABEL,nameKey:'labelImageType',valueKey:'labelImageFiles',name:'제품 한글 표시사항 라벨 또는 도안 이미지'}:{path:paths[imageType]},slotIndex:0}]}));
 if(options.sharedImages)for(const image of images){image.key=owner+'/shared-original.png';image.originalName='shared-original.png';}
 body.imagePage=undefined;delete body.imagePage;body.jsonDocument[0].imagePage.images={mainImage:images[0].transportName,additionalImage:images[1].transportName,labelImages:[{labelImageType:'제품 한글 표시사항 라벨 또는 도안 이미지',labelImageFiles:images[2].transportName}]};body.jsonDocument[0].imagePage.details.detailedImage=images[3].transportName;
 let legalPlan=null;
 if(options.pdf){
  body.jsonDocument[0].legalPage.certificates=[{certificateName:'기존 합성 인증',certificateValue:'기존 값'},{certificateName:'KC 합성 인증',certificateValue:'검토한 인증값'}];
  const binding={format:'supplier-hub-native-legal-binding-v1',schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,nativeType:'certificate',certificate:{schemaIndex:1,fieldId:'synthetic-certificate',path:['legalPage','certificates'],nameKey:'certificateName',valueKey:'certificateValue',name:'KC 합성 인증',value:'검토한 인증값'}},key=owner+'/legal/'+p.productId+'/legal-76000000-0000-4000-8000-000000000001.pdf';
  const file={key,originalName:'한글 인증 원본.pdf',transportName:'cert1-한글 인증 원본.pdf',type:'pdf',contentType:'application/pdf',byteLength:pdf.length,sha256:sha(pdf),nativeType:'certificate',binding,targetId:'certificate:synthetic-certificate',downloadPath:'/api/products/'+p.productId+'/legal-documents?key='+encodeURIComponent(key)};
  legalPlan={format:'yoofam-native-legal-attachment-plan-v1',identity:copy(identity),identityDigest:digest(identity),applicability:'required',targets:[{id:file.targetId,binding}],files:[file],groups:[{nativeType:'certificate',fileKeys:[key]}],issues:[],metadataValid:true,planSha256:null,registered:false,remoteWrites:false,submissionReady:false,transportReady:false,bytesVerified:false};const {planSha256:omitted,...manifest}=legalPlan;void omitted;legalPlan.planSha256=digest(manifest);
 }
 const deferred=copy(body);deferred.jsonDocument[0].imagePage.msrpAgree=false;deferred.jsonDocument[0].imagePage.labelContactAgreed=false;
 const source={format:'yoofam-native-asset-source-plan-v1',storageNameSemantics:'private-key-leaf',identity,identityDigest:digest(identity),images,nativeLegalAttachmentPlan:legalPlan,body,originalBodySha256:digest(body),preparedBodySha256:digest(deferred),sourcePlanSha256:null,issues:[],metadataValid:true,registered:false,remoteWrites:false,submissionReady:false,transportReady:false,bytesVerified:false};const {sourcePlanSha256:omitted,...manifest}=source;void omitted;source.sourcePlanSha256=digest(manifest);
 const scope={ownerId:owner,company:copy(company),productId:p.productId,profileId:p.profileId,requestedProfileId:p.profileId,categoryId:p.categoryId,fingerprint:source.sourcePlanSha256,inputFingerprint:identity.inputFingerprint,schemaSha256:p.schemaSha256,source:identity.source};
 const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity:scope,members:[member],body,originalBodySha256:source.originalBodySha256,preparedBodySha256:source.preparedBodySha256,reviewDigest:null,registered:false,remoteWrites:false,submissionReady:false};review.reviewDigest=digest({format:review.format,type:review.type,identity:scope,members:review.members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
 const packet=await createProductDocumentPacket(review),context=await productDocumentIdentity(packet,f.sender),state={company:copy(company),source,uploads:[],appReads:[],lists:0,blocked:false,registry:new Map(),recoveryRequests:[],inspectionRequests:[],repairRequestedRows:[],receipts:[]};
 const appFetch=async(url,init)=>{const absolute=new URL(url,f.sender.url),path=absolute.pathname;state.appReads.push(absolute.href);assert.equal(init.method??'GET','GET');
  if(options.beforeNativeAppFetch)await options.beforeNativeAppFetch(absolute,init,state);
  if(path.endsWith('/catalog-context'))return jsonResponse(absolute.href,{ownerId:owner,company:state.company});
  if(path.endsWith('/supplier-hub-receipt'))return jsonResponse(absolute.href,{history:{productId:p.productId,blocked:state.blocked}});
  if(path.endsWith('/supplier-hub-product-receipt'))return jsonResponse(absolute.href,{format:'yoofam-native-receipt-history-v1',productId:p.productId,receipts:state.receipts});
  if(path.endsWith('/legal-documents')){assert.equal(absolute.searchParams.get('key'),legalPlan.files[0].key);const response=new Response(pdf,{headers:{'content-type':'application/pdf'}});Object.defineProperty(response,'url',{value:absolute.href});return response;}
  assert.ok(path.endsWith('/native-assets'),path);
  if(options.imageBatch&&absolute.searchParams.get('bundle')==='images'){
   assert.equal(absolute.searchParams.get('sourcePlanSha256'),source.sourcePlanSha256);
   const files=[...new Map(source.images.map(file=>[file.key,file])).values()].map(file=>({key:file.key,byteLength:file.byteLength,sha256:file.sha256,contentType:file.contentType,base64:Buffer.from(options.badPrivateBytes?imageBytes.subarray(1):imageBytes).toString('base64')}));
   return jsonResponse(absolute.href,{format:'yoofam-native-image-batch-v1',sourcePlanSha256:source.sourcePlanSha256,files,registered:false,remoteWrites:false});
  }
  if(absolute.searchParams.has('key')){const file=source.images.find(file=>file.key===absolute.searchParams.get('key'));assert.ok(file);assert.equal(absolute.searchParams.get('sourcePlanSha256'),source.sourcePlanSha256);const bytes=options.badPrivateBytes?imageBytes.subarray(1):imageBytes,response=new Response(bytes,{headers:{'content-type':'image/png','x-yoofam-source-plan-sha256':source.sourcePlanSha256,'x-yoofam-file-sha256':file.sha256}});Object.defineProperty(response,'url',{value:absolute.href});return response;}
  const response=jsonResponse(absolute.href,state.source);if(options.imageBatch)response.headers.set('x-yoofam-native-image-batch','v1');return response;
 };
 const appListeners=[],appContext=vm.createContext({location:new URL(f.sender.url),fetch:appFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date,Response,structuredClone,btoa,atob,window:{},document:{visibilityState:'visible'},chrome:{runtime:{id:'fixture',sendMessage:async message=>{options.onSourceSessionRead?.(copy(message));return {ok:true,sessionId:options.sourceSessionId??null};},onMessage:{addListener:listener=>appListeners.push(listener)}}}});
 vm.runInContext(fs.readFileSync(new URL('../../extensions/supplier-hub/single-content.js',import.meta.url),'utf8'),appContext);
 vm.runInContext(fs.readFileSync(new URL('../../extensions/supplier-hub/native-source-content.js',import.meta.url),'utf8'),appContext);
 const hubFetch=async(url,init)=>{const parsed=new URL(url),doc=parsed.pathname.split('/').at(-1);assert.equal(doc,String(f.createdDocId),'only the newly owned document may receive file operations');state.recoveryRequests.push({url,method:init.method});
  if(typeof state.onRecoveryFetch==='function'&&(parsed.pathname.includes('/get-images-by-id/')||parsed.pathname.includes('/get-files-by-type/')))state.onRecoveryFetch(url,init);
  if(typeof state.recoveryFetchOverride==='function'&&parsed.pathname.includes('/get-images-by-id/'))return state.recoveryFetchOverride(url,init);
  const image=parsed.pathname.includes('/get-images-by-id/')||parsed.pathname.includes('/upload-images/'),group=image?parsed.searchParams.get('imageType'):parsed.searchParams.get('fileType');
  if(parsed.pathname.includes('/get-images-by-id/')||parsed.pathname.includes('/get-files-by-type/')){state.lists++;const values=[...state.registry.values()].filter(row=>image?row.imageName:row.fileType===group);return jsonResponse(url,options.badList?values.map(row=>({...row,s3Link:'changed'})):values);}
  assert.ok(parsed.pathname.includes(image?'/upload-images/':'/upload-files-by-type/'));assert.equal(init.method,'POST');assert.equal(Object.hasOwn(init.headers,'content-type'),false,'multipart boundary belongs to the browser');const metadata=[];
  for(const [field,file]of init.body){assert.equal(field,image?'additionalImageFiles':'uploadFiles');const expected=(image?images:legalPlan.files).find(image=>image.transportName===file.name);assert.ok(expected);assert.equal(sha(new Uint8Array(await file.arrayBuffer())),expected.sha256);metadata.push(image?{imageName:file.name,imageUrl:'/stored/'+file.name,s3Link:'stored/'+file.name,mainImage:false}:{fileName:file.name,fileType:group,s3Link:'stored/'+file.name});}
  const record=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[context.packetDigest];assert.equal(record.nativeAssets.groups[(image?'image:':'legal:')+group].state,'requested','write checkpoint precedes every multipart request');
  state.uploads.push(group);for(const row of metadata)state.registry.set(row.imageName??row.fileName,row);if(state.loseNextUploadAck===group||options.loseUploadAck&&(!options.loseUploadAckGroup||group===options.loseUploadAckGroup))throw Error('synthetic lost upload ACK');return jsonResponse(url,options.badEnvelope?{data:metadata}:metadata);
 };
 const inspectionFetch=async(url,init)=>{
  if(typeof state.beforeInspectionFetch==='function')await state.beforeInspectionFetch(url,init);
  state.inspectionRequests.push({url,method:init.method,body:init.body});const parsed=new URL(url),path=parsed.pathname;
  if(path==='/sr/draft/api/drafts/register-requested'){assert.equal(init.method,'GET');return jsonResponse(url,state.repairRequestedRows);}
  if(path==='/sr/draft/api/drafts')return jsonResponse(url,[...f.documents.values()].map(row=>({...copy(row),status:'UNFINISHED',...(row.docId===f.createdDocId?options.repairRowChanges:{})})));
  assert.equal(path.split('/').at(-1),String(f.createdDocId),'inspection must use only the created synthetic document');
  if(path.startsWith('/sr/draft/api/get-by-id/')){
   if(options.repairBodyFailure){const response=Response.json({errorCode:'INTERNAL_SERVER_ERROR'},{status:500});Object.defineProperty(response,'url',{value:url});return response;}
   return jsonResponse(url,{...copy(f.documents.get(f.createdDocId)),status:'UNFINISHED',...options.repairBodyChanges});
  }
  if(path.startsWith('/sr/draft/api/get-images-by-id/'))return jsonResponse(url,[...state.registry.values()].filter(row=>row.imageName));
  if(path.startsWith('/sr/draft/api/get-files-by-type/')){assert.equal(init.method,'POST');assert.equal(init.body,'{}');return jsonResponse(url,[...state.registry.values()].filter(row=>row.fileType===parsed.searchParams.get('fileType')));}
  throw Error('Unexpected synthetic inspection request '+path);
 };
 const hubContext=vm.createContext({location:f.hubLocation,document:f.hubDocument,fetch:hubFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,
  setTimeout:(fn,delay)=>state.recoveryTimerHarness?state.recoveryTimerHarness.setTimeout(fn,delay):setTimeout(fn,delay),
  clearTimeout:timer=>state.recoveryTimerHarness?state.recoveryTimerHarness.clearTimeout(timer):clearTimeout(timer),Date,Response,structuredClone,FormData,Blob,btoa,atob});
 const inspectionContext=vm.createContext({location:f.hubLocation,document:f.hubDocument,fetch:inspectionFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date,Response,structuredClone});
 const recordMirror=f.recordMirror;
 const execute=f.api.scripting.executeScript;f.api.scripting.executeScript=async request=>{
  if(request.target.tabId===f.sender.tab.id)throw Error('Cannot access contents of the app URL. Extension manifest must request permission to access this host.');
  if(!['nativeProductDocumentAppSourcePage','nativeAssetUploadPage','nativeAssetRecoveryPage','singleExistingDocumentRepairPage'].includes(request.func.name))return execute(request);
  const target=request.func.name==='singleExistingDocumentRepairPage'?inspectionContext:request.func.name==='nativeAssetUploadPage'||request.func.name==='nativeAssetRecoveryPage'?hubContext:appContext;
  target.args=options.browser?.dropNullArguments?JSON.parse(JSON.stringify(request.args,(key,value)=>value===null?undefined:value)):copy(request.args);
  if(options.browser?.sortObjectArguments){const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;target.args=ordered(target.args);}
  if(options.corruptFrameBytes&&request.func.name==='nativeAssetUploadPage'){
   const encoded=typeof target.args[0]==='string',input=encoded?JSON.parse(target.args[0]):target.args[0];input.group.parts[0].base64=Buffer.from('corrupt').toString('base64');target.args[0]=encoded?JSON.stringify(input):input;
  }
  const result=await vm.runInContext('('+request.func.toString()+')(...args)',target);return[{frameId:0,documentId:target===appContext?'app-doc':f.hubDocumentId,result:copy(result)}];
 };
 const message=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async(id,value,frame)=>{if(!['YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_READ_LEGACY_PRODUCT_DOCUMENT_SOURCE'].includes(value.type))return message(id,value,frame);assert.equal(id,f.sender.tab.id);assert.equal(frame.frameId,0);for(const listener of appListeners){let pending;const reply=new Promise(resolve=>{pending=listener(copy(value),{id:'fixture'},resolve);});if(pending===true)return copy(await reply);}return undefined;};
 const selected=await createVerifiedProductDocumentBrowserAdapter(context,{api:f.api}),adapter=selected.adapter,proof={identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,packetDigest:context.packetDigest,requestId:packet.requestId,docId:null};
 const start=async()=>{const source=await adapter.readSource(proof);assert.equal(source.current,true);const target=await adapter.createTarget({identity:context.identity,requestId:packet.requestId,packetDigest:context.packetDigest}),tab=await adapter.readTab({tab:target,identity:context.identity});const common={tab,identity:context.identity,sessionId:source.sessionId,requestId:packet.requestId};await adapter.hubRequest({...common,method:'GET',path:'/sr/draft/api/drafts'});const created=await adapter.hubRequest({...common,method:'POST',path:'/sr/draft/api/create',operationId:packet.requestId+':create',body:copy(context.packet.body)});assert.equal(created.json.docId,f.createdDocId);return common;};
 const update=common=>adapter.hubRequest({...common,method:'POST',path:'/sr/draft/api/update',operationId:packet.requestId+':update',body:{...copy(context.packet.body),docId:f.createdDocId}});
 return{...f,packet,context,state,selected,adapter,start,update,recordMirror,reloadSourceSession:async()=>vm.runInContext('yoofamSingleSessionId=crypto.randomUUID();yoofamSingleAccount=null;yoofamSingleSessionBound=false;yoofamSingleAccountChanged=false;',appContext),close:()=>{recordMirror.close();adapter.dispose();f.close();}};
}
