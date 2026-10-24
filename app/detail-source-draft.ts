import type { DetailWorkspaceRoles } from '@/app/detail-workspace';

/** An explicitly selected saved photo may start a new body between the exact
 * saved top/bottom anchors. A flattened banner list alone cannot tell which
 * side of a lone banner is the body. Does not change source roles or HTML. */
export function startDetailBodyFromSavedPhoto(current: readonly string[], candidate: string, roles: DetailWorkspaceRoles, protectedKeys: readonly string[]): string[] {
  const protectedSet = new Set(protectedKeys), top = new Set(roles.top), bottom = new Set(roles.bottom);
  if (!candidate || protectedSet.has(candidate) || current.includes(candidate)
    || new Set(current).size !== current.length || current.some(key => !protectedSet.has(key))
    || roles.top.some(key => bottom.has(key))
    || current.some(key => !top.has(key) && !bottom.has(key))) throw Error('상단·하단 설정 이미지의 위치를 확인하지 못했습니다. 최신 이미지를 다시 조회해주세요.');
  const firstBottom = current.findIndex(key => bottom.has(key));
  const at = firstBottom < 0 ? current.length : firstBottom;
  if (current.slice(at).some(key => top.has(key))) throw Error('상단·하단 이미지 순서를 확인해주세요.');
  return [...current.slice(0, at), candidate, ...current.slice(at)];
}
