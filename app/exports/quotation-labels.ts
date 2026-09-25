import type { ResolvedQuotation } from '@/app/quotation-schema';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { ExportSizeError, utf8ByteLength } from '@/app/exports/zip';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** Review the same resolved label values used by the option PNG editor. */
export function quotationLabelsPage(resolved: ResolvedQuotation): string {
  const parts: string[] = []; let bytes = 0;
  const add = (part: string) => {
    bytes += utf8ByteLength(part);
    if (bytes > 6 * 1024 * 1024) throw new ExportSizeError('옵션별 표시사항 검토 파일이 6MB를 초과합니다. 포함 옵션 수나 표시사항 내용을 줄여주세요.');
    parts.push(part);
  };
  add('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>최종 견적 표시사항 검토</title><style>body{font-family:sans-serif;max-width:960px;margin:24px auto;padding:16px;color:#17243b;line-height:1.6}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:10px;border:1px solid #dce4ef;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{width:30%}section{margin-top:32px;break-inside:avoid}aside{padding:16px;background:#fff5d8}p{white-space:pre-wrap}</style></head><body><h1>최종 견적 표시사항 검토</h1><aside>저장된 최종 견적값 기준입니다. 원래 상품 표시사항과 다른 옵션별 수정값도 반영합니다. 실제 제품 부착용 라벨이나 Supplier Hub 접수 완료 자료가 아닙니다.</aside>');
  for (const row of resolved.rows.filter(row => row.included)) {
    add(`<section><h2>${escape(row.optionLabel)}</h2><p>옵션 ID: ${escape(row.optionId ?? '상품 공통값')}</p>`);
    const identity = new Set(['title', 'model', 'brand', 'manufacturer', 'color', 'quantity', 'size']);
    const hasValues = resolved.schema.fields.some(field => (identity.has(field.id) || field.section === 'legal') && row.fields[field.id]?.value.trim());
    if (!resolved.schema.categoryId || !hasValues) {
      add('<p>카테고리 또는 표시사항 값이 부족합니다. 견적 입력에서 확인해주세요.</p></section>');
      continue;
    }
    const plan = quotationLabelPlan(resolved, row.optionId);
    add(`<p>${escape(plan.subtitle ?? '')}</p><table><tbody>`);
    for (const [name, value] of plan.rows) add(`<tr><th scope="row">${escape(name)}</th><td>${escape(value)}</td></tr>`);
    add(`</tbody></table><p>${escape(plan.footer ?? '')}</p></section>`);
  }
  add('</body></html>');
  return parts.join('');
}
