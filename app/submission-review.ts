import type { ImageCheck } from '@/app/quotation-image-review';
import type { ResolvedQuotation } from '@/app/quotation-schema';
import { unsupportedQuotationMedia } from '@/app/quotation-html-review';

export type SubmissionIssue = {
  kind: 'error' | 'review'; code: string; message: string;
  optionId: string | null; optionLabel: string; fieldId: string | null;
};
export type SubmissionReview = {
  productId: string; title: string; sourceUrl: string; checkedAt: string; fingerprint: string;
  categoryId: string | null; categoryPath: string[]; includedOptions: number;
  errorCount: number; reviewCount: number; issues: SubmissionIssue[]; omittedIssueCount: number;
  submissionReady: false; transport: 'not-connected'; limits: string[];
};

/** Readiness is derived from final saved cells, never legacy status badges. */
export function inspectSubmission(resolved: ResolvedQuotation, ownedImageKeys: readonly string[], imageChecks?: ReadonlyMap<string,ImageCheck>) {
  const issues: SubmissionIssue[] = [];
  let errorCount = 0; let reviewCount = 0;
  const add = (issue: SubmissionIssue) => {
    if (issue.kind === 'error') errorCount++; else reviewCount++;
    if (issues.length < 1000) issues.push(issue);
  };
  const general = (code: string, message: string) => add({kind:'error', code, message, optionId:null, optionLabel:'상품 공통', fieldId:null});
  if (!resolved.schema.categoryId) general('CATEGORY_MISSING', '상품의 카테고리를 선택해주세요.');
  if (resolved.schema.status !== 'observed') general('SCHEMA_UNCONFIRMED', '선택한 카테고리의 공식 상품 속성이 아직 확인되지 않았습니다.');
  const rows = resolved.rows.filter(row => row.included);
  if (!rows.length) general('NO_INCLUDED_OPTIONS', '견적에 포함할 옵션을 선택해주세요.');
  for (const message of new Set(resolved.issues)) general('QUOTATION_CONSTRAINT', message);
  const owned = new Set(ownedImageKeys);
  for (const row of rows) {
    const unsupportedMedia = unsupportedQuotationMedia(row.fields.detailHtml?.value ?? '');
    if (unsupportedMedia.length) add({kind:'error', code:'HTML_MEDIA_UNSUPPORTED',
      message:`HTML 상세 내용에 Supplier Hub가 지원하지 않는 형식(${unsupportedMedia.join(', ')})이 있습니다. 이미지로 교체한 뒤 다시 검사해주세요.`,
      optionId:row.optionId, optionLabel:row.optionLabel, fieldId:'detailHtml'});
    // Supplier Hub bulk registration UI observed on 2026-09-23 requires a separate label attachment.
    if (resolved.schema.fields.some(field => field.id === 'labelImages') && !row.fields.labelImages?.value.trim()) {
      add({kind:'error', code:'LABEL_ATTACHMENT_MISSING', message:'제품 필수 표시사항: 라벨 또는 도안 이미지를 저장하고 견적서에 연결해주세요.', optionId:row.optionId, optionLabel:row.optionLabel, fieldId:'labelImages'});
    }
    const mainImages = new Set((row.fields.mainImage?.value ?? '').split('\n').map(key => key.trim()).filter(Boolean));
    if ((row.fields.detailImages?.value ?? '').split('\n').some(key => mainImages.has(key.trim()))) {
      add({kind:'review', code:'MAIN_DETAIL_DUPLICATE', message:'대표 이미지와 상세 이미지에 같은 파일이 연결되어 있습니다. Supplier Hub 화면에서 반려 가능성을 안내하므로 구성을 확인해주세요.', optionId:row.optionId, optionLabel:row.optionLabel, fieldId:'detailImages'});
    }
    for (const field of resolved.schema.fields) {
      const cell = row.fields[field.id];
      const errors = new Set(cell?.validationIssues ?? cell?.issues ?? []);
      if (field.required && !cell?.value.trim() && !errors.size) errors.add('필수값을 입력해주세요.');
      if (field.type === 'images') for (const key of (cell?.value ?? '').split('\n').map(item => item.trim()).filter(Boolean)) {
        if (!owned.has(key)) errors.add('이 상품에 저장된 이미지 연결이 아닙니다.');
        else { const check=imageChecks?.get(key); if(check?.kind==='error') errors.add(check.message); else if(check) add({kind:'review',code:'IMAGE_VERIFICATION',message:`${field.label}: ${check.message}`,optionId:row.optionId,optionLabel:row.optionLabel,fieldId:field.id}); }
      }
      for (const message of errors) add({kind:'error', code:'FIELD_INVALID', message:`${field.label}: ${message}`, optionId:row.optionId, optionLabel:row.optionLabel, fieldId:field.id});
      if (!errors.size && field.id === 'msrp' && cell?.value.trim()) add({kind:'review', code:'MSRP_EVIDENCE_REVIEW',
        message: cell.source === 'pricing' || cell.source === 'product'
          ? '권장소비자가격: 자동 계산 또는 저장 상품의 금액입니다. 제조사 권장가·공식 판매처 가격의 근거와 가격 설정 권한을 확인해주세요. Supplier Hub 약관 동의는 별도입니다.'
          : '권장소비자가격: 직접 입력한 금액도 제조사 권장가·공식 판매처 가격의 근거와 가격 설정 권한을 확인해주세요. 저장은 Supplier Hub 약관 동의가 아닙니다.',
        optionId:row.optionId, optionLabel:row.optionLabel, fieldId:field.id});
      else if (cell?.reviewMessages !== undefined) {
        for (const message of new Set(cell.reviewMessages)) if (cell.value.trim()) add({kind:'review', code:'EVIDENCE_REVIEW',
          message: `${field.label}: ${message}`, optionId:row.optionId, optionLabel:row.optionLabel, fieldId:field.id});
      }
      else if (!errors.size && cell?.needsReview && cell.value.trim()) add({kind:'review', code:'EVIDENCE_REVIEW',
        message:`${field.label}: 실제 상품·증빙과 일치하는지 확인해주세요.`, optionId:row.optionId, optionLabel:row.optionLabel, fieldId:field.id});
    }
  }
  return {categoryId:resolved.schema.categoryId, categoryPath:resolved.schema.categoryPath,
    includedOptions:rows.length, errorCount, reviewCount, issues, omittedIssueCount:errorCount+reviewCount-issues.length,
    submissionReady:false as const, transport:'not-connected' as const,
    limits:['저장된 자료만 검사합니다. 편집 중인 내용은 저장 후 다시 검사해주세요.',
      'HTML 검사는 명시된 미디어 태그·주소·형식만 확인합니다. CSS·스크립트·외부 주소의 실제 파일 내용과 최종 렌더링은 확인하지 않습니다.',
      imageChecks ? '이미지 소유권과 저장소 파일 존재·크기·형식검사 기록을 확인했습니다. 파일 내용 전체·번역 품질·Supplier Hub 업로드 성공은 미검증입니다.' : '이미지 연결 소유권을 검사하며 실제 파일 내용·Supplier Hub 업로드 성공은 검사하지 않습니다.',
      '공식 Excel·이미지·인증·물류 규격과 실제 접수는 미검증입니다. 오류가 없어도 등록 완료를 뜻하지 않습니다.',
      'Supplier Hub 전송 연결이 아직 구현되지 않았습니다. 이 검사는 자료를 전송하거나 등록하지 않습니다.']};
}
