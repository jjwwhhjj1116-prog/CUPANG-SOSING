import type { ResolvedQuotation } from '@/app/quotation-schema';
import type { BundleAsset } from '@/app/exports/review-bundle';

type Reference = { optionId: string | null; optionLabel: string; fieldId: string; position: number };
type Attachment = { key: string; archivePath: string; filename: string; references: Reference[] };

/** A local manifest, not an upload command or a record of external consent. */
export function supplierHubUploadPlan(resolved: ResolvedQuotation, assets: readonly BundleAsset[]) {
  const groups = { productImages: new Map<string, Attachment>(), labelImages: new Map<string, Attachment>() };
  const byKey = new Map<string, BundleAsset>();
  const filenames = new Set<string>();
  for (const asset of assets) {
    if (!/^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif|avif)$/i.test(asset.name)) throw new Error('업로드 계획의 이미지 경로를 확인해주세요.');
    const filename = asset.name.split('/').at(-1)!;
    if (byKey.has(asset.key) || filenames.has(filename.toLowerCase())) throw new Error('업로드 계획에 중복된 이미지 참조 또는 파일명이 있습니다.');
    byKey.set(asset.key, asset); filenames.add(filename.toLowerCase());
  }
  const missingLabels: { optionId: string | null; optionLabel: string }[] = [];
  for (const row of resolved.rows.filter(row => row.included)) {
    if (!row.fields.labelImages?.value.trim()) missingLabels.push({ optionId: row.optionId, optionLabel: row.optionLabel });
    for (const field of resolved.schema.fields.filter(field => field.type === 'images')) {
      if (!['mainImage', 'additionalImages', 'detailImages', 'labelImages'].includes(field.id)) throw new Error('업로드 영역을 확인하지 않은 이미지 항목입니다.');
      const group = field.id === 'labelImages' ? groups.labelImages : groups.productImages;
      const keys = (row.fields[field.id]?.value ?? '').split('\n').map(key => key.trim()).filter(Boolean);
      keys.forEach((key, index) => {
        const asset = byKey.get(key);
        if (!asset) throw new Error('업로드 계획에 연결한 이미지 파일이 누락되었습니다.');
        let attachment = group.get(key);
        if (!attachment) {
          attachment = { key, archivePath: asset.name, filename: asset.name.split('/').at(-1)!, references: [] };
          group.set(key, attachment);
        }
        attachment.references.push({ optionId: row.optionId, optionLabel: row.optionLabel, fieldId: field.id, position: index + 1 });
      });
    }
  }
  return { format: 'sourceflow-supplier-hub-upload-plan-v1',
    destination: 'https://supplier.coupang.com/qvt/registration', categoryId: resolved.schema.categoryId,
    submissionReady: false, uploaded: false,
    quotation: { status: 'official-template-verification-required' },
    productImages: [...groups.productImages.values()], labelImages: [...groups.labelImages.values()], missingLabels,
    legalDocuments: { status: 'applicability-and-files-unverified' },
    agreements: { priceData: 'unconfirmed', labelBusinessContact: 'unconfirmed' },
    limits: ['화면에서 관찰한 업로드 영역별 준비 목록입니다. 파일을 업로드하거나 동의·검증·등록하지 않습니다.',
      '원래 저장 자료의 미사용 이미지와 제외 옵션 전용 이미지는 이 목록에서 제외합니다.',
      '첨부 파일명은 견적 이미지 셀과 동일합니다. 최신 공식 Excel 및 파일 내용 적합성은 별도 확인해야 합니다.'],
  };
}
