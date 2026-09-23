import type { ResolvedQuotation } from '@/app/quotation-schema';
import type { BundleAsset } from '@/app/exports/review-bundle';
import { ExportSizeError, utf8ByteLength } from '@/app/exports/zip';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

/** Final quotation references only. Never render saved HTML or remote image URLs. */
export function quotationImageIndex(resolved: ResolvedQuotation, assets: readonly BundleAsset[]): string {
  const files = new Map(assets.map(asset => [asset.key, asset.name]));
  const parts: string[] = []; let bytes = 0;
  const add = (text: string) => {
    bytes += utf8ByteLength(text);
    if (bytes > 6 * 1024 * 1024) throw new ExportSizeError('이미지 검토 페이지가 6MB를 초과합니다. 포함 옵션 수를 줄여주세요.');
    parts.push(text);
  };
  add('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>옵션별 견적 이미지 검토</title><style>body{font-family:sans-serif;max-width:1100px;margin:24px auto;padding:16px;color:#17243b}section{border-top:2px solid #dce4ef;margin-top:24px}ul{display:flex;flex-wrap:wrap;gap:16px;padding:0;list-style:none}li{width:220px;overflow-wrap:anywhere}img{width:220px;height:180px;object-fit:contain;border:1px solid #dde3eb}small{display:block}aside{padding:16px;background:#fff5d8}</style></head><body><h1>옵션별 견적 이미지 검토</h1><aside>저장한 최종 견적값 기준입니다. 압축을 모두 해제한 뒤 열어주세요. 표시한 파일명은 Excel 이미지 셀과 동일합니다. 이미지 번역·내용 적합성·Supplier Hub 접수는 별도 검증이 필요합니다. 미저장 편집과 제외 옵션은 포함하지 않습니다.</aside>');
  add(`<p>카테고리: ${escape(resolved.schema.categoryPath.join(' > '))} (${escape(resolved.schema.categoryId ?? '미연결')})</p>`);
  const fields = resolved.schema.fields.filter(field => field.type === 'images');
  for (const row of resolved.rows.filter(row => row.included)) {
    add(`<section><h2>${escape(row.optionLabel)}</h2><p>옵션 ID: ${escape(row.optionId ?? '상품 공통값')}</p>`);
    for (const field of fields) {
      const cell = row.fields[field.id];
      const keys = (cell?.value ?? '').split('\n').map(key => key.trim()).filter(Boolean);
      add(`<h3>${escape(field.label)}</h3>`);
      if (!keys.length) { add('<p>연결된 이미지 없음</p>'); continue; }
      add('<ul>');
      for (const [index, key] of keys.entries()) {
        const name = files.get(key);
        if (!name || !/^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif|avif)$/i.test(name)) throw new Error('견적 이미지의 첨부 파일 경로를 확인해주세요.');
        add(`<li><img src="${escape(name)}" alt="${escape(field.label)} ${index + 1}" loading="lazy"><strong>${index + 1}. ${escape(name.split('/').at(-1)!)}</strong><small>첨부 위치: ${escape(name)}</small></li>`);
      }
      add('</ul>');
    }
    add('</section>');
  }
  add('</body></html>');
  return parts.join('');
}
