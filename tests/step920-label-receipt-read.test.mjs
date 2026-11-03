import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const json=async(response,statuses=[200])=>{assert.ok(statuses.includes(response.status),response.status+': '+await response.clone().text());return response.json();};
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
// Reuse the actual local API/SQLite pipeline without registering its test cases.
const file=new URL('./product-label-pipeline.test.mjs',import.meta.url),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=ast.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='fixture').getText(ast);
const fixture=vm.runInNewContext(declaration+'\nfixture',{assert,mobileIntakeHarness,quotationWorkbook,webcrypto,companies,json,Uint8Array,Response,Request,File,FormData,Blob,Buffer,URL,Date,JSON});
const lookup=call=>call.method==='GET'&&call.url.startsWith('/api/files?labelUploadId=');
const laterWrites=f=>f.requests.filter(call=>call.url.endsWith('/attachments')&&call.method==='POST'||call.url===f.quotationEndpoint&&call.method==='PUT');
async function setup(company=companies[0]){
 const f=await fixture(company),renderedView=await f.read(),before={sources:JSON.stringify(f.snapshots()),quote:JSON.stringify(await f.readQuotation()),network:[...f.api.network],ai:f.api.aiSources.length};
 const input={productId:f.product.id,endpoint:f.endpoint,quotationEndpoint:f.quotationEndpoint,renderedView,optionId:f.selected.optionId,
  blob:new Blob([png],{type:'image/png'}),uploadedKey:null,onUploaded(){}};
 return{...f,input,before,attach:request=>f.api.load('app/product-label-attachment.ts').attachProductLabel(input,request??f.request),close(){f.api.close();}};
}
function preserved(f){assert.equal(JSON.stringify(f.snapshots()),f.before.sources);assert.deepEqual(f.api.network,f.before.network);assert.equal(f.api.aiSources.length,f.before.ai);}

for(const company of companies)test(`step920 ${company.companyCode}: successful upload verifies one fresh full receipt, reducing lookup GETs from three to two`,async()=>{
 const f=await setup(company);try{
  const result=await f.attach();assert.equal(f.requests.filter(lookup).length,2);
  assert.equal(f.requests.filter(call=>call.url==='/api/files'&&call.method==='POST').length,1);
  assert.equal(laterWrites(f).length,2);assert.deepEqual(f.api.objects.get(result.key),png);assert.ok(result.view.imageKeys.includes(result.key));
  assert.equal(result.quotation.resolved.rows.find(row=>row.optionId===f.selected.optionId).fields.labelImages.value,result.key);preserved(f);
  const first=f.requests.findIndex(call=>call.url==='/api/files'&&call.method==='POST'),pool=f.requests.findIndex(call=>call.url.endsWith('/attachments'));
  assert.equal(f.requests.slice(first+1,pool).filter(lookup).length,1,'the ACK key and exact product-label proof share one authoritative read');
 }finally{f.close();}
});

test('step920 wrong ACK, owner and complete receipt proof mismatches stop before pool or quotation writes',async()=>{
 for(const kind of ['ack-key','receipt-key','owner','missing-proof','product','option','profile','category','plan','epoch','malformed']){
  const f=await setup();let uploaded=false;
  try{
   const request=async(url,init={})=>{
    const response=await f.request(url,init);
    if(url==='/api/files'&&init.method==='POST'){
     uploaded=true;
     if(kind==='owner')f.api.auth.getWorkspaceOwnerId=async()=>'foreign-owner';
     if(kind==='ack-key'){const body=await response.json();return Response.json({...body,key:'foreign/'+body.key.split('/').at(-1)});}
    }
    if(uploaded&&url.startsWith('/api/files?')){
     if(kind==='malformed')return new Response('unreadable',{headers:{'content-type':'application/json'}});
     const body=await response.json();if(!body.key)return Response.json(body);
     if(kind==='receipt-key')body.key='foreign/'+body.key.split('/').at(-1);
     if(kind==='missing-proof')delete body.productLabelProof;
     const proof=body.productLabelProof;
     if(kind==='product')proof.productId='foreign-product';if(kind==='option')proof.optionId='foreign-option';if(kind==='profile')proof.profileId='foreign-profile';
     if(kind==='category')proof.categorySha256='0'.repeat(64);if(kind==='plan')proof.planSha256='0'.repeat(64);if(kind==='epoch')proof.renderEpoch=1;
     return Response.json(body);
    }
    return response;
   };
   await assert.rejects(f.attach(request),undefined,kind);assert.equal(laterWrites(f).length,0,kind);preserved(f);
   assert.equal(JSON.stringify(await f.api.load('db/quotation-fields.ts').readQuotationFields('owner',f.product.id)).includes('quotation-label-'),false,kind);
  }finally{f.close();}
 }
});

test('step920 lost committed upload ACK keeps its separate fresh recovery and proof reads without another upload',async()=>{
 const f=await setup();let lost=false;try{
  const result=await f.attach(async(url,init={})=>{const response=await f.request(url,init);if(url==='/api/files'&&init.method==='POST'&&!lost){lost=true;throw Error('committed upload ACK lost');}return response;});
  assert.equal(lost,true);assert.equal(f.requests.filter(lookup).length,3);assert.equal(f.requests.filter(call=>call.url==='/api/files'&&call.method==='POST').length,1);
  assert.equal(laterWrites(f).length,2);assert.deepEqual(f.api.objects.get(result.key),png);preserved(f);
 }finally{f.close();}
});

test('step920 an uncommitted failed upload cannot adopt a receipt or dispatch pool/reference writes',async()=>{
 const f=await setup();try{
  await assert.rejects(f.attach(async(url,init={})=>url==='/api/files'&&init.method==='POST'?Response.json({error:'synthetic upload rejection'},{status:503}):f.request(url,init)));
  assert.equal(laterWrites(f).length,0);assert.equal(JSON.stringify(await f.readQuotation()),f.before.quote);preserved(f);
 }finally{f.close();}
});

test('step920 source changes during the sole successful receipt read still fail the following current-source pair',async()=>{
 const f=await setup();let uploaded=false,changed=false;try{
  await assert.rejects(f.attach(async(url,init={})=>{
   const response=await f.request(url,init);if(url==='/api/files'&&init.method==='POST')uploaded=true;
   if(uploaded&&!changed&&url.startsWith('/api/files?')){changed=true;const view=await f.read();await json(await f.save(view,[{optionId:f.selected.optionId,fieldKey:'material',value:'경쟁 화면에서 수정한 원료'}]));}
   return response;
  }));
  assert.equal(changed,true);assert.equal(laterWrites(f).length,0);assert.equal((await f.read()).rows.find(row=>row.optionId===f.selected.optionId).values.material,'경쟁 화면에서 수정한 원료');preserved(f);
 }finally{f.close();}
});
