import test from 'node:test';
import {validateUnexpectedLegalAuditReport} from '../extensions/supplier-hub/unexpected-legal-audit.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {savedDraftCurrentReadPage} from '../extensions/supplier-hub/saved-draft-current-read-page.mjs';

const origin='https://supplier.coupang.com',copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const sha=value=>createHash('sha256').update(canonical(value)).digest('hex'),byteSha=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const clock={now:Date.now()},calls=[],timers=new Map(),dataset={};let records='{}',writes=0,sequence=0;
 Object.defineProperty(dataset,'yoofamSingleDocumentRecords',{get:()=>records,set:value=>{records=value;writes++;},enumerable:true});
 const identity={origin:'https://sourceflow.jjwwhhjj1116.workers.dev',appTabId:4,windowId:7,ownerId:'current-owner',company:{code:'A01526306',name:'유앤채'},productId:'native-product',categoryId:'8091',fingerprint:'f'.repeat(64),members:[0,1,2].map(documentIndex=>({optionId:'option-'+documentIndex,optionLabel:'원래 옵션 '+documentIndex,documentIndex}))};
 const expectedBody={docId:2347603,productName:'원래 저장 상품',categoryPath:'생활용품 > 원래 분류',categoryId:'8091',displayCategoryCode:'68183',jsonDocument:identity.members.map(member=>({startPage:{productName:member.optionLabel},productPage:{commonAttributes:{purchasePrice:'1000'}},legalPage:{adCert:''},imagePage:{msrpAgree:false,labelContactAgreed:false}})),scope:'Retail_Categorized_Single',productNoticeNumber:'12',version:188};
 const prepared={...copy(expectedBody),docId:null},logicalIdentity=Object.fromEntries(Object.entries(identity).filter(([key])=>!['appTabId','windowId'].includes(key))),preparedBodySha256=sha(prepared);
 const binding={identity,identityDigest:sha(identity),packetDigest:sha({identity:logicalIdentity,bodySha256:preparedBodySha256,originalBodySha256:preparedBodySha256}),preparedBodySha256,originalBodySha256:preparedBodySha256,nativeAssetSourcePlanSha256:identity.fingerprint,sessionId:'native-session',requestId:'f294-current-saved-request'};
 const binaries=new Map(),expectedImages=[];for(let index=0;index<9;index++){const transportName='stored-image-'+index+'.png',bytes=new Uint8Array([137,80,78,71,index,7,19,25]);binaries.set(transportName,bytes);expectedImages.push({transportName,contentType:'image/png',byteLength:bytes.byteLength,sha256:byteSha(bytes)});}
 const input={binding,expectedTarget:{tabId:18,windowId:7},docId:2347603,baselineDocIds:[2347000],expectedImages,expectedBody,previousTarget:{tabId:9,windowId:7,origin,requestId:binding.requestId,packetDigest:binding.packetDigest},mode:'read'};
 const body={...copy(expectedBody),displayCategoryCode:68183,remark:null,status:'UNFINISHED',serverExtra:'not part of canonical body'};
 for(const member of body.jsonDocument){member.productPage.commonAttributes.purchasePrice=1000;delete member.legalPage.adCert;}
 const files=expectedImages.map((file,index)=>({imageName:file.transportName,imageUrl:'/sr/api/image/get-by-key?key='+encodeURIComponent('stored/native/'+file.transportName),s3Link:'stored/native/'+file.transportName,host:'supplier.coupang.com',mainImage:index===0,imageData:'server-extra-is-not-retained'}));
 const draft={...copy(body),modifiedAt:'2026-10-29T01:02:03.000Z'},state={company:'Company Code: A01526306',formValues:[],body,files,drafts:[draft],requested:[],legal:[],activeBytes:0,maxActiveBytes:0};
 const root={dataset},document={documentElement:root,body:{get innerText(){return state.company;}},querySelectorAll:()=>state.formValues.map(value=>({value}))};
 Object.defineProperty(document,'cookie',{get(){assert.fail('Cookies must never be read.');}});
 const location={origin,pathname:'/dashboard/KR',search:'',hash:''};
 class ClockDate extends Date{static now(){return clock.now;}}
 const response=(path,value,type='application/json',headers={})=>{const raw=type==='application/json'?new TextEncoder().encode(JSON.stringify(value)):value,result=new Response(raw,{status:200,headers:{'content-type':type,'content-length':String(raw.byteLength),...headers}});Object.defineProperty(result,'url',{value:origin+path});return result;};
 const f={input,state,calls,clock,timers,dataset,document,location,binaries,response,beforeFetch:null,override:null};
 const fetch=async(url,init)=>{
  const parsed=new URL(url),path=parsed.pathname+parsed.search;calls.push({path,method:init.method,credentials:init.credentials,redirect:init.redirect,cache:init.cache,headers:copy(init.headers),...(init.body?{body:init.body}:{})});
  assert.equal(parsed.origin,origin);assert.equal(init.credentials,'include');assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');
  await f.beforeFetch?.(path,init);const override=await f.override?.(path,init);if(override!==undefined)return override;
  if(path==='/sr/draft/api/drafts'){assert.equal(init.method,'GET');return response(path,state.drafts);}
  if(path==='/sr/draft/api/drafts/register-requested'){assert.equal(init.method,'GET');return response(path,state.requested);}
  if(path==='/sr/draft/api/get-by-id/2347603'){assert.equal(init.method,'GET');return response(path,state.body);}
  if(path==='/sr/draft/api/get-images-by-id/2347603'){assert.equal(init.method,'GET');return response(path,state.files);}
  if(path==='/sr/draft/api/get-files-by-type/2347603'){assert.equal(init.method,'POST');assert.equal(init.body,'{}');return response(path,state.legal);}
  if(parsed.pathname==='/sr/api/image/get-by-key'){
   assert.equal(init.method,'GET');const name=parsed.searchParams.get('key').split('/').at(-1);assert.ok(binaries.has(name));state.activeBytes++;state.maxActiveBytes=Math.max(state.maxActiveBytes,state.activeBytes);await turn();state.activeBytes--;return response(path,binaries.get(name),'image/png');
  }
  assert.fail('Unapproved remote operation '+path);
 };
 const context=vm.createContext({document,location,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,AbortController,URL,Error,Date:ClockDate,fetch,Promise,Set,Map,
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 for(const key of ['localStorage','sessionStorage'])Object.defineProperty(context,key,{get(){assert.fail('Storage must never be read.');}});
 f.run=async(value=f.input)=>{context.currentInput=value;return plain(await vm.runInContext('('+savedDraftCurrentReadPage.toString()+')(currentInput)',context));};
 f.record=()=>JSON.parse(records)[binding.packetDigest];f.setRecord=record=>{records=JSON.stringify(record===null?{}:{[binding.packetDigest]:record});};f.snapshot=()=>records;f.writes=()=>writes;
 f.proof=observation=>({format:'yoofam-current-saved-draft-target-v1',requestId:binding.requestId,docId:input.docId,tabId:input.expectedTarget.tabId,windowId:input.expectedTarget.windowId,identityDigest:binding.identityDigest,packetDigest:binding.packetDigest,preparedBodySha256:binding.preparedBodySha256,sourcePlanSha256:binding.nativeAssetSourcePlanSha256,baselineSha256:sha(input.baselineDocIds),bodySha256:binding.preparedBodySha256,fileSetSha256:observation.fileSetSha256,byteSetSha256:observation.byteSetSha256,filesCount:observation.filesCount,duplicateMatches:0,documentState:'UNFINISHED',readOnly:true,remoteWrites:false,historicalAckRecovered:false,observedAt:clock.now});
 f.bindInput=observation=>({...copy(input),mode:'bind',proof:f.proof(observation),expectedObservation:Object.fromEntries(['fileSetSha256','byteSetSha256','rawBodySha256','filesCount'].map(key=>[key,observation[key]]))});
 return f;
}
function expectFailure(result){assert.deepEqual(Object.keys(result),['currentReadFailure']);assert.equal(result.currentReadFailure.format,'yoofam-current-saved-draft-read-failure-v1');assert.match(result.currentReadFailure.phase,/^[a-z-]+$/);assert.match(result.currentReadFailure.code,/^[a-z][a-z0-9-]+$/);assert.doesNotMatch(JSON.stringify(result),/https:|2347603|stored-image|current-owner|원래 저장/);}
function resealExpected(f){
 const binding=f.input.binding,prepared=copy(f.input.expectedBody);prepared.docId=null;
 binding.identityDigest=sha(binding.identity);binding.preparedBodySha256=sha(prepared);binding.originalBodySha256=binding.preparedBodySha256;
 const identity=Object.fromEntries(Object.entries(binding.identity).filter(([key])=>!['appTabId','windowId'].includes(key)));
 binding.packetDigest=sha({identity,bodySha256:binding.preparedBodySha256,originalBodySha256:binding.originalBodySha256});f.input.previousTarget.packetDigest=binding.packetDigest;
}

test('fresh owned tab reads the exact original body and nine actual image bytes with at most three parallel downloads',async()=>{
 const f=fixture(),before=f.snapshot(),result=await f.run();assert.equal(result.currentReadFailure,undefined);assert.equal(result.filesCount,9);assert.equal(result.duplicateMatches,0);assert.equal(result.documentState,'UNFINISHED');assert.equal(result.readOnly,true);assert.equal(result.remoteWrites,false);assert.equal(result.historicalAckRecovered,false);assert.equal(result.record,undefined);
 const body=Object.fromEntries(['docId','productName','categoryPath','categoryId','displayCategoryCode','jsonDocument','scope','productNoticeNumber','version','remark'].map(key=>[key,f.state.body[key]]));
 const files=f.state.files.map(row=>Object.fromEntries(['imageName','imageUrl','s3Link','host','mainImage'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))).sort((a,b)=>a.imageName.localeCompare(b.imageName));
 assert.deepEqual(result.body,body);assert.deepEqual(result.files,files);assert.equal(result.rawBodySha256,sha(body));assert.equal(result.fileSetSha256,sha(files));assert.equal(result.byteSetSha256,sha(f.input.expectedImages));assert.equal(f.state.maxActiveBytes,3);
 assert.equal(f.snapshot(),before);assert.equal(f.writes(),0);assert.equal(f.calls.length,14);assert.deepEqual(f.calls.filter(call=>call.method==='POST').map(call=>[call.path,call.body]),[['/sr/draft/api/get-files-by-type/2347603','{}']]);assert.equal(f.calls.some(call=>call.path.includes('fileType=')),false);assert.ok(f.calls.every(call=>call.method==='GET'||call.path==='/sr/draft/api/get-files-by-type/2347603'));assert.equal(f.timers.size,0);
 const stringResult=await f.run(JSON.stringify(f.input));assert.equal(typeof stringResult,'string');assert.equal(JSON.parse(stringResult).fileSetSha256,result.fileSetSha256);
});

test('one unfiltered all-legal query accepts only literal empty arrays or objects through read, bind and check',async()=>{
 for(const legal of [[],{}]){const f=fixture();f.state.legal=legal;const read=await f.run();assert.equal(read.currentReadFailure,undefined);assert.equal(f.calls.length,14);
  const bound=await f.run(f.bindInput(read));assert.equal(bound.currentReadFailure,undefined);assert.equal(f.calls.length,28);const record=f.snapshot(),writes=f.writes();
  const checked=await f.run({...copy(f.input),mode:'check'});assert.equal(checked.currentReadFailure,undefined);assert.equal(f.calls.length,42);assert.equal(f.snapshot(),record);assert.equal(f.writes(),writes);
  assert.deepEqual(f.calls.filter(call=>call.method==='POST').map(call=>[call.path,call.body]),Array.from({length:3},()=>['/sr/draft/api/get-files-by-type/2347603','{}']));
  assert.ok(f.calls.every(call=>call.method==='GET'||call.path==='/sr/draft/api/get-files-by-type/2347603'));assert.equal(f.calls.some(call=>call.path.includes('fileType=')),false);
 }
});

test('all-legal scalar shapes and every nonempty collection fail with fixed distinct diagnostics without unwrapping or leaking responses',async()=>{
 const responses=[null,false,0,''].map(legal=>({legal,code:'legal-response-shape'})).concat([
  [{fileName:'raw-private-file.pdf',fileType:'unfamiliar-native-type'}],
  {fileName:'raw-private-file.pdf',fileType:'certificate'},
  {error:'raw-private-server-error',url:'https://private.example/legal'},
  {data:[]},
  {format:'native-typed-empty',files:[]},
  {certificate:{}},
 ].map(legal=>({legal,code:Array.isArray(legal)?'legal-array-nonempty':'legal-object-nonempty'})));
 for(const {legal,code} of responses){const f=fixture();f.state.legal=legal;const before=f.snapshot(),result=await f.run();expectFailure(result);assert.equal(result.currentReadFailure.phase,'legal-lists');assert.equal(result.currentReadFailure.code,code);
  assert.doesNotMatch(JSON.stringify(result),/raw-private|private\.example|unfamiliar-native-type|native-typed-empty/);assert.equal(f.snapshot(),before);assert.equal(f.writes(),0);assert.equal(f.calls.some(call=>call.path.startsWith('/sr/api/image/')),false);
  assert.deepEqual(f.calls.filter(call=>call.method==='POST').map(call=>[call.path,call.body]),[['/sr/draft/api/get-files-by-type/2347603','{}']]);assert.equal(f.calls.some(call=>call.path.includes('fileType=')),false);
 }
});

test('nonempty legal arrays report bounded field kinds and manifest matches while retaining the failure and hiding all raw file identities',async()=>{
 const f=fixture(),name=f.input.expectedImages[0].transportName,link=f.state.files[0].s3Link;
 f.state.legal=[{fileType:'certificate',fileName:'PRIVATE_UNKNOWN_FILE.pdf',s3Link:'PRIVATE_S3_KEY',docId:f.input.docId},
  {fileType:'MAIN',imageName:name,s3Link:link,docId:f.input.docId},
  {fileType:'additional',fileName:'',s3Link:' \t',docId:String(f.input.docId)}];
 const before=f.snapshot(),result=await f.run();expectFailure(result);assert.equal(result.currentReadFailure.code,'legal-array-nonempty');
 const diagnostics=result.currentReadFailure.diagnostics;assert.deepEqual(Object.keys(diagnostics).sort(),['bodyRelations','collection','count','format','rows','truncated']);assert.equal(diagnostics.format,'yoofam-saved-draft-legal-diagnostics-v2');assert.equal(diagnostics.collection,'array');assert.equal(diagnostics.count,3);assert.equal(diagnostics.truncated,false);
 const [legal,image,empty]=diagnostics.rows;assert.deepEqual(legal.keys,['docId','fileName','fileType','s3Link']);assert.equal(legal.keyCount,4);assert.equal(legal.keysTruncated,false);assert.equal(legal.type,'object');assert.equal(legal.index,0);
 assert.deepEqual(legal.fileType,{type:'string',knownType:'certificate',identifier:true});assert.deepEqual(legal.fileName,{type:'string',expectedImageMatch:false});assert.deepEqual(legal.imageName,{type:'missing',expectedImageMatch:false});assert.deepEqual(legal.s3Link,{type:'string',expectedImageMatch:false});assert.deepEqual(legal.docId,{type:'number',same:true});
 assert.deepEqual(image.fileType,{type:'string',knownType:'MAIN',identifier:true});assert.deepEqual(image.imageName,{type:'string',expectedImageMatch:true});assert.deepEqual(image.s3Link,{type:'string',expectedImageMatch:true});assert.deepEqual(empty.fileName,{type:'string-empty',expectedImageMatch:false});assert.deepEqual(empty.s3Link,{type:'string-empty',expectedImageMatch:false});assert.deepEqual(empty.docId,{type:'string',same:false});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_UNKNOWN_FILE|PRIVATE_S3_KEY|stored\/native|stored-image/);assert.equal(f.snapshot(),before);assert.equal(f.writes(),0);assert.equal(f.calls.some(call=>call.path.startsWith('/sr/api/image/')),false);
});

