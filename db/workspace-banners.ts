import { env } from 'cloudflare:workers';
import type { WorkspaceSettings } from '@/app/workspace-settings';
import { workspaceBannerAssignments } from '@/app/workspace-banners';
import { imageFileType, MAX_IMAGE_BYTES } from '@/app/image-files';
import { readBoundedStream, RequestBodyError } from '@/app/request-body';

export async function verifyWorkspaceBannerFiles(owner: string, settings: WorkspaceSettings, activeOnly = false) {
  let assignments;
  try { assignments = workspaceBannerAssignments(settings, owner, activeOnly); }
  catch (error) { throw new RequestBodyError(400, error instanceof Error ? error.message : '공통 이미지 선택을 확인해주세요.'); }
  if (!assignments.length) return;
  if (!env.FILES) throw new Error('이미지 저장소가 연결되지 않았습니다.');
  for (const [, key] of assignments) {
    const file = await env.FILES.get(key, { range: { offset: 0, length: 1024 } });
    if (!file || file.size < 1 || file.size > MAX_IMAGE_BYTES) throw new RequestBodyError(400, '공통 이미지 파일이 없거나 10MB를 초과합니다. 다시 업로드해주세요.');
    try { imageFileType(await readBoundedStream(file.body, 1024)); }
    catch { throw new RequestBodyError(400, '공통 이미지 형식을 확인해주세요. PNG·JPEG·WebP·GIF·AVIF만 지원합니다.'); }
  }
}
