/** A bounded, read-only OOXML inspector. It never executes formulas or loads relationships over the network. */
export type WorksheetHeaders = { name: string; rows: { rowNumber: number; values: string[] }[] };
export type XlsxInspection = { sheets: WorksheetHeaders[]; warnings: string[] };
const MAX_FILE = 5_000_000;
const MAX_EXPANDED = 25_000_000;
const MAX_ENTRY = 10_000_000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0; });
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
function fail(message: string): never { throw new Error(message); }

async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (bytes.length < 22 || bytes.length > MAX_FILE) fail('Excel 파일 크기는 5MB 이하이어야 합니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50 && index + 22 + view.getUint16(index + 20, true) === bytes.length) { end = index; break; }
  }
  if (end < 0) fail('유효한 XLSX ZIP 파일이 아닙니다.');
  const count = view.getUint16(end + 10, true); const size = view.getUint32(end + 12, true); const start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > 500 || count === 0 || start + size !== end) fail('분할·ZIP64 또는 과도하게 복잡한 Excel 파일은 지원하지 않습니다.');
  const files = new Map<string, Uint8Array>(); let cursor = start; let expanded = 0;
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail('Excel ZIP 목록이 손상되었습니다.');
    const flags = view.getUint16(cursor + 8, true); const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true); const packed = view.getUint32(cursor + 20, true); const unpacked = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true); const extraLength = view.getUint16(cursor + 30, true); const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true); const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 1 || (method !== 0 && method !== 8) || unpacked > MAX_ENTRY || (expanded += unpacked) > MAX_EXPANDED || view.getUint16(cursor + 34, true)) fail('암호화·지원하지 않는 압축 또는 너무 큰 Excel 파일입니다.');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    if (!name || name.includes('\\') || name.startsWith('/') || name.includes('\0') || name.split('/').some(part => part === '..' || part === '.') || files.has(name)) fail('Excel ZIP의 파일 경로가 올바르지 않습니다.');
    if (offset + 30 > start || view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method) fail('Excel ZIP 항목이 손상되었습니다.');
    const localNameLength = view.getUint16(offset + 26, true); const localExtraLength = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + localNameLength + localExtraLength;
    if (dataStart + packed > start || decoder.decode(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== name) fail('Excel ZIP 파일 이름 또는 크기가 일치하지 않습니다.');
    let content: Uint8Array;
    if (method === 0) content = bytes.slice(dataStart, dataStart + packed);
    else {
      const stream = new Blob([bytes.slice(dataStart, dataStart + packed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > unpacked || length > MAX_ENTRY) { await reader.cancel(); fail('Excel 압축 해제 크기가 선언된 크기를 초과합니다.'); } chunks.push(chunk.value); } }
      finally { reader.releaseLock(); }
      content = new Uint8Array(length); let position = 0; for (const chunk of chunks) { content.set(chunk, position); position += chunk.length; }
    }
    if (content.length !== unpacked || crc32(content) !== crc) fail('Excel ZIP 데이터 검증에 실패했습니다.');
    files.set(name, content); cursor = next;
  }
  if (cursor !== end) fail('Excel ZIP 목록 크기가 일치하지 않습니다.');
  return files;
}

