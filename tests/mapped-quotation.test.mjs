import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const moduleCache = new Map();
function load(file) {
  if(moduleCache.has(file))return moduleCache.get(file);
  const output = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, structuredClone, Response, Blob, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, crypto, require: name => {
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file),name)+'.ts');
    throw Error(name);
  } });
  moduleCache.set(file,exports);return exports;
}
const reader = load('app/xlsx-template.ts');
const { createMappedQuotation } = load('app/exports/mapped-quotation.ts');
const encode = value => new TextEncoder().encode(value);
const decode = value => new TextDecoder().decode(value);
async function hash(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join(''); }
function zip(entries) {
  const pieces = [], directory = []; let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name); const bytes = Buffer.from(text); let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    pieces.push(local, nameBytes, bytes); directory.push(central, nameBytes); offset += local.length + nameBytes.length + bytes.length;
  }
  const catalog = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(catalog.length, 12); end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...pieces, catalog, end]); return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}
function entries(sheetChanges = value => value) {
  return [
    ['[Content_Types].xml', '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<workbook xmlns:r="relationship"><sheets><sheet name="견적서" r:id="one"/><sheet name="참고" r:id="two"/></sheets><calcPr calcMode="auto"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="two" Type="x/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="shared" Type="x/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst><si><t>상품명</t></si></sst>'],
    ['xl/styles.xml', '<styleSheet><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="49"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheetChanges('<?xml version="1.0"?><worksheet><dimension ref="A1:F10"/><sheetFormatPr defaultRowHeight="15"/><sheetData>\n<row r="1"><c r="A1" t="inlineStr"><is><t>원본 안내 유지</t></is></c></row>\n<row r="3"><c r="A3" t="s"><v>0</v></c><c r="C3" t="inlineStr"><is><t>공급가</t></is></c><c r="D3" t="inlineStr"><is><t>옵션</t></is></c><c r="E3" t="inlineStr"><is><t>브랜드</t></is></c></row>\n<row r="5" ht="30" customHeight="1"><c r="A5" s="2" t="inlineStr"><is><t>예시</t></is></c><c r="B5" s="1"><f>C5*2</f><v>246</v></c><c r="C5" s="1"><v>123</v></c><c r="D5" s="2"/><c r="F5" t="inlineStr"><is><t>이 열은 변경 금지</t></is></c></row>\n<row r="7"><c r="A7" t="inlineStr"><is><t>아래 원본 행</t></is></c></row>\n<row r="10" s="1" customFormat="1"/>\n</sheetData><dataValidations count="1"><dataValidation type="list" sqref="D5:D10"><formula1>"검정,흰색"</formula1></dataValidation></dataValidations><pageMargins left="1" right="1" top="1" bottom="1" header="1" footer="1"/></worksheet>')],
    ['xl/worksheets/sheet2.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>참고 자료 원본</t></is></c><c r="B1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'],
    ['xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Id="link" Type="x/hyperlink" Target="https://example.invalid/guide" TargetMode="External"/></Relationships>'],
  ];
}
async function inputFrom(files = entries(), updates = {}) {
  const originalBytes = zip(files);
  return {
    originalBytes,
    profile: { name: '테스트', categoryId: 'synthetic', categoryPath: ['테스트'], template: { name: '테스트-원본.xlsx', format: 'xlsx', sha256: await hash(originalBytes), sheetName: '견적서', headerRow: 3, headers: ['상품명', '', '공급가', '옵션', '브랜드'] }, mappings: [{ column: 0, field: 'title', required: true }, { column: 2, field: 'supplyPrice', required: true }, { column: 3, field: 'skuName', required: true }, { column: 4, field: 'brand', required: false }] },
    rows: [{ title: '테스트 상품 & <안전>', supplyPrice: 12500, skuName: '검정', brand: '브랜드' }, { title: '=HYPERLINK("test")', supplyPrice: 13000, skuName: '흰색', brand: '' }], dataStartRow: 5, ...updates,
  };
}

test('mapped XLSX changes only selected cells while preserving other parts, styles, row formatting and unmapped formulas', async () => {
  const input = await inputFrom(); const result = await createMappedQuotation(input);
  const originals = await reader.readXlsxArchive(input.originalBytes); const generated = await reader.readXlsxArchive(result.bytes.buffer);
  for (const [path, bytes] of originals) if (path !== 'xl/worksheets/sheet1.xml') assert.deepEqual(Buffer.from(generated.get(path)), Buffer.from(bytes), path);
  const sheet = decode(generated.get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /<row r="5" ht="30" customHeight="1">/);
  assert.match(sheet, /<c r="A5" s="2" t="inlineStr"><is><t xml:space="preserve">테스트 상품 &amp; &lt;안전&gt;<\/t>/);
  assert.ok(sheet.includes('<c r="B5" s="1"><f>C5*2</f><v>246</v></c>'));
  assert.ok(sheet.includes('<c r="C5" s="1"><v>12500</v></c>'));
  assert.ok(sheet.includes('<c r="F5" t="inlineStr"><is><t>이 열은 변경 금지</t></is></c>'));
  assert.ok(sheet.indexOf('<row r="6">') < sheet.indexOf('<row r="7">'));
  assert.ok(sheet.includes('<c r="A6" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK("test")</t>'));
  assert.ok(sheet.includes('<dataValidation type="list" sqref="D5:D10"><formula1>"검정,흰색"</formula1></dataValidation>'));
  assert.equal(result.report.verification, 'draft'); assert.equal(result.report.missingRequired.length, 0); assert.equal(result.report.blankCells.length, 1);
  assert.equal(result.filename, '테스트-원본-검토용.xlsx'); assert.ok(result.bytes.length < 10_000_000);
  const inspection = reader.inspectXlsxArchive(generated); assert.deepEqual(Array.from(reader.xlsxHeaders(inspection, '견적서', 5)), ['테스트 상품 & <안전>', '', '12500', '검정', '브랜드', '이 열은 변경 금지']);
});

test('mapped XLSX expands sparse/new/self-closing rows and dimension without replacing adjacent original rows', async () => {
  const input = await inputFrom(entries(), { dataStartRow: 10, rows: [{ title: '행10', supplyPrice: 0, skuName: '' }, { title: '행11', supplyPrice: 15, skuName: '새 옵션' }] });
  const result = await createMappedQuotation(input); const archive = await reader.readXlsxArchive(result.bytes.buffer); const sheet = decode(archive.get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /<dimension ref="A1:F11"\/>/);
  assert.match(sheet, /<row r="10" s="1" customFormat="1"><c r="A10"/);
  assert.match(sheet, /<row r="11"><c r="A11"/);
  assert.deepEqual(JSON.parse(JSON.stringify(result.report.missingRequired)), [{ row: 10, column: 4, header: '옵션' }]);
  assert.ok(sheet.includes('<v>0</v>')); assert.ok(sheet.includes('아래 원본 행'));
});

test('mapped XLSX inserts new rows immediately before rewritten rows and preserves namespace prefixes', async () => {
  const files = entries(value => value.replace(/<(\/?)(worksheet|dimension|sheetFormatPr|sheetData|row|c|v|is|t|f|dataValidations|dataValidation|formula1|pageMargins)(?=[\s/>])/g, '<$1s:$2').replace('<s:worksheet>', '<s:worksheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'));
  const input = await inputFrom(files, { dataStartRow: 4, rows: [{ title: '앞 행', supplyPrice: 100, skuName: '앞' }, { title: '뒤 행', supplyPrice: 200, skuName: '뒤' }] });
  const result = await createMappedQuotation(input); const archive = await reader.readXlsxArchive(result.bytes.buffer); const sheet = decode(archive.get('xl/worksheets/sheet1.xml'));
  assert.ok(sheet.indexOf('<s:row r="4">') < sheet.indexOf('<s:row r="5"'));
  assert.ok(sheet.includes('<s:c r="A4" t="inlineStr"><s:is><s:t xml:space="preserve">앞 행</s:t></s:is></s:c>'));
  assert.ok(sheet.includes('<s:c r="B5" s="1"><s:f>C5*2</s:f><s:v>246</s:v></s:c>'));
});

test('mapped XLSX refuses formula cells, array/shared formula ranges and merged-cell collisions', async () => {
  const formula = await inputFrom(); formula.profile.mappings.push({ column: 1, field: 'brand', required: false });
  await assert.rejects(createMappedQuotation(formula), /수식/);
  const merged = await inputFrom(entries(value => value.replace('<pageMargins', '<mergeCells><mergeCell ref="D5:E6"/></mergeCells><pageMargins')));
  await assert.rejects(createMappedQuotation(merged), /병합/);
  const array = await inputFrom(entries(value => value.replace('<f>C5*2</f>', '<f t="array" ref="B5:D8">C5*2</f>')));
  await assert.rejects(createMappedQuotation(array), /수식/);
});

test('mapped export rejects hash/header mismatch, illegal bounds, invalid XML text and macros', async () => {
  const input = await inputFrom();
  for (const update of [{ dataStartRow: 3 }, { dataStartRow: 1048576 }, { rows: [] }, { rows: Array(201).fill(input.rows[0]) }, { rows: [{ ...input.rows[0], title: '\u0000bad' }] }, { rows: [{ ...input.rows[0], title: 'x'.repeat(32768) }] }, { rows: [{ ...input.rows[0], supplyPrice: Infinity }] }]) await assert.rejects(createMappedQuotation({ ...input, ...update }));
  await assert.rejects(createMappedQuotation({ ...input, profile: { ...input.profile, template: { ...input.profile.template, sha256: '0'.repeat(64) } } }), /지문/);
  await assert.rejects(createMappedQuotation({ ...input, profile: { ...input.profile, template: { ...input.profile.template, headers: ['틀림', '', '공급가', '옵션', '브랜드'] } } }), /머리글/);
  await assert.rejects(createMappedQuotation(await inputFrom([...entries(), ['xl/vbaProject.bin', 'synthetic macro']])), /매크로/);
});

test('CSV and TSV exports follow mapped column order, explicit row positions and formula-safe quoting', async () => {
  for (const format of ['csv', 'tsv']) {
    const separator = format === 'csv' ? ',' : '\t'; const originalBytes = encode(`원본 안내\n상품명${separator}공급가${separator}옵션\n`).buffer;
    const profile = { name: '텍스트 양식', categoryId: '', categoryPath: ['테스트'], template: { name: `원본.${format}`, format, sha256: await hash(originalBytes), sheetName: '', headerRow: 2, headers: ['상품명', '공급가', '옵션'] }, mappings: [{ column: 0, field: 'title', required: true }, { column: 1, field: 'supplyPrice', required: true }, { column: 2, field: 'skuName', required: true }] };
    const result = await createMappedQuotation({ originalBytes, profile, dataStartRow: 4, rows: [{ title: '=SUM(1,2)', supplyPrice: 0, skuName: '옵션 "검정"' }, { title: '', supplyPrice: 100, skuName: '흰색' }] });
    const text = decode(result.bytes);
    assert.ok(text.includes(`"상품명"${separator}"공급가"${separator}"옵션"`));
    assert.ok(text.includes(`"'=SUM(1,2)"${separator}"0"${separator}"옵션 ""검정"""`));
    assert.equal(text.split('\r\n')[2], '');
    assert.equal(result.values[0][0],"'=SUM(1,2)");assert.equal(result.values[0][1],0);
    assert.equal(result.values[0][2],'옵션 "검정"');
    assert.ok(result.report.warnings.some(message=>message.includes('1개 셀에 작은따옴표')));
    assert.deepEqual(JSON.parse(JSON.stringify(result.report.missingRequired)), [{ row: 5, column: 1, header: '상품명' }]);
  }
});

test('XLSX preview retains literal formula-like text without CSV prefixes or source mutation',async()=>{
 const rows=[{title:' =SUM(1,2)',supplyPrice:100,skuName:'+옵션',brand:'@브랜드'}];
 const input=await inputFrom(entries(),{rows});const before=JSON.stringify(rows);
 const result=await createMappedQuotation(input);
 assert.equal(result.values[0][0],rows[0].title);assert.equal(result.values[0][3],rows[0].skuName);
 assert.equal(result.values[0][4],rows[0].brand);
 assert.equal(result.report.warnings.some(message=>message.includes('작은따옴표')),false);
 const archive=await reader.readXlsxArchive(result.bytes.buffer);const sheet=decode(archive.get('xl/worksheets/sheet1.xml'));
 assert.ok(sheet.includes('> =SUM(1,2)</'));assert.ok(sheet.includes('>+옵션</'));
 assert.equal(JSON.stringify(rows),before);
});

test('mapped XLSX reports literal dropdown mismatches without changing values or original rules', async () => {
  const input = await inputFrom(entries(value => value.replace('sqref="D5:D10"', 'sqref="D5 D7:D10"')),
    {rows:[{title:'상품',supplyPrice:10,skuName:'목록 밖'},{title:'상품2',supplyPrice:20,skuName:'검사 범위 밖'}]});
  const result = await createMappedQuotation(input);
  assert.equal(result.report.warnings.filter(value=>value.includes('드롭다운')).length,1);
  assert.ok(result.report.warnings.some(value=>value.includes('견적서!D5')));
  const archive = await reader.readXlsxArchive(result.bytes.buffer);
  const sheet = decode(archive.get('xl/worksheets/sheet1.xml'));
  assert.ok(sheet.includes('목록 밖')); assert.ok(sheet.includes('sqref="D5 D7:D10"'));
  const valid = await createMappedQuotation(await inputFrom());
  assert.equal(valid.report.warnings.some(value=>value.includes('불일치')||value.includes('일치하지 않습니다')),false);
});

test('mapped XLSX distinguishes allowed blanks and unresolved list references with bounded diagnostics', async () => {
  const blank = await createMappedQuotation(await inputFrom(entries(value=>value.replace('type="list"','type="list" allowBlank="true"')),
    {rows:[{title:'상품',supplyPrice:10,skuName:''}]}));
  assert.equal(blank.report.warnings.some(value=>value.includes('드롭다운')),false);
  assert.equal(blank.report.missingRequired.length,1);
  const referenced = await createMappedQuotation(await inputFrom(entries(value=>value.replace('"검정,흰색"',"AllowedNames"))));
  assert.ok(referenced.report.warnings.some(value=>value.includes('검사하지 못했습니다')));
  const many = await createMappedQuotation(await inputFrom(entries(value=>value.replace('D5:D10','D5:D204')),
    {rows:Array.from({length:200},()=>({title:'상품',supplyPrice:10,skuName:'목록 밖'}))}));
  assert.equal(many.report.warnings.filter(value=>value.includes('견적서!D')).length,20);
  assert.ok(many.report.warnings.some(value=>value.includes('총 200개')));
});


test('absolute workbook list references use final saved cells and reject formulas or unsupported ranges', async () => {
  const make = expression => entries(value=>value.replace('"검정,흰색"',expression));
  const files = make("'참고'!$A$1:$A$2");
  files[files.findIndex(([name])=>name==='xl/worksheets/sheet2.xml')][1]='<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>검정</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>흰색</t></is></c></row></sheetData></worksheet>';
  const valid=await createMappedQuotation(await inputFrom(files));
  assert.equal(valid.report.warnings.some(value=>value.includes('검사하지 못했습니다')||value.includes('드롭다운')),false);
  const invalid=await createMappedQuotation(await inputFrom(files,{rows:[{title:'상품',supplyPrice:10,skuName:'빨강'}]}));
  assert.ok(invalid.report.warnings.some(value=>value.includes('견적서!D5')));
  for(const expression of ["'참고'!$B$1", "'참고'!$A$1:$A$1001", "'참고'!A1:A2", "'[외부.xlsx]참고'!$A$1", 'INDIRECT("A1")']){
    const output=await createMappedQuotation(await inputFrom(make(expression)));
    assert.ok(output.report.warnings.some(value=>value.includes('검사하지 못했습니다')),expression);
  }
  // A same-sheet source overwritten by this export must use its final value.
  const same=await createMappedQuotation(await inputFrom(make('$A$5'),{rows:[{title:'검정',supplyPrice:10,skuName:'검정'}]}));
  assert.equal(same.report.warnings.some(value=>value.includes('드롭다운')),false);
});

test('defined dropdown names respect worksheet scope and preserve workbook definitions', async () => {
  const make = definitions => entries(value=>value.replace('"검정,흰색"','=AllowedColors')).map(([name,text])=>[name,name==='xl/workbook.xml'?text.replace('<calcPr',`<definedNames>${definitions}</definedNames><calcPr`):text]);
  const global='<definedName name="AllowedColors">\'참고\'!$A$1</definedName>';
  const local='<definedName name="allowedcolors" localSheetId="0">\'견적서\'!$A$5</definedName>';
  const rows=[{title:'검정',supplyPrice:10,skuName:'검정'}];
  const scopedInput=await inputFrom(make(global+local),{rows});
  const scoped=await createMappedQuotation(scopedInput);
  assert.equal(scoped.report.warnings.some(value=>value.includes('드롭다운')||value.includes('검사하지 못했습니다')),false);
  const before=await reader.readXlsxArchive(scopedInput.originalBytes), after=await reader.readXlsxArchive(scoped.bytes.buffer);
  assert.deepEqual(Buffer.from(after.get('xl/workbook.xml')),Buffer.from(before.get('xl/workbook.xml')));
  const otherLocal=local.replace('localSheetId="0"','localSheetId="1"');
  const fallback=await createMappedQuotation(await inputFrom(make(global+otherLocal),{rows}));
  assert.ok(fallback.report.warnings.some(value=>value.includes('견적서!D5')));
  for(const definitions of [local+local, '<definedName name="AllowedColors">AllowedColors</definedName>', '<definedName name="AllowedColors">OFFSET(참고!$A$1,0,0,2)</definedName>', '<definedName name="AllowedColors">$A$1</definedName>',otherLocal]){
    const output=await createMappedQuotation(await inputFrom(make(definitions),{rows}));
    assert.ok(output.report.warnings.some(value=>value.includes('검사하지 못했습니다')),definitions);
  }
});

test('numeric workbook constraints check final typed cells, integer requirements and inclusive boundaries', async () => {
  const run=async(type,operator,first,second,values,extra='')=>{
    const rule=`<dataValidation type="${type}" operator="${operator}" sqref="C5:C20" ${extra}><formula1>${first}</formula1>${second===null?'':`<formula2>${second}</formula2>`}</dataValidation>`;
    const files=entries(value=>value.replace(/<dataValidation type="list"[\s\S]*?<\/dataValidation>/,rule));
    return createMappedQuotation(await inputFrom(files,{rows:values.map(supplyPrice=>({title:'검증',supplyPrice,skuName:'검정'}))}));
  };
  const between=await run('whole','between','0','10',[0,10,11,1.5,'5','']);
  assert.equal(between.report.warnings.filter(value=>value.includes('정수 입력 규칙')).length,4);
  const blank=await run('whole','between','0','10',['',0],'allowBlank="1"');
  assert.equal(blank.report.warnings.some(value=>value.includes('정수 입력 규칙')),false);
  const decimal=await run('decimal','between','-1.5','1.5',[-1.5,0.25,1.5,1.51]);
  assert.equal(decimal.report.warnings.filter(value=>value.includes('숫자 입력 규칙')).length,1);
  for(const [operator,values,count] of [['notBetween',[0,5,10,11],3],['equal',[5,6],1],['notEqual',[5,6],1],['lessThan',[4,5,6],2],['lessThanOrEqual',[4,5,6],1],['greaterThan',[4,5,6],2],['greaterThanOrEqual',[4,5,6],1]]){
    const output=await run('whole',operator,operator==='notBetween'?'0':'5',operator==='notBetween'?'10':null,values);
    assert.equal(output.report.warnings.filter(value=>value.includes('정수 입력 규칙')).length,count,operator);
  }
  for(const [first,second] of [['A1','10'],['10','0'],['0',null]]){
    const output=await run('whole','between',first,second,[5]);
    assert.ok(output.report.warnings.some(value=>value.includes('검사하지 못했습니다')));
  }
});

test('text length constraints check Korean text, whitespace and boundaries without truncating cells', async () => {
  const rule = '<dataValidation type="textLength" operator="between" sqref="A5:A20"><formula1>2</formula1><formula2>4</formula2></dataValidation>';
  const input = await inputFrom(entries(value => value.replace(/<dataValidation type="list"[\s\S]*?<\/dataValidation>/, rule)),
    { rows: ['가방', '가나다라', '가나다라마', '가', ' 가 ', '가\n나', ''].map(title => ({ title, supplyPrice: 10, skuName: '검정' })) });
  const result = await createMappedQuotation(input);
  assert.equal(result.report.warnings.filter(value => value.includes('글자 수 입력 규칙')).length, 3);
  for (const row of [7, 8, 11]) assert.ok(result.report.warnings.some(value => value.includes(`견적서!A${row} (상품명)`)));
  const archive = await reader.readXlsxArchive(result.bytes.buffer);
  const sheet = decode(archive.get('xl/worksheets/sheet1.xml'));
  assert.ok(sheet.includes('가나다라마')); assert.ok(sheet.includes(rule));
  assert.equal(result.report.verification, 'draft');
});

test('text length rules honor all comparison operators, allowed blanks and range coverage', async () => {
  for (const [operator, expected] of [['between', 2], ['notBetween', 3], ['equal', 4], ['notEqual', 1], ['lessThan', 2], ['lessThanOrEqual', 1], ['greaterThan', 4], ['greaterThanOrEqual', 3]]) {
    const rule = `<dataValidation type="textLength" operator="${operator}" allowBlank="true" sqref="A5:A9"><formula1>${['between','notBetween'].includes(operator) ? 2 : 4}</formula1><formula2>4</formula2></dataValidation>`;
    const input = await inputFrom(entries(value => value.replace(/<dataValidation type="list"[\s\S]*?<\/dataValidation>/, rule)),
      { rows: ['가', '가나', '가나다', '가나다라', '가나다라마', '', '범위밖문자열'].map(title => ({ title, supplyPrice: 0 })) });
    const result = await createMappedQuotation(input);
    assert.equal(result.report.warnings.filter(value => value.includes('글자 수 입력 규칙')).length, expected, operator);
  }
  const blank = await createMappedQuotation(await inputFrom(entries(value => value.replace(/<dataValidation type="list"[\s\S]*?<\/dataValidation>/,
    '<dataValidation type="textLength" allowBlank="1" sqref="A5"><formula1>2</formula1><formula2>4</formula2></dataValidation>')), { rows: [{ title: '' }] }));
  assert.equal(blank.report.warnings.some(value => value.includes('글자 수 입력 규칙')), false);
  assert.ok(blank.report.missingRequired.some(value => value.header === '상품명'));
});

test('text length does not pretend to validate formulas, invalid limits, numeric formats or supplementary characters', async () => {
  const run = (first, second, rows) => inputFrom(entries(value => value.replace(/<dataValidation type="list"[\s\S]*?<\/dataValidation>/,
    `<dataValidation type="textLength" sqref="A5:A204"><formula1>${first}</formula1><formula2>${second}</formula2></dataValidation>`)), { rows }).then(createMappedQuotation);
  for (const [first, second] of [['A1','10'], ['-1','4'], ['1.5','4'], ['5','4']]) {
    const output = await run(first, second, [{ title: '가방' }]);
    assert.ok(output.report.warnings.some(value => value.includes('검사하지 못했습니다')));
  }
  const uncertain = await run('1', '1', [{ title: '😀' }, { title: 123 }]);
  assert.ok(uncertain.report.warnings.some(value => value.includes('글자 수 검사 2개') && value.includes('판정하지 않았습니다')));
  assert.equal(uncertain.report.warnings.some(value => value.includes('글자 수 입력 규칙')), false);
  const bounded = await run('1', '1', Array.from({ length: 200 }, () => ({ title: '가나다' })));
  assert.equal(bounded.report.warnings.filter(value => value.includes('글자 수 입력 규칙')).length, 20);
  assert.ok(bounded.report.warnings.some(value => value.includes('총 200개')));
});

test('persisted template input row places output after instructions and can be overridden for one export', async () => {
  const model = load('app/category-profiles.ts');
  const input = await inputFrom();
  input.profile = model.validateCategoryProfile({ ...input.profile, template: { ...input.profile.template, dataStartRow: 12 } });
  const result = await createMappedQuotation({ ...input, dataStartRow: model.quotationStartRow(input.profile.template) });
  const sheet = decode((await reader.readXlsxArchive(result.bytes.buffer)).get('xl/worksheets/sheet1.xml'));
  assert.equal(result.report.dataStartRow, 12);
  assert.ok(sheet.includes('<c r="A12"')); assert.ok(sheet.includes('<c r="A13"'));
  assert.ok(sheet.includes('<c r="A5" s="2" t="inlineStr"><is><t>예시</t></is></c>'));
  assert.ok(sheet.includes('아래 원본 행'));
  const override = await createMappedQuotation({ ...input, dataStartRow: 15 });
  assert.equal(override.report.dataStartRow, 15);
  assert.equal(input.profile.template.dataStartRow, 12);
});

test('XLSX choice label output uses category choices while preserving blank cells and original workbook parts',async()=>{
 const schema=load('app/quotation-schema.ts').getQuotationSchema('80719');const field=schema.fields.find(f=>f.type==='select'&&f.choices.some(c=>c.value&&c.value!==c.label));const choice=field.choices.find(c=>c.value&&c.value!==c.label);
 const input=await inputFrom();input.profile.categoryId='80719';input.profile.mappings=[{column:0,field:field.id,required:false,choiceFormat:'label'}];input.rows=[{[field.id]:choice.value},{[field.id]:''}];
 const before=JSON.stringify(input.profile);const result=await createMappedQuotation(input);const archive=await reader.readXlsxArchive(result.bytes.buffer);
 const inspection=reader.inspectXlsxArchive(archive);assert.equal(reader.xlsxHeaders(inspection,'견적서',5)[0],choice.label);assert.ok(decode(archive.get('xl/worksheets/sheet1.xml')).includes('<c r="A6" t="inlineStr"><is><t xml:space="preserve"></t></is></c>'));
 const original=await reader.readXlsxArchive(input.originalBytes);assert.equal(decode(archive.get('xl/styles.xml')),decode(original.get('xl/styles.xml')));assert.equal(JSON.stringify(input.profile),before);
});

// Synthetic workbooks exercise our file writer, not the unacquired official template.
const categoryRoundtripIds=[...JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-product-schemas-2026-09-23.json',import.meta.url),'utf8')).records.map(record=>record.categoryId),'81452','103495','64497','77442'];
for(const categoryId of categoryRoundtripIds)test(`category ${categoryId}: saved stages round-trip through an actual XLSX with manual overrides and excluded options`,async()=>{
 const schemaModel=load('app/quotation-schema.ts'),contentModel=load('app/product-content.ts'),optionModel=load('app/product-options.ts');
 const settings=load('app/workspace-settings.ts').defaultSettings;
 const policy={exchangeRate:200,supplyMargin:50,coupangMargin:40,minimumMargin:0,msrpMultiple:1.3,roundingUnit:10};
 const keys=['owner/main.png','owner/detail.png','owner/label.png'];
 const product={id:'roundtrip',owner_id:'owner',title:'원문 상품',source_url:'https://detail.1688.com/offer/813724060928.html',source_price_cny:10,supply_price:4000,sale_price:6670,msrp:8670,pricing_policy:JSON.stringify(policy),image_keys:JSON.stringify(keys)};
 const content=contentModel.applyContentPatch(contentModel.emptyProductContent(product.id),{
  seo:{title:'저장 상품 & <검토>',description:'설명\n둘째 줄',keywords:['검토','상품']},
  label:{model:'MODEL-173',material:'플라스틱',components:'본품',countryOfOrigin:'중국',contact:'검토 연락처'},
  assets:{main:[keys[0]],detail:[keys[1]],label:[keys[2]]}
 },'now');
 const options=optionModel.applyOptionRows(optionModel.emptyProductOptions(product.id),['red','blue','excluded'].map((id,index)=>({...optionModel.emptyOptionInput(id),translatedName:id,supplierSku:`sku-${id}`,unitCostCny:10+index,unitsPerPack:1,included:id!=='excluded',color:index?'파랑':'빨강',size:'Free',imageKey:keys[0]})),'now');
 const input={categoryId,product,content,settings,options,overrides:{common:{brand:'수동 브랜드'},options:{blue:{title:'',model:'수동 모델'}}}};
 const before=JSON.stringify(input);const resolved=schemaModel.resolveQuotationFields(input);
 const assets=keys.map((key,index)=>({key,name:`assets/image-${index}.png`}));
 const rows=load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets);
 assert.equal(rows.length,2);assert.equal(rows[0].title,'저장 상품 & <검토>');assert.equal(rows[1].title,'');
 assert.equal(rows[1].model,'수동 모델');assert.equal(rows[0].mainImage,'image-0.png');assert.equal(rows[0].labelImages,'image-2.png');
 assert.equal(rows[0].detailImages,'image-1.png');assert.ok(rows[0].supplyPrice>0);assert.ok(rows[0].salePrice>=rows[0].supplyPrice);
 const registry=load('app/category-profiles.ts').categoryFields;
 for(const field of resolved.schema.fields)assert.ok(Object.hasOwn(registry,field.id),`unexportable field ${categoryId}/${field.id}`);
 const mappings=resolved.schema.fields.map((field,column)=>({column,field:field.id,required:field.id==='title'}));
 mappings.push({column:mappings.length,field:'categoryId',required:true},{column:mappings.length+1,field:'sourceUrl',required:true});
 const headers=mappings.map(mapping=>registry[mapping.field]);
 const columnName=index=>{let name='';for(let value=index+1;value>0;value=Math.floor((value-1)/26))name=String.fromCharCode(65+(value-1)%26)+name;return name;};
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const headerXml=headers.map((header,index)=>`<c r="${columnName(index)}3" t="inlineStr"><is><t>${escape(header)}</t></is></c>`).join('');
 const files=entries(()=>`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>시험 양식 · 공식 원본 아님</t></is></c></row><row r="3">${headerXml}</row></sheetData></worksheet>`);
 const template=await inputFrom(files);template.profile={...template.profile,categoryId,categoryPath:Array.from(resolved.schema.categoryPath),template:{...template.profile.template,headers},mappings};template.rows=rows;
 const output=await createMappedQuotation(template);const archive=await reader.readXlsxArchive(output.bytes.buffer);const inspection=reader.inspectXlsxArchive(archive);
 for(const [index,row] of rows.entries()){
  const cells=Array.from(reader.xlsxHeaders(inspection,'견적서',5+index));
  // Every declared field, including category-specific attributes, must reach the file.
  for(const mapping of mappings){const expected=mapping.field==='categoryId'?categoryId:row[mapping.field];assert.equal(cells[mapping.column]??'',expected==null?'':String(expected),`${categoryId}/${mapping.field}/row${index}`);}
 }
 assert.equal(output.report.rowCount,2);assert.equal(output.report.verification,'draft');assert.equal(output.report.missingRequired.length,1);assert.equal(output.report.missingRequired[0].row,6);
 const original=await reader.readXlsxArchive(template.originalBytes);
 for(const [name,bytes] of original)if(name!=='xl/worksheets/sheet1.xml')assert.deepEqual(Buffer.from(archive.get(name)),Buffer.from(bytes),name);
 assert.ok(!decode(archive.get('xl/worksheets/sheet1.xml')).includes('<row r="7"'));
 assert.equal(JSON.stringify(input),before);
});
