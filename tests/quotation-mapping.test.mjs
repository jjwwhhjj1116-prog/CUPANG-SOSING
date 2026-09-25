import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, require(name) {
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    throw Error(name);
  } });
  cache.set(file, exports); return exports;
}
const { suggestQuotationMappings: suggest } = load('app/quotation-mapping.ts');
const plain = value => JSON.parse(JSON.stringify(value));

test('saved category mappings cannot silently export attributes absent from the selected schema', () => {
  const profiles = load('app/category-profiles.ts');
  const getSchema = load('app/quotation-schema.ts').getQuotationSchema;
  const profile = { name: '분류 변경', categoryId: '80719', categoryPath: ['주방용품'],
    template: { name: 'test.csv', format: 'csv', sha256: 'a'.repeat(64), sheetName: '', headerRow: 1, headers: ['뚜껑', '원본 URL', '고정값'] },
    mappings: [{column:0,field:'lidIncluded',required:false}, {column:1,field:'sourceUrl',required:false}, {column:2,field:'constant',constant:'보존',required:false}] };
  const snapshot = JSON.stringify(profile);
  assert.doesNotThrow(() => profiles.validateQuotationChoiceFormats(profile, getSchema('80719').fields));
  const changed = {...profile, categoryId:'77442'};
  for (const choiceFormat of [undefined, 'value', 'label']) {
    const next = {...changed, mappings: changed.mappings.map((m,i) => i ? m : {...m,choiceFormat})};
    assert.throws(() => profiles.validateQuotationChoiceFormats(next,getSchema('77442').fields), /1열.*현재 카테고리/);
    assert.throws(() => profiles.mapQuotationRow(next,{lidIncluded:'기존값'},getSchema('77442').fields), /1열.*현재 카테고리/);
  }
  const corrected = {...changed, mappings:changed.mappings.slice(1)};
  assert.deepEqual(plain(profiles.mapQuotationRow(corrected,{sourceUrl:'https://detail.1688.com/offer/813724060928.html'},getSchema('77442').fields).values), ['', 'https://detail.1688.com/offer/813724060928.html','보존']);
  assert.equal(JSON.stringify(profile),snapshot);
});

test('brace-only columns map and export while duplicate color labels require manual selection', () => {
  const headers = ['사용부위', '착용방향', 'KC 인증정보', '색상'];
  const result = suggest(headers, '81452');
  assert.deepEqual(plain(result.mappings.map(item => item.field)), ['brace_bodyPart', 'brace_direction', 'brace_noticeKc']);
  assert.deepEqual(plain(result.ambiguousColumns), [3]);
  const profiles = load('app/category-profiles.ts');
  const profile = { name: '보호대', categoryId: '81452', categoryPath: ['스포츠/레져', '헬스/요가', '헬스기구/용품', '헬스보호대'], template: { name: 'test.csv', format: 'csv', sha256: 'a'.repeat(64), sheetName: '', headerRow: 1, headers }, mappings: result.mappings };
  assert.deepEqual(plain(profiles.mapQuotationRow(profile, { brace_bodyPart: '허리', brace_direction: '좌우겸용', brace_noticeKc: '' }).values), ['허리', '좌우겸용', '', '']);
  assert.throws(() => profiles.validateCategoryProfile({ ...profile, categoryId: '80719' }), /다른 카테고리/);
});

test('category changes refresh only session automatic mappings and preserve manual disconnections', () => {
  const { refreshCategoryMappings: refresh } = load('app/quotation-mapping.ts');
  const headers = ['상품명', '뚜껑 포함여부', '공급가', '판매가'];
  const automatic = suggest(headers, '80719').mappings;
  const original = plain(automatic);
  const manual = { column: 2, field: 'constant', required: true, constant: '직접 입력' };
  const current = [...automatic.filter(item => item.column < 2), manual];
  const changed = refresh(headers, '77442', current, automatic, new Set([2, 3]));
  assert.deepEqual(plain(changed.mappings.map(item => item.column)), [0, 2]);
  assert.deepEqual(plain(changed.mappings[1]), manual);
  const restored = refresh(headers, '80719', changed.mappings, changed.automatic, new Set([2, 3]));
  assert.deepEqual(plain(restored.mappings.map(item => item.field)), ['title', 'lidIncluded', 'constant']);
  assert.deepEqual(plain(automatic), original);
});

