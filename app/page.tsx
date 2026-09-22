import { getChatGPTUser } from './chatgpt-auth';
import DashboardClient from './components/dashboard-client';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  if(process.env.NODE_ENV==='production'&&!user?.verifiedAccess)return <main style={{maxWidth:680,margin:'12vh auto',padding:32,fontFamily:'sans-serif'}}><h1>SourceFlow 로그인 확인</h1><p>이 작업 공간은 Cloudflare Access로 보호됩니다. 설정한 사이트 주소로 로그인한 후 다시 열어주세요.</p><p>서버의 Access 팀 도메인과 애플리케이션 인증 설정이 연결돼야 작업 자료를 사용할 수 있습니다.</p></main>;
  return <DashboardClient userName={user?.displayName ?? '로켓셀러'} />;
}
