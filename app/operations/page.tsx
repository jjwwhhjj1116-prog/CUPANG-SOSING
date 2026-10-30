import Link from 'next/link';
import {managedProductAccess} from '@/app/managed-product-access';
import OperationsClient from './operations-client';
import './operations.css';
export const dynamic='force-dynamic';
export default async function OperationsPage(){
 const access=await managedProductAccess();
 if(!access)return <main style={{maxWidth:640,margin:'12vh auto',padding:32}}><h1>YOOFAM 운영관리</h1><p>승인된 회사가 연결된 회원으로 로그인해 주세요. 상품·재고·매출·손익은 회원과 회사별로 보관합니다.</p><p><Link href="/login?returnTo=%2Foperations">로그인</Link> · <Link href="/account">계정 정보</Link> · <Link href="/">상품등록 스튜디오</Link></p></main>;
 return <OperationsClient/>;
}