test('malformed legal rows and nested credential values reveal only fixed types with no raw strings or property values',async()=>{
 const f=fixture(),secret='SECRET_DO_NOT_LEAK_899162';f.state.legal=[null,[],secret,false,34,{},
  {fileType:{token:secret},fileName:[secret],imageName:34,s3Link:false,docId:{secret}},
  {fileType:secret,fileName:secret,imageName:secret,s3Link:'https://private.example/?credential='+secret,docId:secret},
  {fileType:'A'.repeat(40)}, {fileType:'B'.repeat(41)}, {fileType:'한글 원문'}];
 const result=await f.run();expectFailure(result);const rows=result.currentReadFailure.diagnostics.rows;
 assert.deepEqual(rows.map(row=>row.type),['null','array','string','boolean','number','object','object','object','object','object','object']);
 for(const row of rows.slice(0,5)){assert.deepEqual(row.keys,[]);assert.equal(row.keyCount,0);assert.equal(row.keysTruncated,false);assert.deepEqual(row.fileType,{type:'missing',knownType:null,identifier:false});for(const key of ['fileName','imageName','s3Link'])assert.deepEqual(row[key],{type:'missing',expectedImageMatch:false});assert.deepEqual(row.docId,{type:'missing',same:false});}
 assert.deepEqual(rows[6].fileType,{type:'object',knownType:null,identifier:false});assert.deepEqual(rows[6].fileName,{type:'array',expectedImageMatch:false});assert.deepEqual(rows[6].imageName,{type:'number',expectedImageMatch:false});assert.deepEqual(rows[6].s3Link,{type:'boolean',expectedImageMatch:false});assert.deepEqual(rows[6].docId,{type:'object',same:false});
 assert.deepEqual(rows[7].fileType,{type:'string',knownType:null,identifier:true});assert.equal(rows[8].fileType.identifier,true);assert.equal(rows[9].fileType.identifier,false);assert.equal(rows[10].fileType.identifier,false);
 assert.doesNotMatch(JSON.stringify(result),/SECRET_DO_NOT_LEAK|private\.example|credential|한글|AAAAAAAAAAAA|BBBBBBBBBBBB/);assert.equal(f.writes(),0);
});

