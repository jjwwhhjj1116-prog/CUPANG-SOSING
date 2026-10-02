// Synthetic integration fixture, never a Supplier Hub official template.
export function quotationWorkbook(headers) {
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const column = index => { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
  const files = [
    ['[Content_Types].xml', '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<workbook xmlns:r="relationship"><sheets><sheet name="견적서" r:id="one"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1">${headers.map((header,index)=>`<c r="${column(index)}1" t="inlineStr"><is><t>${escape(header)}</t></is></c>`).join('')}</row></sheetData></worksheet>`],
  ];
  return workbookArchive(files);
}
/** Stored ZIP for synthetic OOXML fixtures, including [Content_Types].xml. */
export function workbookArchive(files) {
  const pieces = [], directory = []; let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name), bytes = Buffer.from(text); let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt32LE(crc,14); local.writeUInt32LE(bytes.length,18); local.writeUInt32LE(bytes.length,22); local.writeUInt16LE(nameBytes.length,26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt32LE(crc,16); central.writeUInt32LE(bytes.length,20); central.writeUInt32LE(bytes.length,24); central.writeUInt16LE(nameBytes.length,28); central.writeUInt32LE(offset,42);
    pieces.push(local,nameBytes,bytes); directory.push(central,nameBytes); offset += local.length + nameBytes.length + bytes.length;
  }
  const catalog = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(catalog.length,12); end.writeUInt32LE(offset,16);
  return new Uint8Array(Buffer.concat([...pieces,catalog,end]));
}
