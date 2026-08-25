import { getChatGPTUser } from './chatgpt-auth';
import DashboardClient from './components/dashboard-client';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  return <DashboardClient userName={user?.displayName ?? '로켓셀러'} />;
}
