import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/request-error.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const message=exports.requestErrorMessage;
test('option-price failures retain actionable IDs and individual reasons',()=>{
 const text=message({error:'저장하지 않았습니다.',code:'INVALID_OPTION_PRICE',options:[{optionId:'collected-1',error:'원가 누락'},{optionId:'bundle-2',error:'계산 범위 초과'}]});
 assert.match(text,/저장하지 않았습니다/);assert.match(text,/collected-1: 원가 누락/);assert.match(text,/bundle-2: 계산 범위 초과/);
});
test('unrelated and malformed responses do not leak arbitrary diagnostics or throw',()=>{
 for(const value of [null,[],true,{}, {error:{private:'details'}}])assert.equal(message(value),'요청에 실패했습니다.');
 assert.equal(message({error:'기존 오류',options:[{optionId:'x',error:'숨김'}]}),'기존 오류');
 assert.equal(message({error:'기존 오류',code:'INVALID_OPTION_PRICE',options:[null,{},'bad']}),'기존 오류');
});
test('large option failures are bounded while remaining failure count is visible',()=>{
 const text=message({code:'INVALID_OPTION_PRICE',options:Array.from({length:15},(_,i)=>({optionId:`sku-${i}`,error:'원가 확인'}))});
 assert.match(text,/sku-9:/);assert.doesNotMatch(text,/sku-10:/);assert.match(text,/외 5개 옵션/);
});
