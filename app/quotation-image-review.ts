import type { ResolvedQuotation } from '@/app/quotation-schema';
import { MAX_IMAGE_BYTES } from '@/app/image-files';

type ImageObject = { size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string,string> };
export type ImageCheck = { kind: 'error' | 'review'; message: string };
/** Check only included quotation references; never query unowned keys or download object bodies. */
export async function inspectQuotationImages(resolved: ResolvedQuotation, ownedKeys: readonly string[], head?: (key:string)=>Promise<ImageObject|null>) {
 const owned = new Set(ownedKeys);
 const keys = [...new Set(resolved.rows.filter(row=>row.included).flatMap(row=>resolved.schema.fields.filter(field=>field.type==='images').flatMap(field=>(row.fields[field.id]?.value??'').split('\n').map(key=>key.trim()).filter(key=>owned.has(key)))))];
 const checks = new Map<string,ImageCheck>(); let cursor=0;
 const roles = new Map<string, Set<string>>();
 for (const row of resolved.rows.filter(row => row.included)) for (const id of ['mainImage', 'detailImages']) {
  for (const key of (row.fields[id]?.value ?? '').split('\n').map(value => value.trim()).filter(key => owned.has(key))) {
   if (!roles.has(key)) roles.set(key, new Set());
   roles.get(key)!.add(id);
  }
 }
 async function worker(){
  while(cursor<keys.length){
   const key=keys[cursor++];
   if(!head){checks.set(key,{kind:'error',message:'이미지 저장소 연결을 확인해주세요.'});continue;}
   try{
    const object=await head(key);
    if(!object)checks.set(key,{kind:'error',message:'저장소에 이미지 파일이 없습니다. 다시 저장해주세요.'});
    else if(!Number.isFinite(object.size)||object.size<=0||object.size>MAX_IMAGE_BYTES)checks.set(key,{kind:'error',message:'저장 이미지 크기가 허용 범위를 벗어났습니다.'});
    else if(!/^image\/(png|jpeg|webp|gif|avif)$/i.test(object.httpMetadata?.contentType??''))checks.set(key,{kind:'error',message:'저장 이미지 형식을 확인해주세요.'});
    else if(object.customMetadata?.imageValidation!=='header-v1')checks.set(key,{kind:'review',message:'저장 시 이미지 형식검사 기록이 없습니다. 파일을 확인하거나 다시 업로드해주세요.'});
    else if (roles.has(key)) {
     const metadata = object.customMetadata;
     const width = Number(metadata.imageWidth), height = Number(metadata.imageHeight);
     if (metadata.dimensionValidation !== 'header-v1' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      checks.set(key, {kind:'review',message:'이미지 픽셀 크기를 확인할 기록이 없습니다. 원본 크기를 확인하거나 다시 업로드해주세요. AVIF 등 크기를 읽지 못하는 형식은 별도 확인이 필요합니다.'});
     } else {
      const messages: string[] = [];
      if (roles.get(key)!.has('mainImage') && (width < 1000 || height < 1000)) messages.push('대표 이미지는 1,000×1,000px 이상 권장');
      if (roles.get(key)!.has('detailImages') && (width !== 780 || height > 1500)) messages.push('상세 이미지는 개당 가로 780px·세로 1,500px 이내 안내');
      if (messages.length) checks.set(key, {kind:'review',message:`저장 이미지 ${width}×${height}px: ${messages.join(' / ')}. Supplier Hub 안내와 비교해 편집해주세요. 픽셀 수는 헤더 기준이며 화질·실제 접수 검증은 아닙니다.`});
     }
    }
   }catch{checks.set(key,{kind:'error',message:'이미지 저장소 조회에 실패했습니다. 다시 검사해주세요.'});}
  }
 }
 await Promise.all(Array.from({length:Math.min(3,keys.length)},()=>worker()));
 return checks;
}