test('legal diagnostic samples cap both rows and own keys and never expose unknown identifier keys or credential-shaped property names',async()=>{
 const f=fixture(),knownKeys=['attachmentType','byteLength','categoryId','certificateType','code','contentType','createdAt','data','disabled','docId','documentId','errorCode','fileId','fileName','fileSize','fileType','host','id','imageData','imageName','imageUrl','mainImage','message','mimeType','modifiedAt','name','productId','s3Link','sha256','size','status','type','version'];
 const row=Object.fromEntries([...knownKeys.map(key=>[key,'PRIVATE_VALUE_80129']),['SECRET_CREDENTIAL_80129','PRIVATE_VALUE_80129'],['https://private.example/','PRIVATE_VALUE_80129'],['X'.repeat(81),'PRIVATE_VALUE_80129'],['__proto__',{token:'PRIVATE_VALUE_80129'}]]);
 f.state.legal=Array.from({length:100},()=>copy(row));const result=await f.run();expectFailure(result);const diagnostics=result.currentReadFailure.diagnostics;assert.equal(diagnostics.count,100);assert.equal(diagnostics.rows.length,12);assert.equal(diagnostics.truncated,true);
 for(const [index,sample] of diagnostics.rows.entries()){assert.equal(sample.index,index);assert.equal(sample.keyCount,37);assert.equal(sample.keys.length,12);assert.deepEqual(sample.keys,knownKeys.slice().sort().slice(0,12));assert.equal(sample.keysTruncated,true);assert.ok(sample.keys.every(key=>/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key)));}
 const encoded=JSON.stringify(result);assert.ok(encoded.length<10000);assert.doesNotMatch(encoded,/PRIVATE_VALUE|SECRET_CREDENTIAL|private\.example|__proto__|XXXXXXXXXXXXXXXX/);assert.equal(f.writes(),0);
});

