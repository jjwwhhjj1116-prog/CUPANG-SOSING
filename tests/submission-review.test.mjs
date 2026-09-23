import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const nativeRequire=createRequire(import.meta.url);

function load(file, overrides={}, mode='development', cache=new Map()) {
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const output=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(output,{exports,Error,URL,Response,Date,structuredClone,process:{env:{NODE_ENV:mode}},require(name){
    if(name in overrides)return overrides[name];
    if(name==='next/server')return {NextResponse:Response};
    if(name==='react/jsx-runtime')return nativeRequire(name);
    if(name.startsWith('@/'))return load(`${name.slice(2)}.ts`,overrides,mode,cache);
    throw Error(name);
  }});return exports;
}
const {inspectSubmission}=load('app/submission-review.ts');
const field=(id,type='text',required=false)=>({id,type,required,label:id,section:'product'});
const cell=(value,issues=[],needsReview=false)=>({value,issues,needsReview,source:'manual-option'});
function resolved() {return {schema:{categoryId:'80714',categoryPath:['주방','홀더'],status:'observed',fields:[field('title','text',true),field('mainImage','images'),field('material')]},rows:[{optionId:'red',optionLabel:'빨강',included:true,fields:{title:cell('상품'),mainImage:cell('owner/main.png'),material:cell('면',[],true)}}],issues:[]};}

test('review distinguishes errors from evidence checks and never promotes legacy status or sends data',()=>{
  const input=resolved();input.rows[0].fields.title=cell('', ['필수 입력']);
  input.rows[0].fields.mainImage=cell('other/image.png');
  const report=inspectSubmission(input,['owner/main.png']);
  assert.equal(report.errorCount,2);assert.equal(report.reviewCount,1);assert.equal(report.includedOptions,1);
  assert.equal(report.submissionReady,false);assert.equal(report.transport,'not-connected');
  assert.deepEqual(JSON.parse(JSON.stringify(report.issues.map(i=>i.fieldId))),['title','mainImage','material']);
  input.rows[0].fields.title=cell('수정됨');input.rows[0].fields.mainImage=cell('owner/main.png');
  const clean=inspectSubmission(input,['owner/main.png']);assert.equal(clean.errorCount,0);assert.equal(clean.submissionReady,false);
});
test('excluded options and empty optional review fields do not inflate the report',()=>{
  const input=resolved();input.rows[0].fields.material=cell('',[],true);
  input.rows.push({...structuredClone(input.rows[0]),optionId:'excluded',included:false,fields:{title:cell('', ['missing'])}});
  const report=inspectSubmission(input,['owner/main.png']);assert.equal(report.errorCount,0);assert.equal(report.reviewCount,0);assert.equal(report.includedOptions,1);
});
test('unknown category, empty inclusion, constraints and large reports remain explicit',()=>{
  const input=resolved();input.schema.categoryId=null;input.schema.status='unconfirmed';input.rows=[];input.issues=['옵션 초과','옵션 초과'];
  assert.equal(inspectSubmission(input,[]).errorCount,4);
  const many=resolved();many.rows=Array.from({length:1100},(_,i)=>({...structuredClone(many.rows[0]),optionId:String(i)}));
  const report=inspectSubmission(many,['owner/main.png']);assert.equal(report.reviewCount,1100);assert.equal(report.issues.length,1000);assert.equal(report.omittedIssueCount,100);
});

function route({current=true,revision=2,verified=false,mode='development',missing=false}={}) {
  const calls=[];class QuotationExportError extends Error{constructor(message,status){super(message);this.status=status;}}
  const saved={product:{id:'p',title:'상품',source_url:'https://detail.1688.com/offer/123.html',image_keys:'["owner/main.png"]'},source:{},state:{revision:2}};
  const handlers=load('app/api/products/[id]/submission-review/route.ts',{
    '@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:verified}),getWorkspaceOwnerId:async()=>'owner'},
    '@/app/exports/quotation-source':{QuotationExportError,readQuotationExportSource:async(...args)=>{calls.push(args);if(missing)throw new QuotationExportError('없음',404);return saved;},resolveQuotationExport:()=>resolved(),quotationExportFingerprint:async()=>'a'.repeat(64)},
    '@/db/quotation-fields':{quotationSourcesCurrent:async()=>current,readQuotationFields:async()=>({revision})},
    '@/app/product-content':{productImageKeys:JSON.parse},
    '@/app/image-files':{isOwnedImageKey:(owner,key)=>key.startsWith(owner+'/')},
  },mode);return {handlers,calls};
}
const request=(query='')=>new Request('http://localhost/api/products/p/submission-review'+query);
const context={params:Promise.resolve({id:'p'})};
test('GET scopes saved source to authenticated owner and selected profile, without mutations',async()=>{
  const {handlers,calls}=route();const response=await handlers.GET(request('?profileId=profile-1'),context);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(calls,[['owner','p','profile-1']]);const body=await response.json();assert.equal(body.productId,'p');assert.equal(body.fingerprint,'a'.repeat(64));assert.equal(body.submissionReady,false);
});
test('GET rejects stale source, concurrent quotation edits, missing products and invalid profile',async()=>{
  for(const config of [{current:false},{revision:3}])assert.equal((await route(config).handlers.GET(request(),context)).status,409);
  assert.equal((await route({missing:true}).handlers.GET(request(),context)).status,404);
  const {handlers,calls}=route();assert.equal((await handlers.GET(request('?profileId=../x'),context)).status,400);assert.equal(calls.length,0);
});
test('production review requires verified authentication before reading product data',async()=>{
  const blocked=route({mode:'production'});assert.equal((await blocked.handlers.GET(request(),context)).status,503);assert.equal(blocked.calls.length,0);
  assert.equal((await route({mode:'production',verified:true}).handlers.GET(request(),context)).status,200);
});

function renderPanel(products,results=[]) {
  let index=0;const states=['',0,{key:JSON.stringify([JSON.stringify(products.map(product=>product.id)),'',0]),results,finished:true}];
  const {SubmissionReviewPanel}=load('app/components/submission-review-panel.tsx',{
    react:{useState:()=>[states[index++],()=>{}],useEffect:()=>{}},
  });
  return renderToStaticMarkup(createElement(SubmissionReviewPanel,{products,profiles:[],onEdit:()=>{}}));
}
test('review UI shows actual issues and URL, escapes source text and keeps transmission disabled',()=>{
  const report={...inspectSubmission(resolved(),[]),checkedAt:'2026-09-23T00:00:00Z'};
  const html=renderPanel([{id:'p',title:'<script>unsafe</script>',source_url:'javascript:alert(1)'}],[{id:'p',report}]);
  assert.ok(html.includes('입력 오류 1개'));assert.ok(html.includes('증빙 확인 1개'));
  assert.ok(html.includes('견적서 수정하기'));assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('href="javascript:'));assert.match(html,/disabled="">Supplier Hub 전송/);
});
test('empty selection and failed review do not display old ready badges',()=>{
  assert.ok(renderPanel([]).includes('검사할 상품을 선택'));
  const html=renderPanel([{id:'p',title:'상품',source_url:'https://example.com/p'}],[{id:'p',error:'검사 중 변경'}]);
  assert.ok(html.includes('role="alert"'));assert.ok(html.includes('검사 중 변경'));assert.ok(!html.includes('입력 오류 0개'));
});
