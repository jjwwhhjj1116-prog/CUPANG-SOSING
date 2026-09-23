import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,structuredClone});return exports;}
const {generatedImageRolePatch,generatedImagesRolePatch}=load('app/image-role-adoption.ts');
const {emptyProductContent,applyContentPatch}=load('app/product-content.ts');
function fixture(){const content=emptyProductContent('p');content.revision=3;content.assets.main.value=['owner/main'];content.assets.additional.value=['owner/a','owner/raw','owner/b'];content.assets.detail.value=['owner/c'];content.assets.label.value=['owner/label'];content.assets.size.value=['owner/size'];return {content,job:{productId:'p',status:'completed',contentRevision:3,review:{sourceKey:'owner/raw'},result:{attached:true,storageKey:'owner/result'}},keys:['owner/raw','owner/result','owner/a','owner/b','owner/c']};}
test('reviewed generated result replaces only original positions and preserves all other content and original files',()=>{
 const {content,job,keys}=fixture();const before=JSON.stringify(content);const patch=generatedImageRolePatch(content,job,keys);const next=applyContentPatch(content,patch,'now');
 assert.deepEqual(JSON.parse(JSON.stringify(next.assets.additional.value)),['owner/a','owner/result','owner/b']);
 assert.deepEqual(JSON.parse(JSON.stringify(next.assets.detail.value)),['owner/c']);
 assert.equal(next.assets.main.value[0],'owner/main');assert.equal(next.assets.label.value[0],'owner/label');assert.equal(next.assets.size.value[0],'owner/size');
 assert.equal(JSON.stringify(content),before);assert.equal(keys.includes('owner/raw'),true);assert.equal(next.assets.additional.provenance,'manual');
});
test('changed content, other product, unfinished and unattached results cannot overwrite roles',()=>{
 for(const change of [x=>x.content.revision++,x=>x.job.productId='other',x=>x.job.status='running',x=>x.job.result.attached=false,x=>{x.keys.splice(1,1);}]){
  const x=fixture();change(x);assert.throws(()=>generatedImageRolePatch(x.content,x.job,x.keys));
 }
});
test('missing original roles and existing output duplicates require explicit editor selection',()=>{
 const x=fixture();for(const role of ['main','additional','detail'])x.content.assets[role].value=[];assert.throws(()=>generatedImageRolePatch(x.content,x.job,x.keys),/직접 선택/);
 const y=fixture();y.content.assets.additional.value.push('owner/result');assert.throws(()=>generatedImageRolePatch(y.content,y.job,y.keys),/이미 지정/);
 const z=fixture();z.job.result.storageKey='owner/raw';assert.throws(()=>generatedImageRolePatch(z.content,z.job,z.keys));
});

test('batch applies multiple results in one content revision and preserves original order',()=>{
 const {content,job,keys}=fixture();keys.push('owner/result2');
 const second={...structuredClone(job),review:{sourceKey:'owner/c'},result:{attached:true,storageKey:'owner/result2'}};
 const before=JSON.stringify(content);const patch=generatedImagesRolePatch(content,[second,job],keys);const next=applyContentPatch(content,patch,'now');
 assert.equal(next.revision,4);assert.deepEqual(JSON.parse(JSON.stringify(next.assets.additional.value)),['owner/a','owner/result','owner/b']);assert.equal(next.assets.detail.value[0],'owner/result2');assert.equal(next.assets.label.value[0],'owner/label');assert.equal(JSON.stringify(content),before);
});
test('batch fails as a whole for conflicting source, duplicate output, stale or unattached results',()=>{
 for(const mutate of [second=>{second.review.sourceKey='owner/raw';},second=>{second.result.storageKey='owner/result';},second=>{second.contentRevision=2;},second=>{second.result.attached=false;}]){
  const {content,job,keys}=fixture();keys.push('owner/result2');const second={...structuredClone(job),review:{sourceKey:'owner/c'},result:{attached:true,storageKey:'owner/result2'}};mutate(second);
  const before=JSON.stringify(content);assert.throws(()=>generatedImagesRolePatch(content,[job,second],keys));assert.equal(JSON.stringify(content),before);
 }
 const {content,job,keys}=fixture();assert.throws(()=>generatedImagesRolePatch(content,[],keys));assert.throws(()=>generatedImagesRolePatch(content,Array(51).fill(job),keys));
});
