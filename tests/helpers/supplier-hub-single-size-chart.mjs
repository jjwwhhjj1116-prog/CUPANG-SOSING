import {assetSnapshot,assetProjectionFixture,assetApiFixture,companies,module,plain,keys,imageBytes,sha,config} from './supplier-hub-single-assets.mjs';
import {projectionFixture} from './supplier-hub-single-projection.mjs';
import assert from 'node:assert/strict';

export {companies,module,plain,keys,imageBytes,sha};
export const sizeKeys=Array.from({length:5},(_,index)=>`owner/size-chart-${index+1}.png`);
export const sizePath=['imagePage','images','sizeChartImage'];
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
export const publicKeys=f=>[...f.h.objects.keys()].filter(key=>key.startsWith('quotation-public-detail/'));
export const allTables=f=>JSON.stringify(f.h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,f.h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));

export function sizeChartSnapshot(company=companies[0]){
 const snapshot=assetSnapshot(company),raw=JSON.parse(snapshot.schemaString);
 raw.properties.imagePage.properties.images.properties.sizeChartImage={type:['string','null'],title:'사이즈표 이미지',requirement:'선택'};
 snapshot.schemaString=JSON.stringify(raw);return snapshot;
}

export function sizeChartProjectionFixture(company=companies[0],value=sizeKeys[0]){
 const original=assetProjectionFixture(company),f=projectionFixture(sizeChartSnapshot(company));
 Object.assign(f.row.fields,structuredClone(original.row.fields));f.set(sizePath,undefined,value);
 const sizeField=f.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(sizePath)&&field.hubWire?.name===undefined);
 const assets=[...original.assets,...sizeKeys.map((key,index)=>({key,name:`assets/size-${index+1}.png`,data:imageBytes(100+index),sha256:sha(imageBytes(100+index))}))];
 const metadata=new Map([...original.metadata,...sizeKeys.map((key,index)=>[key,{size:imageBytes(100+index).byteLength,httpMetadata:{contentType:'image/png'},customMetadata:{sha256:sha(imageBytes(100+index))}}])]);
 return {...f,sizeField,assets,metadata,planInput:async()=>({projection:await module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument(f.input),
  owner:'owner',productId:'synthetic-size-chart-694',ownedKeys:[...keys,...sizeKeys],assets,metadata,config})};
}

/** Synthetic PNGs and category schema only; actual handlers/SQLite/R2 perform
 * preparation, never source collection, Chrome control or remote Hub writes. */
export async function sizeChartApiFixture(company=companies[0]){
 const f=await assetApiFixture(company,sizeChartSnapshot(company)),{h}=f;
 h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...keys,...sizeKeys]),f.id);
 for(const [index,key]of sizeKeys.entries())await h.bindings.FILES.put(key,imageBytes(100+index),{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:sha(imageBytes(100+index))}});
 const saved=(await json(await h.route(f.base+'/content'))).content;
 await json(await h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{assets:{size:[sizeKeys[0]]}}}}));
 const sizeField=f.byWire(sizePath);assert.ok(sizeField);
 let view=await json(await h.route(f.base+'/quotation-fields'+f.query));
 await json(await h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
  {fieldKey:sizeField,optionId:'synthetic-two',value:sizeKeys[1]},{fieldKey:sizeField,optionId:'synthetic-excluded',value:sizeKeys[2]},
 ]}}));
 view=await json(await h.route(f.base+'/quotation-fields'+f.query));
 const field=view.resolved.schema.fields.find(field=>field.id===sizeField);assert.equal(field.type,'images');assert.equal(field.hubInput,'sizeImages');
 const requests=[],storage={publicPutAttempts:0,privatePutAttempts:0,gets:[],heads:[]};let loseNext=false;
 const originalPut=h.bindings.FILES.put,originalGet=h.bindings.FILES.get,originalHead=h.bindings.FILES.head;
 h.bindings.FILES.put=async(...args)=>{if(args[0].startsWith('quotation-public-detail/'))storage.publicPutAttempts++;else storage.privatePutAttempts++;return originalPut(...args);};
 h.bindings.FILES.head=async key=>{storage.heads.push(key);return originalHead(key);};
 h.bindings.FILES.get=async key=>{
  storage.gets.push(key);const value=await originalGet(key);if(!value)return value;
  const bytes=Uint8Array.from(h.objects.get(key));return {...value,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})};
 };
 const route=async(path,options={})=>{
  const response=await h.route(path,options),entry={path,method:options.method??'GET',status:response.status};requests.push(entry);
  if(loseNext&&entry.method==='POST'&&path===f.endpoint&&response.status===200){loseNext=false;entry.deliveredStatus=503;return Response.json({error:'isolated fixture acknowledgement lost after durable preparation'},{status:503});}
  return response;
 };
 const prepare=fingerprint=>route(f.endpoint,{method:'POST',body:{action:'prepare',expectedFingerprint:fingerprint}});
 const edit=async changes=>{const current=await json(await route(f.base+'/quotation-fields'+f.query));return json(await route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes}}));};
 const serve=async url=>{const token=new URL(url).pathname.split('/').at(-1);return h.load('app/media/quotation/[token]/route.ts').GET(new Request(url),{params:Promise.resolve({token})});};
 return {...f,sizeField,view,requests,storage,route,prepare,edit,serve,loseNextPrepareAcknowledgement(){loseNext=true;}};
}
