// Uncompressed ZIP with UTF-8 filenames. Bounded at the caller for Worker memory.
// No third-party runtime dependency or external service is needed.
const encoder = new TextEncoder();
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipFiles(files: { name: string; data: Uint8Array | string }[]) {
  if (!files.length || files.length > 200) throw new Error('첨부 파일 수를 확인해주세요.');
  const names = new Set<string>();
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0, centralSize = 0;
  for (const file of files) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(file.name) || file.name.startsWith('/') || file.name.split('/').some(part=>part==='..'||!part) || names.has(file.name)) throw new Error('잘못되거나 중복된 파일명입니다.');
    names.add(file.name);
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    if (offset + data.length > 30 * 1024 * 1024) throw new Error('검토 패키지는 30MB 이하여야 합니다.');
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(12,33,true);
    h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);
    const entry = new Uint8Array(46 + name.length), c = new DataView(entry.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(14,33,true);
    c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);entry.set(name,46);
    local.push(header,data);central.push(entry);offset += header.length+data.length;centralSize+=entry.length;
  }
  const end=new Uint8Array(22), e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  const result=new Uint8Array(offset+centralSize+end.length);let position=0;
  for(const part of [...local,...central,end]){result.set(part,position);position+=part.length;}
  return result;
}
