import type { WorkspaceSettings } from '@/app/workspace-settings';
import { isOwnedImageKey } from '@/app/image-files';

/** A captured request owns its banner selection; later settings edits never replace it. */
export function workspaceBannerAssignments(settings: WorkspaceSettings, owner: string, activeOnly = true): ['detailTop' | 'detailBottom', string][] {
  const assignments: ['detailTop' | 'detailBottom', string][] = [];
  for (const [role, key, enabled] of [
    ['detailTop', settings.topImageKey ?? '', settings.topImageEnabled],
    ['detailBottom', settings.bottomImageKey ?? '', settings.bottomImageEnabled],
  ] as const) {
    // Legacy enabled switches with no file remain empty, not invented content.
    if (!key || activeOnly && !enabled) continue;
    if (!isOwnedImageKey(owner, key)) throw new Error('공통 이미지는 본인이 업로드한 파일만 사용할 수 있습니다.');
    if (assignments.some(([, previous]) => previous === key)) throw new Error('상단과 하단에는 서로 다른 이미지 파일을 선택해주세요.');
    assignments.push([role, key]);
  }
  return assignments;
}