test('legal diagnostic failure also blocks bind and check without altering an existing current-read record or fabricating acknowledgements',async()=>{
 for(const mode of ['bind','check']){const f=fixture(),read=await f.run();if(mode==='check')await f.run(f.bindInput(read));const before=f.snapshot(),writes=f.writes();f.state.legal=[{fileType:'LABEL',imageName:f.input.expectedImages[0].transportName,s3Link:f.state.files[0].s3Link}];
  const input=mode==='bind'?f.bindInput(read):{...copy(f.input),mode:'check'},encoded=await f.run(JSON.stringify(input));assert.equal(typeof encoded,'string');const result=JSON.parse(encoded);expectFailure(result);assert.equal(result.currentReadFailure.code,'legal-array-nonempty');assert.equal(result.currentReadFailure.diagnostics.rows[0].fileType.knownType,'LABEL');assert.equal(result.record,undefined);assert.equal(result.body,undefined);assert.equal(f.snapshot(),before);assert.equal(f.writes(),writes);
 }
 for(const legal of [{data:[]},null]){const f=fixture();f.state.legal=legal;const result=await f.run();expectFailure(result);assert.equal(Object.hasOwn(result.currentReadFailure,'diagnostics'),false);}
 const f=fixture();f.state.files[0].host='other.invalid';const result=await f.run();expectFailure(result);assert.equal(Object.hasOwn(result.currentReadFailure,'diagnostics'),false);
});

test('legal relation diagnostics require paired image identity and preserve separate LABEL and schema certificate associations',async()=>{
 const f=fixture(),name=f.input.expectedImages[0].transportName,link=f.state.files[0].s3Link,other=f.state.files[1].s3Link;
 for(const member of f.input.expectedBody.jsonDocument){member.imagePage.images={labelImages:[{labelImageType:'PRIVATE_LABEL_NAME',labelImageFiles:name}]};member.legalPage.certificates=[{certificateName:'PRIVATE_SCHEMA_NAME',certificateValue:'NA'},{certificateName:'PRIVATE_SCHEMA_NAME_2',certificateValue:'PRIVATE_CERT_NUMBER'}];}
 resealExpected(f);f.state.body.jsonDocument=copy(f.input.expectedBody.jsonDocument);for(const member of f.state.body.jsonDocument)delete member.legalPage.adCert;
 f.state.legal=[{fileType:'certificate',fileName:name,s3Link:other},{fileType:'certificate',fileName:name,s3Link:link},{fileType:'certificate',fileName:'private-prefix-cert1-private.png',s3Link:'PRIVATE_CERT_LINK'}];
 const before=f.snapshot(),result=await f.run();expectFailure(result);const d=result.currentReadFailure.diagnostics;
 assert.equal(d.rows[0].fileName.expectedImageMatch,true);assert.equal(d.rows[0].s3Link.expectedImageMatch,true);assert.equal(d.rows[0].pairedImageDescriptorMatch,false);
 assert.equal(d.rows[1].pairedImageDescriptorMatch,true);assert.equal(d.rows[1].expectedLabelReferences,3);assert.equal(d.rows[0].expectedLabelReferences,3);
 assert.deepEqual(d.rows[2].certificateNamePrefix,{type:'string',matchedIndex:1,ambiguous:false,scanComplete:true,memberRowMatches:3});
 assert.equal(d.bodyRelations.remoteLegalMatchesExpected,true);assert.equal(d.bodyRelations.memberCount,3);assert.equal(d.bodyRelations.truncated,false);
 for(const member of d.bodyRelations.members){assert.equal(member.remoteCertificatesType,'array');assert.equal(member.remoteCount,2);assert.equal(member.expectedCount,2);assert.equal(member.matchesExpected,true);assert.equal(member.rows[1].expectedRowMatch,true);assert.deepEqual(member.rows[1].fieldKinds,{null:0,array:0,object:0,'string-empty':0,string:2,number:0,boolean:0});}
 assert.equal(f.snapshot(),before);assert.equal(f.writes(),0);assert.equal(f.calls.some(call=>call.path.startsWith('/sr/api/image/')),false);assert.doesNotMatch(JSON.stringify(d),/PRIVATE_|private-prefix|"certificateValue"|"certificateName"|certificateFile|stored-image|stored\/native/);
});

test('certificate prefixes use canonical includes semantics without claiming an ambiguous or out-of-range row',async()=>{
 const f=fixture();for(const member of f.state.body.jsonDocument)member.legalPage.certificates=[{},{}];
 f.state.legal=['x-cert0-private','cert01-private','cert1-private-cert0-other','cert200-private','cert999999999999999999999999-private','x'.repeat(513)].map(fileName=>({fileType:'certificate',fileName}));
 f.state.legal.push({fileType:'certificate',fileName:{privateCredential:'PRIVATE_PREFIX_VALUE'}});
 const result=await f.run();expectFailure(result);const rows=result.currentReadFailure.diagnostics.rows;
 assert.deepEqual(rows[0].certificateNamePrefix,{type:'string',matchedIndex:0,ambiguous:false,scanComplete:true,memberRowMatches:3});
 assert.deepEqual(rows[1].certificateNamePrefix,{type:'string',matchedIndex:null,ambiguous:false,scanComplete:true,memberRowMatches:0});
 assert.deepEqual(rows[2].certificateNamePrefix,{type:'string',matchedIndex:null,ambiguous:true,scanComplete:true,memberRowMatches:0});
 for(const index of [3,4,5])assert.deepEqual(rows[index].certificateNamePrefix,{type:'string',matchedIndex:null,ambiguous:false,scanComplete:false,memberRowMatches:0});
 assert.deepEqual(rows[6].certificateNamePrefix,{type:'object',matchedIndex:null,ambiguous:false,scanComplete:true,memberRowMatches:0});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PREFIX_VALUE|privateCredential|private|xxxxxxxxxxxx/);assert.equal(f.writes(),0);
});

test('legal body equality permits only missing empty adCert projection and detects every other changed schema value',async()=>{
 const f=fixture();f.state.legal=[{fileType:'certificate'}];
 const read=await f.run();assert.equal(read.currentReadFailure.diagnostics.bodyRelations.remoteLegalMatchesExpected,true);
 f.state.body.jsonDocument[0].legalPage.extra='PRIVATE_EXTRA';const extra=await f.run();assert.equal(extra.currentReadFailure.diagnostics.bodyRelations.remoteLegalMatchesExpected,false);
 delete f.state.body.jsonDocument[0].legalPage.extra;f.state.body.jsonDocument[0].legalPage.adCert=null;
 assert.equal((await f.run()).currentReadFailure.diagnostics.bodyRelations.remoteLegalMatchesExpected,false);
 assert.doesNotMatch(JSON.stringify(extra),/PRIVATE_EXTRA|extra/);assert.equal(f.writes(),0);
});