test('saved mappings and edited required flags are never inferred to be automatic', () => {
  const { refreshCategoryMappings: refresh } = load('app/quotation-mapping.ts');
  const headers = ['뚜껑 포함여부', '상품명'];
  const saved = suggest(headers, '80719').mappings;
  assert.deepEqual(plain(refresh(headers, '77442', saved, [], new Set()).mappings), plain(saved));
  const edited = saved.map(item => ({ ...item, required: !item.required }));
  assert.deepEqual(plain(refresh(headers, '77442', edited, saved, new Set()).mappings), plain(edited));
  const unknown = refresh(headers, '', saved, saved, new Set());
  assert.equal(unknown.mappings.some(item => item.field === 'lidIncluded'), false);
});

test('a category-specific dropdown maps and exports only for the selected category', () => {
  const schema = load('app/quotation-schema.ts').getQuotationSchema('80714');
  const field = schema.fields.find(field => field.visibility === 'hidden' && field.type === 'select');
  const result = suggest([field.label, '색상', '수량', '사이즈'], '80714');
  assert.deepEqual(plain(result.mappings.map(item => item.field)), [field.id, 'color', 'quantity']);
  assert.deepEqual(plain(result.unmatchedColumns), [3]);
  const profiles = load('app/category-profiles.ts');
  const draft = {name: '홀더', categoryId: '80714', categoryPath: schema.categoryPath, template: {name: 'test.csv', format: 'csv', sha256: 'a'.repeat(64), sheetName: '', headerRow: 1, headers: [field.label]}, mappings: [result.mappings[0]]};
  const value = field.choices.find(choice => choice.value).value;
  assert.equal(profiles.mapQuotationRow(draft, {[field.id]: value}).values[0], value);
  assert.throws(() => profiles.validateCategoryProfile({...draft, categoryId: '80715'}), /다른 카테고리/);
  assert.deepEqual(plain(suggest([field.label], 'unknown').mappings), []);
});

test('maps exact category fields, formatting marks and known aliases to editable column drafts', () => {
  const result = suggest(['상품명 *', '쿠팡 판매가', '뚜껑 포함여부', '수량', '박스 내 SKU 수량', '수입 및 판매원'], '80719');
  assert.deepEqual(plain(result.mappings.map(item => item.field)), ['title', 'salePrice', 'lidIncluded', 'quantity', 'boxSkuQuantity', 'importer']);
  assert.equal(result.mappings[0].required, true);
  assert.equal(result.mappings[4].required, true);
  assert.deepEqual(plain(result.unmatchedColumns), []);
});

test('never copies basket attributes or legal notice fields into another category', () => {
  const result = suggest(['상품명', '바구니 형태', '수량', '품명 및 모델명', '재질'], 'unobserved');
  assert.deepEqual(plain(result.mappings.map(item => item.field)), ['title']);
  assert.deepEqual(plain(result.unmatchedColumns), [1, 2, 3, 4]);
});

test('ambiguous duplicate headers and unrecognized unit-bearing headers remain unassigned', () => {
  const result = suggest(['상품명', '상품명 *', '', '무게', '포장 무게 kg', '한 개 단품 포장 무게', '중량', '가로길이(mm)'], '80719');
  assert.deepEqual(plain(result.ambiguousColumns), [0, 1]);
  assert.deepEqual(plain(result.unmatchedColumns), [2, 3, 4, 7]);
  assert.deepEqual(plain(result.mappings.map(item => item.field)), ['packagedWeightG', 'weight']);
});

test('header suggestion skips cover sheets and requires a unique strong exact-label candidate',()=>{
 const {suggestQuotationHeader}=load('app/quotation-mapping.ts');
 const sheet=(name,rowNumber,values)=>({name,rows:[{rowNumber,values}]});
 const workbook={sheets:[sheet('안내',1,['견적서 작성 가이드']),sheet('상품',7,['상품명','공급가','판매가','브랜드'])],warnings:[]};
 const before=JSON.stringify(workbook);
 assert.deepEqual(plain(suggestQuotationHeader(workbook,'80719')),{sheetName:'상품',rowNumber:7,matchedFields:4});
 assert.equal(JSON.stringify(workbook),before);
 assert.equal(suggestQuotationHeader({...workbook,sheets:[...workbook.sheets,sheet('다른 분류',9,['상품명','공급가','판매가','브랜드'])]},'80719'),null);
 for(const headers of [['상품명','공급가'],['상품명','공급가','상품명','판매가'],['상품명 안내','공급가','판매가'],['브랜드','제조사','판매가']])assert.equal(suggestQuotationHeader({sheets:[sheet('모호',1,headers)],warnings:[]},'80719'),null);
});

