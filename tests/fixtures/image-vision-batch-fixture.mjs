import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto,createHash} from 'node:crypto';
import * as parse5 from 'parse5';

export const batchRequestId='12345678-1234-4123-8123-123456789abc';
export const batchNextRequestId='12345678-1234-4123-8123-123456789abd';
export const providerRequestId='768f15b7-4fd6-4498-906e-ad94ffc7f8d2';
export const completedVisionBatch=()=>({responses:[{id:0,success:true,result:{model:'@cf/qwen/qwen3.8-27b',object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({decision:'foreign-text',blocks:[{original:'黑色',translated:'검정',kind:'overlay',box:{x:10,y:10,width:40,height:20}}]})}}]}}]});
export function imageVisionBatchFixture({bytes=new Uint8Array([1,2,3])}={}){
 const sqlite=new DatabaseSync(':memory:'),queries=[],calls=[];
 sqlite.exec("CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT,image_keys TEXT);CREATE TABLE product_content(product_id TEXT,owner_id TEXT,revision INTEGER);CREATE TABLE members(id TEXT,email TEXT,role TEXT,status TEXT,company_code TEXT,company_name TEXT)");
 sqlite.prepare('INSERT INTO products VALUES(?,?,?,?)').run('new-product','owner','2026-10-29T00:00:00.000Z','["owner/source.png"]');
 sqlite.prepare('INSERT INTO product_content VALUES(?,?,?)').run('new-product','owner',2);
 sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run('owner','fixture@example.test','admin','approved','A01526306','유앤채');
 const controls={owner:'owner',verified:true,provider:null,beforeRead:null,afterRead:null,settings:{addCopyright:false,translationPrompt:''}};
 const db={prepare(sql){queries.push(sql);let args=[];const query={sql,bind(...values){args=values;return query;},async first(){await controls.beforeRead?.(sql);const row=sqlite.prepare(sql).get(...args)??null;await controls.afterRead?.(sql);return row;},async run(){return sqlite.prepare(sql).run(...args);},async all(){return{results:sqlite.prepare(sql).all(...args)};}};return query;},async batch(rows){for(const row of rows)sqlite.exec(row.sql);return[];}};
 const env={DB:db,SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true',AI:{async run(model,input,options){calls.push({model,input:JSON.parse(JSON.stringify(input)),options:options&&JSON.parse(JSON.stringify(options))});return controls.provider?.(model,input,options)??(input.request_id?{status:'running'}:{request_id:providerRequestId,model,status:'queued'});}},FILES:{async get(){return{size:bytes.length,body:new Response(bytes).body};},put(){throw Error('No image writes');}}};
 const notUsed=class extends Error{},stubs={'cloudflare:workers':{env},'next/server':{NextResponse:Response},parse5,
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>{const m=sqlite.prepare('SELECT * FROM members WHERE id=?').get(controls.owner);return{userId:controls.owner,email:m?.email,verifiedAccess:controls.verified,membership:m&&{id:m.id,email:m.email,role:m.role,status:m.status,companyCode:m.company_code,companyName:m.company_name}};},getWorkspaceOwnerId:async()=>controls.owner},
  '@/db/queries':{findProduct:async(owner,id)=>sqlite.prepare('SELECT * FROM products WHERE id=? AND owner_id=?').get(id,owner)??null,getSettings:async()=>({payload:JSON.stringify(controls.settings)})},
  '@/db/product-content':{readProductContent:async(owner,id)=>{const keys=JSON.parse(sqlite.prepare('SELECT image_keys FROM products WHERE id=? AND owner_id=?').get(id,owner)?.image_keys??'[]');return{revision:sqlite.prepare('SELECT revision FROM product_content WHERE product_id=? AND owner_id=?').get(id,owner)?.revision,assets:{detail:{value:keys},additional:{value:keys},main:{value:keys}}};}},
  '@/db/product-options':{},'@/db/product-attachments':{},'@/db/product-image-translation':{},'@/db/quotation-fields':{},
  '@/app/quotation-fields-snapshot':{QuotationFieldsSnapshotError:notUsed},'@/app/quotation-seo-targets':{},'@/app/quotation-image-targets':{},'@/app/quotation-schema':{},'@/app/quotation-public-detail':{PublicDetailError:notUsed},
  '@/app/product-content':{productImageKeys:JSON.parse},'@/app/automation/image-edit':{inspectImage:()=>({width:100,height:80,mime:'image/png'})},
  '@/app/image-files':{MAX_IMAGE_BYTES:10*1024*1024,MAX_IMAGE_MULTIPART_BYTES:11*1024*1024,PRODUCT_IMAGE_POOL_LIMIT:200,isOwnedImageKey:(owner,key)=>typeof key==='string'&&key.startsWith(owner+'/')},
  '@/app/free-image-edit-document':{MAX_FREE_IMAGE_EDIT_BYTES:65536},'@/app/free-image-edit-record':{FreeImageEditRecordError:notUsed},
  '@/db/image-no-text-receipts':{async readImageNoTextReceipts(){return{};},async storeImageNoTextReceipt(){}},
 };
 let cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Request,Response,File,Blob,FormData,Headers,TextEncoder,TextDecoder,ReadableStream,Uint8Array,DataView,AbortController,AbortSignal,Date,crypto:webcrypto,structuredClone,btoa:value=>Buffer.from(value,'binary').toString('base64'),process:{env:{NODE_ENV:'production'}},setTimeout,clearTimeout,fetch(){throw Error('No external HTTP');},require(name){if(name in stubs)return stubs[name];assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}},{filename:file});return exports;}
 const source={productId:'new-product',productVersion:'2026-10-29T00:00:00.000Z',contentRevision:2,sourceKey:'owner/source.png',sourceSha256:createHash('sha256').update(bytes).digest('hex'),role:'detail',width:100,height:80};
 const route=()=>load('app/api/products/[id]/image-text/route.ts'),context={params:Promise.resolve({id:'new-product'})};
 const invoke=async(method,url,body,headers={})=>{const r=await route()[method](new Request('https://app.test/api/products/new-product/image-text'+url,{method,...(body?{headers:{'content-type':'application/json',origin:'https://app.test',...headers},body:JSON.stringify(body)}:{headers})}),context);return{status:r.status,body:await r.json()};};
 return{sqlite,queries,calls,env,controls,source,load,reload(){cache=new Map();},close(){sqlite.close();},
  fetcher(url,options={}){const method=options.method??'GET',headers=new Headers(options.headers);if(method==='POST')headers.set('origin','https://app.test');return route()[method](new Request(new URL(url,'https://app.test'),{...options,headers}),context);},
  configuration(){return load('app/automation/workers-image-vision.ts').imageVisionConfiguration(env);},
  create(overrides={}){return invoke('POST','',{action:'vision-batch',requestId:batchRequestId,source,sourceLanguage:'zh',configuration:this.configuration(),inspectionPolicy:'product-text-preservation-v2',transport:'workers-ai-batch-v1',...overrides});},
  poll(requestId=batchRequestId,overrides={}){return invoke('POST','',{action:'vision-batch-poll',requestId,...overrides});},
  read(requestId=batchRequestId,extra={}){return invoke('GET','?'+new URLSearchParams({visionBatchRequestId:requestId,...extra}));},
  discover(overrides={}){return invoke('GET','?'+new URLSearchParams({visionBatchSource:JSON.stringify(source),sourceLanguage:'zh',inspectionPolicy:'product-text-preservation-v2',...overrides}));},
 };
}
