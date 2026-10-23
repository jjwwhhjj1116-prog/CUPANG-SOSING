import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionFixture,providedOptionModule as module} from './helpers/provided-option-quotation.mjs';
import {hubSchemaSnapshot,schemaCompanies} from './helpers/hub-schema.mjs';

const quotes=module('app/quotation-schema.ts'),defaults=module('app/couplus-quotation-defaults.ts');
const na='해당사항없음',plain=value=>JSON.parse(JSON.stringify(value));
function fixture(company=schemaCompanies[0],values=['해당없음','실제 값'],initial=true){
 const source=providedOptionFixture(),snapshot=hubSchemaSnapshot(company),raw=JSON.parse(snapshot.schemaString);
 raw.properties.legalPage.properties.notices.allOf[0].contains.properties.name.enum=['시험 자동선택 고시'];
 raw.properties.legalPage.properties.notices.allOf[0].contains.properties.value={type:values.includes(null)?['string','null']:'string',enum:values};
 snapshot.schemaString=JSON.stringify(raw);
 const schema=quotes.getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,snapshot),notice=schema.fields.find(field=>field.label==='시험 자동선택 고시');
 if(initial)source.content.initialLegalNotices=module('app/initial-legal-notices.ts').createInitialLegalNotices(schema,source.settings,'2026-10-23T01:00:00.000Z');
 const resolve=(extra={})=>quotes.resolveQuotationFields({...source,categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,...extra});
 return {source,snapshot,schema,notice,resolve};
}

test('automatic Couplus N/A aliases select only one exact current enum wire by value or label, ignoring whitespace',()=>{
 for(const value of [na,'해당없음','해 당 사 항 없 음',' 해당\n없음 ']){
  for(const choice of [{value:'해당없음',label:'해당없음'},{value:'NONE',label:'해당 사항 없음'},{value:'',label:'해당 없음'}]){
   const field={id:'synthetic',draftDefault:value,choices:[{value:'ordinary',label:'실제 선택'},choice]},before=JSON.stringify(field);
   assert.equal(defaults.couplusQuotationDefault('unrecorded',field),choice.value);assert.equal(JSON.stringify(field),before);
  }
 }
 assert.equal(defaults.couplusQuotationDefault('80719',{id:'handlingReason',choices:[{value:'',label:'해당 없음'},{value:'fragile',label:'유리'}]}),'');
});

test('missing or ambiguous N/A enums retain the original automatic value and never guess the first choice',()=>{
 for(const choices of [undefined,[],[{value:'ordinary',label:'실제 선택'}],[{value:'short',label:'해당없음'},{value:'long',label:'해당사항없음'}],
  [{value:'',label:'해당사항없음'},{value:'NONE',label:'해당 없음'}]])assert.equal(defaults.couplusQuotationDefault('991234',{id:'test',draftDefault:na,choices}),na);
 assert.equal(defaults.couplusQuotationDefault('991234',{id:'test',draftDefault:'실제 값',choices:[{value:'NONE',label:na}]}),'실제 값');
 assert.equal(defaults.couplusQuotationDefault('991234',{id:'test',draftDefault:'',choices:[{value:'NONE',label:na}]}),'','a hidden/null placeholder is not an N/A synonym');
});

for(const company of schemaCompanies)test(`${company.code}: native named-array preset and stored initial notice map to the official N/A enum without rewriting the source`,()=>{
 for(const initial of [false,true]){
  const x=fixture(company,undefined,initial),before=JSON.stringify(x.source),snapshot=JSON.stringify(x.snapshot),rows=x.resolve().rows;
  assert.equal(x.notice.draftDefault,na,'raw schema initializer remains unchanged');
  for(const row of rows){const cell=row.fields[x.notice.id];assert.equal(cell.value,'해당없음');assert.equal(cell.source,'couplus-default');assert.deepEqual(plain(cell.validationIssues),[]);assert.equal(cell.needsReview,true);}
  assert.equal(JSON.stringify(x.source),before);assert.equal(JSON.stringify(x.snapshot),snapshot);
  if(initial)assert.equal(x.source.content.initialLegalNotices.fields.find(field=>field.fieldId===x.notice.id).value,na,'immutable initial packet keeps the recorded placeholder');
 }
});

test('only an explicit nullable N/A choice permits an automatic blank wire; no-match and ambiguous native schemas keep validation failures',()=>{
 const nullable=fixture(undefined,[null,'실제 값']);
 for(const row of nullable.resolve().rows){assert.equal(row.fields[nullable.notice.id].value,'');assert.equal(row.fields[nullable.notice.id].source,'couplus-default');assert.deepEqual(plain(row.fields[nullable.notice.id].validationIssues),[]);}
 for(const values of [['실제 값','다른 값'],[null,'해당없음','실제 값']]){
  const x=fixture(undefined,values);
  for(const row of x.resolve().rows){assert.equal(row.fields[x.notice.id].value,na);assert.match(row.fields[x.notice.id].validationIssues.join(),/선택값/);}
 }
});

test('manual quotation values including explicit blanks remain exact and are never changed to an automatic N/A synonym',()=>{
 const x=fixture(),option=x.source.options.rows[0].id;
 for(const layer of ['common','option'])for(const value of ['',na,'해당 없음','실제 값']){
  const overrides={common:{},options:{}};if(layer==='common')overrides.common[x.notice.id]=value;else overrides.options[option]={[x.notice.id]:value};
  const before=JSON.stringify(overrides),row=x.resolve({overrides}).rows.find(row=>row.optionId===(layer==='common'?null:option)),cell=row.fields[x.notice.id];
  assert.equal(cell.value,value);assert.equal(cell.source,'manual-'+layer);assert.equal(JSON.stringify(overrides),before);
  if(value===na||value==='해당 없음')assert.match(cell.validationIssues.join(),/선택값/);
 }
});

test('settings and collected/manual content retain exact invalid N/A text and its normal enum validation',()=>{
 const x=fixture(undefined,undefined,false),raw=JSON.parse(x.snapshot.schemaString);
 raw.properties.productPage.properties.basicAttributes.properties.brand.enum=['해당없음','실제 브랜드'];
 raw.properties.legalPage.properties.notices.allOf.push({contains:{type:'object',properties:{name:{type:'string',enum:['제조국']},value:{type:'string',enum:['해당없음','중국']}}}});
 x.snapshot.schemaString=JSON.stringify(raw);x.source.settings.brand=na;
 for(const provenance of ['collected','manual']){
  x.source.content.label.countryOfOrigin={value:na,provenance,updatedAt:'2026-10-23T01:00:00.000Z'};
  const resolved=x.resolve(),brand=resolved.schema.fields.find(field=>field.label==='브랜드'),country=resolved.schema.fields.find(field=>field.label==='제조국');
  const before=JSON.stringify(x.source);
  for(const row of resolved.rows){
   assert.equal(row.fields[brand.id].value,na);assert.equal(row.fields[brand.id].source,'settings');assert.match(row.fields[brand.id].validationIssues.join(),/선택값/);
   assert.equal(row.fields[country.id].value,na);assert.equal(row.fields[country.id].source,'content');assert.match(row.fields[country.id].validationIssues.join(),/선택값/);
  }
  assert.equal(JSON.stringify(x.source),before);
 }
});
