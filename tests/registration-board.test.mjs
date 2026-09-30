import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):require(name)});return exports;}
const {registrationTitle,registrationThumbnail,registrationStepLabel,RegistrationBoard,filterRegistrationProducts}=load('app/components/registration-board.tsx');
test('board shows edited title and selected image while searches retain source title and URL',()=>{
 const product={id:'p',title:'원본상품',source_url:'https://detail.1688.com/offer/813724060928.html',created_at:'2026-09-26T00:00:00Z',image_keys:'["first","owner/chosen image"]',content_summary:{seoTitle:'수정한 상품명',mainImageKey:'owner/chosen image'}};
 assert.equal(registrationTitle(product),'수정한 상품명');assert.equal(registrationThumbnail(product),'/api/files/owner/chosen%20image');
 for(const query of ['수정한','원본상품','813724060928'])assert.equal(filterRegistrationProducts([product],query,null,null).length,1);
 product.content_summary.seoTitle='';product.content_summary.mainImageKey=null;
 assert.equal(registrationTitle(product),'상품명 미입력');assert.equal(registrationThumbnail(product),null);
 product.content_summary.mainImageKey='foreign';assert.equal(registrationThumbnail(product),null);
 product.content_summary=null;assert.equal(registrationTitle(product),'원본상품');assert.equal(registrationThumbnail(product),null);
});

test('source preview survives an unchosen or cleared main image without completing image stages',()=>{
 const product={image_keys:JSON.stringify(['owner/banner','owner/source','owner/chosen']),source_image_key:'owner/source',content_summary:{mainImageKey:null,main:0,additional:0,detail:0,missingImages:false}};
 const before=JSON.stringify(product);
 assert.equal(registrationThumbnail(product),'/api/files/owner/source');
 for(const step of ['대표 이미지','추가 이미지','상세 이미지'])assert.equal(registrationStepLabel(product,step),'0장');
 assert.equal(JSON.stringify(product),before);
 product.content_summary.mainImageKey='owner/chosen';product.content_summary.main=1;
 assert.equal(registrationThumbnail(product),'/api/files/owner/chosen');
 product.content_summary.mainImageKey=null;product.content_summary.main=0;
 assert.equal(registrationThumbnail(product),'/api/files/owner/source');
 product.content_summary.mainImageKey='foreign';product.content_summary.missingImages=true;
 assert.equal(registrationThumbnail(product),'/api/files/owner/source');
 assert.equal(product.content_summary.missingImages,true);
});

test('listing never substitutes an arbitrary banner, removed original or malformed image library',()=>{
 const product={image_keys:'["owner/banner"]',source_image_key:'owner/removed',content_summary:{mainImageKey:null}};
 assert.equal(registrationThumbnail(product),null);
 for(const source of [null,'','foreign']){product.source_image_key=source;assert.equal(registrationThumbnail(product),null);}
 product.source_image_key='owner/source';product.image_keys='{"key":"owner/source"}';assert.equal(registrationThumbnail(product),null);
 product.image_keys='broken';assert.equal(registrationThumbnail(product),null);
});

test('real collected draft renders a product preview while quotation image fields remain blank',async()=>{
 const {mobileIntakeHarness}=await import('./helpers/mobile-intake.mjs');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {createElement}=await import('react');const h=mobileIntakeHarness();
 try{
  await h.intake();const response=await h.load('app/api/products/route.ts').GET();assert.equal(response.status,200);
  const {products}=await response.json(),product=products[0];assert.ok(product.source_image_key);
  const html=renderToStaticMarkup(createElement(RegistrationBoard,{products,selected:new Set(),onSelected:()=>{},onOpen:()=>{},loading:false,error:'',onArchive:()=>{}}));
  assert.ok(html.includes(`src="${registrationThumbnail(product)}"`));assert.ok(!html.includes('이미지<br/>없음'));
  assert.match(html,/우드 패턴 다리 선글라스/);assert.equal((html.match(/>0장<\/button>/g)||[]).length,4);
  const fields=await h.route('/api/products/'+product.id+'/quotation-fields');assert.equal(fields.status,200);
  for(const row of (await fields.json()).resolved.rows)for(const key of ['mainImage','additionalImages','detailImages'])assert.equal(row.fields[key].value,'');
 }finally{h.close();}
});
