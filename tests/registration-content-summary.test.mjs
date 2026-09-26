import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
function load(file,db){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name==='cloudflare:workers'?{env:{DB:db}}:load(name.slice(2)+'.ts',db)});return exports;}
const {registrationContentSummary}=load('app/registration-content-summary.ts');
const {emptyProductContent}=load('app/product-content.ts');
test('listing counts saved owned roles, merges detail sections and distinguishes cleared SEO',()=>{
 const product={id:'p',image_keys:'["a","b","c"]'},content=emptyProductContent('p');
 content.seo.title.value='상품';content.assets.main.value=['a'];content.assets.additional.value=['b','foreign'];content.assets.detailTop.value=['b'];content.assets.detail.value=['b','c'];content.assets.label.value=[];
 const summary=registrationContentSummary(product,content);assert.equal(summary.seo,true);assert.equal(summary.main,1);assert.equal(summary.additional,1);assert.equal(summary.detail,2);assert.equal(summary.label,0);assert.equal(summary.missingImages,true);
 content.seo.title.value='';assert.equal(registrationContentSummary(product,content).seo,false);
 assert.equal(registrationContentSummary(product,null).main,0);content.productId='other';assert.throws(()=>registrationContentSummary(product,content));
});
test('batched listing enforces owner and product bounds, isolates corrupt content and limits SQL parameters',async()=>{
 const sqlite=new DatabaseSync(':memory:');const lengths=[];
 sqlite.exec('CREATE TABLE products(id TEXT PRIMARY KEY)');
 const db={prepare(sql){let args=[];const query={bind(...values){args=values;lengths.push(values.length);return query;},async run(){return sqlite.prepare(sql).run(...args);},async all(){return {results:sqlite.prepare(sql).all(...args)};}};return query;}};
 const {readRegistrationSummaries}=load('db/product-content.ts',db);
 const products=Array.from({length:81},(_,i)=>({id:'p'+i,image_keys:'[]'}));
 try{
  await readRegistrationSummaries('owner',products);
  for(const id of ['p0','p1','p2','p3'])sqlite.prepare('INSERT INTO products VALUES (?)').run(id);
  const content=emptyProductContent('p0');content.revision=1;content.seo.title.value='stored';
  const insert=sqlite.prepare('INSERT INTO product_content VALUES (?,?,?,?,?)');
  insert.run('p0','owner',1,JSON.stringify(content),'now');
  insert.run('p1','other',1,JSON.stringify({...content,productId:'p1'}),'now');
  insert.run('p2','owner',1,'broken','now');
  insert.run('p3','owner',2,JSON.stringify({...content,productId:'p3'}),'now');
  const result=await readRegistrationSummaries('owner',products);
  assert.equal(Object.keys(result).length,81);assert.equal(result.p0.seo,true);assert.equal(result.p1.seo,false);assert.equal(result.p2,null);assert.equal(result.p3,null);assert.ok(lengths.every(n=>n<=81));
  assert.equal(Object.keys(await readRegistrationSummaries('owner',[])).length,0);
 }finally{sqlite.close();}
});

test('listing preserves saved SEO title, deliberate blank and selected main image',()=>{
 const product={id:'p',image_keys:'["first-upload","chosen"]'},content=emptyProductContent('p');
 assert.equal(registrationContentSummary(product,content).seoTitle,null);
 content.seo.title.value='edited title';content.assets.main.value=['chosen'];
 let summary=registrationContentSummary(product,content);assert.equal(summary.seoTitle,'edited title');assert.equal(summary.mainImageKey,'chosen');
 content.seo.title.value='';content.seo.title.provenance='manual';content.assets.main.value=[];
 summary=registrationContentSummary(product,content);assert.equal(summary.seoTitle,'');assert.equal(summary.mainImageKey,null);
 content.assets.main.value=['foreign'];summary=registrationContentSummary(product,content);assert.equal(summary.mainImageKey,null);assert.equal(summary.missingImages,true);
});
