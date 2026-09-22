import { mapQuotationRow, parseTemplateText, validateCategoryProfile, type CategoryField, type CategoryProfileInput } from '@/app/category-profiles';
import { inspectXlsxArchive, readXlsxArchive, xlsxHeaders, xlsxWorksheetPath } from '@/app/xlsx-template';

export type QuotationData = Partial<Record<Exclude<CategoryField, 'constant'>, string | number | null>>;
export type QuotationCellIssue = { row: number; column: number; header: string };
export type MappedQuotationReport = {
  verification: 'draft'; rowCount: number; dataStartRow: number;
  missingRequired: QuotationCellIssue[]; blankCells: QuotationCellIssue[]; warnings: string[];
};
export type MappedQuotationInput = { originalBytes: ArrayBuffer; profile: CategoryProfileInput; rows: QuotationData[]; dataStartRow: number };
export type MappedQuotationResult = { bytes: Uint8Array; filename: string; mimeType: string; report: MappedQuotationReport };
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_OUTPUT = 10_000_000;
function fail(message: string): never { throw new Error(message); }

type XmlSpan = { name: string; local: string; start: number; openEnd: number; closeStart: number; end: number; selfClosing: boolean; attributes: Record<string, string>; children: XmlSpan[] };
function decodeXml(value: string) { return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => { const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }; if (Object.hasOwn(named, entity)) return named[entity]; return String.fromCodePoint(entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1))); }); }
function spans(source: string): XmlSpan {
  // The shared OOXML inspector validates XML first. Spans allow editing only the
  // intended cells while leaving all unrelated source bytes and formatting intact.
  const root: XmlSpan = { name: '#root', local: '#root', start: 0, openEnd: 0, closeStart: source.length, end: source.length, selfClosing: false, attributes: {}, children: [] };
  const stack = [root]; const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>/g; let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    const text = match[0]; if (text.startsWith('<!') || text.startsWith('<?')) continue;
    if (text.startsWith('</')) { const current = stack.pop(); if (!current || current.name !== text.slice(2, -1).trim()) fail('워크시트 XML 구조가 일치하지 않습니다.'); current.closeStart = match.index; current.end = token.lastIndex; continue; }
    const opening = /^<([\w.:-]+)([\s\S]*?)(\/?)>$/.exec(text); if (!opening) fail('워크시트 태그를 읽지 못했습니다.');
    const attributes: Record<string, string> = Object.create(null); const attribute = /\s+([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let item: RegExpExecArray | null;
    while ((item = attribute.exec(opening[2]))) attributes[item[1]] = decodeXml(item[2] ?? item[3]);
    const node: XmlSpan = { name: opening[1], local: opening[1].split(':').at(-1)!, start: match.index, openEnd: token.lastIndex, closeStart: token.lastIndex, end: token.lastIndex, selfClosing: Boolean(opening[3]), attributes, children: [] };
    stack.at(-1)!.children.push(node); if (!node.selfClosing) stack.push(node);
  }
  if (stack.length !== 1 || root.children.length !== 1) fail('워크시트 XML 구조를 확인해주세요.');
  return root.children[0];
}
function coordinate(reference: string): { column: number; row: number } {
  const parts = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/.exec(reference); if (!parts) fail('워크시트 셀 좌표를 확인해주세요.');
  let column = 0; for (const letter of parts[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(parts[2]); if (column > 16384 || row > 1048576) fail('Excel 셀 범위를 초과했습니다.');
  return { column: column - 1, row };
}
function columnName(column: number): string { let result = ''; for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result; return result; }
function range(value: string) { const parts = value.split(':'); if (parts.length > 2) fail('워크시트 영역을 읽지 못했습니다.'); const start = coordinate(parts[0]); const end = coordinate(parts[1] ?? parts[0]); if (start.row > end.row || start.column > end.column) fail('워크시트 영역의 순서를 확인해주세요.'); return { start, end }; }
type Edit = { start: number; end: number; text: string };
function applyEdits(source: string, edits: Edit[], origin = 0): string {
  const ordered = edits.map((edit, index) => ({ ...edit, index })).sort((a, b) => b.start - a.start || b.end - a.end || b.index - a.index);
  let last = source.length + origin;
  for (const edit of ordered) { if (edit.start < origin || edit.end > last || edit.end < edit.start) fail('견적서 셀 수정 영역이 겹칩니다.'); source = source.slice(0, edit.start - origin) + edit.text + source.slice(edit.end - origin); last = edit.start; }
  return source;
}
function cellXml(source: string, existing: XmlSpan | undefined, reference: string, value: string | number, prefix: string): string {
  const tag = existing?.name ?? `${prefix}c`;
  let opening = existing ? source.slice(existing.start, existing.openEnd).replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/, '').replace(/\s*\/?>$/, '') : `<${tag} r="${reference}"`;
  // Only the value/type is replaced. Style indices and all other cell attributes remain.
  const extension = existing?.children.filter(node => !['v', 'is', 'f'].includes(node.local)).map(node => source.slice(node.start, node.end)).join('') ?? '';
  if (typeof value === 'number') return `${opening}><${prefix}v>${value}</${prefix}v>${extension}</${tag}>`;
  opening += ' t="inlineStr"';
  const escaped = value.replace(/_x[\da-f]{4}_/gi, match => `_x005F_${match.slice(1)}`).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `${opening}><${prefix}is><${prefix}t xml:space="preserve">${escaped}</${prefix}t></${prefix}is>${extension}</${tag}>`;
}
function writeWorksheet(source: string, sheetName: string, profile: CategoryProfileInput, values: (string | number)[][], startRow: number): string {
  const root = spans(source); const sheetData = root.children.find(node => node.local === 'sheetData'); if (!sheetData) fail('워크시트의 상품 행 영역을 찾을 수 없습니다.');
  const prefix = sheetData.name.includes(':') ? `${sheetData.name.split(':')[0]}:` : '';
  const mappedColumns = profile.mappings.map(mapping => mapping.column).sort((a, b) => a - b);
  const lastRow = startRow + values.length - 1;
  const intersects = (reference: string) => { const area = range(reference); return startRow <= area.end.row && lastRow >= area.start.row && mappedColumns.some(column => column >= area.start.column && column <= area.end.column); };
  for (const merged of root.children.filter(node => node.local === 'mergeCells').flatMap(node => node.children)) if (merged.attributes.ref && intersects(merged.attributes.ref)) fail(`${sheetName}!${merged.attributes.ref} 병합 영역과 상품 입력 영역이 겹칩니다.`);
  const originalRows = sheetData.children.filter(node => node.local === 'row');
  const rows = new Map<number, XmlSpan>();
  let previousRow = 0;
  for (const row of originalRows) {
    const number = Number(row.attributes.r); if (!Number.isSafeInteger(number) || number < 1 || number > 1048576 || rows.has(number)) fail('워크시트 행 번호가 올바르지 않습니다.'); rows.set(number, row);
    if (number <= previousRow) fail('워크시트 행 순서가 올바르지 않습니다.'); previousRow = number;
    let previousColumn = -1;
    for (const cell of row.children.filter(node => node.local === 'c')) {
      const position = coordinate(cell.attributes.r); if (position.row !== number) fail('워크시트의 행과 셀 좌표가 일치하지 않습니다.');
      if (position.column <= previousColumn) fail('워크시트 열 순서가 올바르지 않습니다.'); previousColumn = position.column;
      for (const formula of cell.children.filter(node => node.local === 'f')) if (intersects(formula.attributes.ref ?? cell.attributes.r)) fail(`${sheetName}!${formula.attributes.ref ?? cell.attributes.r} 수식 영역은 덮어쓸 수 없습니다.`);
    }
  }
  const edits: Edit[] = []; const newRows: { row: number; text: string }[] = [];
  for (const [index, rowValues] of values.entries()) {
    const rowNumber = startRow + index; const row = rows.get(rowNumber);
    if (!row) { newRows.push({ row: rowNumber, text: `<${prefix}row r="${rowNumber}">${mappedColumns.map(column => cellXml(source, undefined, `${columnName(column)}${rowNumber}`, rowValues[column], prefix)).join('')}</${prefix}row>` }); continue; }
    const cells = row.children.filter(node => node.local === 'c'); const seen = new Set<number>();
    for (const cell of cells) { const column = coordinate(cell.attributes.r).column; if (seen.has(column)) fail('워크시트 셀 좌표가 중복되었습니다.'); seen.add(column); }
    const cellEdits: Edit[] = [];
    for (const column of mappedColumns) {
      const cell = cells.find(cell => coordinate(cell.attributes.r).column === column);
      const replacement = cellXml(source, cell, `${columnName(column)}${rowNumber}`, rowValues[column], prefix);
      if (cell) cellEdits.push({ start: cell.start, end: cell.end, text: replacement });
      else {
        const next = cells.find(cell => coordinate(cell.attributes.r).column > column);
        const position = next?.start ?? cells.at(-1)?.end ?? row.openEnd;
        cellEdits.push({ start: position, end: position, text: replacement });
      }
    }
    let replacement: string;
    if (row.selfClosing) replacement = source.slice(row.start, row.end).replace(/\s*\/>$/, '>') + mappedColumns.map(column => cellXml(source, undefined, `${columnName(column)}${rowNumber}`, rowValues[column], prefix)).join('') + `</${row.name}>`;
    else replacement = applyEdits(source.slice(row.start, row.end), cellEdits, row.start);
    edits.push({ start: row.start, end: row.end, text: replacement });
  }
  if (sheetData.selfClosing) {
    const replacement = source.slice(sheetData.start, sheetData.end).replace(/\s*\/>$/, '>') + newRows.map(row => row.text).join('') + `</${sheetData.name}>`;
    edits.push({ start: sheetData.start, end: sheetData.end, text: replacement });
  } else {
    for (const row of newRows) { const next = originalRows.find(original => Number(original.attributes.r) > row.row); const position = next?.start ?? sheetData.closeStart; edits.push({ start: position, end: position, text: row.text }); }
  }
  const dimension = root.children.find(node => node.local === 'dimension');
  if (dimension?.attributes.ref) {
    const bounds = range(dimension.attributes.ref);
    const reference = `${columnName(Math.min(bounds.start.column, mappedColumns[0]))}${Math.min(bounds.start.row, startRow)}:${columnName(Math.max(bounds.end.column, mappedColumns.at(-1)!))}${Math.max(bounds.end.row, lastRow)}`;
    edits.push({ start: dimension.start, end: dimension.end, text: source.slice(dimension.start, dimension.end).replace(/(\sref\s*=\s*)(?:"[^"]*"|'[^']*')/, `$1"${reference}"`) });
  }
  return applyEdits(source, edits);
}

const crcTable = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0; });
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
function concatenate(chunks: Uint8Array[], length: number) { const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result; }
async function zip(files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []; const directory: Uint8Array[] = []; let offset = 0; let directorySize = 0;
  for (const [path, bytes] of files) {
    const name = encoder.encode(path); const stream = new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream('deflate-raw')); const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    const crc = crc32(bytes); const local = new Uint8Array(30); const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x800, true); header.setUint16(8, 8, true); header.setUint16(12, 33, true); header.setUint32(14, crc, true); header.setUint32(18, compressed.length, true); header.setUint32(22, bytes.length, true); header.setUint16(26, name.length, true);
    const central = new Uint8Array(46); const center = new DataView(central.buffer);
    center.setUint32(0, 0x02014b50, true); center.setUint16(4, 20, true); center.setUint16(6, 20, true); center.setUint16(8, 0x800, true); center.setUint16(10, 8, true); center.setUint16(14, 33, true); center.setUint32(16, crc, true); center.setUint32(20, compressed.length, true); center.setUint32(24, bytes.length, true); center.setUint16(28, name.length, true); center.setUint32(42, offset, true);
    chunks.push(local, name, compressed); directory.push(central, name); offset += local.length + name.length + compressed.length; directorySize += central.length + name.length;
    if (offset + directorySize + 22 > MAX_OUTPUT) fail('생성한 견적서가 10MB를 초과합니다. 상품 수를 줄여주세요.');
  }
  const end = new Uint8Array(22); const tail = new DataView(end.buffer); tail.setUint32(0, 0x06054b50, true); tail.setUint16(8, files.size, true); tail.setUint16(10, files.size, true); tail.setUint32(12, directorySize, true); tail.setUint32(16, offset, true);
  return concatenate([...chunks, ...directory, end], offset + directorySize + end.length);
}
function safeCell(value: unknown): string | number {
  if (typeof value === 'number') { if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('견적서 숫자 범위를 확인해주세요.'); return value; }
  if (typeof value !== 'string' || value.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)) fail('견적서 셀의 문자 또는 길이를 확인해주세요.');
  return value;
}
function delimitedCell(value: string | number): string { const text = String(value); return `"${(/^[\s]*[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`; }

