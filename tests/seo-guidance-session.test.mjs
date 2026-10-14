import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const api={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/seo-guidance-session.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,Error});
const plain=value=>JSON.parse(JSON.stringify(value)),defaults={brand:'기본 브랜드, 보조 브랜드',features:'원문 특징',keywords:'원문 타겟'};
const key=api.seoGuidanceSessionSourceKey('supplier-source',defaults),open=(owner='owner',product='product',source=key)=>api.openSeoGuidanceSession(owner,product,source);
beforeEach(()=>api.setSeoGuidanceSessionOwner(undefined));

test('source identity includes captured brand, feature and target defaults without any product clock',()=>{
 assert.equal(api.seoGuidanceSessionSourceKey('supplier-source',{...defaults}),key);
 for(const field of ['brand','features','keywords'])assert.notEqual(api.seoGuidanceSessionSourceKey('supplier-source',{...defaults,[field]:'새 원문 기준'}),key);
 assert.notEqual(api.seoGuidanceSessionSourceKey('different-supplier-source',defaults),key);
});
test('a field blur commits only its own raw value and preserves explicit feature/target blanks',()=>{
 const token=open();assert.equal(api.commitSeoGuidanceSession(token,'features',''),true);assert.deepEqual(plain(api.readSeoGuidanceSession(token)),{features:''});
 assert.equal(api.commitSeoGuidanceSession(token,'keywords',''),true);assert.deepEqual(plain(api.readSeoGuidanceSession(token)),{features:'',keywords:''});
 assert.deepEqual(plain(api.initialSeoGuidanceMemo(defaults,api.readSeoGuidanceSession(token))),{brand:'기본 브랜드',features:'',keywords:''});
});
test('raw whitespace and newlines remain session input while returned objects cannot mutate the cache',()=>{
 const token=open();api.commitSeoGuidanceSession(token,'features','  입력 원문\n둘째 줄  ');const copy=api.readSeoGuidanceSession(token);copy.features='외부 변경';
 assert.deepEqual(plain(api.readSeoGuidanceSession(token)),{features:'  입력 원문\n둘째 줄  '});
});
test('release rejects old callbacks and reopening the same owner/product/source restores finalized fields',()=>{
 const old=open();api.commitSeoGuidanceSession(old,'features','확정 특징');api.releaseSeoGuidanceSession(old);
 assert.equal(api.commitSeoGuidanceSession(old,'keywords','닫힌 창'),false);assert.equal(api.readSeoGuidanceSession(old),null);
 const fresh=open();assert.deepEqual(plain(api.readSeoGuidanceSession(fresh)),{features:'확정 특징'});assert.equal(api.commitSeoGuidanceSession(old,'features','낡은 값'),false);
});
test('an older ticket cannot publish after another live session opens at the same key',()=>{
 const old=open();api.commitSeoGuidanceSession(old,'keywords','현재 키워드');const fresh=open();
 assert.equal(api.commitSeoGuidanceSession(old,'features','낡은 입력'),false);assert.deepEqual(plain(api.readSeoGuidanceSession(fresh)),{keywords:'현재 키워드'});
});
test('different products retain independent fields within the current owner',()=>{
 const first=open('owner','first');api.commitSeoGuidanceSession(first,'features','첫 상품');const second=open('owner','second');api.commitSeoGuidanceSession(second,'keywords','둘째 상품');
 assert.deepEqual(plain(api.readSeoGuidanceSession(first)),{features:'첫 상품'});assert.deepEqual(plain(api.readSeoGuidanceSession(second)),{keywords:'둘째 상품'});
});
test('a fresh canonical source retires old finalized fields and old callbacks even when returning to its old key',()=>{
 const old=open();api.commitSeoGuidanceSession(old,'features','이전 원문');const fresh=open('owner','product','new-source');
 assert.deepEqual(plain(api.readSeoGuidanceSession(fresh)),{});assert.equal(api.commitSeoGuidanceSession(old,'features','이전 콜백'),false);
 const returned=open();assert.deepEqual(plain(api.readSeoGuidanceSession(returned)),{});
});
test('owner A/B/A retires both cached values and every older ticket',()=>{
 const first=open('A');api.commitSeoGuidanceSession(first,'features','A 원문');const second=open('B');api.commitSeoGuidanceSession(second,'features','B 원문');const returned=open('A');
 assert.equal(api.commitSeoGuidanceSession(first,'features','retired A'),false);assert.equal(api.commitSeoGuidanceSession(second,'features','foreign B'),false);
 assert.deepEqual(plain(api.readSeoGuidanceSession(returned)),{});
});
test('logout retires cache before any generator for another owner needs to mount',()=>{
 const old=open();api.commitSeoGuidanceSession(old,'keywords','로그아웃 이전');api.setSeoGuidanceSessionOwner(undefined);
 assert.equal(api.commitSeoGuidanceSession(old,'keywords','늦은 콜백'),false);assert.deepEqual(plain(api.readSeoGuidanceSession(open())),{});
});
for(const owner of [undefined,'','   '])test(`a ${owner===undefined?'missing':JSON.stringify(owner)} owner cannot retain or commit guidance`,()=>{
 const token=api.openSeoGuidanceSession(owner,'product',key);assert.equal(token,null);assert.equal(api.commitSeoGuidanceSession(token,'features','보관 불가'),false);assert.equal(api.readSeoGuidanceSession(token),null);
});
for(const [name,brand,saved,expected]of [
 ['nonempty default','기본,두번째',{brand:'직접 브랜드'},'기본'],
 ['empty default','',{brand:'직접 브랜드,두번째'},'직접 브랜드'],
 ['manual brand blank with default','기본',{brand:''},'기본'],
 ['manual brand blank without default','',{brand:''},''],
 ['raw first segment',' 기본 ,두번째',{brand:'직접'},' 기본 '],
])test(`initialization follows the observed ${name} brand rule`,()=>assert.equal(api.initialSeoGuidanceMemo({...defaults,brand},saved).brand,expected));
test('oversize or control-bearing fields cannot replace the valid session cache',()=>{
 const token=open();api.commitSeoGuidanceSession(token,'features','보존');
 for(const [field,value]of [['brand','가'.repeat(101)],['features','가'.repeat(2001)],['keywords','가'.repeat(2001)],['features','금지\u0000문자'],['unknown','값']])assert.throws(()=>api.commitSeoGuidanceSession(token,field,value),/길이와 문자/);
 assert.deepEqual(plain(api.readSeoGuidanceSession(token)),{features:'보존'});
});
