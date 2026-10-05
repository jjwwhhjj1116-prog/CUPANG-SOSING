import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {listManagedProducts} from '@/db/managed-products';
import type {ManagedProductFilter} from '@/app/managed-products';
const headers={'cache-control':'no-store'};
export async function GET(request:Request){
 const access=await managedProductAccess();if(!access)return NextResponse.json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},{status:403,headers});
 const params=new URL(request.url).searchParams,page=Number(params.get('page')??1),pageSize=Number(params.get('pageSize')??25),search=(params.get('search')??'').trim(),filter=params.get('filter')??'all';
 if(!Number.isSafeInteger(page)||page<1||page>10000||![10,25,50].includes(pageSize)||search.length>200||!['all','unavailable','loser','no-purchase','no-import'].includes(filter))return NextResponse.json({error:'목록의 검색·페이지 조건을 확인해주세요.'},{status:400,headers});
 try{return NextResponse.json(await listManagedProducts(access.ownerId,access.company,{page,pageSize,search,filter:filter as ManagedProductFilter}),{headers});}
 catch{return NextResponse.json({error:'상품관리 목록을 읽지 못했습니다. 다시 조회해주세요.'},{status:503,headers});}
}
