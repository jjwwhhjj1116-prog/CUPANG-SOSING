import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { createReviewBundle, imageExtension, type BundleAsset } from '@/app/exports/review-bundle';

export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  if(process.env.NODE_ENV==='production' && !(await getChatGPTUser())?.verifiedAccess)return NextResponse.json({error:'운영 인증 연결 후 다운로드할 수 있습니다.'},{status:503});
  const owner=await getWorkspaceOwnerId();const {id}=await context.params;
  try {
    const product=await findProduct(owner,id);
    if(!product)return NextResponse.json({error:'상품을 찾을 수 없습니다.'},{status:404});
    const content=await readProductContent(owner,id);
    const keys=[...new Set(Object.values(content.assets).flatMap(field=>field.value))];
    const productKeys:unknown=JSON.parse(product.image_keys);
    if(!Array.isArray(productKeys)||keys.length>50||keys.some(key=>!key.startsWith(owner+'/')||!productKeys.includes(key)))return NextResponse.json({error:'상품의 첨부 이미지 참조를 확인해주세요.'},{status:409});
    const assets:BundleAsset[]=[];let total=0;
    for(const [index,key] of keys.entries()) {
      const file=await env.FILES.get(key);
      if(!file)return NextResponse.json({error:'첨부 이미지가 저장소에 없습니다. 이미지 탭에서 참조를 수정해주세요.'},{status:409});
      total+=file.size;if(total>20*1024*1024)return NextResponse.json({error:'이미지 합계는 20MB 이하여야 합니다.'},{status:413});
      const data=new Uint8Array(await file.arrayBuffer());
      let extension;try{extension=imageExtension(data);}catch{return NextResponse.json({error:'지원하지 않는 이미지 형식이 포함되어 있습니다.'},{status:400});}
      assets.push({key,name:`assets/image-${String(index+1).padStart(3,'0')}.${extension}`,data});
    }
    const [latestProduct,latestContent]=await Promise.all([findProduct(owner,id),readProductContent(owner,id)]);
    if(!latestProduct||latestProduct.updated_at!==product.updated_at||latestContent.revision!==content.revision) {
      return NextResponse.json({error:'자료를 묶는 동안 상품 또는 콘텐츠가 변경되었습니다. 저장이 끝난 뒤 다시 다운로드해주세요.'},{status:409});
    }
    const zip=createReviewBundle(product,content,assets);
    return new Response(zip.buffer as ArrayBuffer,{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="sourceflow-review.zip"','cache-control':'no-store','x-content-type-options':'nosniff'}});
  } catch {return NextResponse.json({error:'검토 패키지를 생성하지 못했습니다. 첨부 파일과 저장 상태를 확인해주세요.'},{status:503});}
}