test('certificate body samples share a twelve-row budget and never expose schema keys or values',async()=>{
 const f=fixture(),base=f.input.expectedBody.jsonDocument[0],secret='PRIVATE_BODY_FIELD_876';
 f.input.binding.identity.members=Array.from({length:13},(_,documentIndex)=>({optionId:'option-'+documentIndex,optionLabel:'private-'+documentIndex,documentIndex}));
 f.input.expectedBody.jsonDocument=Array.from({length:13},()=>({...copy(base),legalPage:{adCert:'',certificates:Array.from({length:15},()=>({[secret]:secret,unknownNested:{secret},array:[secret],empty:'',nil:null,number:3,boolean:false}))}}));
 f.input.expectedBody.jsonDocument[0].imagePage.images={labelImages:'PRIVATE_MALFORMED_LABEL'};resealExpected(f);f.state.body.jsonDocument=copy(f.input.expectedBody.jsonDocument);f.state.legal=[{fileType:'certificate',fileName:'PRIVATE_FILE'}];
 const result=await f.run();expectFailure(result);const d=result.currentReadFailure.diagnostics,b=d.bodyRelations;
 assert.equal(b.memberCount,13);assert.equal(b.members.length,12);assert.equal(b.truncated,true);assert.equal(b.members.flatMap(member=>member.rows).length,12);assert.equal(b.members[0].rows.length,12);assert.ok(b.members.every(member=>member.truncated));
 assert.deepEqual(b.members[0].rows[0].fieldKinds,{null:1,array:1,object:1,'string-empty':1,string:1,number:1,boolean:1});assert.equal(d.rows[0].expectedLabelReferences,null);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|unknownNested|secret|certificateFile|private-/);assert.equal(f.writes(),0);assert.equal(f.calls.length,5);
});

test('bind independently rereads current hashes, records no historical ACK and can idempotently refresh only its current-read proof',async()=>{
 const f=fixture(),read=await f.run(),input=f.bindInput(read),bound=await f.run(input);assert.equal(bound.currentReadFailure,undefined);assert.equal(f.writes(),1);assert.deepEqual(bound.record,f.record());
 const record=f.record();assert.equal(record.state,'updated');assert.equal(record.createOperationId,f.input.binding.requestId+':create');assert.deepEqual(record.baselineDocIds,f.input.baselineDocIds);assert.equal(record.updateOperationId,undefined);assert.equal(record.nativeAssets,undefined);assert.equal(record.validation,undefined);
 assert.equal(record.currentReadRecovery.proofSha256,sha(input.proof));assert.equal(record.currentReadRecovery.fileBodyWritesAllowed,false);assert.equal(record.currentReadRecovery.historicalAckRecovered,false);
 const first=f.snapshot();assert.equal((await f.run(input)).currentReadFailure,undefined);assert.equal(f.snapshot(),first);assert.equal(f.writes(),1);
 f.clock.now++;const renewed=f.bindInput(read);assert.equal((await f.run(renewed)).currentReadFailure,undefined);assert.equal(f.writes(),2);assert.equal(f.record().currentReadRecovery.proof.observedAt,f.clock.now);assert.equal((await f.run()).currentReadFailure,undefined);assert.equal(f.writes(),2);
});

test('check verifies an existing validated loaded record without mutation; read and bind cannot rewind advanced state',async()=>{
 const f=fixture(),read=await f.run();await f.run(f.bindInput(read));const record=f.record();record.state='validated';record.validation={2:{operationId:f.input.binding.requestId+':validate:2',state:'observed',response:{data:[{success:true}]}}};record.loadedDocId=f.input.docId;record.watchToken='current-watch';record.watchState='active';record.watchExpiresAt=f.clock.now+60000;f.setRecord(record);
 f.location.pathname='/sr/registration/step/startPage';f.state.formValues=['원래 저장 상품'];const snapshot=f.snapshot();
 const checked=await f.run({...copy(f.input),previousTarget:{...f.input.previousTarget,tabId:f.input.expectedTarget.tabId},mode:'check'});assert.equal(checked.currentReadFailure,undefined);assert.equal(checked.record,undefined);assert.equal(f.snapshot(),snapshot);
 f.location.pathname='/dashboard/KR';f.state.formValues=[];expectFailure(await f.run());expectFailure(await f.run(f.bindInput(read)));assert.equal(f.snapshot(),snapshot);
});

test('check admits only the body flags of observed authorized stages and preserves the initial current-read proof',async()=>{
 for(const mode of ['product','both','unauthorized-flag','nonboolean','operation','other-body','order']){const f=fixture(),read=await f.run();await f.run(f.bindInput(read));const record=f.record(),authorizedStages=mode==='both'?['productPage','imagePage']:mode==='order'?['imagePage']:['productPage'];
  record.state='validated';record.stageConsentOperations=Object.fromEntries(authorizedStages.map(stage=>[stage,{state:'observed',operationId:f.input.binding.requestId+':stage-consent:'+stage}]));if(mode==='operation')record.stageConsentOperations.productPage.operationId='different-operation';f.setRecord(record);
  for(const member of f.state.body.jsonDocument){member.imagePage.msrpAgree=true;if(mode==='both'||mode==='unauthorized-flag')member.imagePage.labelContactAgreed=true;if(mode==='nonboolean')member.imagePage.msrpAgree='true';}
  if(mode==='other-body')f.state.body.jsonDocument[0].productPage.commonAttributes.purchasePrice++;const before=f.snapshot();
  const result=await f.run({...copy(f.input),mode:'check',authorizedStages});
  if(['product','both'].includes(mode)){assert.equal(result.currentReadFailure,undefined);assert.notEqual(result.rawBodySha256,read.rawBodySha256);assert.equal(f.record().currentReadRecovery.rawBodySha256,read.rawBodySha256);}
  else expectFailure(result);assert.equal(f.snapshot(),before,mode);
 }
});

test('optional native remark and source-bound generic member counts remain exact without wrapper or body normalization guesses',async()=>{
 const f=fixture();delete f.state.body.remark;f.input.binding.identity.members=f.input.binding.identity.members.slice(0,1);f.input.expectedBody.jsonDocument=f.input.expectedBody.jsonDocument.slice(0,1);f.state.body.jsonDocument=f.state.body.jsonDocument.slice(0,1);
 const binding=f.input.binding;binding.identityDigest=sha(binding.identity);binding.preparedBodySha256=sha({...copy(f.input.expectedBody),docId:null});binding.originalBodySha256=binding.preparedBodySha256;binding.packetDigest=sha({identity:Object.fromEntries(Object.entries(binding.identity).filter(([key])=>!['appTabId','windowId'].includes(key))),bodySha256:binding.preparedBodySha256,originalBodySha256:binding.originalBodySha256});f.input.previousTarget.packetDigest=binding.packetDigest;
 const result=await f.run();assert.equal(result.currentReadFailure,undefined);assert.equal(result.body.jsonDocument.length,1);assert.equal(Object.hasOwn(result.body,'remark'),false);assert.equal(result.rawBodySha256,sha(result.body));assert.equal(f.writes(),0);
});

