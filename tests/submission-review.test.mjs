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

test('late option errors take priority over earlier review reminders under the display cap',()=>{
 const input=resolved();
 input.rows=Array.from({length:1005},(_,i)=>({...structuredClone(input.rows[0]),optionId:`option-${i}`}));
 input.rows[1004].fields.title=cell('',['마지막 옵션 필수 누락']);
 const before=JSON.stringify(input),report=inspectSubmission(input,['owner/main.png']);
 assert.equal(report.errorCount,1);assert.equal(report.reviewCount,1005);
 assert.equal(report.issues.length,1000);assert.equal(report.omittedIssueCount,6);
 assert.equal(report.issues[0].optionId,'option-1004');assert.equal(report.issues[0].kind,'error');
 assert.equal(report.issues[1].optionId,'option-0');assert.equal(report.submissionReady,false);
 assert.equal(JSON.stringify(input),before);
 for(const row of input.rows)row.fields.title=cell('',['필수 누락']);
 const all=inspectSubmission(input,['owner/main.png']);
 assert.equal(all.errorCount,1005);assert.equal(all.reviewCount,1005);assert.equal(all.omittedIssueCount,1010);
 assert.ok(all.issues.every(issue=>issue.kind==='error'));assert.equal(all.issues[999].optionId,'option-999');
});

