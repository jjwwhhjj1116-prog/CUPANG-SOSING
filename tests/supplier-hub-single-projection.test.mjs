import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { companies, syntheticSnapshot, projectionFixture, plain, module } from './helpers/supplier-hub-single-projection.mjs';
const project = module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
const exact = (result, path, name) => {
  let value = result.payload.jsonDocument[0]; for (const key of path) value = value[key];
  return name === undefined ? value : value.find(item => Object.values(item).includes(name));
};
for (const company of companies) test(`Single typed preview preserves final prices, primitive choices and manual blanks without writes (${company.code})`, async () => {
  const f = projectionFixture(syntheticSnapshot(company));
  f.set(['productPage', 'commonAttributes', 'count'], undefined, '0');
  f.set(['productPage', 'commonAttributes', 'booleanValue'], undefined, 'false');
  f.set(['productPage', 'commonAttributes', 'exposedAttributes'], '색상', '검정');
  f.set(['productPage', 'unexposedAttributes'], '문자 선택', 'false');
  f.set(['productPage', 'unexposedAttributes'], '수동 공란', '');
  f.set(['productPage', 'unexposedAttributes'], 'null 선택', '');
  f.set(['imagePage', 'msrpAgree'], undefined, 'true', 'schema');
  f.set(['imagePage', 'labelContactAgreed'], undefined, 'true', 'schema');
  const before = JSON.stringify(f.input), out = await project(f.input), document = out.payload.jsonDocument[0];
  assert.equal(out.payload.docId, null); assert.equal(out.payload.categoryId, 765432); assert.equal(out.payload.displayCategoryCode, '81452');
  assert.equal(out.payload.scope, 'Retail_Categorized_Single'); assert.equal(out.payload.version, 188); assert.equal(out.payload.productNoticeNumber, 25);
  assert.equal(document.startPage.productName, '검토 상품, 검정'); assert.equal(document.startPage.categoryPath, '스포츠/레져>헬스/요가>헬스기구/용품>헬스보호대 (81452)');
  assert.equal(document.productPage.modelNumber, ''); assert.equal(document.productPage.commonAttributes.purchasePrice, '11960');
  assert.equal(document.productPage.commonAttributes.coupangSalePrice, '19930'); assert.equal(document.productPage.commonAttributes.msrp, '25910');
  assert.equal(document.productPage.commonAttributes.count, 0); assert.equal(document.productPage.commonAttributes.booleanValue, false);
  assert.deepEqual(plain(document.productPage.unexposedAttributes), [{ attributeName: '문자 선택', attributeValue: 'false' }, { attributeName: '수동 공란', attributeValue: '' }, { attributeName: 'null 선택', attributeValue: null }]);
  assert.deepEqual(plain(document.sourcingPage), { sourcingChannelType: null, sourcingChannelId: null });
  assert.equal(document.imagePage.msrpAgree, true); assert.equal(out.humanAgreementsConfirmed, false);
  assert.ok(out.review.issues.some(issue => issue.code === 'AGREEMENT_UNCONFIRMED')); assert.equal(out.registered, false); assert.equal(out.remoteWrites, false); assert.equal(out.submissionReady, false);
  assert.equal(JSON.stringify(f.input), before);
});