test('scope, stale source, legal source plans and conflicting page records fail before remote queries',async()=>{
 for(const mode of ['company','form','page','baseline','identity-hash','packet-hash','source-body','member-order','legal-source','too-large','total-size','foreign-record']){const f=fixture();
  if(mode==='company')f.state.company='Company Code: A01464742';if(mode==='form')f.state.formValues=['user work'];if(mode==='page')f.location.pathname='/sr/registration';if(mode==='baseline')f.input.baselineDocIds.push(f.input.docId);
  if(mode==='identity-hash')f.input.binding.identityDigest='a'.repeat(64);if(mode==='packet-hash')f.input.binding.packetDigest='a'.repeat(64);if(mode==='source-body')f.input.expectedBody.productName='changed';if(mode==='member-order')f.input.binding.identity.members[1].documentIndex=0;
  if(mode==='legal-source')f.input.expectedLegal=[];if(mode==='too-large')f.input.expectedImages[0].byteLength=10*1024*1024+1;if(mode==='total-size')for(const file of f.input.expectedImages)file.byteLength=10*1024*1024;if(mode==='foreign-record')f.dataset.yoofamSingleDocumentRecords=JSON.stringify({other:{docId:999}});
  const before=f.snapshot();expectFailure(await f.run());assert.equal(f.calls.length,0,mode);assert.equal(f.snapshot(),before,mode);
 }
});

test('direct native list and body shapes, original document status and complete duplicate coverage are required',async()=>{
 for(const mode of ['draft-wrapper','draft-duplicate-id','missing-original','submitted-original','wrong-scope','wrong-category','same-draft','same-requested','requested-original','requested-wrapper','body-wrapper','body-status','body-field','body-member-count']){const f=fixture();
  if(mode==='draft-wrapper')f.state.drafts={items:f.state.drafts};if(mode==='draft-duplicate-id')f.state.drafts.push(copy(f.state.drafts[0]));if(mode==='missing-original')f.state.drafts=[];if(mode==='submitted-original')f.state.drafts[0].status='SUBMITTED';if(mode==='wrong-scope')f.state.drafts[0].scope='Retail_Multi';if(mode==='wrong-category')f.state.drafts[0].categoryId='999';
  if(mode==='same-draft')f.state.drafts.push({...copy(f.state.drafts[0]),docId:2347604});if(mode==='same-requested')f.state.requested=[{...copy(f.state.drafts[0]),docId:2347604}];if(mode==='requested-original')f.state.requested=[copy(f.state.drafts[0])];if(mode==='requested-wrapper')f.state.requested={rows:[]};
  if(mode==='body-wrapper')f.state.body={data:f.state.body};if(mode==='body-status')f.state.body.status='SUBMITTED';if(mode==='body-field')delete f.state.body.categoryId;if(mode==='body-member-count')f.state.body.jsonDocument.pop();
  expectFailure(await f.run());assert.equal(f.writes(),0,mode);assert.equal(f.calls.some(call=>call.path.startsWith('/sr/api/image/')),false,mode);
 }
});

test('image metadata cannot nominate foreign downloads, duplicate names, extra files or unexpected legal files',async()=>{
 for(const mode of ['missing','unexpected','duplicate','foreign-host','foreign-url','wrong-key','extra-query','fragment','main-type','legal-present']){const f=fixture();
  if(mode==='missing')f.state.files.pop();if(mode==='unexpected')f.state.files[0].imageName='unexpected.png';if(mode==='duplicate')f.state.files[1]=copy(f.state.files[0]);if(mode==='foreign-host')f.state.files[0].host='external.example';if(mode==='foreign-url')f.state.files[0].imageUrl='https://external.example/sr/api/image/get-by-key?key=one';
  if(mode==='wrong-key')f.state.files[0].imageUrl='/sr/api/image/get-by-key?key=wrong';if(mode==='extra-query')f.state.files[0].imageUrl+='&token=do-not-read';if(mode==='fragment')f.state.files[0].imageUrl+='#fragment';if(mode==='main-type')f.state.files[0].mainImage='true';if(mode==='legal-present')f.state.legal=[{fileName:'already.pdf'}];
  expectFailure(await f.run());assert.equal(f.writes(),0,mode);assert.equal(f.calls.some(call=>call.path.startsWith('/sr/api/image/')),false,mode);
 }
});

test('actual bytes must match immutable SHA, MIME and bounded length with no redirect or error response',async()=>{
 for(const mode of ['sha','mime','length','stream-size','redirect','status','declared-size']){const f=fixture();
  f.override=path=>{if(!path.startsWith('/sr/api/image/'))return;const file=f.input.expectedImages[0],raw=copy([...f.binaries.get(file.transportName)]);let response;
   if(mode==='sha'){raw[0]++;response=f.response(path,new Uint8Array(raw),'image/png');}
   if(mode==='mime')response=f.response(path,new Uint8Array(raw),'image/jpeg');if(mode==='length')response=f.response(path,new Uint8Array(raw.slice(1)),'image/png');
   if(mode==='stream-size')response=f.response(path,new Uint8Array([...raw,1]),'image/png',{'content-length':String(raw.length)});
   if(mode==='redirect'){response=f.response(path,new Uint8Array(raw),'image/png');Object.defineProperty(response,'redirected',{value:true});}
   if(mode==='status'){response=f.response(path,new Uint8Array(raw),'image/png');Object.defineProperty(response,'status',{value:500});}
   if(mode==='declared-size')response=f.response(path,new Uint8Array(raw),'image/png',{'content-length':String(10*1024*1024+1)});return response;
  };
  expectFailure(await f.run());assert.equal(f.writes(),0,mode);assert.ok(f.calls.every(call=>call.method==='GET'||call.path.startsWith('/sr/draft/api/get-files-by-type/')));
 }
});

test('HTTP failures expose only the bounded status enum without reading or returning raw server errors',async()=>{
 for(const status of [401,403,404,429,500,502,503,504,418]){const f=fixture();f.override=path=>{if(path!=='/sr/draft/api/drafts')return;const response=f.response(path,{error:'private-raw-server-error',url:'https://private.example/session'});Object.defineProperty(response,'status',{value:status});return response;};
  const result=await f.run();expectFailure(result);assert.equal(result.currentReadFailure.code,status===418?'http-response':'http-'+status);assert.doesNotMatch(JSON.stringify(result),/private-raw|private\.example/);assert.equal(f.calls.length,1);assert.equal(f.writes(),0);
 }
});

test('manual redirects fail closed in read, bind and check without reading or following the authentication target',async()=>{
 const variants=[{type:'opaqueredirect',status:0,redirected:false},{type:'basic',status:200,redirected:true},{type:'basic',status:0,redirected:false},{type:'basic',status:302,redirected:false},{type:'basic',status:307,redirected:false}];
 for(const mode of ['read','bind','check'])for(const variant of variants){const f=fixture();let input=f.input;
  if(mode!=='read'){const read=await f.run();input=mode==='bind'?f.bindInput(read):{...copy(f.input),mode:'check'};if(mode==='check')assert.equal((await f.run(f.bindInput(read))).currentReadFailure,undefined);}
  const before=f.snapshot(),writes=f.writes(),calls=f.calls.length;let inspected=0;
  f.override=path=>path==='/sr/draft/api/drafts'?{...variant,ok:variant.status===200,get url(){inspected++;return 'https://private.example/sso?token=private-redirect';},get headers(){inspected++;throw Error('redirect headers must not be inspected');},get body(){inspected++;throw Error('redirect body must not be inspected');}}:undefined;
  const result=await f.run(input);expectFailure(result);assert.deepEqual(result.currentReadFailure,{format:'yoofam-current-saved-draft-read-failure-v1',phase:'draft-list',code:'http-redirect'});
  assert.equal(inspected,0,JSON.stringify({mode,variant}));assert.equal(f.snapshot(),before);assert.equal(f.writes(),writes);assert.equal(f.timers.size,0);
  assert.deepEqual(f.calls.slice(calls).map(call=>[call.path,call.redirect]),[['/sr/draft/api/drafts','manual']]);assert.doesNotMatch(JSON.stringify(result),/private|sso|token/);
 }
});

