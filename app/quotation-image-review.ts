import type { ResolvedQuotation } from '@/app/quotation-schema';
import { MAX_IMAGE_BYTES } from '@/app/image-files';

type ImageObject = { size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string,string> };
export type ImageCheck = { kind: 'error' | 'review'; message: string };
/** Check only included quotation references; never query unowned keys or download object bodies. */
export async function inspectQuotationImages(resolved: ResolvedQuotation, ownedKeys: readonly string[], head?: (key:string)=>Promise<ImageObject|null>) {
 const owned = new Set(ownedKeys);
 const keys = [...new Set(resolved.rows.filter(row=>row.included).flatMap(row=>resolved.schema.fields.filter(field=>field.type==='images').flatMap(field=>(row.fields[field.id]?.value??'').split('\n').map(key=>key.trim()).filter(key=>owned.has(key)))))];
 const checks = new Map<string,ImageCheck>(); let cursor=0;
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
   }catch{checks.set(key,{kind:'error',message:'이미지 저장소 조회에 실패했습니다. 다시 검사해주세요.'});}
  }
 }
 await Promise.all(Array.from({length:Math.min(3,keys.length)},()=>worker()));
 return checks;
}