test('named allOf order and explicit name/value keys survive false/zero/null values', async () => {
  const f = projectionFixture(); f.set(['productPage', 'unexposedAttributes'], '문자 선택', '0');
  const out = await project(f.input); assert.equal(exact(out, ['productPage', 'unexposedAttributes'], '문자 선택').attributeValue, '0');
  assert.deepEqual(plain(out.payload.jsonDocument[0].legalPage.notices).map(item => item.noticeItemName), ['품명 및 모델명', '소재']);
  assert.deepEqual(Object.keys(out.payload.jsonDocument[0].imagePage.images.labelImages[0]), ['labelImageType', 'labelImageFiles']);
});
test('private images are retained only in sidecar; no URL publication or opaque filename fallback', async () => {
  const f = projectionFixture(); const id = f.set(['imagePage', 'images', 'mainImage'], undefined, 'owner/private.png');
  f.set(['imagePage', 'images', 'labelImages'], '한글표시사항', 'owner/label.png');
  f.set(['imagePage', 'details', 'detailedImage'], undefined, 'owner/first.png\nowner/second.png');
  const out = await project(f.input); assert.ok(!Object.hasOwn(out.payload.jsonDocument[0].imagePage.images, 'mainImage'));
  assert.ok(!Object.hasOwn(out.payload.jsonDocument[0].imagePage.images.labelImages[0], 'labelImageFiles'));
  assert.equal(out.review.unresolvedImages.find(item => item.fieldId === id).savedValue, 'owner/private.png');
  assert.ok(!JSON.stringify(out.payload).includes('owner/')); assert.equal(out.review.documentShapeComplete, false);
  assert.equal(out.review.unresolvedImages.length, 3); assert.ok(out.review.issues.some(issue => issue.code === 'IMAGE_UNRESOLVED'));
});
test('manual title/HTML blanks and an excluded option stay blank/excluded; defaults never refill', async () => {
  const f = projectionFixture(); f.set(['startPage', 'productName'], undefined, ''); f.set(['imagePage', 'details', 'htmlProductDetailContent'], undefined, '');
  f.resolved.rows.push({ ...structuredClone(f.row), optionId: 'excluded', included: false });
  const out = await project(f.input); assert.equal(out.payload.productName, ''); assert.equal(out.payload.jsonDocument.length, 1);
  assert.equal(out.payload.jsonDocument[0].startPage.productName, ''); assert.equal(out.payload.jsonDocument[0].imagePage.details.htmlProductDetailContent, '');
  assert.ok(out.review.issues.some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
});
for (const change of ['company', 'excel-scope', 'kan', 'notice', 'version', 'display', 'metadata-missing', 'metadata-duplicate']) test(`Single source identity fails closed: ${change}`, async () => {
  const f = projectionFixture();
  if (change === 'company') f.input.company = companies[1];
  if (change === 'excel-scope') f.snapshot.metadata.scopeType = 'Retail_Categorized_Excel';
  if (change === 'kan') f.snapshot.metadata.kanCategoryId = 1234;
  if (change === 'notice') f.snapshot.metadata.noticeNumber = 99;
  if (change === 'version') f.snapshot.metadata.version = 187;
  if (change === 'display') f.snapshot.metadata.displayCategoryCode = '80719';
  if (change.startsWith('metadata')) { const raw = JSON.parse(f.snapshot.schemaString); if (change === 'metadata-missing') delete raw.metadata; else raw.metadata += ';version:188'; f.snapshot.schemaString = JSON.stringify(raw); }
  await assert.rejects(project(f.input), error => /^SINGLE_/.test(error.code));
});
test('unsupported validation keywords, duplicate wires and changed readonly category are rejected', async () => {
  const a = projectionFixture(); const raw = JSON.parse(a.snapshot.schemaString); raw.properties.productPage.properties.brand.pattern = '^SAFE$'; a.snapshot.schemaString = JSON.stringify(raw);
  await assert.rejects(project(a.input), error => error.code === 'SINGLE_UNSUPPORTED');
  const b = projectionFixture(); b.schema.fields.push({ ...b.schema.fields.find(field => field.hubWire) }); await assert.rejects(project(b.input), error => error.code === 'SINGLE_DUPLICATE_WIRE');
  const c = projectionFixture(); c.set(['startPage', 'categoryPath'], undefined, '다른 경로', 'manual-common'); await assert.rejects(project(c.input), error => error.code === 'SINGLE_READONLY_CATEGORY');
});
test('unknown named-array validation is not flattened into an apparently valid document', async () => {
  const f = projectionFixture(); const raw = JSON.parse(f.snapshot.schemaString); raw.properties.productPage.properties.unexposedAttributes.allOf[0].minContains = 2; f.snapshot.schemaString = JSON.stringify(raw);
  await assert.rejects(project(f.input), error => error.code === 'SINGLE_UNSUPPORTED');
});

for (const [name, dropdown, value, expected] of [['count', [0, 2], '2', 2], ['booleanValue', [false, true], 'false', false]])
  test(`undeclared dropdown preserves its exact primitive: ${name}`, async () => {
    const snapshot = syntheticSnapshot(), raw = JSON.parse(snapshot.schemaString);
    raw.properties.productPage.properties.commonAttributes.properties[name] = { title: '합성 선택 항목', dropdown };
    snapshot.schemaString = JSON.stringify(raw);
    const f = projectionFixture(snapshot); f.set(['productPage', 'commonAttributes', name], undefined, value);
    assert.deepEqual(plain(f.schema.unsupportedFields), []);
    const out = await project(f.input); assert.equal(out.payload.jsonDocument[0].productPage.commonAttributes[name], expected);
    assert.equal(typeof out.payload.jsonDocument[0].productPage.commonAttributes[name], typeof expected);
    assert.ok(!out.review.issues.some(issue => issue.path?.at(-1) === name && issue.code === 'TYPE_OR_CONSTRAINT'));
  });
test('undeclared dropdown null choice stays null and ambiguous mixed primitives remain blocked', async () => {
  const snapshot = syntheticSnapshot(), raw = JSON.parse(snapshot.schemaString);
  raw.properties.productPage.properties.commonAttributes.properties.booleanValue = { title: '합성 nullable 선택', dropdown: [null, false, true] };
  raw.properties.productPage.properties.commonAttributes.properties.count = { title: '합성 혼합 선택', dropdown: [0, '2'] };
  snapshot.schemaString = JSON.stringify(raw);
  const f = projectionFixture(snapshot); f.set(['productPage', 'commonAttributes', 'booleanValue'], undefined, '');
  f.set(['productPage', 'commonAttributes', 'count'], undefined, '2');
  const before = JSON.stringify(f.input), out = await project(f.input), attributes = out.payload.jsonDocument[0].productPage.commonAttributes;
  assert.equal(attributes.booleanValue, null); assert.ok(!Object.hasOwn(attributes, 'count'));
  assert.ok(out.review.issues.some(issue => issue.path?.at(-1) === 'count' && issue.code === 'TYPE_OR_CONSTRAINT'));
  assert.equal(out.review.documentShapeComplete, false); assert.equal(JSON.stringify(f.input), before);
});
test('advisory dropdown keeps declared string brand and productBarcode as free text', async () => {
  const snapshot = syntheticSnapshot(), raw = JSON.parse(snapshot.schemaString);
  raw.properties.productPage.properties.brand = { type: 'string', title: '브랜드', dropdown: ['추천 브랜드'] };
  raw.properties.productPage.properties.commonAttributes.properties.productBarcode = { type: 'string', title: '바코드', dropdown: ['123456', '654321'] };
  snapshot.schemaString = JSON.stringify(raw);
  const f = projectionFixture(snapshot); f.set(['productPage', 'brand'], undefined, '직접 검토한 브랜드');
  f.set(['productPage', 'commonAttributes', 'productBarcode'], undefined, 'AB-123456');
  const out = await project(f.input); assert.equal(out.payload.jsonDocument[0].productPage.brand, '직접 검토한 브랜드');
  assert.equal(out.payload.jsonDocument[0].productPage.commonAttributes.productBarcode, 'AB-123456');
  assert.ok(!out.review.issues.some(issue => ['brand', 'productBarcode'].includes(issue.path?.at(-1)) && issue.code === 'TYPE_OR_CONSTRAINT'));
});

const recorded = new URL('../outputs/step650-official-81452-profile-after.json', import.meta.url);
test('recorded Unand 81452 Single5562v188 restores all 68 exact wires and preserves original metadata (private optional artifact)', { skip: !fs.existsSync(recorded) }, async () => {
  const bytes = fs.readFileSync(recorded), before = createHash('sha256').update(bytes).digest('hex'), profile = JSON.parse(bytes);
  const f = projectionFixture(profile.hubSchema), wireFields = f.schema.fields.filter(field => field.hubWire);
  assert.equal(wireFields.length, 68); assert.deepEqual(plain(f.schema.unsupportedFields), []);
  const out = await project(f.input); assert.equal(out.payload.categoryId, 5562); assert.equal(out.payload.displayCategoryCode, '81452'); assert.equal(out.payload.version, 188); assert.equal(out.payload.productNoticeNumber, 25);
  assert.equal(out.payload.jsonDocument[0].productPage.commonAttributes.purchasePrice, '11960'); assert.equal(out.payload.jsonDocument[0].productPage.commonAttributes.coupangSalePrice, '19930');
  assert.equal(out.review.fields.filter(field => field.path.length).length, 68);
  assert.equal(out.payload.jsonDocument[0].productPage.commonAttributes.exposedAttributes.length, 3); assert.equal(out.payload.jsonDocument[0].productPage.unexposedAttributes.length, 10);
  assert.equal(out.payload.jsonDocument[0].legalPage.certificates.length, 3); assert.equal(out.payload.jsonDocument[0].legalPage.notices.length, 12);
  assert.equal(out.payload.jsonDocument[0].imagePage.images.labelImages[0].labelImageType, '제품 한글 표시사항 라벨 또는 도안 이미지');
  assert.equal(createHash('sha256').update(fs.readFileSync(recorded)).digest('hex'), before);
  assert.equal(out.registered, false); assert.equal(out.remoteWrites, false); assert.equal(out.submissionReady, false);
});

// The native policy excludes this exact optional wire even when its local
// automatic value is empty. These synthetic inputs contain no customer data.
const nativePolicy = module('app/supplier-hub-native-form-projection.ts').NATIVE_FORM_SERIALIZATION_POLICY;
const scalar=(type='string',example='')=>({type,examples:[example]});
function nativeOsrpFixture(mode='optional'){
 const snapshot=syntheticSnapshot(),raw=JSON.parse(snapshot.schemaString);
 const fill=node=>{if(node.properties){node.required=Object.keys(node.properties);Object.values(node.properties).forEach(fill);}else if(node.allOf){node.allOf.forEach(entry=>fill(entry.contains));const [nameKey,valueKey]=Object.keys(node.allOf[0].contains.properties);node.examples=[node.allOf.map(entry=>({[nameKey]:entry.contains.properties[nameKey].enum[0],[valueKey]:''}))];}else if(!node.enum)node.examples=[Object.hasOwn(node,'default')?node.default:node.type==='integer'?7:node.type==='boolean'?false:''];};
 fill(raw);const group=raw.properties.productPage.properties.commonAttributes;group.properties.osrp=scalar(['string','null']);
 if(mode==='required')group.required.push('osrp');
 if(mode==='osrp-only'){delete group.properties.msrp;group.required=group.required.filter(key=>key!=='msrp');}
 raw.properties.legalPage.properties.productNoticeName={...scalar(),prefilled:true,minLength:1};raw.properties.imagePage.properties.images.properties.sizeChartImage=scalar(['string','null']);raw.properties.imagePage.properties.images.properties.labelImages.allOf[0].contains.properties.labelImageType.enum=['제품 한글 표시사항 라벨 또는 도안 이미지'];raw.properties.imagePage.properties.images.properties.labelImages.examples[0][0].labelImageType='제품 한글 표시사항 라벨 또는 도안 이미지';if(mode==='unbound')delete snapshot.inputBindings;
 if(mode==='nonnumeric')group.properties.osrp={type:'boolean'};
 if(mode==='schema-default')group.properties.osrp.default='41000';
 if(mode==='unrelated')group.properties.otherOptional=scalar(['string','null']);
 snapshot.schemaString=JSON.stringify(raw);
 let f;
 if(mode!=='osrp-only')f=projectionFixture(snapshot);
 else{
  const schema=module('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,snapshot),fields=Object.fromEntries(schema.fields.map(field=>[field.id,{value:'',source:'empty',needsReview:true,issues:[],validationIssues:[]}])),row={optionId:'synthetic-one',optionLabel:'검정',included:true,fields},resolved={schema,rows:[row],issues:[],reviewMessages:[],validationIssues:[]};
  const set=(wirePath,name,value,source='manual-option')=>{const field=schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(wirePath)&&field.hubWire?.name===name);if(!field)throw Error('Absent synthetic field');fields[field.id]={value,source,needsReview:true,issues:[],validationIssues:[]};};
  f={schema,row,resolved,set,input:{snapshot,company:snapshot.company,categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,resolved}};
  set(['startPage','productName'],undefined,'검토 상품, 검정');set(['startPage','categoryPath'],undefined,snapshot.categoryPath.join(' > ')+' ('+snapshot.categoryId+')','schema');set(['productPage','brand'],undefined,'합성 브랜드');set(['productPage','commonAttributes','purchasePrice'],undefined,'11960');set(['productPage','commonAttributes','coupangSalePrice'],undefined,'19930');
 }
 for(const field of f.schema.fields){const wire=field.hubWire;if(!wire?.name)continue;const choice=field.choices?.find(choice=>choice.value!=='');f.set(wire.path,wire.name,choice?.value??'saved named value');}
 for(const [key,value]of [['count','7'],['booleanValue','true']])f.set(['productPage','commonAttributes',key],undefined,value);
 f.set(['logisticsPage','totalSKUsInBox'],undefined,'50');f.set(['legalPage','productNoticeName'],undefined,'saved notice');f.set(['imagePage','msrpAgree'],undefined,'false');f.set(['imagePage','labelContactAgreed'],undefined,'false');f.set(['productPage','unexposedAttributes'],'수동 공란','','couplus-default');
 return f;
}

const osrpPath = ['productPage','commonAttributes','osrp'];
const omittedOsrp = out => out.review.issues.filter(issue => issue.code === 'NATIVE_FORM_FIELD_OMITTED' && issue.path?.join('.') === osrpPath.join('.'));
async function nativeOsrp(value, source, mode='optional', marked=true) {
  const f=nativeOsrpFixture(mode); f.set(osrpPath, undefined, value, source);
  const input={...f.input,...(marked?{nativeSerializationPolicy:nativePolicy}:{})},before=JSON.stringify(input);
  const out=await project(input);assert.equal(JSON.stringify(input),before);
  return {out,f,field:out.review.fields.find(field=>field.path.join('.')===osrpPath.join('.'))};
}
test('native independent OSRP warning preserves populated issue order and body with an absent automatic value',async()=>{
  const populated=await nativeOsrp('39930','pricing'),absent=await nativeOsrp('','empty');
  assert.equal(omittedOsrp(populated.out).length,1);
  assert.equal(omittedOsrp(absent.out).length,1);
  assert.deepEqual(plain(absent.out.payload),plain(populated.out.payload));
  assert.deepEqual(plain(absent.out.review.issues),plain(populated.out.review.issues));
  assert.equal(absent.field.source,'empty');assert.equal(absent.field.savedValue,'');assert.equal(absent.field.projected,false);
  assert.ok(!Object.hasOwn(absent.out.payload.jsonDocument[0].productPage.commonAttributes,'osrp'));
});
for(const [source,value,mode] of [['manual-option','','optional'],['manual-common','','optional'],['manual-option','43000','optional'],['schema','41000','schema-default'],['schema','','optional'],['couplus-default','41000','optional']])
 test(`native independent OSRP warning preserves explicit ${source}/${value||'blank'}/${mode}`,async()=>{
  const {out,field}=await nativeOsrp(value,source,mode);
  assert.equal(omittedOsrp(out).length,1);assert.equal(field.savedValue,value);assert.equal(field.source,source);assert.equal(field.projected,false);
  assert.ok(!Object.hasOwn(out.payload.jsonDocument[0].productPage.commonAttributes,'osrp'));
 });
for(const mode of ['required','osrp-only','unbound'])
 test(`native independent OSRP warning excludes ${mode} classification`,async()=>{
  const {out,f}=await nativeOsrp('','empty',mode);
  assert.equal(module('app/quotation-price-targets.ts').quotationIndependentOptionalOsrp(f.schema.fields),undefined);
  assert.equal(omittedOsrp(out).length,0);
 });
test('native independent OSRP warning does not apply without native policy or to unrelated absent optional values',async()=>{
 const legacy=await nativeOsrp('','empty','optional',false);assert.equal(omittedOsrp(legacy.out).length,0);assert.equal(legacy.out.nativeSerializationPolicy,undefined);
 const {out}=await nativeOsrp('','empty','unrelated');assert.equal(omittedOsrp(out).length,1);
 assert.equal(out.review.issues.filter(issue=>issue.code==='NATIVE_FORM_FIELD_OMITTED'&&issue.path?.at(-1)==='otherOptional').length,0);
});
test('native independent OSRP warning never masks an ambiguous duplicate wire',async()=>{
 const f=nativeOsrpFixture();f.schema.fields.push({...f.schema.fields.find(field=>field.hubWire?.path.join('.')===osrpPath.join('.'))});
 assert.equal(module('app/quotation-price-targets.ts').quotationIndependentOptionalOsrp(f.schema.fields),undefined);
 await assert.rejects(project({...f.input,nativeSerializationPolicy:nativePolicy}),error=>error.code==='SINGLE_DUPLICATE_WIRE');
});

test('native independent OSRP warning keeps unsupported raw types blocked and shared classifier excludes readonly/ambiguous bindings',async()=>{
 const f=nativeOsrpFixture('nonnumeric');await assert.rejects(project({...f.input,nativeSerializationPolicy:nativePolicy}),error=>error.code==='SINGLE_UNSUPPORTED');
 const classify=module('app/quotation-price-targets.ts').quotationIndependentOptionalOsrp;
 for(const change of ['readonly','nonnumeric','binding']){
  const fields=plain(nativeOsrpFixture().schema.fields),field=fields.find(field=>field.hubWire?.path.join('.')===osrpPath.join('.'));
  if(change==='readonly')field.readOnly=true;
  if(change==='nonnumeric'){field.numericText=false;field.type='boolean';}
  if(change==='binding')field.hubInput='salePrice';
  assert.equal(classify(fields),undefined);
 }
});