test('redirect classification protects every metadata and byte read before consuming any redirect response',async()=>{
 const phases=[['draft-list','/sr/draft/api/drafts'],['requested-list','/sr/draft/api/drafts/register-requested'],['body','/sr/draft/api/get-by-id/2347603'],['image-list','/sr/draft/api/get-images-by-id/2347603'],['legal-lists','/sr/draft/api/get-files-by-type/2347603'],['image-bytes','/sr/api/image/get-by-key?']];
 for(const [phase,path] of phases){const f=fixture(),before=f.snapshot();let inspected=0;
  f.override=current=>current.startsWith(path)?{type:'opaqueredirect',status:0,redirected:false,get url(){inspected++;throw Error('redirect URL must not be inspected');},get headers(){inspected++;throw Error('redirect headers must not be inspected');},get body(){inspected++;throw Error('redirect body must not be inspected');}}:undefined;
  const result=await f.run();expectFailure(result);assert.equal(result.currentReadFailure.phase,phase);assert.equal(result.currentReadFailure.code,'http-redirect');assert.equal(inspected,0);
  assert.equal(f.snapshot(),before);assert.equal(f.writes(),0);assert.equal(f.timers.size,0);assert.ok(f.calls.every(call=>call.redirect==='manual'));assert.ok(f.calls.every(call=>!call.path.includes('/login')&&!call.path.includes('/sso')));
 }
});

test('fetch exceptions remain fixed network failures without leaking error names, messages, stacks or authentication URLs',async()=>{
 for(const name of ['TypeError','RangeError','PrivateCredentialError']){const f=fixture(),before=f.snapshot();f.override=()=>{const error=Error('private-cookie=secret; https://private.example/sr/sso/login');error.name=name;error.stack='private-stack-with-session';throw error;};
  const result=await f.run();expectFailure(result);assert.deepEqual(result.currentReadFailure,{format:'yoofam-current-saved-draft-read-failure-v1',phase:'draft-list',code:'http-network'});assert.doesNotMatch(JSON.stringify(result),/TypeError|RangeError|PrivateCredentialError|private|secret|session/);assert.equal(f.calls.length,1);assert.equal(f.snapshot(),before);assert.equal(f.writes(),0);assert.equal(f.timers.size,0);
 }
});

test('MIME diagnostics use fixed buckets while unchanged image bytes still require their exact source MIME',async()=>{
 for(const mime of ['application/octet-stream','image/jpeg']){const f=fixture();f.override=path=>path.startsWith('/sr/api/image/')?f.response(path,f.binaries.get(f.input.expectedImages[0].transportName),mime):undefined;
  const result=await f.run();expectFailure(result);assert.equal(result.currentReadFailure.code,mime==='application/octet-stream'?'http-type-octet-stream':'http-type-other');assert.equal(f.writes(),0);
 }
});

test('company and exact DOM record snapshots are fenced during every read, including concurrent byte reads',async()=>{
 for(const mode of ['company','record-list','record-bytes']){const f=fixture();f.beforeFetch=path=>{if(mode==='company'&&path.endsWith('/drafts'))f.state.company='Company Code: A01464742';if(mode==='record-list'&&path.endsWith('/drafts')||mode==='record-bytes'&&path.startsWith('/sr/api/image/'))f.dataset.yoofamSingleDocumentRecords=JSON.stringify({changed:{docId:42}});};
  expectFailure(await f.run());assert.equal(f.record(),undefined);assert.equal(f.writes(),mode==='company'?0:1);
 }
});

test('bind rejects stale or mismatched proof, changed current bytes/body/metadata and advanced records without rewriting anything',async()=>{
 for(const mode of ['stale','proof-target','proof-source','proof-body','proof-hash','observation-hash','extra-observation','changed-body','changed-metadata']){const f=fixture(),read=await f.run(),input=f.bindInput(read);
  if(mode==='stale')input.proof.observedAt-=60001;if(mode==='proof-target')input.proof.tabId++;if(mode==='proof-source')input.proof.sourcePlanSha256='a'.repeat(64);if(mode==='proof-body')input.proof.bodySha256='a'.repeat(64);if(mode==='proof-hash')input.proof.fileSetSha256='a'.repeat(64);if(mode==='observation-hash')input.expectedObservation.rawBodySha256='a'.repeat(64);if(mode==='extra-observation')input.expectedObservation.extra=true;
  if(mode==='changed-body')f.state.body.jsonDocument[0].productPage.commonAttributes.purchasePrice++;if(mode==='changed-metadata')f.state.files[1].mainImage=true;
  const before=f.snapshot();expectFailure(await f.run(input));assert.equal(f.snapshot(),before,mode);assert.equal(f.writes(),0,mode);
 }
});

test('per-request timeout produces only fixed diagnostics and never binds after a missing response',async()=>{
 const f=fixture();let notifyStarted;const started=new Promise(resolve=>{notifyStarted=resolve;});f.override=path=>{if(!path.endsWith('/drafts'))return;notifyStarted();return new Promise(()=>{});};const pending=f.run();
 // WebCrypto may wait for a busy worker pool. Advance the synthetic timer only
 // after the actual fetch starts, rather than counting arbitrary event turns.
 await Promise.race([started,pending.then(()=>{throw Error('Expected one pending read');})]);assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);const timer=[...f.timers.values()][0];assert.equal(timer.ms,30000);timer.fn();const failed=await pending;expectFailure(failed);assert.equal(failed.currentReadFailure.code,'http-timeout');assert.equal(f.writes(),0);assert.equal(f.timers.size,0);
});