test('header relocation preserves manual values and disconnections by unique label, never by position', () => {
  const { relocateQuotationMappings: relocate, refreshCategoryMappings: refresh } = load('app/quotation-mapping.ts');
  const old = ['상품명', '공급가', '판매가', '뚜껑 포함여부', '기타', '기타', ''];
  const headers = ['판매가', '뚜껑 포함여부', '상품명 *', '공급가', '기타', ''];
  const mappings = [{column:0,field:'constant',required:true,constant:'보존'}, {column:1,field:'supplyPrice',required:false},
    {column:3,field:'lidIncluded',required:false}, {column:4,field:'constant',required:false,constant:'중복'}, {column:6,field:'constant',required:false,constant:'빈 이름'}];
  const automatic = [mappings[2]]; const snapshot = plain(mappings);
  const result = relocate(old,headers,'80719',mappings,automatic,new Set([0,2]));
  assert.deepEqual(plain(result.mappings), [{column:1,field:'lidIncluded',required:false},{column:2,field:'constant',required:true,constant:'보존'},{column:3,field:'supplyPrice',required:false}]);
  assert.deepEqual([...result.protectedColumns], [2,0]);
  assert.deepEqual(plain(result.lostColumns), [4,6]);
  const changed = refresh(headers,'77442',result.mappings,result.automatic,result.protectedColumns);
  assert.deepEqual(plain(changed.mappings.map(item=>item.field)), ['constant','supplyPrice']);
  assert.deepEqual(plain(mappings),snapshot);
  const duplicate = relocate(['공급가'],['공급가','공급가'],'80719',[{...mappings[1],column:0}],[],new Set());
  assert.equal(duplicate.mappings.length,0);
});

test('choice output format persists and explicit edits survive automatic mapping refresh',()=>{
 const profiles=load('app/category-profiles.ts');const schema=load('app/quotation-schema.ts').getQuotationSchema('80719');const field=schema.fields.find(f=>f.type==='select'&&f.visibility==='hidden');
 const auto=suggest([field.label],'80719').mappings;const mappings=auto.map(m=>({...m,choiceFormat:'label'}));
 const profile={name:'출력 형식',categoryId:'80719',categoryPath:['주방용품'],template:{name:'test.csv',format:'csv',sha256:'a'.repeat(64),sheetName:'',headerRow:1,headers:[field.label]},mappings};
 assert.equal(profiles.validateCategoryProfile(profile).mappings[0].choiceFormat,'label');
 const refreshed=load('app/quotation-mapping.ts').refreshCategoryMappings([field.label],'80719',mappings,auto,new Set());assert.equal(refreshed.mappings[0].choiceFormat,'label');
 assert.throws(()=>profiles.validateCategoryProfile({...profile,mappings:[{...mappings[0],choiceFormat:'other'}]}),/출력 형식/);
 assert.throws(()=>profiles.mapQuotationRow(profile,{[field.id]:'bad'},schema.fields),/선택 목록/);
 assert.throws(()=>profiles.mapQuotationRow(profile,{}),/선택형/);
 assert.equal(profiles.mapQuotationRow(profile,{[field.id]:''},schema.fields).values[0],'');
});

test('automatic Excel mappings retain required header markers without rewriting saved decisions',()=>{
 for(const header of ['재질 *','재질＊','* 재질','＊재질']){
  const result=suggest([header],'80719');assert.equal(result.mappings.length,1);assert.equal(result.mappings[0].field,'noticeMaterial');assert.equal(result.mappings[0].required,true);
 }
 assert.equal(suggest(['재질'],'80719').mappings[0].required,false);
 assert.equal(suggest(['상품명'],'80719').mappings[0].required,true);
 assert.equal(suggest(['알 수 없는 항목 *'],'80719').mappings.length,0);
 assert.equal(suggest(['재질','재질 *'],'80719').mappings.length,0);
 const {refreshCategoryMappings}=load('app/quotation-mapping.ts');
 const manual=[{column:0,field:'noticeMaterial',required:false}];const before=JSON.stringify(manual);
 assert.equal(refreshCategoryMappings(['재질 *'],'80719',manual,[],new Set()).mappings[0].required,false);
 assert.equal(refreshCategoryMappings(['재질 *'],'80719',manual,manual,new Set([0])).mappings[0].required,false);
 assert.equal(refreshCategoryMappings(['재질 *'],'80719',manual,manual,new Set()).mappings[0].required,true);
 assert.equal(JSON.stringify(manual),before);
});
