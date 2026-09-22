import { NextResponse } from 'next/server';
import { integrationBlock } from '@/app/workflow';

// Fail closed even if legacy endpoint/key environment variables are present.
// A real adapter requires observed protocol, per-product evidence and approval.
export async function POST() {
  return NextResponse.json(integrationBlock, { status: 501 });
}
