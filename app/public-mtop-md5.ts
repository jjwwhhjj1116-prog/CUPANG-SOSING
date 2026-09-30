/** UTF-8 MD5 for Alibaba's public lib-mtop request format only.
 * This is a protocol checksum, never a password or authentication scheme. */
export function publicMtopMd5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer), bits = bytes.length * 8;
  view.setUint32(data.length - 8, bits >>> 0, true);
  view.setUint32(data.length - 4, Math.floor(bits / 0x100000000), true);
  const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let offset = 0; offset < data.length; offset += 64) {
    const initial = [a,b,c,d];
    for (let i = 0; i < 64; i++) {
      const round = i >>> 4;
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const word = round === 0 ? i : round === 1 ? (5*i+1)%16 : round === 2 ? (3*i+5)%16 : (7*i)%16;
      const sum = (a + f + Math.floor(Math.abs(Math.sin(i+1)) * 0x100000000) + view.getUint32(offset + word*4, true)) | 0;
      const shift = shifts[round*4 + i%4], next = (b + ((sum << shift) | (sum >>> (32-shift)))) | 0;
      a = d; d = c; c = b; b = next;
    }
    a = (a + initial[0]) | 0; b = (b + initial[1]) | 0; c = (c + initial[2]) | 0; d = (d + initial[3]) | 0;
  }
  const result = new DataView(new ArrayBuffer(16));
  [a,b,c,d].forEach((word,index) => result.setUint32(index*4,word,true));
  return Array.from(new Uint8Array(result.buffer),byte => byte.toString(16).padStart(2,'0')).join('');
}
