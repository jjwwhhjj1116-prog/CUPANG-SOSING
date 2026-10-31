import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {assetProjectionFixture,companies,module,plain,sha,imageBytes,config} from './helpers/supplier-hub-single-assets.mjs';

// Actual package loader, native GET handler, projector, attachment reader and
// both plan builders. Persistence snapshots and private object I/O are inert
// local values: this fixture never opens a DB or contacts an external service.
async function fixture({issue='번역 미완료: 원문 확인',role='detail',selection='selected',sidecar='valid'}={}){
 const f=assetProjectionFixture(),productId='synthetic-native-review',owner='owner',now='2026-10-31T02:00:00.000Z',calls=[];
 const records=module('app/free-image-edit-record.ts'),sourceKey='owner/source-generated.png',bytes=imageBytes(90),outputSha=sha(bytes);
 const source={productId,productVersion:now,contentRevision:3,sourceKey,sourceSha256:sha(imageBytes(91)),role,width:1,height:1,
  quotationTarget:{kind:'quotation',profileId:null,optionId:'synthetic-one',input:role==='main'?'mainImage':role==='additional'?'additionalImages':'detailImages',fieldKey:'synthetic-image',slotIndex:0,
   revision:5,inputFingerprint:'c'.repeat(64),optionRevision:4,bindingSha256:'d'.repeat(64),value:sourceKey}};
 const document={format:'free-image-edit-v1',width:1,height:1,sourceLanguage:'zh',regions:[{id:'text',text:'原文',translated:issue?'':'직접 수정',box:{x:0,y:0,width:1,height:1},confidence:20,
  selected:!issue,issue,translationProvenance:issue?'empty':'manual',background:'#ffffff',foreground:'#000000',fontSize:1}]};
 const {key}=await records.freeImageEditOutputKey(source,document,outputSha),record=await records.prepareFreeImageEditRecord(source,document,
  {source:'collection',profileId:null,categoryId:f.input.categoryId,categoryPath:f.input.categoryPath},companies[0],{key,sha256:outputSha,bytes:bytes.length,width:1,height:1});
 const objects=new Map(f.assets.map(asset=>[asset.key,new Uint8Array(asset.data)])),metadata=new Map([...f.metadata].map(([key,value])=>[key,{...plain(value),version:'version-'+sha(objects.get(key)).slice(0,8)}]));
 objects.set(key,bytes);metadata.set(key,{size:bytes.length,version:'version-generated',httpMetadata:{contentType:'image/png'},customMetadata:{freeImageEditDocumentSha256:record.documentSha256,
  freeImageEditRecordSha256:record.recordSha256,freeImageOutputSha256:outputSha,freeImageSourceSha256:sha(new TextEncoder().encode(module('app/free-image-translation.ts').freeImageSourceIdentity(source))),imageWidth:'1',imageHeight:'1'}});
 const recordBytes=new Uint8Array(record.bytes);if(sidecar==='corrupt')recordBytes[0]^=1;
 if(sidecar!=='missing')objects.set(key+'.edit.json',recordBytes);
 let supersededKey=null;
 if(selection==='superseded'){
  const previous=structuredClone(document);Object.assign(previous.regions[0],{issue:'이전 결과의 미완료 문구',translated:'',selected:false,translationProvenance:'empty'});
  supersededKey=(await records.freeImageEditOutputKey(source,previous,outputSha)).key;
  const stored=await records.prepareFreeImageEditRecord(source,previous,record.record.context,companies[0],{key:supersededKey,sha256:outputSha,bytes:bytes.length,width:1,height:1});
  objects.set(supersededKey,bytes);objects.set(supersededKey+'.edit.json',new Uint8Array(stored.bytes));
  metadata.set(supersededKey,{...plain(metadata.get(key)),customMetadata:{...plain(metadata.get(key).customMetadata),freeImageEditDocumentSha256:stored.documentSha256,freeImageEditRecordSha256:stored.recordSha256}});
 }
 const target=role==='main'?['imagePage','images','mainImage']:role==='additional'?['imagePage','images','additionalImage']:['imagePage','details','detailedImage'];
 if(selection==='selected'||selection==='superseded')f.set(target,undefined,key);
 if(selection==='label-only')f.set(['imagePage','images','labelImages'],'제품 한글 표시사항 라벨 또는 도안 이미지',key);
 if(selection==='excluded'){
  const excluded=structuredClone(f.row);excluded.optionId='excluded-option';excluded.optionLabel='제외 옵션';excluded.included=false;
  const field=f.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(target)&&field.hubWire?.name===undefined);
  excluded.fields[field.id]={...excluded.fields[field.id],value:key};f.resolved.rows.push(excluded);
 }
 const pool=[...metadata.keys()],clocks={productVersion:now,contentRevision:3,optionRevision:4,quotationRevision:5,profileId:null,profileRevision:null};
 const saved={product:{id:productId,owner_id:owner,updated_at:now,image_keys:JSON.stringify(pool)},content:{productId,revision:3,assets:{detailTop:{value:[]},detailBottom:{value:[]}},legalDocuments:{applicability:'not-applicable',files:[]}},
  options:{productId,revision:4,rows:f.resolved.rows.map(row=>({id:row.optionId,included:row.included,translatedName:row.optionLabel}))},state:{revision:5},settings:{},profile:null,
  source:clocks,sourceGaps:[],hubSchema:f.snapshot,company:companies[0],categoryContext:{source:'collection',profileId:null,categoryId:f.input.categoryId,categoryPath:f.input.categoryPath}};
 const view={productVersion:now,contentRevision:3,optionRevision:4,revision:5,inputFingerprint:'c'.repeat(64),categoryContext:saved.categoryContext,resolved:f.resolved,imageKeys:pool};
 const member={id:owner,email:'synthetic@example.test',role:'admin',status:'approved',companyCode:companies[0].code,companyName:companies[0].name};
 const bucket={head:async key=>{calls.push(['head',key]);return metadata.get(key)??null;},get:async key=>{
  calls.push(['get',key]);const data=objects.get(key);if(!data)return null;
  if(key.endsWith('.edit.json'))return{size:data.length,httpMetadata:{contentType:'application/json'},body:new Response(data).body};
  return{...plain(metadata.get(key)),arrayBuffer:async()=>new Uint8Array(data).buffer};
 },put:()=>assert.fail('read-only package validation must not write an image')};
 const env={FILES:bucket,YOOFAM_DETAIL_IMAGE_SECRET:config.secret,YOOFAM_DETAIL_IMAGE_ORIGIN:config.origin,
  DB:{prepare(sql){assert.match(sql,/product_removals/u);return{bind(){return{first:async()=>null};}};}}};
 class QuotationExportError extends Error{}
 const overrides={
  'cloudflare:workers':{env},'next/server':{NextResponse:Response},
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:true,userId:owner,membership:member}),getWorkspaceOwnerId:async()=>owner},
  '@/app/exports/quotation-source':{QuotationExportError,readQuotationExportSource:async()=>plain(saved),resolveQuotationExport:()=>structuredClone(f.resolved),quotationExportFingerprint:async()=> 'b'.repeat(64)},
  '@/db/quotation-fields':{readQuotationFields:async()=>plain(saved.state),quotationSourcesCurrent:async()=>true},
  '@/app/quotation-fields-snapshot':{QuotationFieldsSnapshotError:class extends Error{},stableQuotationFieldsView:async()=>({view:structuredClone(view),source:plain(clocks)})},
 };
 const modules=new Map();
 function load(file){
  if(modules.has(file))return modules.get(file);
  const exports={};modules.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,Error,Date,URL,Request,Response,Headers,AbortController,TextEncoder,TextDecoder,Uint8Array,Map,Set,JSON,Object,Array,structuredClone,crypto:webcrypto,btoa,atob,console,
   fetch:()=>assert.fail('no network'),require:name=>overrides[name]??(name==='@/app/exports/attachments'?load('app/exports/attachments.ts')
    :name==='@/app/exports/single-package'?load('app/exports/single-package.ts'):name.startsWith('@/app/')?module(name.slice(2)+'.ts'):assert.fail('unexpected dependency '+name))},{filename:file});return exports;
 }
 const api=load('app/api/products/[id]/native-assets/route.ts'),loader=load('app/exports/single-package.ts');
 const get=()=>api.GET(new Request('https://local.test/api/products/'+productId+'/native-assets'),{params:Promise.resolve({id:productId})});
 return{...f,productId,key,supersededKey,calls,objects,metadata,saved,view,get,load:()=>loader.loadSinglePackage(owner,productId,null,companies[0],async()=>{},false,undefined,true,{nativeReadOnly:true}),
  legacy:()=>loader.loadSinglePackage(owner,productId,null,companies[0],async()=>{}),state:()=>JSON.stringify([saved,view,[...objects].map(([key,value])=>[key,sha(value)])])};
}
const reviewed=body=>body.issues.filter(issue=>issue.code.startsWith('FREE_IMAGE_TRANSLATION_'));

