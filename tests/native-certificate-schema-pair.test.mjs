import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionFixture,providedOptionModule} from './helpers/provided-option-quotation.mjs';

// Shipped-artifact basis, not a live execution claim:
// step725-current-ui/chunk-36123f1a.155d5b9e.js SHA-256
// 2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664,
// UTF-16 [218956,223632), slice SHA-256
// 6de6bfed5767c745670736a8a96769585b816d3cc2795383a6bc32fe12bdea97:
// Couplus edits legalPage.certificates[].certificateName/certificateValue.
// step548-hub-main.js SHA-256
// 6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11,
// UTF-16 [4124852,4131939), slice SHA-256
// c9c4c93e4400ea81c6e630ae61db0ac67a44308f7e48058bf5ae615b907e6d97:
// the native certificate widget consumes schema-ordered name/value rows.
// Every schema and product below is synthetic; no certification or attachment
// is inferred from these field names and no native dispatch is performed.
const compiler=providedOptionModule('app/supplier-hub-schema.ts');
const quotation=providedOptionModule('app/quotation-schema.ts');
const project=providedOptionModule('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const path=['합성 분류','인증 행 시험'],plain=value=>JSON.parse(JSON.stringify(value));
const object=(properties,required=[])=>({type:'object',properties,required});
const named=(name,value,{reverse=false,nameKey='certificateName',valueKey='certificateValue'}={})=>({contains:object(
  Object.fromEntries((reverse?[[valueKey,value],[nameKey,{type:'string',enum:[name],requirement:'필수'}]]:
    [[nameKey,{type:'string',enum:[name],requirement:'필수'}],[valueKey,value]])),[nameKey,valueKey])});
function snapshot({company=companies[0],categoryId='991754',reverse=false,entries}={}){
  const raw=object({
    startPage:object({productName:{type:'string',title:'상품명',minLength:1},categoryPath:{type:'string',title:'카테고리',minLength:1}},['productName','categoryPath']),
    productPage:object({}),
    legalPage:object({certificates:{type:'array',items:{},allOf:entries??[
      named('합성 인증 A',{type:'string',enum:['인증-A']},{reverse}),
      named('합성 인증 B',{type:'string',enum:['인증-B']},{reverse}),
    ]},notices:{type:'array',items:{},allOf:[named('합성 고시',{type:'string',enum:['고시값']},{reverse,nameKey:'noticeItemName',valueKey:'noticeItemValue'})]},
    mandatoryScalar:{type:'integer',title:'필수 합성 정수',minimum:2,maximum:8}},['certificates','mandatoryScalar']),
  },['startPage','productPage','legalPage']);
  raw.metadata='scope:Retail_Categorized_Single;categoryId:765432;version:188;productNoticeCategoryId:25';
  return {format:'supplier-hub-schema-v1',categoryId,categoryPath:[...path],company:{...company},observedAt:Date.now(),
    schemaString:JSON.stringify(raw),metadata:{kanCategoryId:765432,noticeNumber:25,scopeType:'Retail_Categorized_Single',version:188},
    draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1'};
}
const certFields=fields=>fields.filter(field=>field.hubWire?.path.join('.')==='legalPage.certificates');
function resolved(snapshot,values={}){
  const fixture=providedOptionFixture({reviewedNames:true}),schema=quotation.getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,snapshot);
  const common={};
  for(const field of schema.fields){
    const wire=field.hubWire;
    if(wire?.path.join('.')==='legalPage.certificates')common[field.id]=Object.hasOwn(values,wire.name)?values[wire.name]:wire.name==='합성 인증 A'?'인증-A':'인증-B';
    if(wire?.path.join('.')==='legalPage.notices')common[field.id]='고시값';
    if(wire?.path.join('.')==='legalPage.mandatoryScalar')common[field.id]=Object.hasOwn(values,'mandatoryScalar')?values.mandatoryScalar:'4';
  }
  const input={...fixture,categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,overrides:{common,options:{}}};
  const value=quotation.resolveQuotationFields(input);
  return {input,value,project:()=>project({snapshot,company:snapshot.company,categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,resolved:value})};
}

for(const company of companies)for(const reverse of [false,true])test(`${company.code}: singleton certificate value enums keep exact schema order and keys (reverse=${reverse})`,async()=>{
  const source=snapshot({company,reverse}),before=JSON.stringify(source),compiled=compiler.compileHubQuotationSchema(source);
  assert.deepEqual(plain(compiled.unsupported),[]);
  const fields=certFields(compiled.fields);assert.equal(fields.length,2);
  assert.deepEqual(plain(fields.map(field=>field.hubWire)),['합성 인증 A','합성 인증 B'].map(name=>({path:['legalPage','certificates'],nameKey:'certificateName',valueKey:'certificateValue',name})));
  assert.ok(fields.every(field=>field.required&&field.section==='legal'));
  const f=resolved(source),inputBefore=JSON.stringify(f.input),out=await f.project();
  assert.deepEqual(plain(out.payload.jsonDocument[0].legalPage.certificates),[
    {certificateName:'합성 인증 A',certificateValue:'인증-A'},{certificateName:'합성 인증 B',certificateValue:'인증-B'},
  ]);
  assert.deepEqual(plain(out.payload.jsonDocument[0].legalPage.notices),[{noticeItemName:'합성 고시',noticeItemValue:'고시값'}]);
  assert.equal(out.payload.jsonDocument[0].legalPage.mandatoryScalar,4);
  assert.equal(JSON.stringify(source),before);assert.equal(JSON.stringify(f.input),inputBefore);
  assert.equal(out.registered,false);assert.equal(out.remoteWrites,false);assert.equal(out.submissionReady,false);
});

test('certificate field identity is stable across property order and isolated by category',async()=>{
  const a=snapshot(),b=snapshot({reverse:true}),other=snapshot({categoryId:'991755'});
  const fields=source=>certFields(compiler.compileHubQuotationSchema(source).fields);
  assert.deepEqual(fields(a).map(field=>field.id),fields(b).map(field=>field.id));
  assert.ok(fields(a).every((field,index)=>field.id!==fields(other)[index].id));
  const f=resolved(a);f.input.categoryId=other.categoryId;f.input.categoryPath=other.categoryPath;f.input.hubSchema=other;
  // Old category-specific IDs are not automatically applied to the new row.
  const changed=quotation.resolveQuotationFields(f.input),current=certFields(changed.schema.fields);
  assert.ok(current.every(field=>changed.rows[0].fields[field.id].source!=='manual-common'));
  await assert.rejects(project({snapshot:other,company:other.company,categoryId:other.categoryId,categoryPath:other.categoryPath,resolved:f.value}),error=>error.code==='SINGLE_RESOLVED_SCHEMA');
});

for(const placement of ['product','other-legal-array','nested-legal-array'])test(`certificate pair recognition stays confined to exact legalPage.certificates (${placement})`,async()=>{
  const source=snapshot(),raw=JSON.parse(source.schemaString),array=raw.properties.legalPage.properties.certificates;
  delete raw.properties.legalPage.properties.certificates;raw.properties.legalPage.required=['mandatoryScalar'];
  if(placement==='product')raw.properties.productPage.properties.certificates=array;
  else if(placement==='other-legal-array')raw.properties.legalPage.properties.otherCertificates=array;
  else raw.properties.legalPage.properties.nested=object({certificates:array});
  source.schemaString=JSON.stringify(raw);
  const compiled=compiler.compileHubQuotationSchema(source);assert.ok(compiled.unsupported.length);assert.equal(certFields(compiled.fields).length,0);
  const f=resolved(source);await assert.rejects(f.project(),error=>error.code==='SINGLE_UNSUPPORTED');
});

for(const kind of ['duplicate','unknown-ambiguous','invalid-name','extra-property'])test(`unsupported certificate rows cannot become an apparently valid native document (${kind})`,async()=>{
  let entries;
  if(kind==='duplicate')entries=[named('중복 인증',{type:'string',enum:['동일값']}),named('중복 인증',{type:'string',enum:['동일값']},{reverse:true})];
  else if(kind==='unknown-ambiguous')entries=[named('알 수 없는 이름',{type:'string',enum:['알 수 없는 값']},{nameKey:'certTitle',valueKey:'certText'})];
  else if(kind==='invalid-name'){entries=[named('유효하지 않은 이름',{type:'string',enum:['값']})];entries[0].contains.properties.certificateName.enum=['이름1','이름2'];}
  else {entries=[named('여분 속성',{type:'string',enum:['값']})];entries[0].contains.properties.extra={type:'string'};}
  const source=snapshot({entries}),compiled=compiler.compileHubQuotationSchema(source);assert.ok(compiled.unsupported.length);
  const f=resolved(source);await assert.rejects(f.project(),error=>error.code==='SINGLE_UNSUPPORTED');
});

for(const invalid of ['', '1', '9', '4.5'])test(`existing required scalar constraints remain blocking after certificate recognition (${JSON.stringify(invalid)})`,async()=>{
  const source=snapshot(),f=resolved(source,{mandatoryScalar:invalid}),field=f.value.schema.fields.find(field=>field.hubWire?.path.join('.')==='legalPage.mandatoryScalar');
  assert.equal(field.required,true);assert.equal(field.integer,true);assert.equal(field.min,2);assert.equal(field.max,8);
  assert.ok(f.value.rows[0].fields[field.id].validationIssues.length);
  const out=await f.project();assert.equal(out.review.documentShapeComplete,false);
  assert.ok(out.review.issues.some(issue=>issue.fieldId===field.id&&['VALUE_INVALID','TYPE_OR_CONSTRAINT'].includes(issue.code)));
});

test('certificate number choices and explicit manual blank remain validation facts, never file applicability defaults',async()=>{
  const source=snapshot(),f=resolved(source,{'합성 인증 A':''}),out=await f.project(),first=certFields(f.value.schema.fields)[0];
  assert.equal(f.value.rows[0].fields[first.id].value,'');assert.equal(f.value.rows[0].fields[first.id].source,'manual-common');
  assert.equal(out.review.documentShapeComplete,false);assert.ok(out.review.issues.some(issue=>issue.fieldId===first.id&&issue.code==='TYPE_OR_CONSTRAINT'));
  assert.deepEqual(plain(out.payload.jsonDocument[0].legalPage.certificates[0]),{certificateName:'합성 인증 A'});
});
