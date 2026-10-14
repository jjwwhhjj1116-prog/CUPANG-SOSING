import { env } from 'cloudflare:workers';
import { readQuotationExportSource, resolveQuotationExport, quotationExportFingerprint } from '@/app/exports/quotation-source';
import { readQuotationFields, quotationSourcesCurrent } from '@/db/quotation-fields';
import { productImageKeys } from '@/app/product-content';
import { loadAttachments } from '@/app/exports/attachments';
import { publicDetailConfig, publicDetailVersion } from '@/app/quotation-public-detail';
import { projectSupplierHubSingleDocument } from '@/app/supplier-hub-single-projection';
import { buildSingleAssetPlan, singleAssetSelection, singleAssetPackageView, publishSingleAssets, verifySingleAssets, SingleAssetError } from '@/app/supplier-hub-single-assets';
import { collectionSourceReview } from '@/app/collection-source-review';
import { readLegalDocuments, inspectLegalDocumentStorage } from '@/app/legal-documents';
import { fingerprint } from '@/app/automation/model';

import type {SupplierHubCompany} from '@/app/supplier-hub-company';

function changed(): never { throw new SingleAssetError('준비 중 상품·견적값·이미지·회사 또는 카테고리가 변경되었습니다. 다시 검토해주세요.', 'SINGLE_SOURCE_CHANGED'); }

/** Shared current-source proof. A read never publishes assets or contacts Hub. */
export async function loadSinglePackage(owner:string,id:string,profileId:string|null,company:SupplierHubCompany,active:()=>Promise<void>,prepare=false,expectedFingerprint?:string){
    const saved = await readQuotationExportSource(owner, id, profileId);
    if (!saved.hubSchema || !saved.company || saved.company.code !== company.code || saved.company.name !== company.name || !saved.categoryContext.categoryId)
      throw new SingleAssetError('이 상품 회사·카테고리의 검증된 Single 원문 양식이 필요합니다.', 'SINGLE_SCHEMA');
    const config = publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]);
    const sourceFingerprint = await quotationExportFingerprint(saved, null), configVersion = await publicDetailVersion(config);
    const projection = await projectSupplierHubSingleDocument({ snapshot: saved.hubSchema, company, categoryId: saved.categoryContext.categoryId,
      categoryPath: saved.categoryContext.categoryPath, resolved: resolveQuotationExport(saved) });
    const ownedKeys = productImageKeys(saved.product.image_keys), selection = singleAssetSelection(projection, owner, ownedKeys);
    // Invalid/unknown refs stay blocking in the plan; they never cause a read of
    // an unowned key. Selected bytes are strictly bounded by loadAttachments.
    const assets = await loadAttachments(owner, saved.product.image_keys, selection.keys);
    const metadata = new Map(await Promise.all(selection.keys.map(async key => [key, await env.FILES.head(key)] as const)));
    const documents = readLegalDocuments(saved.content.legalDocuments, owner, id);
    const sourceIssues = [...collectionSourceReview(saved.sourceGaps), ...(saved.generatedProductLabelIssues ?? []),
      ...await inspectLegalDocumentStorage(documents, id, key => env.FILES.head(key))];
    if (documents.applicability === 'required') sourceIssues.push({ kind: 'error', code: 'SINGLE_LEGAL_DOCUMENT_TRANSPORT_UNVERIFIED', optionId: null,
      optionLabel: '법적 필수서류', fieldId: null, message: '필수 원본 서류의 Single 파일 연결 형식은 별도 확인이 필요합니다. 저장한 서류는 변경하지 않습니다.' });
    if (documents.applicability === 'unconfirmed') sourceIssues.push({ kind: 'review', code: 'SINGLE_LEGAL_APPLICABILITY_UNCONFIRMED', optionId: null,
      optionLabel: '법적 필수서류', fieldId: null, message: '실제 상품의 법적 서류 해당 여부를 확인해주세요. 미확인을 해당없음으로 바꾸지 않았습니다.' });
    const plan = await buildSingleAssetPlan({ projection, owner, productId: id, ownedKeys, assets, metadata, config, sourceIssues });
    const packageFingerprint = await fingerprint({ format: 'yoofam-supplier-hub-single-package-v1', sourceFingerprint, configVersion,
      sourceAssetFingerprint: plan.sourceAssetFingerprint, payload: plan.payload, manifest: plan.manifest, issues: plan.issues });
    if (expectedFingerprint !== undefined && expectedFingerprint !== packageFingerprint) changed();
    const guard = async (file?: (typeof plan.files)[number]) => {
      await active();
      if (!await quotationSourcesCurrent(owner, id, saved.source) || (await readQuotationFields(owner, id)).revision !== saved.state.revision) changed();
      const latest = await readQuotationExportSource(owner, id, profileId);
      if (await quotationExportFingerprint(latest, null) !== sourceFingerprint
        || JSON.stringify(await publicDetailVersion(publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]))) !== JSON.stringify(configVersion)) changed();
      if (file) {
        const stored = await env.FILES.get(file.key), currentMetadata = await env.FILES.head(file.key);
        if (!stored || !currentMetadata || JSON.stringify(currentMetadata) !== JSON.stringify(metadata.get(file.key))) changed();
        const bytes = new Uint8Array(await stored.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (bytes.byteLength !== file.byteLength || sha256 !== file.sha256) changed();
      }
      await active();
    };
    await guard();
    if (prepare && plan.canPrepare) {
      await publishSingleAssets(plan, env.FILES, guard);
      // Re-read every selected private file after publication. A source edit
      // never silently turns an older immutable capability into a current one.
      for (const file of plan.files) await guard(file);
    }
    const published = plan.canPrepare && await verifySingleAssets(plan, env.FILES, guard);
    await guard();
    const view = { ...singleAssetPackageView(plan, published), productId: id, requestedProfileId: profileId, fingerprint: packageFingerprint,
      source: { productVersion: saved.product.updated_at, contentRevision: saved.content.revision, optionRevision: saved.options.revision,
        quotationRevision: saved.state.revision, profileId: saved.categoryContext.profileId, profileRevision: saved.profile?.revision ?? null },
      options: resolveQuotationExport(saved).rows.filter(row => row.included).map(row => ({ optionId: row.optionId, optionLabel: row.optionLabel })),
      excludedOptions: saved.options.rows.filter(row => !row.included).map(row => ({ optionId: row.id, translatedName: row.translatedName })) };
    return { view, saved, guard };
}
