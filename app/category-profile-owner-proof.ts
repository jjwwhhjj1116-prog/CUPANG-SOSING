import { parseWorkspaceSettingsScope } from '@/app/workspace-settings-scope';

export class CategoryProfileOwnerProofError extends Error {
  constructor(readonly status: 400 | 409, message: string) { super(message); }
}

/** Scope-aware pickers bind mutations to the account that selected the form.
 * Older manual editors remain supported without this optional precondition. */
export function validateCategoryProfileOwnerProof(request: Request, ownerId: string): void {
  if (!request.headers.has('X-YOOFAM-Workspace-Owner')) return;
  const expected = request.headers.get('X-YOOFAM-Workspace-Owner');
  if (!parseWorkspaceSettingsScope({ ownerId: expected, company: null })) throw new CategoryProfileOwnerProofError(400, '올바른 카테고리 선택 계정 정보가 필요합니다.');
  if (expected !== ownerId) throw new CategoryProfileOwnerProofError(409, '카테고리를 선택한 로그인 계정이 변경되었습니다. 기존 설정은 유지하며 현재 계정에서 다시 선택해주세요.');
}
