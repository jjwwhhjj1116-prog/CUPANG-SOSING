import type { ResolvedQuotation } from '@/app/quotation-schema';
import type { BundleAsset } from '@/app/exports/review-bundle';
import { ExportSizeError, utf8ByteLength } from '@/app/exports/zip';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

/** Portable local fragments, not public URLs or a verified Hub submission body. */
export function quotationDetailContent(resolved: ResolvedQuotation, assets: readonly BundleAsset[], description: string) {
  const files = new Map(assets.map(asset => [asset.key, asset.name]));
  let bytes = 0;
  const rows = resolved.rows.filter(row => row.included).map(row => {
    const cell = row.fields.detailHtml;
    const manual = cell?.source === 'manual-option' || cell?.source === 'manual-common';
    const names: string[] = [];
    // Manual HTML (including an intentional blank) is authoritative. Do not
    // append the separate image field or restore a removed description to it.
    let html = cell?.value ?? '';
    if (!manual) {
      const keys = (row.fields.detailImages?.value ?? '').split('\n').map(key => key.trim()).filter(Boolean);
      for (const key of keys) {
        const name = files.get(key);
        if (!name || !/^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif|avif)$/i.test(name)) throw new Error('상세 HTML의 첨부 파일 경로를 확인해주세요.');
        names.push(name);
      }
      const paragraph = description ? `<p>${escape(description).replace(/\r?\n/g, '<br>')}</p>` : '';
      const images = names.map((name, index) => `<img src="${escape(name)}" alt="${row.fields.altText?.value ? `${escape(row.fields.altText.value)} ${index + 1}` : ''}" style="display:block;width:100%;height:auto">`).join('');
      html = paragraph || images ? `<div style="width:800px;max-width:100%;margin:0;padding:0">${paragraph}${images}</div>` : '';
    }
    const result = { optionId: row.optionId, optionLabel: row.optionLabel, mode: manual ? 'manual' as const : 'generated' as const, html, images: names };
    bytes += utf8ByteLength(JSON.stringify(result));
    if (bytes > 6 * 1024 * 1024) throw new ExportSizeError('옵션별 상세 HTML 합계가 6MB를 초과합니다. 포함 옵션이나 설명을 줄여주세요.');
    return result;
  });
  return { format: 'yoofam-plus-detail-content-v1', imageBase: 'archive-root-relative', submissionReady: false,
    notice: '압축을 해제한 폴더 기준 이미지 경로입니다. 공개 URL이나 Supplier Hub 접수용으로 검증된 HTML이 아닙니다. 수동 HTML은 원문으로만 보존하며 실행하지 않습니다.', rows };
}
