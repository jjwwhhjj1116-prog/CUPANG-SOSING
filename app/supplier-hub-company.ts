import type { WorkspaceMember } from '@/app/workspace-members';

export type SupplierHubCompany = { code: string; name: string };
export function approvedSupplierHubCompany(member?: WorkspaceMember): SupplierHubCompany | null {
  if (!member || member.status !== 'approved') return null;
  const companies: Record<string,string> = { A01526306: '유앤채', A01464742: '와이홉' };
  const code = member.companyCode.trim(), name = member.companyName.trim();
  return companies[code] === name ? { code, name } : null;
}