type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[]; text: string };
const localName = (name: string) => name.split(':').at(-1)!;
function unescapeXml(value: string): string {
  return value.replace(/&([^;]*);/g, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    const number = /^#x[\da-f]+$/i.test(entity) ? parseInt(entity.slice(2), 16) : /^#\d+$/.test(entity) ? Number(entity.slice(1)) : NaN;
    if (!Number.isSafeInteger(number) || number < 1 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) fail('지원하지 않는 XML 문자 참조입니다.');
    return String.fromCodePoint(number);
  });
}
// OOXML uses a small XML subset. This strict parser is shared with Node tests;
// DTDs/entities are forbidden, and depth/node limits bound malformed documents.
function xml(bytes: Uint8Array | undefined): XmlNode {
  if (!bytes) return fail('Excel 내부 파일을 찾을 수 없습니다.');
  const text = decoder.decode(bytes).replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('외부 선언이 있는 XML은 읽을 수 없습니다.');
  const root: XmlNode = { name: '#root', attributes: {}, children: [], text: '' }; const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
  let cursor = 0; let count = 0; let match: RegExpExecArray | null;
  while ((match = tokens.exec(text))) {
    if (match.index !== cursor) fail('XML 태그를 읽지 못했습니다.'); cursor = tokens.lastIndex;
    const token = match[0]; const current = stack.at(-1)!;
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { current.text += token.slice(9, -3); continue; }
    if (!token.startsWith('<')) { if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(token)) fail('XML 문자 참조가 올바르지 않습니다.'); current.text += unescapeXml(token); continue; }
    if (token.startsWith('</')) { const name = token.slice(2, -1).trim(); if (stack.length === 1 || current.name !== name) fail('XML 태그가 일치하지 않습니다.'); stack.pop(); continue; }
    const opening = /^<([a-zA-Z_][\w.:-]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!opening || ++count > 150000 || stack.length > 64) fail('XML 구조 또는 크기를 확인해주세요.');
    const node: XmlNode = { name: opening[1], attributes: {}, children: [], text: '' };
    const attributes = opening[2]; const matcher = /\s+([a-zA-Z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let end = 0; let attr: RegExpExecArray | null;
    while ((attr = matcher.exec(attributes))) { if (attr.index !== end || Object.hasOwn(node.attributes, attr[1])) fail('XML 속성이 올바르지 않습니다.'); const value = attr[2] ?? attr[3]; if (/[<]|&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(value)) fail('XML 속성 문자가 올바르지 않습니다.'); node.attributes[attr[1]] = unescapeXml(value); end = matcher.lastIndex; }
    if (attributes.slice(end).trim()) fail('XML 속성을 읽지 못했습니다.');
    current.children.push(node); if (!opening[3]) stack.push(node);
  }
  if (cursor !== text.length || stack.length !== 1 || root.children.length !== 1 || root.text.trim()) fail('XML 문서가 올바르지 않습니다.');
  return root.children[0];
}
function children(node: XmlNode, name: string) { return node.children.filter(child => localName(child.name) === name); }
function allText(node: XmlNode): string { return node.text + node.children.map(allText).join(''); }
function richText(node: XmlNode): string { return children(node, 't').map(allText).join('') + children(node, 'r').map(run => children(run, 't').map(allText).join('')).join(''); }
function relationshipPath(base: string, target: string): string {
  if (/^[a-z][\w+.-]*:|^\/\/|[\\?#\u0000-\u001f]/i.test(target)) return fail('외부 또는 비정상적인 Excel 관계 경로입니다.');
  const parts = (target.startsWith('/') ? target.slice(1) : `${base.slice(0, base.lastIndexOf('/') + 1)}${target}`).split('/'); const result: string[] = [];
  for (const part of parts) { if (part === '..') { if (!result.length) fail('Excel 관계 경로가 파일 밖으로 나갑니다.'); result.pop(); } else if (part && part !== '.') result.push(part); }
  return result.join('/');
}
function relationships(files: Map<string, Uint8Array>, path: string) {
  const root = xml(files.get(path)); if (localName(root.name) !== 'Relationships') fail('Excel 관계 문서를 확인해주세요.');
  const values = children(root, 'Relationship').map(node => node.attributes); const seen = new Set<string>();
  for (const value of values) { if (!value.Id || seen.has(value.Id) || !value.Target || !value.Type) fail('Excel 관계 ID가 올바르지 않습니다.'); seen.add(value.Id); }
  return values;
}
export async function inspectXlsx(input: ArrayBuffer): Promise<XlsxInspection> {
  return inspectXlsxArchive(await readXlsxArchive(input));
}
export async function readXlsxArchive(input: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  return unzip(new Uint8Array(input));
}
export function inspectXlsxArchive(files: Map<string, Uint8Array>): XlsxInspection {
  if (!files.has('[Content_Types].xml')) fail('XLSX 콘텐츠 목록이 없습니다.');
  const contentTypes = xml(files.get('[Content_Types].xml'));
  if (children(contentTypes, 'Override').some(node => /macroEnabled|vbaProject/i.test(node.attributes.ContentType ?? ''))) fail('매크로 포함 Excel 파일은 지원하지 않습니다.');
  const main = relationships(files, '_rels/.rels').find(value => /\/officeDocument$/.test(value.Type));
  if (!main || main.TargetMode === 'External') fail('Excel 통합문서 연결을 찾을 수 없습니다.');
  const workbookPath = relationshipPath('', main.Target);
  const workbook = xml(files.get(workbookPath)); if (localName(workbook.name) !== 'workbook') fail('Excel 통합문서 형식을 확인해주세요.');
  const slash = workbookPath.lastIndexOf('/'); const relPath = `${workbookPath.slice(0, slash + 1)}_rels/${workbookPath.slice(slash + 1)}.rels`;
  const rels = relationships(files, relPath); const stringsRel = rels.find(value => /\/sharedStrings$/.test(value.Type));
  const strings: string[] = [];
  if (stringsRel) { if (stringsRel.TargetMode === 'External') fail('외부 문자열 파일은 지원하지 않습니다.'); const sst = xml(files.get(relationshipPath(workbookPath, stringsRel.Target))); for (const node of children(sst, 'si')) strings.push(richText(node)); }
  const sheetNodes = children(workbook, 'sheets').flatMap(node => children(node, 'sheet'));
  if (!sheetNodes.length || sheetNodes.length > 50) fail('Excel 시트는 1~50개까지 지원합니다.');
  const warnings = new Set<string>(); const sheets: WorksheetHeaders[] = []; const names = new Set<string>();
  for (const sheet of sheetNodes) {
    const name = sheet.attributes.name; const relationId = Object.entries(sheet.attributes).find(([key]) => localName(key) === 'id')?.[1];
    const relation = rels.find(value => value.Id === relationId);
    if (!name || names.has(name) || !relation || relation.TargetMode === 'External' || !/\/worksheet$/.test(relation.Type)) fail('Excel 시트 연결을 확인해주세요.');
    names.add(name);
    const worksheet = xml(files.get(relationshipPath(workbookPath, relation.Target)));
    if (localName(worksheet.name) !== 'worksheet') fail('Excel 워크시트 형식을 확인해주세요.');
    if (children(worksheet, 'mergeCells').length) warnings.add('병합 셀이 있습니다. 실제 머리글 행과 열 위치를 확인해주세요.');
    if (children(worksheet, 'dataValidations').length) warnings.add('원본의 입력 제한은 별도로 보존해야 합니다. 열 연결만으로 제출 유효성이 확인되지는 않습니다.');
    const rows: WorksheetHeaders['rows'] = []; const seenRows = new Set<number>();
    for (const row of children(worksheet, 'sheetData').flatMap(node => children(node, 'row'))) {
      const rowNumber = Number(row.attributes.r);
      if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || seenRows.has(rowNumber)) fail('Excel 행 번호가 올바르지 않습니다.');
      seenRows.add(rowNumber); if (rowNumber > 1000) continue;
      const values: string[] = []; const seenColumns = new Set<number>();
      for (const cell of children(row, 'c')) {
        const reference = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell.attributes.r ?? '');
        if (!reference || Number(reference[2]) !== rowNumber) fail('Excel 셀 좌표를 확인해주세요.');
        let column = 0; for (const letter of reference[1]) column = column * 26 + letter.charCodeAt(0) - 64; column--;
        if (column >= 200) { warnings.add('200열을 넘는 셀은 머리글 분석 범위에서 제외했습니다.'); continue; }
        if (seenColumns.has(column)) fail('Excel 셀 좌표가 중복되었습니다.'); seenColumns.add(column);
        while (values.length <= column) values.push('');
        if (children(cell, 'f').length) { warnings.add('수식 셀은 실행하거나 머리글로 사용하지 않습니다.'); continue; }
        const raw = children(cell, 'v').map(allText).join('');
        if (cell.attributes.t === 's') { const index = Number(raw); if (!/^\d+$/.test(raw) || !Number.isSafeInteger(index) || index >= strings.length) fail('Excel 공유 문자열 번호가 올바르지 않습니다.'); values[column] = strings[index]; }
        else if (cell.attributes.t === 'inlineStr') values[column] = children(cell, 'is').map(richText).join('');
        else if (cell.attributes.t === 'e') warnings.add('오류 셀은 머리글로 사용하지 않습니다.');
        else values[column] = raw;
      }
      if (values.some(Boolean)) rows.push({ rowNumber, values });
    }
    sheets.push({ name, rows });
  }
  return { sheets, warnings: [...warnings] };
}

export function xlsxWorksheetPath(files: Map<string, Uint8Array>, sheetName: string): string {
  const main = relationships(files, '_rels/.rels').find(value => /\/officeDocument$/.test(value.Type));
  if (!main || main.TargetMode === 'External') fail('Excel 통합문서 연결을 찾을 수 없습니다.');
  const workbookPath = relationshipPath('', main.Target);
  const workbook = xml(files.get(workbookPath));
  const sheet = children(workbook, 'sheets').flatMap(node => children(node, 'sheet')).find(node => node.attributes.name === sheetName);
  const relationId = sheet && Object.entries(sheet.attributes).find(([key]) => localName(key) === 'id')?.[1];
  const slash = workbookPath.lastIndexOf('/');
  const rels = relationships(files, `${workbookPath.slice(0, slash + 1)}_rels/${workbookPath.slice(slash + 1)}.rels`);
  const relation = rels.find(value => value.Id === relationId);
  if (!relation || relation.TargetMode === 'External' || !/\/worksheet$/.test(relation.Type)) fail('Excel 시트 연결을 확인해주세요.');
  return relationshipPath(workbookPath, relation.Target);
}

export function xlsxHeaders(inspection: XlsxInspection, sheetName: string, headerRow: number): string[] {
  const sheet = inspection.sheets.find(value => value.name === sheetName);
  const row = sheet?.rows.find(value => value.rowNumber === headerRow);
  if (!row?.values.some(Boolean)) fail('선택한 시트·행에 읽을 수 있는 머리글이 없습니다.');
  return row.values;
}
