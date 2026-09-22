// Uncompressed ZIP with UTF-8 filenames. No external service or runtime library.
const encoder = new TextEncoder();
export const MAX_ZIP_BYTES = 30 * 1024 * 1024;
export class ExportSizeError extends Error { readonly status = 413; }
const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  crcTable[index] = value >>> 0;
}
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
/** TextEncoder-compatible size, including lone surrogate replacement, without allocating bytes. */
export function utf8ByteLength(text: string) {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) length++;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { length += 4; index++; }
    else length += 3;
  }
  return length;
}
export function zipFiles(files: { name: string; data: Uint8Array | string }[]) {
  if (!files.length || files.length > 200) throw new Error('첨부 파일 수를 확인해주세요.');
  const names = new Set<string>(); let localSize = 0, centralSize = 0;
  // Validate the entire plan, including headers, before encoding text, CRC work
  // or allocating the archive. Each string is later encoded directly in-place.
  const plan = files.map(file => {
    if (!/^[a-zA-Z0-9_./-]+$/.test(file.name) || file.name.startsWith('/') || file.name.split('/').some(part => part === '..' || !part) || names.has(file.name)) throw new Error('잘못되거나 중복된 파일명입니다.');
    names.add(file.name);
    const name = encoder.encode(file.name);
    if (name.length > 65535) throw new Error('첨부 파일명이 너무 깁니다.');
    const length = typeof file.data === 'string' ? utf8ByteLength(file.data) : file.data.length;
    const offset = localSize; localSize += 30 + name.length + length; centralSize += 46 + name.length;
    if (localSize + centralSize + 22 > MAX_ZIP_BYTES) throw new ExportSizeError('검토 패키지는 30MB 이하여야 합니다. 포함 옵션이나 첨부 자료를 줄여주세요.');
    return { ...file, name, length, offset };
  });
  const result = new Uint8Array(localSize + centralSize + 22); let directoryOffset = localSize;
  for (const file of plan) {
    const dataOffset = file.offset + 30 + file.name.length;
    const data = result.subarray(dataOffset, dataOffset + file.length);
    if (typeof file.data === 'string') encoder.encodeInto(file.data, data);
    else data.set(file.data);
    const crc = crc32(data);
    const h = new DataView(result.buffer, file.offset, 30);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(12,33,true);
    h.setUint32(14,crc,true);h.setUint32(18,file.length,true);h.setUint32(22,file.length,true);h.setUint16(26,file.name.length,true);result.set(file.name,file.offset+30);
    const c = new DataView(result.buffer, directoryOffset, 46);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(14,33,true);
    c.setUint32(16,crc,true);c.setUint32(20,file.length,true);c.setUint32(24,file.length,true);c.setUint16(28,file.name.length,true);c.setUint32(42,file.offset,true);result.set(file.name,directoryOffset+46);
    directoryOffset += 46 + file.name.length;
  }
  const e = new DataView(result.buffer, directoryOffset, 22);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,localSize,true);
  return result;
}
