import { WORKSPACE_ACCOUNTS } from '@/app/workspace-members';

type WorkspaceAccount = typeof WORKSPACE_ACCOUNTS[number];
export type WorkspaceSettingsScope = {
  ownerId: string;
  company: { code: WorkspaceAccount['companyCode']; name: WorkspaceAccount['companyName'] } | null;
};

/** A missing or malformed response cannot bind an editor to an account. */
export function parseWorkspaceSettingsScope(value: unknown): WorkspaceSettingsScope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { ownerId, company } = value as Record<string, unknown>;
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 200 || ownerId !== ownerId.trim() || /[\u0000-\u001f\u007f]/u.test(ownerId)) return null;
  if (company === null) return { ownerId, company: null };
  if (!company || typeof company !== 'object' || Array.isArray(company)) return null;
  const { code, name } = company as Record<string, unknown>;
  const account = WORKSPACE_ACCOUNTS.find(account => account.companyCode === code && account.companyName === name);
  return account ? { ownerId, company: { code: account.companyCode, name: account.companyName } } : null;
}
