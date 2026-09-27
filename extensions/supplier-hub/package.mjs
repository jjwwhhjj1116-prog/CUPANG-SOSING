const MAX = 30 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({length:256}, (_, n) => {
  for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0);
  return n>>>0;
});
function crc(bytes) { let n=0xffffffff; for(const b of bytes)n=(n>>>8)^crcTable[(n^b)&255]; return (n^0xffffffff)>>>0; }

// Accept only the bounded, uncompressed archive emitted by the app's zipFiles.
// Never run, render or extract archive content to the filesystem.
export function readPackageZip(bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX)throw Error('ZIP 파일은 30MB 이하여야 합니다.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), end=bytes.length-22;
  if(view.getUint32(end,true)!==0x06054b50||view.getUint16(end+20,true)!==0||view.getUint32(end+4,true)!==0)throw Error('YOOFAM PLUS 원본 ZIP을 선택해주세요.');
  const count=view.getUint16(end+10,true), size=view.getUint32(end+12,true), start=view.getUint32(end+16,true);
  if(!count||count>200||count!==view.getUint16(end+8,true)||start+size!==end)throw Error('ZIP 목록이 올바르지 않습니다.');
  const files=new Map();let central=start,local=0;
  for(let i=0;i<count;i++){
    if(central+46>end||view.getUint32(central,true)!==0x02014b50)throw Error('ZIP 목록이 손상되었습니다.');
    const flags=view.getUint16(central+8,true),method=view.getUint16(central+10,true),check=view.getUint32(central+16,true),packed=view.getUint32(central+20,true),length=view.getUint32(central+24,true),n=view.getUint16(central+28,true),extra=view.getUint16(central+30,true),comment=view.getUint16(central+32,true),offset=view.getUint32(central+42,true);
    if(flags!==0x800||method!==0||packed!==length||extra||comment||offset!==local||central+46+n>end||local+30+n+length>start)throw Error('지원하지 않거나 손상된 ZIP입니다.');
    const name=decoder.decode(bytes.subarray(central+46,central+46+n));
    if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.split('/').some(p=>!p||p==='..')||files.has(name))throw Error('ZIP 파일명이 올바르지 않습니다.');
    if(view.getUint32(local,true)!==0x04034b50||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method||view.getUint32(local+14,true)!==check||view.getUint32(local+18,true)!==length||view.getUint32(local+22,true)!==length||view.getUint16(local+26,true)!==n||view.getUint16(local+28,true)!==0||decoder.decode(bytes.subarray(local+30,local+30+n))!==name)throw Error('ZIP 파일 헤더가 일치하지 않습니다.');
    const data=bytes.subarray(local+30+n,local+30+n+length);
    if(crc(data)!==check)throw Error('ZIP 파일 내용이 손상되었습니다.');
    files.set(name,data);central+=46+n;local+=30+n+length;
  }
  if(central!==end||local!==start)throw Error('ZIP 경계가 올바르지 않습니다.');
  return files;
}

export async function prepareAttachments(bytes) {
  const files=readPackageZip(bytes);
  const manifest=files.get('supplier-hub-upload-plan.json');
  if(!manifest||manifest.length>2*1024*1024)throw Error('업로드 준비 목록이 없습니다. 앱에서 ZIP을 다시 준비해주세요.');
  const plan=JSON.parse(decoder.decode(manifest));
  if(plan.format!=='sourceflow-supplier-hub-upload-plan-v1'||plan.destination!=='https://supplier.coupang.com/qvt/registration'||typeof plan.categoryId!=='string'||!plan.categoryId.trim())throw Error('상품 카테고리와 업로드 준비 목록을 확인해주세요.');
  const quote=plan.quotation?.file;
  if(!quote||!/^YOOFAM-[a-f0-9]{64}\.xlsx$/.test(quote.filename))throw Error('공식 Excel 양식으로 작성한 XLSX가 필요합니다. CSV/TSV는 전송하지 않습니다.');
  const data=files.get(quote.filename);
  if(!data||data.length!==quote.byteLength||!/^\w{64}$/.test(quote.sha256)||data[0]!==0x50||data[1]!==0x4b)throw Error('견적서 첨부 정보가 일치하지 않습니다.');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==quote.sha256)throw Error('견적서 파일이 검사 이후 변경되었습니다.');
  const file=(name,bytes)=>({name,base64:encodeBase64(bytes)});
  const group=items=>{
    if(!Array.isArray(items)||items.length>200)throw Error('이미지 첨부 목록을 확인해주세요.');
    const seen=new Set();return items.map(item=>{
      if(!item||!/^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif|avif)$/i.test(item.archivePath)||item.filename!==item.archivePath.split('/').at(-1)||seen.has(item.filename))throw Error('이미지 파일명과 첨부 목록이 일치하지 않습니다.');
      seen.add(item.filename);const data=files.get(item.archivePath);if(!data?.length)throw Error('이미지 첨부가 누락되었습니다.');
      return file(item.filename,data);
    });
  };
  const productImages=group(plan.productImages),labelImages=group(plan.labelImages);
  if(!labelImages.length||!Array.isArray(plan.missingLabels)||plan.missingLabels.length)throw Error('모든 포함 옵션의 표시사항 라벨을 연결해주세요.');
  return {categoryId:plan.categoryId,quotation:[file(quote.filename,data)],productImages,labelImages};
}
function encodeBase64(bytes){let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);}
