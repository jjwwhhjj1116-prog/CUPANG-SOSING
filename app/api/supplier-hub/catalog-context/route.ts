import {NextResponse} from 'next/server';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';

/** Only this member's approved company, never the administrator's member list. */
export async function GET(){
  const headers={'cache-control':'no-store'};
  try{
    const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
    if(!user?.verifiedAccess)return NextResponse.json({error:'회원 로그인이 필요합니다.'},{status:401,headers});
    if(!company)return NextResponse.json({error:'계정 관리에서 승인된 회사코드·회사명을 확인해주세요.'},{status:403,headers});
    return NextResponse.json({ownerId:user.userId,company},{headers});
  }catch{
    return NextResponse.json({code:'YOOFAM_CONTEXT_SERVICE_ERROR',error:'회원·회사 확인 서버가 일시적으로 응답하지 않습니다. 로그인 만료로 확인된 것은 아닙니다.'},{status:503,headers});
  }
}
