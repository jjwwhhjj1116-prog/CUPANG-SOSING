import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getSettings, saveSettings } from '@/db/queries';
import { NextResponse } from 'next/server';

async function ownerId() { return (await getChatGPTUser())?.userId ?? 'local-demo'; }
export async function GET() {
  try { const result = await getSettings(await ownerId()); return NextResponse.json({ settings: result ? JSON.parse(result.payload) : null }); }
  catch { return NextResponse.json({ settings: null }); }
}
export async function PUT(request: Request) {
  const settings = await request.json();
  await saveSettings(await ownerId(), JSON.stringify(settings));
  return NextResponse.json({ settings });
}
