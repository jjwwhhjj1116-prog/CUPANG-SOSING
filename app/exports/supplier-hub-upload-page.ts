import type { supplierHubUploadPlan } from '@/app/exports/supplier-hub-upload-plan';
import { ExportSizeError, utf8ByteLength } from '@/app/exports/zip';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));

/** Local attachment guide only; no network access, scripts or submission controls. */
export function supplierHubUploadPage(plan: ReturnType<typeof supplierHubUploadPlan>) {
  const parts: string[] = []; let bytes = 0;
  const add = (value: string) => {
    bytes += utf8ByteLength(value);
    if (bytes > 6 * 1024 * 1024) throw new ExportSizeError('업로드 준비 화면이 6MB를 초과합니다. 포함 옵션 수를 줄여주세요.');
    parts.push(value);
  };
  add('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'unsafe-inline\'"><title>Supplier Hub 업로드 준비</title><style>body{font:16px/1.6 sans-serif;max-width:1100px;margin:24px auto;padding:20px;color:#17243b}aside{background:#fff5d8;padding:16px;border-radius:12px}section{margin:24px 0;border:1px solid #dce4ef;padding:20px;border-radius:12px}.files{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}article{border:1px solid #dce4ef;padding:12px;overflow-wrap:anywhere}img{width:100%;height:180px;object-fit:contain}a{color:#0068ac}li{margin-bottom:6px}small{display:block}h2{margin-top:0}</style></head><body><h1>Supplier Hub 업로드 준비</h1><aside>압축을 모두 해제한 뒤 이 파일을 열어주세요. 저장된 최종 견적값의 첨부 준비 화면입니다. 업로드·약관 동의·파일 검증·등록은 실행하지 않습니다. 파일 내용과 공식 양식 적합성은 별도 확인이 필요합니다.</aside>');
  add(`<p>카테고리 코드: ${escape(plan.categoryId ?? '미선택')}</p><section><h2>1. 견적서 Excel</h2><p>최신 공식 양식과 출력 파일의 시트·열 연결을 확인해주세요. 이 화면은 Excel 검증 완료를 의미하지 않습니다.</p><p><a href="https://supplier.coupang.com/qvt/registration" target="_blank" rel="noopener noreferrer">Supplier Hub 대량 등록 열기</a></p></section>`);
  for (const [title, files] of [['2. 상품 이미지', plan.productImages], ['3. 제품 필수 표시사항 · 라벨/도안', plan.labelImages]] as const) {
    add(`<section><h2>${title} · ${files.length}개</h2><p>이 영역에 올릴 파일입니다. 파일명을 변경하지 마세요. 여러 옵션이 공유하는 파일은 한 번만 표시합니다.</p><div class="files">`);
    if (!files.length) add('<p>연결된 파일 없음</p>');
    for (const file of files) {
      if (!/^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif|avif)$/i.test(file.archivePath) || file.filename !== file.archivePath.split('/').at(-1)) throw new Error('업로드 준비 화면의 첨부 경로를 확인해주세요.');
      add(`<article><img src="${escape(file.archivePath)}" alt="${escape(file.filename)}" loading="lazy"><a href="${escape(file.archivePath)}" download="${escape(file.filename)}">${escape(file.filename)}</a><small>${escape(file.archivePath)}</small><ul>`);
      for (const ref of file.references) add(`<li>${escape(ref.optionLabel)} (${escape(ref.optionId ?? '공통')}) · ${escape(ref.fieldId)} · ${ref.position}번째</li>`);
      add('</ul></article>');
    }
    add('</div></section>');
  }
  if (plan.missingLabels.length) {
    add('<aside><strong>라벨 연결이 없는 옵션</strong><ul>');
    for (const row of plan.missingLabels) add(`<li>${escape(row.optionLabel)} (${escape(row.optionId ?? '공통')})</li>`);
    add('</ul>견적 편집에서 라벨을 연결하고 다시 내려받아주세요.</aside>');
  }
  add('<section><h2>4. 법적 필수서류 및 동의</h2><p>서류 해당 여부·첨부 파일, 가격 데이터 및 라벨 업무용 연락처 동의는 미확인입니다. 이 목록은 해당없음 선택이나 동의를 대신하지 않습니다.</p></section><p>오류·검토 사유: submission-review.json/CSV · 첨부 참조 원본: supplier-hub-upload-plan.json</p></body></html>');
  return parts.join('');
}
