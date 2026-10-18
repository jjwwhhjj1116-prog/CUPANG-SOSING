import {NextResponse} from 'next/server';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {listRemovedProductsPage} from '@/db/queries';
import {parseRemovedProductsQuery,removedProductsCursor,RemovedProductsQueryError} from '@/app/product-removal-pagination';

export async function GET(request:Request){
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return NextResponse.json({error:'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.'},{status:503});
  try{
    const owner=await getWorkspaceOwnerId(),query=await parseRemovedProductsQuery(new URL(request.url).searchParams,owner),page=await listRemovedProductsPage(owner,query);
    const products=page.products.map(({id,owner_id,title,source_url,updated_at,removed_at,registration_number})=>({id,owner_id,title,source_url,updated_at,removed_at,...(registration_number?{registration_number}:{})}));
    return NextResponse.json({products,nextCursor:page.next?await removedProductsCursor(owner,page.next):null},{headers:{'cache-control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof RemovedProductsQueryError?error.message:'삭제된 상품 목록을 불러오지 못했습니다. 다시 조회해주세요.'},{status:error instanceof RemovedProductsQueryError?400:503,headers:{'cache-control':'no-store'}});}
}
