import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Uint8Array,DataView,require:name=>load(name.slice(2)+'.ts')});return exports;}
const {quotationDetailPage:render}=load('app/exports/quotation-detail.ts');
const cell=(value,source='content')=>({value,source,needsReview:false,issues:[]});
const row=(id,images,html=cell(''))=>({optionId:id,optionLabel:id,included:true,fields:{title:cell('상품 <script>bad()</script>'),detailImages:cell(images),detailHtml:html}});
const assets=['top','body','bottom'].map(name=>({key:'owner/'+name,name:'assets/'+name+'.png',data:new Uint8Array()}));
test('detail review follows final per-option order and excludes omitted options',()=>{
 const resolved={rows:[row('a','owner/top\nowner/body\nowner/bottom'),row('b','owner/body'),{...row('excluded','owner/top'),included:false}]};const before=JSON.stringify(resolved);
 const html=render(resolved,assets,'설명 <img src=x onerror=bad()>');
 assert.ok(html.indexOf('src="assets/top.png"')<html.indexOf('src="assets/body.png"'));assert.ok(html.indexOf('src="assets/body.png"')<html.indexOf('src="assets/bottom.png"'));
 assert.equal((html.match(/<figure>/g)||[]).length,4);assert.ok(!html.includes('excluded'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img src=x onerror=bad()&gt;'));assert.equal(JSON.stringify(resolved),before);
});
test('manual HTML including intentional blanks remains inert and never restores the automatic description',()=>{
 for(const source of ['manual-common','manual-option'])for(const value of ['', '<script>bad()</script><img src="https://example.invalid/a.png">']){
  const html=render({rows:[row('a','',cell(value,source))]},assets,'자동 설명');
  assert.ok(!html.includes('자동 설명'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src="https://'));assert.match(html,/수동 HTML/);if(!value)assert.match(html,/직접 비움/);
 }
});
test('detail review rejects missing attachments, unsafe paths and excessive repeated content',()=>{
 const resolved={rows:[row('a','owner/top')]};
 assert.throws(()=>render(resolved,[],'') );
 for(const name of ['https://example.invalid/a.png','assets/../a.png','assets/a.svg','assets/a.png" onerror="bad'])assert.throws(()=>render(resolved,[{...assets[0],name}],'') );
 assert.throws(()=>render({rows:Array.from({length:200},(_,i)=>row(String(i),'',cell('x'.repeat(150000),'manual-common')))},[],''),/6MB/);
});
