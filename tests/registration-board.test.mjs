import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):require(name)});return exports;}
const {registrationTitle,registrationThumbnail,filterRegistrationProducts}=load('app/components/registration-board.tsx');
test('board shows edited title and selected image while searches retain source title and URL',()=>{
 const product={id:'p',title:'원본상품',source_url:'https://detail.1688.com/offer/813724060928.html',created_at:'2026-09-26T00:00:00Z',image_keys:'["first","owner/chosen image"]',content_summary:{seoTitle:'수정한 상품명',mainImageKey:'owner/chosen image'}};
 assert.equal(registrationTitle(product),'수정한 상품명');assert.equal(registrationThumbnail(product),'/api/files/owner/chosen%20image');
 for(const query of ['수정한','원본상품','813724060928'])assert.equal(filterRegistrationProducts([product],query,null,null).length,1);
 product.content_summary.seoTitle='';product.content_summary.mainImageKey=null;
 assert.equal(registrationTitle(product),'상품명 미입력');assert.equal(registrationThumbnail(product),null);
 product.content_summary.mainImageKey='foreign';assert.equal(registrationThumbnail(product),null);
 product.content_summary=null;assert.equal(registrationTitle(product),'원본상품');assert.equal(registrationThumbnail(product),null);
});
