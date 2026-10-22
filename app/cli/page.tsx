import {redirect} from 'next/navigation';
import Link from 'next/link';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {CliConnectionPanel} from '@/app/components/cli-connection-panel';

export const dynamic='force-dynamic';
export default async function CliConnectionPage(){
 const user=await getChatGPTUser();
 if(!user?.verifiedAccess)redirect('/login?next=%2Fcli');
 const company=approvedSupplierHubCompany(user.membership);
 if(!company)return <main style={{maxWidth:760,margin:'10vh auto',padding:24}}><h1>YOOFAM 스튜디오 CLI</h1><p>승인된 회원의 회사코드·회사명이 필요합니다. 계정 관리에서 현재 회사 승인을 확인해주세요.</p><Link className="btn ghost" href="/">스튜디오로 돌아가기</Link></main>;
 return <CliConnectionPanel initialScope={{ownerId:user.userId,company}} displayName={user.displayName}/>;
}
