import { env } from 'cloudflare:workers';
import { parseTemplateText, type TemplateDefinition } from '@/app/category-profiles';
import { inspectXlsx, xlsxHeaders } from '@/app/xlsx-template';

export function templateKey(ownerId: string, sha256: string, format: string) { return `${encodeURIComponent(ownerId)}/category-templates/${sha256}.${format}`; }
export class TemplateValidationError extends Error {}
export function ownsTemplateKey(ownerId: string, key: string): boolean {
  const prefix = `${encodeURIComponent(ownerId)}/category-templates/`;
  return key.startsWith(prefix) && /^[a-f0-9]{64}\.(xlsx|csv|tsv)$/.test(key.slice(prefix.length));
}
export async function validateStoredTemplate(ownerId: string, template: TemplateDefinition | null) {
  if (!template) return;
  if (!template.storageKey || template.storageKey !== templateKey(ownerId, template.sha256, template.format)) throw new TemplateValidationError('견적서 원본 파일을 먼저 저장해주세요.');
  if (!env.FILES) throw new Error('견적서 저장소를 사용할 수 없습니다.');
  const object = await env.FILES.get(template.storageKey);
  if (!object || object.customMetadata?.sha256 !== template.sha256 || object.customMetadata?.format !== template.format) throw new TemplateValidationError('저장된 견적서 원본과 파일 정보가 일치하지 않습니다.');
  const bytes = await object.arrayBuffer();
  let headers: string[];
  if (template.format === 'xlsx') headers = xlsxHeaders(await inspectXlsx(bytes), template.sheetName, template.headerRow);
  else headers = parseTemplateText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), template.format === 'tsv' ? '\t' : ',', template.headerRow);
  if (JSON.stringify(headers.map(value => value.trim())) !== JSON.stringify(template.headers)) throw new TemplateValidationError('견적서 머리글이 원본 파일과 일치하지 않습니다. 다시 연결해주세요.');
}
