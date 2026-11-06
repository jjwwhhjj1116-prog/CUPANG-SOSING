import test from 'node:test';import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
const units=()=>load('app/current-quotation-attribute-rules.ts');
test('current NUMBER units preserve numbers and exact50 units while splitting only quantity extras',()=>{
 const m=units(),rule={group:'QUANTITY',mandatory:false};assert.equal(m.currentQuantityUnits.length,50);
 for(const unit of m.currentQuantityUnits)assert.equal(m.normalizeCurrentAttributeNumber('1'+unit,rule).value,'1'+unit);
 assert.equal(m.normalizeCurrentAttributeNumber('약 1,000켤레',rule).value,'1,000쌍');assert.equal(m.normalizeCurrentAttributeNumber('2개 + 보관함',rule).extra,'보관함');
 for(const [group,value,expected]of [['LENGTH','2센티미터','2cm'],['WEIGHT','100g 세트','100g'],['VOLUME','3리터','3L'],['DAYS','2년','2년도']])assert.equal(m.normalizeCurrentAttributeNumber(value,{group,mandatory:true}).value,expected);
 assert.equal(m.normalizeCurrentAttributeNumber('20',{group:'LENGTH',mandatory:true}).value,'20');assert.equal(m.normalizeCurrentAttributeNumber('20cm',{group:'LENGTH',mandatory:true}).value,'20cm');
 assert.ok(m.normalizeCurrentAttributeNumber('100g(참조)',{group:'WEIGHT',mandatory:false}).error);assert.equal(m.normalizeCurrentAttributeNumber('없음',rule).value,null);assert.ok(m.normalizeCurrentAttributeNumber('가로 2개',rule).error);
});
test('current label unknown/bundle/count rules do not confuse centimetres with contents',()=>{
 const m=load('app/product-label-current-rules.ts');assert.equal(m.normalizeCurrentLabelContent('',1),'1개');assert.equal(m.normalizeCurrentLabelContent('상세정보참조',3),'3개');assert.equal(m.normalizeCurrentLabelContent('1쌍',3),'3쌍');assert.equal(m.normalizeCurrentLabelContent('2개 묶음',3),'3개 묶음');assert.equal(m.normalizeCurrentLabelContent('20cm',1),'20cm / 1개');assert.equal(m.normalizeCurrentLabelContent('100ml',1),'100ml');assert.equal(m.normalizeCurrentLabelContent('설명',3),'설명 x 3개');
});
