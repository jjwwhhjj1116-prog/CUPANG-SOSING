import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) {
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require(name){if(name.startsWith('@/'))return load(`${name.slice(2)}.ts`);throw Error(name);}});return exports;
}
const model=load('app/product-options.ts');
const {refreshOptionPriceBase}=load('app/option-price-refresh.ts');
const policy={exchangeRate:100,supplyMargin:0,coupangMargin:0,minimumMargin:0,msrpMultiple:1,roundingUnit:1};
function base(){return {options:{...model.emptyProductOptions('p'),revision:1,rows:[{...model.emptyOptionInput('a'),unitCostCny:2,unitsPerPack:1,included:true}]},productVersion:'2026-09-23T00:00:00.000Z',pricing:{policy,policySource:'saved-product',rows:[]}};}
function latest(b){return {...structuredClone(b),productVersion:'2026-09-23T00:01:00.000Z',pricing:{...b.pricing,policy:{...policy,exchangeRate:200}}};}
test('refresh preserves all unsaved option edits and recalculates with the new policy',()=>{
 const b=base(),n=latest(b),draft=[{...b.options.rows[0],unitCostCny:4,unitsPerPack:3,translatedName:'직접 편집',imageKey:'owner/image.png'}];
 const before=JSON.stringify(draft),r=refreshOptionPriceBase(b,n,draft);
 assert.equal(JSON.stringify(r.rows),before);assert.notEqual(r.rows,draft);assert.notEqual(r.rows[0],draft[0]);
 assert.equal(model.calculateOptionPrices(r.rows,r.saved.pricing.policy)[0].calculation.supplyPrice,2400);
 assert.equal(JSON.stringify(draft),before);assert.equal(b.pricing.policy.exchangeRate,100);
});
test('new server option revision cannot be silently overwritten',()=>{const b=base(),n=latest(b);n.options.revision++;assert.throws(()=>refreshOptionPriceBase(b,n,b.options.rows),/서버의 옵션/);});
test('same revision with changed values or row order is rejected',()=>{const b=base();b.options.rows.push({...b.options.rows[0],id:'b'});const n=latest(b);n.options.rows.reverse();assert.throws(()=>refreshOptionPriceBase(b,n,b.options.rows),/서버의 옵션/);const changed=latest(b);changed.options.rows[0].unitCostCny=9;assert.throws(()=>refreshOptionPriceBase(b,changed,b.options.rows),/서버의 옵션/);});
test('other product and stale or invalid versions are rejected',()=>{const b=base(),n=latest(b);n.options.productId='other';assert.throws(()=>refreshOptionPriceBase(b,n,[]),/다른 상품/);for(const version of ['invalid','2026-09-22T00:00:00Z'])assert.throws(()=>refreshOptionPriceBase(b,{...latest(b),productVersion:version},[]),/최신 상품/);});
test('draft additions, deletions, exclusions and invalid unfinished numbers are retained',()=>{const b=base(),draft=[{...model.emptyOptionInput('new'),unitCostCny:null,unitsPerPack:NaN,included:false}];const r=refreshOptionPriceBase(b,latest(b),draft);assert.equal(r.rows.length,1);assert.equal(r.rows[0].id,'new');assert.ok(Number.isNaN(r.rows[0].unitsPerPack));assert.equal(r.rows[0].included,false);});

test('merge keeps manual blanks and local additions while incorporating untouched server fields',()=>{
 const {mergeOptionDraft}=load('app/option-price-refresh.ts');const b=base(),n=latest(b);n.options.revision=2;n.options.rows[0].stock=20;
 const draft=[{...b.options.rows[0],translatedName:'',unitCostCny:4},model.emptyOptionInput('new')];
 const original=JSON.stringify({b,n,draft});const r=mergeOptionDraft(b,n,draft);
 assert.equal(r.rows[0].stock,20);assert.equal(r.rows[0].unitCostCny,4);assert.equal(r.rows[0].translatedName,'');assert.equal(r.rows[1].id,'new');
 assert.equal(r.saved.options.revision,2);assert.equal(r.saved.productVersion,n.productVersion);
 assert.equal(model.calculateOptionPrices(r.rows,r.saved.pricing.policy)[0].calculation.supplyPrice,800);
 assert.equal(JSON.stringify({b,n,draft}),original);
});

test('merge rejects competing edits and deleted rows changed remotely without mutating drafts',()=>{
 const {mergeOptionDraft}=load('app/option-price-refresh.ts');const b=base(),n=latest(b);n.options.revision=2;n.options.rows[0].unitCostCny=5;
 const draft=[{...b.options.rows[0],unitCostCny:4}],original=JSON.stringify(draft);
 assert.throws(()=>mergeOptionDraft(b,n,draft),/양쪽에서 변경/);assert.equal(JSON.stringify(draft),original);
 assert.throws(()=>mergeOptionDraft(b,n,[]),/삭제한 옵션/);
 assert.equal(mergeOptionDraft(b,n,[{...draft[0],unitCostCny:5}]).rows[0].unitCostCny,5);
 assert.equal(mergeOptionDraft(b,latest(b),[]).rows.length,0);
});

test('merge rejects remote structure changes, inconsistent versions and other products',()=>{
 const {mergeOptionDraft}=load('app/option-price-refresh.ts');const b=base();
 for(const change of [n=>n.options.rows.push({...n.options.rows[0],id:'new'}),n=>n.options.rows.pop()]){const n=latest(b);n.options.revision++;change(n);assert.throws(()=>mergeOptionDraft(b,n,b.options.rows),/옵션 추가·삭제·순서/);}
 const n=latest(b);n.options.rows[0].stock=20;assert.throws(()=>mergeOptionDraft(b,n,b.options.rows),/버전과 내용/);
 n.options.productId='other';assert.throws(()=>mergeOptionDraft(b,n,b.options.rows),/다른 상품/);
 const stale=latest(b);stale.productVersion='2020-01-01';assert.throws(()=>mergeOptionDraft(b,stale,b.options.rows),/최신 상품/);
});
