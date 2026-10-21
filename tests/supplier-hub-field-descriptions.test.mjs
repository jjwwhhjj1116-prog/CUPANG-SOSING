import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const h=mobileIntakeHarness(),model=h.load('app/supplier-hub-schema.ts'),quotes=h.load('app/quotation-schema.ts');
test.after(()=>h.close());
const plain=value=>JSON.parse(JSON.stringify(value));
const change=(snapshot,edit)=>{const raw=JSON.parse(snapshot.schemaString);edit(raw);return {...snapshot,schemaString:JSON.stringify(raw)};};
const withoutHelp=fields=>plain(fields).map(field=>{delete field.help;return field;});

for(const company of schemaCompanies){
 test(`category fields retain their own scalar descriptions without changing values or wires (${company.code})`,()=>{
  const original=hubSchemaSnapshot(company),before=JSON.stringify(original),baseline=quotes.getQuotationSchema(original.categoryId,schemaPath,original);
  const titleHelp='옵션명을 제외한 상품명을 입력하세요.\n특수문자는 사용할 수 없습니다.';
  const priceHelp='부가세를 포함한 공급 가격을 원 단위로 입력하세요.';
  const described=change(original,raw=>{
   raw.properties.startPage.properties.productName.description=titleHelp;
   raw.properties.productPage.properties.price.properties.supplyPrice.description=priceHelp;
   raw.properties.productPage.description='페이지 설명은 각 항목의 설명이 아닙니다.';
  });
  const actual=quotes.getQuotationSchema(described.categoryId,schemaPath,described);
  assert.equal(actual.fields.find(field=>field.id==='title').help,titleHelp);
  assert.equal(actual.fields.find(field=>field.id==='supplyPrice').help,priceHelp);
  assert.deepEqual(withoutHelp(actual.fields),withoutHelp(baseline.fields));
  assert.deepEqual(plain(actual.unsupportedFields),plain(baseline.unsupportedFields));
  assert.equal(actual.status,baseline.status);assert.equal(actual.submissionReady,false);
  assert.equal(JSON.stringify(original),before);
 });

 test(`named array value descriptions stay attached to the exact attribute or notice (${company.code})`,()=>{
  const original=hubSchemaSnapshot(company),baseline=model.compileHubQuotationSchema(original);
  const described=change(original,raw=>{
   const attribute=raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[1].contains;
   attribute.description='별도 객체 설명';attribute.properties.name.description='이름 항목 설명';
   attribute.properties.value.description='자외선 차단 여부를 선택하세요.';
   const notice=raw.properties.legalPage.properties.notices.allOf[1].contains;
   notice.properties.value.description='렌즈에 맞는 세척 방법을 입력하세요.';
   notice.properties={value:notice.properties.value,name:notice.properties.name};
  });
  const actual=model.compileHubQuotationSchema(described);
  assert.equal(actual.fields.find(field=>field.hubWire.name==='렌즈 유형').help,'자외선 차단 여부를 선택하세요.');
  assert.equal(actual.fields.find(field=>field.hubWire.name==='렌즈 관리방법').help,'렌즈에 맞는 세척 방법을 입력하세요.');
  assert.equal(actual.fields.find(field=>field.hubWire.name==='색상').help,undefined);
  assert.deepEqual(withoutHelp(actual.fields),withoutHelp(baseline.fields));
  assert.deepEqual(plain(actual.unsupported),plain(baseline.unsupported));
 });

 test(`absent or non-string descriptions do not introduce generic prompts or affect saved overrides (${company.code})`,()=>{
  const original=hubSchemaSnapshot(company),baseline=model.compileHubQuotationSchema(original);
  for(const description of [undefined,'','   ',null,42,{text:'객체는 설명이 아닙니다.'}]){
   const described=change(original,raw=>{raw.properties.productPage.properties.basicAttributes.properties.brand.description=description;});
   const actual=model.compileHubQuotationSchema(described);
   assert.equal(actual.fields.find(field=>field.label==='브랜드').help,undefined);
   assert.deepEqual(plain(actual),plain(baseline));
  }
  const schema=quotes.getQuotationSchema(original.categoryId,schemaPath,original);
  const field=schema.fields.find(field=>field.id==='brand');
  const saved=quotes.applyQuotationChanges(quotes.emptyQuotationOverrides(),[{fieldKey:field.id,optionId:null,value:'기존 수동 브랜드'},{fieldKey:'model',optionId:'SKU',value:''}]);
  const copy=JSON.stringify(saved),described=change(original,raw=>{raw.properties.productPage.properties.basicAttributes.properties.brand.description='브랜드를 확인하세요.';});
  const next=quotes.getQuotationSchema(described.categoryId,schemaPath,described);
  assert.equal(next.fields.find(item=>item.id===field.id).help,'브랜드를 확인하세요.');
  assert.equal(JSON.stringify(saved),copy);assert.equal(saved.common.brand,'기존 수동 브랜드');assert.equal(saved.options.SKU.model,'');
 });
}

test('description text remains literal including markup and multiline content',()=>{
 const literal='<img src=x onerror="alert(1)">\n<a href="https://example.test">표시 설명</a> & 확인';
 const snapshot=change(hubSchemaSnapshot(),raw=>{raw.properties.startPage.properties.productName.description=literal;});
 const field=model.compileHubQuotationSchema(snapshot).fields.find(item=>item.label==='상품명');
 assert.equal(field.help,literal);assert.equal(field.schemaDefault,undefined);assert.equal(field.draftDefault,undefined);
});

for(const company of schemaCompanies)test(`attribute example tooltips follow original lookup order without supplying a product fact (${company.code})`,()=>{
 const original=hubSchemaSnapshot(company);
 const attribute=raw=>raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[0].contains.properties.value;
 const values=[
  [{example:'최우선 예시',examples:['배열 예시'],default:'기본 예시',enum:['허용값']},'최우선 예시'],
  [{example:'',examples:['배열 첫 예시','다음 예시'],default:'기본 예시'},'배열 첫 예시'],
  [{example:0,examples:[false,'사용하지 않을 두 번째 예시'],default:'기본 예시'},'기본 예시'],
  [{examples:[],enum:['허용 예시']},'허용 예시'],
  [{example:12.5},'12.5'],[{example:true},'true'],[{example:{text:'객체'}},undefined],
  [{examples:[null,'사용하지 않을 두 번째 예시']},undefined],
 ];
 for(const [annotations,expected]of values){
  const described=change(original,raw=>Object.assign(attribute(raw),annotations));
  const before=JSON.stringify(described),field=model.compileHubQuotationSchema(described).fields.find(item=>item.hubWire.name==='색상');
  assert.equal(field.example,expected);assert.equal(field.draftDefault,'해당사항없음');
  assert.equal(field.schemaDefault,annotations.default);assert.equal(JSON.stringify(described),before);
 }
 const scalar=change(original,raw=>{
  raw.properties.startPage.properties.productName.example='상품명 예시는 도구팁 대상이 아님';
  raw.properties.legalPage.properties.notices.allOf[0].contains.properties.value.example='고시 항목은 속성 도구팁 대상이 아님';
 });
 const fields=model.compileHubQuotationSchema(scalar).fields;
 assert.equal(fields.find(field=>field.label==='상품명').example,undefined);
 assert.equal(fields.find(field=>field.hubWire.name==='품명 및 모델명').example,undefined);
});
