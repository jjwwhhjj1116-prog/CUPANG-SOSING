import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/quotation-profile-selection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const choose=exports.selectQuotationProfile;
const profiles=[{id:'saved',categoryId:'80719',categoryPath:['새 표시 경로']},{id:'other',categoryId:'77442'}];
const context={source:'collection',profileId:'saved',categoryId:'80719',categoryPath:['수집 당시 경로']};
test('same profile and category code reconnect despite display path changes without mutating snapshots',()=>{
 const before=JSON.stringify({profiles,context});const result=choose(profiles,context);
 assert.equal(result.profileId,'saved');assert.equal(result.warning,'');assert.equal(JSON.stringify({profiles,context}),before);
});
test('changed category code never silently replaces the captured category with a mutable profile',()=>{
 const result=choose([{...profiles[0],categoryId:'77442'}],context);
 assert.equal(result.profileId,'');assert.match(result.warning,/80719/);assert.match(result.warning,/77442/);
});
test('missing profile and unknown codes preserve captured context instead of matching another profile by name or code',()=>{
 for(const [saved,captured] of [[profiles,{...context,profileId:'deleted'}],[profiles,{...context,categoryId:null}],[[{...profiles[0],categoryId:''}],context]]){
  const result=choose(saved,captured);assert.equal(result.profileId,'');assert.ok(result.warning);
 }
 assert.equal(choose(profiles,{...context,profileId:null}).profileId,'');
});
test('deleted inspection profile preserves captured context without automatically selecting a replacement',()=>{
 assert.equal(choose(profiles,context,'other').profileId,'other');
 const before=JSON.stringify({profiles,context});
 const result=choose(profiles,context,'deleted');
 assert.equal(result.profileId,'');assert.match(result.warning,/삭제/);
 assert.match(result.warning,/다시 선택/);
 assert.equal(JSON.stringify({profiles,context}),before);
});
