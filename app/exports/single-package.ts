import { env } from 'cloudflare:workers';
import { readQuotationExportSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { readQuotationFields, quotationSourcesCurrent } from '@/db/quotation-fields';
import { productImageKeys } from '@/app/product-content';
import { loadAttachments } from '@/app/exports/attachments';
import { publicDetailConfig, publicDetailVersion } from '@/app/quotation-public-detail';
import { projectSupplierHubSingleDocument } from '@/app/supplier-hub-single-projection';
import { buildSingleAssetPlan, singleAssetSelection, singleAssetPackageView, publishSingleAssets, verifySingleAssets, SingleAssetError } from '@/app/supplier-hub-single-assets';
import { collectionSourceReview } from '@/app/collection-source-review';
import { readLegalDocuments, inspectLegalDocumentStorage } from '@/app/legal-documents';
import { buildNativeLegalContext } from '@/app/native-legal-binding';
import { buildNativeLegalAttachmentPlan } from '@/app/native-legal-attachment-plan';
import { fingerprint } from '@/app/automation/model';
import { stableQuotationFieldsView, QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';
import { buildNativeAssetSourcePlan, nativeAssetSourceImageKeys } from '@/app/native-asset-source-plan';

import type {SupplierHubCompany} from '@/app/supplier-hub-company';

function changed(): never { throw new SingleAssetError('준비 중 상품·견적값·이미지·회사 또는 카테고리가 변경되었습니다. 다시 검토해주세요.', 'SINGLE_SOURCE_CHANGED'); }

/** Compare complete inert DTO values only inside one package request. Exotic
 * objects use the original fingerprint path, never a partial source-clock key. */
function packageSourceValueKey(value:unknown):string|null{
  let count=0;const seen=new Set<object>(),objects=new Set<object>([Object.prototype]),arrays=new Set<object>([Array.prototype]);
  const inspect=(item:unknown,depth:number):void=>{
    if(++count>100000||depth>40||typeof item==='string'&&item.length>6_000_000)throw Error('Uncacheable source');
    if(item===undefined||item===null||['string','number','boolean'].includes(typeof item))return;
    if(typeof item!=='object'||seen.has(item))throw Error('Uncacheable source');
    const array=Array.isArray(item),prototype=Object.getPrototypeOf(item),known=array?arrays:objects,keys=Reflect.ownKeys(item);
    if(prototype!==null&&!known.has(prototype)){
      const constructor=Object.getOwnPropertyDescriptor(prototype,'constructor')?.value;
      if(typeof constructor!=='function'||constructor.prototype!==prototype||Function.prototype.toString.call(constructor)!==`function ${array?'Array':'Object'}() { [native code] }`)throw Error('Uncacheable source');
      known.add(prototype);
    }
    if(array&&(prototype===null||keys.length!==item.length+1||Object.keys(item).length!==item.length))throw Error('Uncacheable source');
    seen.add(item);
    for(const key of keys){const field=Object.getOwnPropertyDescriptor(item,key)!;
      if(typeof key!=='string'||!Object.hasOwn(field,'value')||!field.enumerable&&!(array&&key==='length'))throw Error('Uncacheable source');
      inspect(field.value,depth+1);
    }
    seen.delete(item);
  };
  try{
    inspect(value,0);
    const key=JSON.stringify(value,(_key,item)=>item===undefined?'\u0000undefined':typeof item==='string'&&item.startsWith('\u0000')?'\u0000'+item
      :typeof item==='number'&&(Object.is(item,-0)||!Number.isFinite(item))?'\u0000'+(Object.is(item,-0)?'-0':String(item)):item);
    return key.length<=6_000_000?key:null;
  }catch{return null;}
}

/** Shared current-source proof. A read never publishes assets or contacts Hub. */
export async function loadSinglePackage(owner:string,id:string,profileId:string|null,company:SupplierHubCompany,active:()=>Promise<void>,prepare=false,expectedFingerprint?:string,includeNativeAssets=false){
    const saved = await readQuotationExportSource(owner, id, profileId);
    // The visible editor also binds settings, profile interpretation and source
    // context. Pair its exact fingerprint with this export's full source guard;
    // product/content/option/quotation clocks alone do not identify that view.
    const reviewed = await stableQuotationFieldsView(owner,id,profileId).catch(error => {
      if(error instanceof QuotationFieldsSnapshotError)throw new QuotationExportError(error.message,error.status);
      throw error;
    });
    if (reviewed.view.revision !== saved.state.revision || JSON.stringify(reviewed.source) !== JSON.stringify(saved.source)) changed();
    if (!saved.hubSchema || !saved.company || saved.company.code !== company.code || saved.company.name !== company.name || !saved.categoryContext.categoryId)
      throw new SingleAssetError('이 상품 회사·카테고리의 검증된 Single 원문 양식이 필요합니다.', 'SINGLE_SCHEMA');
    const config = publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]);
    const sourceFingerprint = await quotationExportFingerprint(saved, null), configVersion = await publicDetailVersion(config);
    const sourceValueKey=packageSourceValueKey(saved);
    const resolved=resolveQuotationExport(saved);
    const projection = await projectSupplierHubSingleDocument({ snapshot: saved.hubSchema, company, categoryId: saved.categoryContext.categoryId,
      categoryPath: saved.categoryContext.categoryPath, resolved });
    const ownedKeys = productImageKeys(saved.product.image_keys), selection = singleAssetSelection(projection, owner, ownedKeys);
    // Invalid/unknown refs stay blocking in the plan; they never cause a read of
    // an unowned key. Selected bytes are strictly bounded by loadAttachments.
    const readKeys = includeNativeAssets ? [...new Set([...selection.keys, ...nativeAssetSourceImageKeys({projection,owner,ownedKeys})])] : selection.keys;
    const assets = await loadAttachments(owner, saved.product.image_keys, readKeys);
    const metadata = new Map(await Promise.all(readKeys.map(async key => [key, await env.FILES.head(key)] as const)));
    const documents = readLegalDocuments(saved.content.legalDocuments, owner, id);
    const nativeLegal = await buildNativeLegalContext({snapshot:saved.hubSchema,company,categoryId:saved.categoryContext.categoryId,
      categoryPath:saved.categoryContext.categoryPath,resolved,documents});
    const source = { productVersion: saved.product.updated_at, contentRevision: saved.content.revision, optionRevision: saved.options.revision,
      quotationRevision: saved.state.revision, profileId: saved.categoryContext.profileId, profileRevision: saved.profile?.revision ?? null };
    const options = resolved.rows.filter(row => row.included).map(row => ({ optionId: row.optionId, optionLabel: row.optionLabel }));
    const nativeIdentity = {ownerId:owner,productId:id,company,categoryId:saved.categoryContext.categoryId,categoryPath:[...saved.categoryContext.categoryPath],
        schemaSha256:projection.schemaSha256,sourceFingerprint,inputFingerprint:reviewed.view.inputFingerprint,source,
        members:options.map((option,documentIndex)=>({...option,documentIndex}))};
    const nativeLegalAttachmentPlan = await buildNativeLegalAttachmentPlan({context:nativeLegal,applicability:documents.applicability,identity:nativeIdentity});
    const sourceIssues = [...collectionSourceReview(saved.sourceGaps), ...(saved.generatedProductLabelIssues ?? []),
      ...await inspectLegalDocumentStorage(documents, id, key => env.FILES.head(key))];
    // Native filename preparation has its own reviewed body. It must never
    // silently replace the legacy public-URL payload or its operation digest.
    const nativeAssetSourcePlan = includeNativeAssets ? await buildNativeAssetSourcePlan({identity:nativeIdentity,projection,ownedKeys,assets,metadata,
      nativeLegalAttachmentPlan,sourceIssues:[...sourceIssues]}) : null;
    if (documents.applicability === 'required') sourceIssues.push(...nativeLegal.issues.map(issue=>({kind:'error' as const,code:issue.code,optionId:null,
      optionLabel:'법적 필수서류',fieldId:issue.fieldId??null,message:issue.message})));
    if (documents.applicability === 'required') sourceIssues.push(...nativeLegalAttachmentPlan.issues.map(issue=>({kind:'error' as const,code:issue.code,optionId:null,
      optionLabel:'법적 필수서류',fieldId:issue.fieldId??null,message:issue.message})));
    if (documents.applicability === 'required') sourceIssues.push({ kind: 'error', code: 'SINGLE_LEGAL_DOCUMENT_TRANSPORT_UNVERIFIED', optionId: null,
      optionLabel: '법적 필수서류', fieldId: null, message: '필수 원본 서류의 Single 파일 연결 형식은 별도 확인이 필요합니다. 저장한 서류는 변경하지 않습니다.' });
    if (documents.applicability === 'unconfirmed') sourceIssues.push({ kind: 'review', code: 'SINGLE_LEGAL_APPLICABILITY_UNCONFIRMED', optionId: null,
      optionLabel: '법적 필수서류', fieldId: null, message: '실제 상품의 법적 서류 해당 여부를 확인해주세요. 미확인을 해당없음으로 바꾸지 않았습니다.' });
    const plan = await buildSingleAssetPlan({ projection, owner, productId: id, ownedKeys, assets, metadata, config, sourceIssues });
    const packageFingerprint = await fingerprint({ format: 'yoofam-supplier-hub-single-package-v1', sourceFingerprint, configVersion,
      sourceAssetFingerprint: plan.sourceAssetFingerprint, payload: plan.payload, manifest: plan.manifest, issues: plan.issues,
      nativeLegalAttachmentPlanSha256:nativeLegalAttachmentPlan.planSha256 });
    if (expectedFingerprint !== undefined && expectedFingerprint !== packageFingerprint) changed();
    const verifyPrivateFile = async (file:{key:string;byteLength:number;sha256:string}) => {
      const stored = await env.FILES.get(file.key), currentMetadata = await env.FILES.head(file.key);
      if (!stored || !currentMetadata || JSON.stringify(currentMetadata) !== JSON.stringify(metadata.get(file.key))) changed();
      const bytes = new Uint8Array(await stored.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== file.byteLength || sha256 !== file.sha256) changed();
    };
    const guard = async (file?: {key:string;byteLength:number;sha256:string}) => {
      await active();
      if (!await quotationSourcesCurrent(owner, id, saved.source) || (await readQuotationFields(owner, id)).revision !== saved.state.revision) changed();
      const latest = await readQuotationExportSource(owner, id, profileId);
      const latestFingerprint=sourceValueKey!==null&&packageSourceValueKey(latest)===sourceValueKey?sourceFingerprint:await quotationExportFingerprint(latest,null);
      if (latestFingerprint !== sourceFingerprint
        || JSON.stringify(await publicDetailVersion(publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]))) !== JSON.stringify(configVersion)) changed();
      if (file) await verifyPrivateFile(file);
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
    const nativeAssetSourceGuard = async () => {
      await guard();
      // Read-only bytes are withheld until the whole batch's final complete
      // source/config proof. Keep each file's live membership, metadata and
      // byte digest checks without reparsing the same source DTO per image.
      // Publication continues to use the original per-file full guard above.
      if (nativeAssetSourcePlan) for (const image of nativeAssetSourcePlan.images) {
        await active();
        await verifyPrivateFile(image);
        await active();
      }
      await guard();
    };
    if (includeNativeAssets) await nativeAssetSourceGuard();
    const view = { ...singleAssetPackageView(plan, published), productId: id, requestedProfileId: profileId, fingerprint: packageFingerprint,
      // A reviewed metadata mapping is not an uploaded native file or receipt.
      nativeLegal,nativeLegalAttachmentPlan,
      ...(nativeAssetSourcePlan ? {nativeAssetSourcePlan} : {}),
      // Response metadata only: operation fingerprints, packets and receipts
      // retain their existing contract and exact prepared body identity.
      inputFingerprint: reviewed.view.inputFingerprint,
      source,options,
      excludedOptions: saved.options.rows.filter(row => !row.included).map(row => ({ optionId: row.id, translatedName: row.translatedName })) };
    return { view, saved, guard, nativeAssetSourceAssets:includeNativeAssets?assets:[], nativeAssetSourceGuard };
}