test('actual native package GET blocks selected unresolved main, additional and detail outputs at their exact current option and field',async()=>{
 for(const role of ['main','additional','detail']){
  const f=await fixture({role}),before=f.state(),response=await f.get();assert.equal(response.status,200,await response.clone().text());const plan=await response.json();
  assert.equal(plan.metadataValid,false);assert.equal(plan.sourcePlanSha256,null);const issues=reviewed(plan);assert.equal(issues.length,1);assert.equal(issues[0].code,'FREE_IMAGE_TRANSLATION_UNRESOLVED');
  assert.equal(issues[0].optionId,'synthetic-one');const path=role==='main'?['imagePage','images','mainImage']:role==='additional'?['imagePage','images','additionalImage']:['imagePage','details','detailedImage'];
  assert.equal(issues[0].fieldId,f.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(path)&&field.hubWire?.name===undefined).id);
  assert.equal(f.calls.filter(([method,key])=>method==='get'&&key===f.key+'.edit.json').length,1);assert.equal(f.state(),before);
  const legacy=await f.legacy();assert.equal(legacy.view.review.canPrepare,false);assert.equal(legacy.view.review.issues.some(issue=>issue.code==='FREE_IMAGE_TRANSLATION_UNRESOLVED'),true);
  for(const flag of ['registered','remoteWrites','submissionReady','transportReady','bytesVerified'])assert.equal(plan[flag],false);
 }
});

