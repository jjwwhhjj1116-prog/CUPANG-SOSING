import type { WorkspaceMember } from '@/app/workspace-members';

export type SupplierHubCompany = { code: string; name: string };
export const SUPPLIER_HUB_COMPANIES:readonly SupplierHubCompany[]=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
export function supplierHubCompany(code:unknown,name:unknown):SupplierHubCompany|null{
  if(typeof code!=='string'||typeof name!=='string')return null;
  const matched=SUPPLIER_HUB_COMPANIES.find(company=>company.code===code.trim()&&company.name===name.trim());
  return matched?{...matched}:null;
}
export function approvedSupplierHubCompany(member?: WorkspaceMember): SupplierHubCompany | null {
  if (!member || member.status !== 'approved') return null;
  return supplierHubCompany(member.companyCode,member.companyName);
}
