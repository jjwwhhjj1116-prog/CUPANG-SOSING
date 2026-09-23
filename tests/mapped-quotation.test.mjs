import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const output = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Response, Blob, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, crypto, require: name => {
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
    throw Error(name);
  } });
  return exports;
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
    assert.deepEqual(JSON.parse(JSON.stringify(result.report.missingRequired)), [{ row: 5, column: 1, header: '상품명' }]);
  }
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