export async function createMappedQuotation(input: MappedQuotationInput): Promise<MappedQuotationResult> {
  const profile = validateCategoryProfile(input.profile); const template = profile.template;
  if (!template || !profile.mappings.length) fail('견적서 원본과 열 연결이 필요합니다.');
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 200) fail('견적서는 한 번에 1~200개 행으로 생성해주세요.');
  if (!Number.isSafeInteger(input.dataStartRow) || input.dataStartRow <= template.headerRow || input.dataStartRow + input.rows.length - 1 > 1048576) fail('상품 시작 행은 머리글 뒤의 유효한 Excel 행이어야 합니다.');
  if (input.originalBytes.byteLength < 1 || input.originalBytes.byteLength > 5_000_000) fail('견적서 원본은 5MB 이하이어야 합니다.');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input.originalBytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== template.sha256) fail('선택한 견적서와 저장된 원본 파일 지문이 일치하지 않습니다.');
  const report: MappedQuotationReport = { verification: 'draft', rowCount: input.rows.length, dataStartRow: input.dataStartRow, missingRequired: [], blankCells: [], warnings: ['생성 결과는 검토용입니다. Supplier Hub 접수·카테고리별 필수 정보 검증은 완료되지 않았습니다.'] };
  let payloadSize = 0;
  const values = input.rows.map((data, index) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('상품 자료 형식을 확인해주세요.');
    const mapped = mapQuotationRow(profile, data).values.map(value => {
      const safe = safeCell(value);
      const escaped = String(safe).replace(/_x[\da-f]{4}_/gi, match => `_x005F_${match.slice(1)}`).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      payloadSize += encoder.encode(escaped).byteLength + 100;
      if (payloadSize > 8_000_000) fail('상품 셀 자료가 너무 큽니다. 견적서를 나누어 생성해주세요.');
      return safe;
    });
    for (const mapping of profile.mappings) {
      const value = mapped[mapping.column]; if (typeof value !== 'string' || value.trim()) continue;
      const issue = { row: input.dataStartRow + index, column: mapping.column + 1, header: template.headers[mapping.column] };
      report.blankCells.push(issue); if (mapping.required) report.missingRequired.push(issue);
    }
    return mapped;
  });
  let bytes: Uint8Array; let mimeType: string;
  if (template.format === 'xlsx') {
    const files = await readXlsxArchive(input.originalBytes); const inspection = inspectXlsxArchive(files);
    if ([...files.keys()].some(path => /(?:^|\/)vbaProject\.bin$|^_xmlsignatures\//i.test(path))) fail('매크로 또는 전자서명된 Excel은 수정할 수 없습니다.');
    const headers = xlsxHeaders(inspection, template.sheetName, template.headerRow);
    if (JSON.stringify(headers.map(value => value.trim())) !== JSON.stringify(template.headers)) fail('견적서 원본 머리글과 열 연결이 일치하지 않습니다.');
    const path = xlsxWorksheetPath(files, template.sheetName); const original = files.get(path); if (!original) fail('원본 시트를 찾을 수 없습니다.');
    const updated = encoder.encode(writeWorksheet(decoder.decode(original), template.sheetName, profile, values, input.dataStartRow));
    if (updated.byteLength > 10_000_000) fail('생성한 워크시트가 10MB를 초과합니다.');
    files.set(path, updated); inspectXlsxArchive(files);
    report.warnings.push(...inspection.warnings, '기존 수식과 유효성 검사 규칙을 보존했습니다. 수식 계산값과 신규 행의 검사 범위는 Excel에서 확인해주세요.');
    bytes = await zip(files); mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    const delimiter = template.format === 'tsv' ? '\t' : ',';
    const headers = parseTemplateText(decoder.decode(input.originalBytes), delimiter, template.headerRow);
    if (JSON.stringify(headers.map(value => value.trim())) !== JSON.stringify(template.headers)) fail('견적서 원본 머리글과 열 연결이 일치하지 않습니다.');
    if (input.dataStartRow > 10000) fail('CSV·TSV 상품 시작 행은 10000 이하로 지정해주세요.');
    const rows: (string | number)[][] = Array.from({ length: input.dataStartRow - 1 }, () => []);
    rows[template.headerRow - 1] = template.headers;
    bytes = encoder.encode(`\uFEFF${[...rows, ...values].map(row => row.map(delimitedCell).join(delimiter)).join('\r\n')}\r\n`);
    report.warnings.push('CSV·TSV 출력은 선택한 머리글 위치와 매핑 행으로 새로 생성합니다. 원본의 다른 데이터 행은 복사하지 않습니다.');
    mimeType = template.format === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8';
  }
  if (bytes.byteLength > MAX_OUTPUT) fail('생성한 견적서가 10MB를 초과합니다.');
  const name = template.name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').slice(0, 180);
  return { bytes, filename: `${name || 'quotation'}-검토용.${template.format}`, mimeType, report };
}
