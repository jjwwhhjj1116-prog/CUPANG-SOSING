import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
function loader(overrides={}){const cache=new Map();function load(file){
 if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 const sourcePath=file==='app/quotation-image-review'&&process.env.TEST_IMAGE_BASELINE?process.env.TEST_IMAGE_BASELINE:new URL('../'+file+'.ts',import.meta.url);
 const code=ts.transpileModule(fs.readFileSync(sourcePath,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Error,URL,Response,TextEncoder,TextDecoder,Uint8Array,crypto,structuredClone,process:{env:{NODE_ENV:'production'}},require(name){if(Object.hasOwn(overrides,name))return overrides[name];if(name==='parse5')return native(name);if(name.startsWith('@/'))return load(name.slice(2));throw Error(name);}});return exports;
}return load;}
const load=loader();
const inspector=load('app/quotation-image-review').inspectQuotationImages;
const publicDetail=load('app/quotation-public-detail');
const submission=load('app/submission-review').inspectSubmission;
const key='owner/opaque.gif',publicUrl='https://media.example.test/media/quotation/'+'a'.repeat(64);
const cell=value=>({value,source:'content',validationIssues:[],issues:[],needsReview:false,reviewMessages:[]});
const definition=(id,type='images')=>({id,label:id,type,required:false,section:'images',visibility:'common'});
const resolved=()=>({schema:{categoryId:'69900',categoryPath:['선글라스'],status:'observed',fields:[definition('mainImage'),definition('detailImages'),definition('detailHtml','html')]},rows:[{optionId:'sku',optionLabel:'sku',included:true,fields:{mainImage:cell(''),detailImages:cell(key),detailHtml:cell(`<img src="${publicUrl}">`)}}],issues:[],validationIssues:[],reviewMessages:[]});
const object=mime=>({size:100,httpMetadata:{contentType:mime},customMetadata:{imageValidation:'header-v1',dimensionValidation:'header-v1',imageWidth:'800',imageHeight:'1200'}});
const reference=[{key,token:'a'.repeat(64),url:publicUrl}];

test('metadata review rejects a GIF behind an opaque generated detail URL like package byte review',async()=>{
 const data=resolved(),before=JSON.stringify(data),reads=[];
 const checks=await inspector(data,[key],async value=>{reads.push(value);return object('image/gif');},reference);
 assert.equal(checks.get(key)?.kind,'error');assert.match(checks.get(key)?.message,/GIF/);
 const report=submission(data,[key],checks);assert.ok(report.errorCount>0);assert.ok(report.issues.some(issue=>issue.kind==='error'&&issue.message.includes('GIF')));
 const bytes=new TextEncoder().encode('GIF89a'+String.fromCharCode(32,3,176,4)+'test');
 assert.equal(publicDetail.publicDetailMediaIssues(data,reference,[{key,data:bytes}]).length,1);
 assert.deepEqual(reads,[key]);assert.equal(JSON.stringify(data),before);
});

test('static detail MIME formats keep their existing checks and unreferenced GIFs are not rejected as HTML',async()=>{
 for(const mime of ['image/png','image/jpeg','image/webp','image/avif']){
  const data=resolved(),checks=await inspector(data,[key],async()=>object(mime),reference);assert.notEqual(checks.get(key)?.kind,'error',mime);
 }
 for(const mutate of [data=>data.rows[0].fields.detailHtml=cell(''),data=>data.rows[0].fields.detailHtml=cell('<p>수동 HTML</p>')]){
  const data=resolved();mutate(data);const checks=await inspector(data,[key],async()=>object('image/gif'),reference);assert.notEqual(checks.get(key)?.kind,'error');
 }
 const mainOnly=resolved();mainOnly.rows[0].fields.mainImage=cell(key);mainOnly.rows[0].fields.detailImages=cell('');mainOnly.rows[0].fields.detailHtml=cell('');
 assert.notEqual((await inspector(mainOnly,[key],async()=>object('image/gif'),reference)).get(key)?.kind,'error');
});

test('excluded and unowned references do not trigger metadata reads; shared main/detail GIF is still blocked',async()=>{
 const excluded=resolved();excluded.rows[0].included=false;let reads=0;
 assert.equal((await inspector(excluded,[key],async()=>{reads++;return object('image/gif');},reference)).size,0);
 assert.equal((await inspector(resolved(),[],async()=>{reads++;return object('image/gif');},reference)).size,0);assert.equal(reads,0);
 const shared=resolved();shared.rows[0].fields.mainImage=cell(key);assert.equal((await inspector(shared,[key],async()=>{reads++;return object('image/gif');},reference)).get(key).kind,'error');assert.equal(reads,1);
 for(const metadata of [undefined,{}, {imageValidation:'old'}]){
  const stored={...object('IMAGE/GIF'),customMetadata:metadata};assert.equal((await inspector(resolved(),[key],async()=>stored,reference)).get(key).kind,'error');
 }
});

test('actual saved-review API passes generated public references to GIF inspection without publishing or modifying source',async()=>{
 const input=resolved(),before=JSON.stringify(input),heads=[];
 const saved={product:{id:'p',source_url:'https://example.test/item',image_keys:JSON.stringify([key])},content:load('app/product-content').emptyProductContent('p'),state:{revision:1},source:{}};
 const routeLoad=loader({
  'cloudflare:workers':{env:{YOOFAM_DETAIL_IMAGE_ORIGIN:'https://media.example.test',YOOFAM_DETAIL_IMAGE_SECRET:'b'.repeat(64),FILES:{head:async value=>{heads.push(value);return object('image/gif');}}}},
  'next/server':{NextResponse:Response},
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:true}),getWorkspaceOwnerId:async()=> 'owner'},
  '@/app/exports/quotation-source':{QuotationExportError:class extends Error{},readQuotationExportSource:async()=>saved,resolveQuotationExport:()=>input,quotationExportFingerprint:async()=> 'a'.repeat(64)},
  '@/db/quotation-fields':{quotationSourcesCurrent:async()=>true,readQuotationFields:async()=>({revision:1})},
 });
 const response=await routeLoad('app/api/products/[id]/submission-review/route').GET(new Request('https://app.example.test/api/products/p/submission-review'),{params:Promise.resolve({id:'p'})});
 assert.equal(response.status,200);const report=await response.json();assert.ok(report.errorCount>0);assert.ok(report.issues.some(issue=>issue.kind==='error'&&issue.message.includes('GIF')));
 assert.equal(report.submissionReady,false);assert.equal(report.productId,'p');assert.deepEqual(heads,[key]);assert.equal(JSON.stringify(input),before);
});
