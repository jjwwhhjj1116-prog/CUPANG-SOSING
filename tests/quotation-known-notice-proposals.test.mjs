import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';

const {quotationKnownNoticeProposals:propose}=load('app/quotation-known-notice-proposals.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),all={optionId:null,applyToAllOptions:true};
function fixture(){
 const fields=['제조자(수입자)','소비자상담 관련 전화번호','제조국(원산지)','인증/허가 사항','품질보증기준'].map((label,index)=>({id:'notice'+index,label,section:'legal',visibility:'common',type:'text',required:true,hubWire:{path:['legalPage','notices'],name:label,nameKey:'noticeItemName',valueKey:'noticeItemValue'}}));
 const schema={status:'observed',categoryId:'68183',categoryPath:['합성','기타재화'],fields};
 const content=load('app/product-content.ts').emptyProductContent('product');content.revision=3;
 for(const [key,value]of Object.entries({manufacturer:'저장 제조사',importer:'저장 수입사',contact:'02-1234-5678',countryOfOrigin:'중국'}))content.label[key]={value,provenance:'manual',updatedAt:'2026-10-23T00:00:00Z'};
 const view={contentRevision:3,categoryContext:{categoryId:schema.categoryId,categoryPath:schema.categoryPath},overrides:{common:{},options:{}},resolved:{schema,rows:['a','b','excluded'].map(optionId=>({optionId,included:optionId!=='excluded',fields:Object.fromEntries(fields.map(field=>[field.id,{value:'해당사항없음',source:'couplus-default'}]))}))}};
 return {content,view,fields,run:(scope=all)=>propose('product',view,content,scope)};
}
test('known saved manufacture/contact sources produce exact included-option proposals without mutating defaults or claims',()=>{
 const f=fixture(),before=JSON.stringify(f),changes=plain(f.run());
 assert.deepEqual(changes,['a','b'].flatMap(optionId=>[{optionId,fieldKey:'notice0',value:'제조자: 저장 제조사 / 수입자: 저장 수입사'},{optionId,fieldKey:'notice1',value:'02-1234-5678'}]));
 assert.equal(JSON.stringify(f),before);assert.ok(changes.every(change=>!['notice2','notice3','notice4'].includes(change.fieldKey)));
 assert.equal(f.view.resolved.rows[0].fields.notice0.value,'해당사항없음');
});
test('single-option scope stays exact and excluded/missing options cannot become a target',()=>{
 const f=fixture();assert.deepEqual(plain(f.run({optionId:'b',applyToAllOptions:false})).map(row=>row.optionId),['b','b']);
 for(const scope of [{optionId:'excluded',applyToAllOptions:false},{optionId:'missing',applyToAllOptions:false},{optionId:null,applyToAllOptions:false},{optionId:'excluded',applyToAllOptions:true}])assert.throws(()=>f.run(scope),/범위/);
});
test('manual option/common values and deliberate blanks remain untouched even if a response cell is inconsistent',()=>{
 for(const value of ['', '해당사항없음','직접 수정'])for(const layer of ['common','options']){
  const f=fixture();if(layer==='common')f.view.overrides.common.notice0=value;else f.view.overrides.options.a={notice0:value};
  const changes=f.run();assert.equal(changes.some(row=>row.optionId==='a'&&row.fieldKey==='notice0'),false);
  assert.equal(changes.some(row=>row.optionId==='b'&&row.fieldKey==='notice0'),layer==='options');
 }
 for(const source of ['manual-option','manual-common','settings','content','schema','empty']){
  const f=fixture();f.view.resolved.rows[0].fields.notice0={value:'해당사항없음',source};assert.equal(f.run().some(row=>row.optionId==='a'&&row.fieldKey==='notice0'),false);
 }
 const f=fixture();f.view.resolved.rows[0].fields.notice0.value='다른 자동 고시';assert.equal(f.run().some(row=>row.optionId==='a'&&row.fieldKey==='notice0'),false);
});
test('generated, translated, unverified, blank and N/A sources never replace placeholders',()=>{
 for(const provenance of ['generated','translated','unverified']){
  const f=fixture();for(const key of ['manufacturer','importer','contact'])f.content.label[key].provenance=provenance;
  assert.deepEqual(plain(f.run()),[]);
 }
 for(const value of ['', '  ','해당사항없음','해당 없음','unsafe\u0000text','x'.repeat(2001)]){
  const f=fixture();for(const key of ['manufacturer','importer','contact'])f.content.label[key].value=value;
  assert.deepEqual(plain(f.run()),[]);
 }
 const f=fixture();f.content.label.manufacturer.value='';assert.equal(f.run()[0].value,'수입자: 저장 수입사');
 f.content.label.importer.value='';assert.ok(f.run().every(row=>row.fieldKey==='notice1'));
});
test('collected sources are copied exactly while generated country stays excluded',()=>{
 const f=fixture();for(const key of ['manufacturer','importer','contact'])f.content.label[key].provenance='collected';
 f.content.label.countryOfOrigin.provenance='generated';assert.equal(f.run().length,4);assert.equal(f.run().some(row=>row.fieldKey==='notice2'),false);
});
test('only exact supported notice wires and writable fields receive values',()=>{
 for(const mutate of [field=>{field.hubWire=undefined;},field=>{field.hubWire.path=['legalPage','certificates'];},field=>{field.hubWire.path=['legalPage','notices','nested'];},field=>{field.hubWire.name='제조자';},field=>{field.hubWire.nameKey='name';},field=>{field.hubWire.valueKey='value';},field=>{field.section='product';},field=>{field.visibility='hidden';},field=>{field.readOnly=true;},field=>{field.hubInput='manufacturer';},field=>{field.type='number';}]){
  const f=fixture();mutate(f.fields[0]);assert.equal(f.run().some(row=>row.fieldKey==='notice0'),false);
 }
 const f=fixture();f.fields[0].hubWire.valueKey='noticeContent';assert.ok(f.run().some(row=>row.fieldKey==='notice0'));
});
test('existing exact A/S contact alias uses the same source without widening similar labels',()=>{
 for(const [label,expected]of [['A/S 책임자와 전화번호',true],['소비자상담 관련 전화번호 안내',false],['제조국',false]]){
  const f=fixture();f.fields[1].label=label;f.fields[1].hubWire.name=label;
  assert.equal(f.run().some(row=>row.fieldKey==='notice1'),expected);
 }
});
test('field length and enum restrictions are checked before a source is proposed',()=>{
 for(const change of [{maxLength:3},{type:'select',choices:[{value:'다른 회사',label:'다른 회사'}]}]){
  const f=fixture();Object.assign(f.fields[0],change);assert.equal(f.run().some(row=>row.fieldKey==='notice0'),false);
 }
});
test('product/content revision and category identity must match the exact quotation read',()=>{
 for(const mutate of [f=>{f.content.productId='other';},f=>{f.content.revision=2;},f=>{f.content.revision=NaN;},f=>{f.content.schemaVersion=2;},f=>{f.view.categoryContext.categoryId='other';},f=>{f.view.categoryContext.categoryPath=['other'];},f=>{f.view.resolved.schema.status='unconfirmed';}]){
  const f=fixture();mutate(f);assert.throws(()=>f.run(),/범위/);
 }
});
test('ambiguous target identities and duplicate options fail rather than producing repeated writes',()=>{
 const f=fixture();f.fields.push({...f.fields[0],id:'duplicate'});assert.throws(()=>f.run(),/범위/);
 const g=fixture();g.view.resolved.rows.push(plain(g.view.resolved.rows[0]));assert.throws(()=>g.run(),/범위/);
});
