import { getChatGPTUser } from './chatgpt-auth';
import DashboardClient from './components/dashboard-client';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let accessMessage = 'Cloudflare Access 로그인 상태를 확인해주세요.';
  const user = await getChatGPTUser(error => { accessMessage = `${error.message} (${error.code}${error.stage ? `/${error.stage}` : ''})`; });
  if(process.env.NODE_ENV==='production'&&!user?.verifiedAccess)return <main style={{maxWidth:680,margin:'12vh auto',padding:32,fontFamily:'sans-serif'}}><h1>SourceFlow 로그인 확인</h1><p>이 작업 공간은 Cloudflare Access로 보호됩니다.</p><p>{accessMessage}</p><a href="/">다시 확인</a></main>;
  return <DashboardClient userName={user?.displayName ?? '로켓셀러'} />;
}
