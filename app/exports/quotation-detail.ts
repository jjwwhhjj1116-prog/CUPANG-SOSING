import type { ResolvedQuotation } from '@/app/quotation-schema';
import type { BundleAsset } from '@/app/exports/review-bundle';
import { ExportSizeError, utf8ByteLength } from '@/app/exports/zip';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
/** Local review only: final image order, with manual HTML preserved as inert source. */
export function quotationDetailPage(resolved: ResolvedQuotation, assets: readonly BundleAsset[], description: string): string {
  const files = new Map(assets.map(asset => [asset.key, asset.name]));
  const parts: string[] = []; let bytes = 0;
  const add = (text: string) => {
    bytes += utf8ByteLength(text);
    if (bytes > 6 * 1024 * 1024) throw new ExportSizeError('상세페이지 검토 파일이 6MB를 초과합니다. 옵션 수나 상세 설명을 줄여주세요.');
    parts.push(text);
  };
  add('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'unsafe-inline\'"><title>옵션별 상세페이지 검토</title><style>body{font-family:sans-serif;max-width:860px;margin:24px auto;padding:16px;color:#17243b;line-height:1.6}section{border-top:2px solid #dce4ef;margin-top:32px}figure{margin:0}img{display:block;width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit}aside{padding:16px;background:#fff5d8}figcaption{font-size:12px;color:#64748b}</style></head><body><h1>옵션별 상세페이지 검토</h1><aside>압축을 모두 해제한 뒤 열어주세요. 최종 견적서의 상세 이미지 순서와 설명을 함께 확인하는 내부 검토 자료입니다. 외부 접수용 HTML이나 공개 이미지 주소가 아니며 Supplier Hub 등록에 사용할 수 있는지 별도 검증이 필요합니다.</aside>');
  for (const row of resolved.rows.filter(row => row.included)) {
    const html = row.fields.detailHtml;
    const manual = html?.source === 'manual-option' || html?.source === 'manual-common';
    add(`<section><h2>${escape(row.fields.title?.value ?? row.optionLabel)}</h2><p>${escape(row.optionLabel)} · ${escape(row.optionId ?? '상품 공통값')}</p>`);
    if (manual) {
      add('<aside>수동 HTML이 적용된 옵션입니다. 아래 이미지는 별도 상세 이미지 필드의 순서이며, 수동 HTML을 렌더링한 결과가 아닙니다.</aside>');
      add(`<details open><summary>보존된 수동 HTML 원문${html.value ? '' : ' · 직접 비움'}</summary><pre>${escape(html.value)}</pre></details>`);
    } else if (description) add(`<pre>${escape(description)}</pre>`);
    const keys = (row.fields.detailImages?.value ?? '').split('\n').map(key => key.trim()).filter(Boolean);
    if (!keys.length) add('<p>최종 견적서에 연결된 상세 이미지가 없습니다.</p>');
    for (const [index, key] of keys.entries()) {
      const name = files.get(key);
      if (!name || !/^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif|avif)$/i.test(name)) throw new Error('상세페이지 이미지의 첨부 파일 경로를 확인해주세요.');
      add(`<figure><img src="${escape(name)}" alt="상세 이미지 ${index + 1}" loading="lazy"><figcaption>${index + 1}. ${escape(name.split('/').at(-1)!)}</figcaption></figure>`);
    }
    add('</section>');
  }
  add('</body></html>');
  return parts.join('');
}
