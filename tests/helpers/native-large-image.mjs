/** Valid 1px PNG with a large ancillary text chunk, entirely synthetic. */
export function largeNativePng(){
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
 const payload=Buffer.concat([Buffer.from('Comment\0'),Buffer.alloc(1024*1024,97)]),type=Buffer.from('tEXt'),size=Buffer.alloc(4),checksum=Buffer.alloc(4);
 size.writeUInt32BE(payload.length);let crc=0xffffffff;
 for(const byte of Buffer.concat([type,payload])){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 checksum.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([png.subarray(0,33),size,type,payload,checksum,png.subarray(33)]);
}
