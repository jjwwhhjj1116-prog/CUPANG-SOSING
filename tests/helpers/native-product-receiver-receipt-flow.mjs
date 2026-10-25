import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {nativeReviewFixture,companies,plain,json} from './native-source-review.mjs';
import {singleBrowserFixture} from './supplier-hub-single-document-adapter.mjs';
import {createProductDocumentPacket} from '../../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity,createProductDocumentReceiver} from '../../extensions/supplier-hub/product-document-receiver.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../../extensions/supplier-hub/product-document-adapter.mjs';

export {companies,plain,json};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const withUrl=(response,url)=>{Object.defineProperty(response,'url',{value:url});return response;};

/** Actual application handlers and browser adapter/receiver, with only the
 * Chrome surface and Supplier Hub transport replaced by in-memory fixtures.
 * No returned receiver observation is authored by this helper. */
export async function nativeReceiverReceiptFixture(company=companies[0],options={}){
 const source=await nativeReviewFixture(company),state={status:'SUBMITTED',qvtRequestId:'000769-QVT-raw',rowChanges:{},uploads:[],appReads:[],uploadReads:[],registry:new Map(),humanConfirmations:[]};
 let browser,selected;
 try{
  const fields=await source.fields(),changes=[
   {fieldKey:source.byWire(['startPage','productName']),optionId:'synthetic-one',value:'합성 전체 첫째'},
   {fieldKey:source.byWire(['startPage','productName']),optionId:'synthetic-two',value:'합성 전체 둘째'},
   ...[['supplyPrice','3333',['productPage','commonAttributes','purchasePrice']],['salePrice','4444',['productPage','commonAttributes','coupangSalePrice']],['msrp','5555',['productPage','commonAttributes','msrp']]]
    .flatMap(([key,value,path])=>[...new Set([key,source.byWire(path)])].map(fieldKey=>({fieldKey,optionId:'synthetic-two',value}))),
  ];
  await json(await source.h.route(source.fieldsPath,{method:'PUT',body:{expectedRevision:fields.revision,expectedInputFingerprint:fields.inputFingerprint,changes}}));
  const plan=await source.source(),quotationView=await source.fields(),review=await source.model.reviewCurrentNativeSupplierHubProductDocument({productId:source.id,profileId:source.profile.id,quotationView,sourcePlan:plan,ownerId:'owner',signal:new AbortController().signal,fetcher:source.request});
  browser=await singleBrowserFixture(company,{registerRequestedRows:f=>[{docId:f.createdDocId,status:state.status,qvtRequestId:state.qvtRequestId,productName:f.documents.get(f.createdDocId).productName,categoryPath:f.documents.get(f.createdDocId).categoryPath,modifiedAt:new Date().toISOString(),remark:'',...state.rowChanges}],...options.browser});
  const packet=await createProductDocumentPacket(plain(review)),context=await productDocumentIdentity(packet,browser.sender),origin=new URL(browser.sender.url).origin,
   native=source.h.load('app/api/products/[id]/native-assets/route.ts'),receipt=source.h.load('app/api/products/[id]/supplier-hub-product-receipt/route.ts');
  const original=source.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(source.id),protectedRow={...original,id:'protected-synthetic-native-769'},columns=Object.keys(protectedRow);
  source.h.sqlite.prepare('INSERT INTO products('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(key=>protectedRow[key]));
  await source.h.bindings.FILES.put('owner/protected-synthetic-native-769.png',new Uint8Array([1,7,6,9]),{httpMetadata:{contentType:'application/octet-stream'}});
  const appFetch=async(url,init={})=>{
   const absolute=new URL(url,origin),path=absolute.pathname;state.appReads.push({url:absolute.href,method:init.method??'GET'});assert.equal(init.method??'GET','GET');
   let response;
   if(path==='/api/supplier-hub/catalog-context')response=await source.h.load('app/api/supplier-hub/catalog-context/route.ts').GET();
   else if(path===source.base+'/native-assets')response=await native.GET(new Request(absolute,{...init}),source.context);
   else if(path===source.base+'/supplier-hub-product-receipt')response=await receipt.GET(new Request(absolute,{...init}),source.context);
   else if(path===source.base+'/supplier-hub-receipt')response=await source.h.route(path+absolute.search);
   else throw Error('Unexpected local app request '+absolute.href);
   return withUrl(response,absolute.href);
  };
  const appListeners=[],appContext=vm.createContext({location:new URL(browser.sender.url),fetch:appFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date,Response,structuredClone,btoa,atob,window:{},document:{visibilityState:'visible'},chrome:{runtime:{id:'synthetic-native-chain',sendMessage:async()=>({ok:true,sessionId:null}),onMessage:{addListener:listener=>appListeners.push(listener)}}}});
  vm.runInContext(fs.readFileSync(new URL('../../extensions/supplier-hub/single-content.js',import.meta.url),'utf8'),appContext);
  vm.runInContext(fs.readFileSync(new URL('../../extensions/supplier-hub/native-source-content.js',import.meta.url),'utf8'),appContext);
  const uploadFetch=async(url,init)=>{
   const parsed=new URL(url),doc=parsed.pathname.split('/').at(-1);assert.equal(doc,String(browser.createdDocId),'only the newly owned synthetic document receives files');
   state.uploadReads.push({url,method:init.method});
   if(parsed.pathname.includes('/get-images-by-id/'))return withUrl(Response.json([...state.registry.values()]),url);
   assert.ok(parsed.pathname.includes('/upload-images/'));assert.equal(init.method,'POST');assert.equal(Object.hasOwn(init.headers,'content-type'),false);
   const group=parsed.searchParams.get('imageType'),files=[];
   for(const [field,file]of init.body){
    assert.equal(field,'additionalImageFiles');const expected=plan.images.find(image=>image.transportName===file.name&&image.imageType===group);assert.ok(expected,'multipart filename and role come from the actual server plan');
    const bytes=new Uint8Array(await file.arrayBuffer());assert.equal(file.type,expected.contentType);assert.equal(bytes.length,expected.byteLength);assert.equal(sha(bytes),expected.sha256);
    files.push({imageName:file.name,imageUrl:'/stored/'+file.name,s3Link:'stored/'+file.name,mainImage:false});
   }
   const record=JSON.parse(browser.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[context.packetDigest];assert.equal(record.nativeAssets.groups['image:'+group].state,'requested','upload is checkpointed before transport');
   state.uploads.push({group,files:files.map(file=>file.imageName)});for(const file of files)state.registry.set(file.imageName,file);return withUrl(Response.json(files),url);
  };
  const hubContext=vm.createContext({location:browser.hubLocation,document:browser.hubDocument,fetch:uploadFetch,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,setTimeout,clearTimeout,Date,Response,structuredClone,FormData,Blob,btoa,atob});
  const execute=browser.api.scripting.executeScript;
  browser.api.scripting.executeScript=async request=>{
   if(request.target.tabId===browser.sender.tab.id)throw Error('Cannot access contents of the app URL. Extension manifest must request permission to access this host.');
   if(!['nativeProductDocumentAppSourcePage','nativeAssetUploadPage','nativeAssetRecoveryPage'].includes(request.func.name))return execute(request);
   const target=request.func.name==='nativeProductDocumentAppSourcePage'?appContext:hubContext;target.args=plain(request.args);
   const result=await vm.runInContext('('+request.func.toString()+')(...args)',target);return[{frameId:0,documentId:target===appContext?'synthetic-app-document':browser.hubDocumentId,result:plain(result)}];
  };
  const message=browser.api.tabs.sendMessage;
  browser.api.tabs.sendMessage=async(id,value,frame)=>{
   if(['YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_READ_LEGACY_PRODUCT_DOCUMENT_SOURCE'].includes(value.type)){
    assert.equal(id,browser.sender.tab.id);assert.equal(frame.frameId,0);for(const listener of appListeners){let pending;const reply=new Promise(resolve=>{pending=listener(plain(value),{id:'synthetic-native-chain'},resolve);});if(pending===true)return plain(await reply);}return undefined;
   }
   if(value.type==='YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION'){
    assert.equal(id,browser.sender.tab.id);assert.equal(frame.frameId,0);state.humanConfirmations.push(plain(value.expected));
    return{ok:true,userInitiated:true,challengeId:value.expected.challenge.id,identityDigest:context.identityDigest,checkedAt:Date.now()};
   }
   return message(id,value,frame);
  };
  selected=await createVerifiedProductDocumentBrowserAdapter(context,{api:browser.api});assert.equal(selected.nativeAssets,true);
  const receiver=()=>createProductDocumentReceiver({adapter:selected.adapter,store:browser.storage.store}),endpoint=source.base+'/supplier-hub-product-receipt';
  const post=value=>receipt.POST(new Request(origin+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:source.profile.id,observation:value})}),source.context);
  const history=()=>receipt.GET(new Request(origin+endpoint+source.query),source.context).then(json);
  return{...source,...browser,source,browser,plan,review,packet,context,state,adapter:selected.adapter,receiver:receiver(),reloadReceiver:receiver,post,history,
   reloadSourceSession:async()=>vm.runInContext('yoofamSingleSessionId=crypto.randomUUID();yoofamSingleAccount=null;',appContext),
   get submitted(){return browser.submitted;},
   close:()=>{selected.adapter.dispose();browser.close();source.close();}};
 }catch(error){selected?.adapter.dispose();browser?.close();source.close();throw error;}
}