test('confirmed blank choice codes remain evidence reviews while unentered blanks do not',()=>{
 for(const source of ['manual-option','manual-common','couplus-default','content','empty']){
  for(const modern of [true,false]){
   const input=resolved();input.rows[0].fields.material=cell('');
   input.schema.fields.push({...field('choice','select'),choices:[{value:'',label:'해당사항없음'}]});
   input.rows[0].fields.choice={...cell('',[],true),source,...(modern?{validationIssues:[],reviewMessages:['실제 상품 확인']}:{})};
   const before=JSON.stringify(input),report=inspectSubmission(input,['owner/main.png']);
   const checks=report.issues.filter(issue=>issue.fieldId==='choice');
   assert.equal(checks.length,source==='empty'?0:1);
   if(checks.length){assert.equal(checks[0].kind,'review');assert.match(checks[0].message,/해당사항없음/);}
   assert.equal(report.submissionReady,false);assert.equal(JSON.stringify(input),before);
   input.schema.fields.at(-1).choices=[{value:'N/A',label:'해당사항없음'}];
   assert.equal(inspectSubmission(input,[]).issues.filter(issue=>issue.fieldId==='choice').length,0);
  }
 }
});
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
test('MSRP evidence review follows the final included value and never treats edits as agreement',()=>{
 const input=resolved(); input.rows[0].fields.material=cell(''); input.schema.fields.push(field('msrp','number'));
 for(const source of ['pricing','product','manual-option','manual-common']) {
  input.rows[0].fields.msrp={...cell('13000',[],true),source};
  const before=JSON.stringify(input);const result=inspectSubmission(input,['owner/main.png']);
  const issues=result.issues.filter(i=>i.fieldId==='msrp');assert.equal(issues.length,1);
  assert.equal(issues[0].kind,'review');assert.equal(issues[0].code,'MSRP_EVIDENCE_REVIEW');
  assert.match(issues[0].message,/가격 설정 권한/);assert.equal(issues[0].optionId,'red');
  assert.equal(result.errorCount,0);assert.equal(result.submissionReady,false);assert.equal(JSON.stringify(input),before);
 }
 input.rows[0].fields.msrp=cell('');assert.equal(inspectSubmission(input,[]).issues.some(i=>i.fieldId==='msrp'),false);
 input.rows[0].fields.msrp=cell('invalid',['숫자 오류'],true);
 assert.equal(inspectSubmission(input,[]).issues.find(i=>i.fieldId==='msrp').code,'FIELD_INVALID');
 input.rows[0].included=false;assert.equal(inspectSubmission(input,[]).issues.some(i=>i.fieldId==='msrp'),false);
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
    'cloudflare:workers':{env:{FILES:{head:async()=>({size:100,httpMetadata:{contentType:'image/png'},customMetadata:{imageValidation:'header-v1',dimensionValidation:'header-v1',imageWidth:'1000',imageHeight:'1000'}})}}},
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
    '@/app/components/quotation-review-issues':load('app/components/quotation-review-issues.tsx',{react:nativeRequire('react')}),
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

const {inspectQuotationImages}=load('app/quotation-image-review.ts',{'@/app/image-files':{MAX_IMAGE_BYTES:10*1024*1024}});
const validImage={size:100,httpMetadata:{contentType:'image/png'},customMetadata:{imageValidation:'header-v1',dimensionValidation:'header-v1',imageWidth:'1000',imageHeight:'1000'}};

test('pixel guidance follows included final image roles and does not claim decoding or registration',async()=>{
 const input=resolved();input.schema.fields.push(field('detailImages','images'));
 input.rows[0].fields.detailImages=cell('owner/detail.png');
 const object=(w,h)=>({...validImage,customMetadata:{...validImage.customMetadata,imageWidth:String(w),imageHeight:String(h)}});
 let checks=await inspectQuotationImages(input,['owner/main.png','owner/detail.png'],async key=>key.includes('main')?object(999,1000):object(780,1500));
 assert.equal(checks.size,1);assert.equal(checks.get('owner/main.png').kind,'review');assert.match(checks.get('owner/main.png').message,/999×1000/);
 checks=await inspectQuotationImages(input,['owner/main.png','owner/detail.png'],async key=>key.includes('main')?object(1000,1000):object(780,1501));
 assert.equal(checks.size,1);assert.match(checks.get('owner/detail.png').message,/1,500/);
 input.rows[0].fields.detailImages=cell('owner/main.png');
 checks=await inspectQuotationImages(input,['owner/main.png'],async()=>object(780,1500));
 assert.match(checks.get('owner/main.png').message,/대표 이미지/);
 assert.equal(inspectSubmission(input,['owner/main.png'],checks).submissionReady,false);
 checks=await inspectQuotationImages(input,['owner/main.png'],async()=>({...validImage,customMetadata:{imageValidation:'header-v1'}}));
 assert.match(checks.get('owner/main.png').message,/기록이 없습니다/);
});

test('bulk registration requires label attachment and flags identical main/detail references only on included rows',()=>{
 const input=resolved();input.schema.fields.push(field('labelImages','images'),field('detailImages','images'));
 input.rows[0].fields.labelImages=cell('');input.rows[0].fields.detailImages=cell('owner/main.png');
 const report=inspectSubmission(input,['owner/main.png','owner/label.png']);
 assert.ok(report.issues.some(issue=>issue.code==='LABEL_ATTACHMENT_MISSING'&&issue.fieldId==='labelImages'));
 assert.ok(report.issues.some(issue=>issue.code==='MAIN_DETAIL_DUPLICATE'&&issue.kind==='review'));
 input.rows[0].fields.labelImages=cell('owner/label.png');input.rows[0].fields.detailImages=cell('');
 input.rows.push({...structuredClone(input.rows[0]),included:false,fields:{labelImages:cell('')}});
 const fixed=inspectSubmission(input,['owner/main.png','owner/label.png']);
 assert.equal(fixed.errorCount,0);assert.equal(fixed.issues.some(issue=>issue.code==='MAIN_DETAIL_DUPLICATE'),false);
 assert.equal(fixed.submissionReady,false);
});
test('image review deduplicates included owned references and does not read other owners or excluded options',async()=>{
 const input=resolved();input.rows[0].fields.mainImage.value='owner/main.png\nowner/main.png\nother/private.png';
 input.rows.push({...structuredClone(input.rows[0]),included:false,fields:{mainImage:cell('owner/excluded.png')}});
 const calls=[];const checks=await inspectQuotationImages(input,['owner/main.png','owner/excluded.png'],async key=>{calls.push(key);return validImage;});
 assert.deepEqual(calls,['owner/main.png']);assert.equal(checks.size,0);
});
test('image review reports missing invalid oversized and unavailable objects, while old validation metadata needs review',async()=>{
 for(const object of [null,{...validImage,size:0},{...validImage,size:10485761},{...validImage,httpMetadata:{contentType:'text/html'}}]){
  const checks=await inspectQuotationImages(resolved(),['owner/main.png'],async()=>object);
  assert.equal(checks.get('owner/main.png').kind,'error');
  assert.equal(inspectSubmission(resolved(),['owner/main.png'],checks).errorCount,1);
 }
 const old=await inspectQuotationImages(resolved(),['owner/main.png'],async()=>({...validImage,customMetadata:{}}));
 assert.equal(old.get('owner/main.png').kind,'review');
 assert.equal(inspectSubmission(resolved(),['owner/main.png'],old).issues[0].code,'IMAGE_VERIFICATION');
 for(const head of [undefined,async()=>{throw Error('offline');}])assert.equal((await inspectQuotationImages(resolved(),['owner/main.png'],head)).get('owner/main.png').kind,'error');
});
test('image review bounds concurrent storage reads to three and checks every unique image',async()=>{
 const input=resolved();const keys=Array.from({length:12},(_,i)=>`owner/${i}.png`);input.rows[0].fields.mainImage.value=keys.join('\n');
 let active=0,max=0,total=0;
 await inspectQuotationImages(input,keys,async()=>{active++;total++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return validImage;});
 assert.equal(total,12);assert.equal(max,3);
});

test('HTML review flags observed unsupported embedded formats without following URLs',()=>{
 const input=resolved();input.schema.fields.push(field('detailHtml','textarea'));
 input.rows[0].fields.detailHtml=cell('<IMG SRC="https://example.test/a%2eGIF?q=.png"><object data="/a.PDF"></object><embed src=/a.psd><video src="/a.mp4"></video>');
 const before=JSON.stringify(input);const report=inspectSubmission(input,['owner/main.png']);
 const issue=report.issues.find(item=>item.code==='HTML_MEDIA_UNSUPPORTED');
 assert.equal(issue.optionId,'red');assert.equal(issue.fieldId,'detailHtml');
 for(const format of ['GIF','PDF','PSD','동영상'])assert.ok(issue.message.includes(format));
 assert.equal(report.errorCount,1);assert.equal(JSON.stringify(input),before);assert.equal(report.submissionReady,false);
 input.rows[0].included=false;
 assert.equal(inspectSubmission(input,[]).issues.some(item=>item.code==='HTML_MEDIA_UNSUPPORTED'),false);
});

test('HTML media detection distinguishes examples, comments and query text from embedded content',()=>{
 const {unsupportedQuotationMedia:check}=load('app/quotation-html-review.ts');
 for(const html of ['<p>파일명 a.gif</p>','&lt;img src="a.gif"&gt;','<!-- <video src="a.mp4"> -->','<img src="a.png?name=a.gif">','<img alt="a.gif" src="a.jpg">','<a href="a.pdf">참고</a>'])assert.equal(check(html).length,0);
 for(const html of ['<img src="data:image/gif;base64,AAAA">','<source type="video/mp4" src="/unknown">','<object type="application/pdf" data="/unknown">','<embed src="a.psd#page">','<video></video>'])assert.equal(check(html).length,1);
 assert.equal(check('<img alt="a > b" src="a.gif">')[0],'GIF');
 assert.equal(check('<img src="a.gif"><img src="b.GIF">').length,1);
});

const {resolveQuotationNavigation}=load('app/quotation-navigation.ts');
test('review navigation selects the exact option and field without changing saved data',()=>{
 const source=resolved();source.rows.push({...structuredClone(source.rows[0]),optionId:null,optionLabel:'공통'});
 const before=JSON.stringify(source);
 const destination=resolveQuotationNavigation(source,{optionId:'red',fieldId:'material'});
 assert.equal(destination.ok,true);assert.equal(destination.optionId,'red');assert.equal(destination.section,'product');assert.equal(destination.fieldId,'material');
 assert.equal(resolveQuotationNavigation(source,{optionId:null,fieldId:'title'}).optionId,null);
 assert.equal(JSON.stringify(source),before);
});
test('stale review navigation does not fall back to common or another field',()=>{
 const source=resolved();
 assert.equal(resolveQuotationNavigation(source,{optionId:'deleted',fieldId:'title'}).ok,false);
 assert.equal(resolveQuotationNavigation(source,{optionId:'red',fieldId:'removed'}).ok,false);
 source.rows[0].included=false;source.schema.fields[0].readOnly=true;
 const destination=resolveQuotationNavigation(source,{optionId:'red',fieldId:'title'});
 assert.equal(destination.ok,true);assert.match(destination.message,/제외된 옵션/);assert.match(destination.message,/원본 단계/);
});