test('missing or corrupt selected translation records remain unconfirmed blockers, while repaired selected outputs become valid without changing stored values',async()=>{
 for(const sidecar of ['missing','corrupt']){const f=await fixture({sidecar}),response=await f.get(),plan=await response.json();assert.equal(plan.metadataValid,false);assert.equal(reviewed(plan)[0].code,'FREE_IMAGE_TRANSLATION_UNCONFIRMED');assert.equal(plan.sourcePlanSha256,null);}
 for(const issue of [null,'','   ']){const f=await fixture({issue}),before=f.state(),loaded=await f.load(),plan=loaded.view.nativeAssetSourcePlan;assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));assert.equal(reviewed(plan).length,0);assert.match(plan.sourcePlanSha256,/^[a-f0-9]{64}$/u);assert.equal(f.state(),before);
  const review=await module('app/supplier-hub-native-product-document.ts').compileNativeSupplierHubProductDocument({productId:f.productId,sourcePlan:plan,quotationView:f.view,ownerId:'owner'});assert.equal(review.remoteWrites,false);
 }
});

test('unselected pool outputs, excluded option references and label-only reuse never block current effective product image wires or read their sidecars',async()=>{
 for(const selection of ['pool-only','excluded','label-only']){const f=await fixture({selection}),before=f.state(),loaded=await f.load(),plan=loaded.view.nativeAssetSourcePlan;
  assert.equal(plan.metadataValid,true,selection+': '+JSON.stringify(plan.issues));assert.equal(reviewed(plan).length,0,selection);assert.equal(f.calls.some(([,key])=>key===f.key+'.edit.json'),false,selection);
  assert.equal(f.state(),before);assert.equal(plan.identity.members.some(member=>member.optionId==='excluded-option'),false);
 }
});

test('an explicitly selected repaired output supersedes an older unresolved output in the same product pool',async()=>{
 const f=await fixture({issue:null,selection:'superseded'}),before=f.state(),loaded=await f.load(),plan=loaded.view.nativeAssetSourcePlan;
 assert.ok(f.supersededKey);assert.notEqual(f.key,f.supersededKey);assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));assert.equal(reviewed(plan).length,0);
 assert.equal(plan.images.some(image=>image.key===f.key),true);assert.equal(plan.images.some(image=>image.key===f.supersededKey),false);
 assert.equal(f.calls.some(([,key])=>key===f.supersededKey||key===f.supersededKey+'.edit.json'),false);assert.equal(f.state(),before);
});