const auditInput=(f,bindings=null)=>({...copy(f.input),mode:'audit',audit:{checkpointSequence:24,schemaBindingComplete:bindings!==null,certificateBindings:bindings??[]}});
function certificateFixture(){
 const f=fixture(),bindings=[0,1,2].map(schemaIndex=>({schemaIndex,nameKey:'certificateTitle',valueKey:'certificateNumber',name:'PRIVATE_SCHEMA_TITLE_'+schemaIndex,value:'해당사항없음'}));
 for(const member of f.input.expectedBody.jsonDocument)member.legalPage.certificates=bindings.map(row=>({[row.nameKey]:row.name,[row.valueKey]:row.value}));
 for(const member of f.state.body.jsonDocument)member.legalPage.certificates=copy(f.input.expectedBody.jsonDocument[0].legalPage.certificates);
 resealExpected(f);return{f,bindings};
}
test('independent audit reads full legal list and every original image byte without binding, acceptance or legal reclassification',async()=>{
 const f=fixture(),name=f.state.files[0].imageName;f.state.legal=[{fileType:'certificate',fileName:name,s3Link:'PRIVATE_WRONG_S3'}];
 const before=f.snapshot(),report=await f.run(auditInput(f));validateUnexpectedLegalAuditReport(report,{binding:{...f.input.binding,sourcePlanSha256:f.input.binding.nativeAssetSourcePlanSha256,docId:f.input.docId,checkpointSequence:24},target:f.input.expectedTarget},f.clock.now);
 assert.equal(report.bodyMatchesExpected,true);assert.equal(report.legalCount,1);assert.equal(report.imageCount,9);assert.equal(report.schemaBindingComplete,false);assert.equal(report.legalEntries[0].association,'unknown');assert.equal(report.legalEntries[0].pairedImageDescriptorMatch,false);assert.equal(report.differenceCount,0);
 for(const key of ['canResume','canDelete','registered','remoteWrites','checkpointWrites','historicalAckRecovered'])assert.equal(report[key],false,key);
 assert.equal(report.readOnly,true);assert.equal(f.writes(),0);assert.equal(f.snapshot(),before);assert.equal(f.calls.length,14);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_WRONG|stored-image|stored\/native|certificateTitle/);
 const normal=await f.run();assert.equal(normal.currentReadFailure.code,'legal-array-nonempty');assert.equal(f.writes(),0);
});
test('schema-bound audit distinguishes canonical NA from empty and missing without revealing certificate names or values',async()=>{
 const {f,bindings}=certificateFixture();f.state.body.jsonDocument[0].legalPage.certificates[0].certificateNumber='';delete f.state.body.jsonDocument[1].legalPage.certificates[1].certificateNumber;
 f.state.body.jsonDocument[2].legalPage.certificates[2].certificateNumber='PRIVATE_UNEXPECTED_NUMBER';f.state.legal=[{fileType:'certificate',fileName:'PRIVATE_NO_PREFIX',s3Link:'PRIVATE_S3'}];
 const report=await f.run(auditInput(f,bindings));validateUnexpectedLegalAuditReport(report,{},f.clock.now);assert.equal(report.schemaBindingComplete,true);assert.equal(report.bodyMatchesExpected,false);assert.notEqual(report.normalizedBodySha256,report.preparedBodySha256);
 assert.deepEqual(report.differences.filter(row=>row.path==='legalPage.certificates.value').map(row=>[row.documentIndex,row.schemaIndex,row.expectedValueKind,row.actualValueKind]),[[0,0,'na','empty'],[1,1,'na','missing'],[2,2,'na','present']]);
 assert.equal(report.legalEntries[0].association,'unknown','nonmatching actual rows do not prove unused');assert.doesNotMatch(JSON.stringify(report),/PRIVATE_|certificateTitle|certificateNumber|해당사항없음/);assert.equal(f.writes(),0);
});
test('schema names bind native prefix indices independently of raw body row ordering and reject ambiguous prefixes',async()=>{
 const {f,bindings}=certificateFixture();for(const member of f.state.body.jsonDocument)member.legalPage.certificates.reverse();
 f.state.legal=[{fileType:'certificate',fileName:'prefix-cert2-private.pdf',s3Link:'private-0'},{fileType:'certificate',fileName:'cert0-private-cert1-private.pdf',s3Link:'private-1'},{fileType:'certificate',fileName:'no-schema-prefix',s3Link:'private-2'},{fileType:'certificate',fileName:'cert01-private.pdf',s3Link:'private-3'},{fileType:'certificate',fileName:'cert399-private.pdf',s3Link:'private-4'}];
 const report=await f.run(auditInput(f,bindings));validateUnexpectedLegalAuditReport(report,{},f.clock.now);assert.equal(report.bodyMatchesExpected,false);assert.deepEqual(report.legalEntries.map(row=>[row.association,row.schemaIndex]),[['linked',2],['ambiguous',null],['unlinked',null],['unlinked',null],['unknown',null]]);
 assert.equal(report.differences.filter(row=>row.path==='legalPage.certificates.order').length,3);assert.equal(report.canDelete,false);assert.equal(f.writes(),0);
});
test('audit bounds the public digest and difference samples while preserving complete legal count and exact pair matching',async()=>{
 const {f,bindings}=certificateFixture(),secret='PRIVATE_DO_NOT_EXPOSE';f.state.legal=Array.from({length:30},(_,index)=>({fileType:index===0?'certificate':secret,fileName:index===0?f.state.files[0].imageName:secret,s3Link:index===0?f.state.files[0].s3Link:secret,[secret]:{token:secret}}));
 for(const member of f.state.body.jsonDocument)member.legalPage.certificates.forEach(row=>row.certificateNumber=secret);
 const report=await f.run(auditInput(f,bindings));validateUnexpectedLegalAuditReport(report,{},f.clock.now);assert.equal(report.legalCount,30);assert.equal(report.legalEntries.length,12);assert.equal(report.legalEntriesTruncated,true);assert.equal(report.legalEntries[0].pairedImageDescriptorMatch,true);assert.equal(report.differenceCount,9);assert.ok(JSON.stringify(report).length<16000);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_DO_NOT|stored-image|token|certificateNumber/);assert.equal(f.writes(),0);
 const changed=copy(report);changed.legalEntries[0].fileName=secret;assert.throws(()=>validateUnexpectedLegalAuditReport(changed,{},f.clock.now));
 for(const key of ['remoteWrites','checkpointWrites','canResume','canDelete','registered']){const changed=copy(report);changed[key]=true;assert.throws(()=>validateUnexpectedLegalAuditReport(changed,{},f.clock.now));}
});
test('audit preserves image-byte, duplicate and source fences and rejects forged or sparse schema bindings',async()=>{
 for(const scenario of ['byte','duplicate','source','schema']){
  const {f,bindings}=certificateFixture();f.state.legal=[{fileType:'certificate',fileName:'PRIVATE',s3Link:'PRIVATE'}];const input=auditInput(f,bindings);
  if(scenario==='byte')f.binaries.set(f.input.expectedImages[0].transportName,new Uint8Array([1]));
  if(scenario==='duplicate')f.state.drafts.push({...copy(f.state.drafts[0]),docId:2347604});
  if(scenario==='source')f.beforeFetch=async path=>{if(path==='/sr/draft/api/get-by-id/2347603')f.state.company='Company Code: A01464742';};
  if(scenario==='schema')input.audit.certificateBindings[1].schemaIndex=2;
  const result=await f.run(input);expectFailure(result);assert.equal(f.writes(),0);assert.ok(f.calls.every(call=>call.method==='GET'||call.path==='/sr/draft/api/get-files-by-type/2347603'));
 }
});
