import { registrationContentObservation, type RegistrationQuotationLabels } from '@/app/registration-content-summary';
import { validateCategoryProfile } from '@/app/category-profiles';
import { validateCategoryIdentity } from '@/app/category-identity';
import { parseCollectionRequest } from '@/app/sourcing';
import { env } from 'cloudflare:workers';
import { emptyProductContent, withCurrentLabelFields, type ProductContent } from '@/app/product-content';
import {readRegistrationExecutionStages} from '@/db/registration-stage-status';
import {mergeRegistrationStages,registrationStagesWithImageReviews,type RegistrationFinalImageKeys} from '@/app/registration-stage-status';
import {readImageNoTextReceipts} from '@/db/image-no-text-receipts';
import {isFreeImageEditOutputKey,readFreeImageEditReviews,type FreeImageEditReview} from '@/app/free-image-edit-review';
import {quotationValidationEnvironment,savedQuotationValidationForListing,type QuotationValidationListingRow} from '@/db/quotation-save-validation';
import {savedQuotationValidationStage} from '@/app/quotation-save-validation';
import {stableQuotationFieldsView} from '@/app/quotation-fields-snapshot';
import {productLabelsSnapshotFromSource} from '@/app/product-labels-source-snapshot';
import {inspectGeneratedProductLabels,PRODUCT_LABEL_PROOF_RECIPE} from '@/app/product-label-proof';

type ContentRow = { payload: string; revision: number };
type ListingLabelRow=QuotationValidationListingRow;
function listingLabels(ownerId:string,product:{id:string;image_keys:string},row:ListingLabelRow,contentRevision:number):RegistrationQuotationLabels{
 if(row.product_id!==product.id||row.image_keys!==product.image_keys||(row.content_revision??0)!==contentRevision)throw Error('Listing source changed');
 const options=row.option_payload?JSON.parse(row.option_payload):{schemaVersion:1,productId:product.id,revision:0,rows:[]};
 if(options.schemaVersion!==1||options.productId!==product.id||options.revision!==(row.option_revision??0))throw Error('Invalid listing options');
 const state=row.quotation_payload?JSON.parse(row.quotation_payload):{schemaVersion:1,productId:product.id,revision:0,overrides:{common:{},options:{}}};
 if(state.schemaVersion!==1||state.productId!==product.id||state.revision!==(row.quotation_revision??0))throw Error('Invalid listing quotation');
 let profileId:string|null=null,categoryId:string|null=null,categoryPath:string[]=[],hubSchema:RegistrationQuotationLabels['hubSchema'],template:RegistrationQuotationLabels['template'];
 if(row.linked_job){
  if(row.valid_job!==row.linked_job||!row.context_payload||parseCollectionRequest({urls:[row.source_url]})[0].offerId!==row.job_offer)throw Error('Invalid listing capture link');
  const captured=JSON.parse(row.context_payload);
  if(captured?.category){const category=validateCategoryProfile(captured.category);validateCategoryIdentity(category);profileId=typeof captured.category.id==='string'?captured.category.id:null;categoryId=category.categoryId||null;categoryPath=category.categoryPath;hubSchema=category.hubSchema;template=category.template;}
 }
 return {ownerId,settings:row.settings_payload?JSON.parse(row.settings_payload):null,profileId,categoryId,categoryPath,...(hubSchema?{hubSchema}:{}),...(template?{template}:{}),options,state};
}
const schemaReadyBindings = new WeakSet<D1Database>();
async function database() {
  const db = env.DB;
  if (!db) throw new Error('D1 binding DB is unavailable.');
  if (!schemaReadyBindings.has(db)) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS product_content (
    product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
    schemaReadyBindings.add(db);
  }
  return db;
}

export async function readProductContent(ownerId: string, productId: string): Promise<ProductContent> {
  const db = await database();
  const row = await db.prepare('SELECT payload, revision FROM product_content WHERE owner_id=? AND product_id=?').bind(ownerId, productId).first<ContentRow>();
  if (!row) return emptyProductContent(productId);
  const content: ProductContent = JSON.parse(row.payload);
  if (content.schemaVersion !== 1 || content.productId !== productId || content.revision !== row.revision) throw new Error('Invalid stored content');
  return withCurrentLabelFields(content);
}

/** The authenticated saved-source reader constructs this predicate; it is
 * never accepted from request JSON. Keep the general content store independent
 * of the quotation compiler and its runtime dependency graph. */
export type ProductContentSourceCommit = { sourcePredicate: {sql:string;args:(string|number|null)[]}; quotationRevision: number; quotationPayload: string;
  member: { email: string; role: string; companyCode: string; companyName: string } };
export async function saveProductContent(ownerId: string, content: ProductContent, expectedRevision: number, expectedImageKeys?: string, sealed?: ProductContentSourceCommit): Promise<ProductContent | null> {
  const db = await database();
  if (content.revision !== expectedRevision + 1 || !content.updatedAt) throw new Error('Invalid content revision');
  const guard = sealed?.sourcePredicate ?? null;
  const sourceSql = guard ? ` AND (${guard.sql}) AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_quotation_fields q WHERE q.product_id=p.id))
    OR EXISTS(SELECT 1 FROM product_quotation_fields q WHERE q.product_id=p.id AND q.owner_id=p.owner_id AND q.revision=? AND q.payload=?))` : '';
  const sourceArgs = guard && sealed ? [...guard.args,sealed.quotationRevision,sealed.quotationRevision,sealed.quotationPayload] : [];
  const membership = sealed && (env as {YOOFAM_AUTH_ENABLED?:string}).YOOFAM_AUTH_ENABLED === 'true'
    ? {sql:` AND EXISTS(SELECT 1 FROM members m WHERE m.id=p.owner_id AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=? AND m.company_name=?)`,
      args:[sealed.member.email.trim().toLowerCase(),sealed.member.role,sealed.member.companyCode,sealed.member.companyName]}
    : {sql:'',args:[]};
  // Both the insert and update compare the revision inside SQLite. The second
  // statement invalidates the quotation only if this writer changed one row.
  const result = await db.batch<ContentRow>([
    db.prepare(`INSERT INTO product_content(product_id, owner_id, revision, payload, updated_at)
      SELECT p.id, p.owner_id, ?, ?, ? FROM products p WHERE p.id=? AND p.owner_id=? AND (? IS NULL OR p.image_keys=?)${sourceSql}${membership.sql}
        AND (?=0 OR EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?))
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision, payload=excluded.payload, updated_at=excluded.updated_at
        WHERE product_content.owner_id=excluded.owner_id AND product_content.revision=?
      RETURNING payload, revision`).bind(content.revision, JSON.stringify(content), content.updatedAt, content.productId, ownerId, expectedImageKeys ?? null, expectedImageKeys ?? null,
      ...sourceArgs,...membership.args,expectedRevision, content.productId, ownerId, expectedRevision, expectedRevision),
    db.prepare(`UPDATE products SET quote_status='대기', updated_at=CASE WHEN updated_at < ? THEN ? ELSE updated_at END
      WHERE id=? AND owner_id=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?)`)
      .bind(content.updatedAt, content.updatedAt, content.productId, ownerId, content.productId, ownerId, content.revision),
  ]);
  return result[0].results[0] ? content : null;
}

/** Batched read for the visible product listing; never query another owner's data. */
export async function readRegistrationSummaries(ownerId: string, products: {id:string;image_keys:string;updated_at?:string}[]) {
  const summaries: Record<string, import('@/app/registration-content-summary').RegistrationContentSummary | null> = {};
  if (!products.length) return summaries;
  const db = await database();
  const executionStages=await readRegistrationExecutionStages(ownerId,products);
  const noTextReceipts=await readImageNoTextReceipts(ownerId,products);
  let validationEnvironment:ReturnType<typeof quotationValidationEnvironment>|undefined;
  for (let offset=0;offset<products.length;offset+=80) {
    const chunk=products.slice(offset,offset+80);
    const rows=await db.prepare(`SELECT product_id, payload, revision FROM product_content WHERE owner_id=? AND product_id IN (${chunk.map(()=>'?').join(',')})`).bind(ownerId,...chunk.map(product=>product.id)).all<{product_id:string;payload:string;revision:number}>();
    const records=new Map(rows.results.map(row=>[row.product_id,row]));
    // One owner-scoped metadata read per chunk, independent of SKU count. Only
    // the exact linked intake supplies category scope; equal URLs are never a
    // reason to borrow another job, company or product's quotation overrides.
    let labelRecords:Map<string,ListingLabelRow>|null=null;
    try{const source=await db.prepare(`SELECT p.id AS product_id,p.updated_at AS product_version,p.image_keys,p.source_url,pc.revision AS content_revision,
      o.payload AS option_payload,o.revision AS option_revision,q.payload AS quotation_payload,q.revision AS quotation_revision,pl.revision AS label_revision,
      cp.job_id AS linked_job,j.id AS valid_job,j.offer_id AS job_offer,j.updated_at AS job_updated_at,c.payload AS context_payload,ws.payload AS settings_payload,
      vp.id AS validation_profile_id,vp.revision AS validation_profile_revision,vp.payload AS validation_profile_payload
      FROM products p LEFT JOIN product_options o ON o.product_id=p.id AND o.owner_id=p.owner_id
      LEFT JOIN product_content pc ON pc.product_id=p.id AND pc.owner_id=p.owner_id
      LEFT JOIN product_labels pl ON pl.product_id=p.id AND pl.owner_id=p.owner_id
      LEFT JOIN product_quotation_fields q ON q.product_id=p.id AND q.owner_id=p.owner_id
      LEFT JOIN collection_products cp ON cp.product_id=p.id AND cp.owner_id=p.owner_id
      LEFT JOIN collection_jobs j ON j.id=cp.job_id AND j.owner_id=p.owner_id AND j.status='awaiting_connector'
      LEFT JOIN collection_context c ON c.job_id=j.id
      LEFT JOIN workspace_settings ws ON ws.owner_id=p.owner_id
      LEFT JOIN category_profiles vp ON vp.owner_id=p.owner_id AND vp.id=CASE WHEN json_valid(q.payload) THEN json_extract(q.payload,'$.savedValidation.requestedProfileId') ELSE NULL END
      WHERE p.owner_id=? AND p.id IN (${chunk.map(()=>'?').join(',')})`).bind(ownerId,...chunk.map(product=>product.id)).all<ListingLabelRow>();labelRecords=new Map(source.results.map(row=>[row.product_id,row]));}
    catch{/* Older partial databases retain content counts with a connection warning. */}
    const labelChecks: (()=>Promise<void>)[] = [];
    const labelObjects = new Map<string, R2Object | null>();
    for(const product of chunk) {
      try {
        const row=records.get(product.id);
        const content=row?JSON.parse(row.payload) as ProductContent:null;
        if(row&&content?.revision!==row.revision)throw Error('Invalid content revision');
        let labels:RegistrationQuotationLabels|null=null;
        if(labelRecords){const source=labelRecords.get(product.id);if(!source)throw Error('Unowned listing product');try{labels=listingLabels(ownerId,product,source,row?.revision??0);}catch{/* A corrupt source must not turn zero references into a verified count. */}}
        const observed=registrationContentObservation(product,content,labels,noTextReceipts[product.id]),summary=observed.summary;
        const selected=Object.fromEntries((['main','additional','detail']as const).map(role=>[role,observed.finalImageKeys[role].filter(key=>isFreeImageEditOutputKey(ownerId,key))]))as RegistrationFinalImageKeys;
        const selectedKeys=[...new Set(Object.values(selected).flat())];
        if(summary.stages&&selectedKeys.length){
          let reviews:FreeImageEditReview[];
          try{reviews=await readFreeImageEditReviews(env.FILES,ownerId,product.id,selectedKeys);}
          catch{reviews=selectedKeys.map(key=>({format:'free-image-edit-review-v1',productId:product.id,key,status:'unconfirmed',unresolvedRegions:null}));}
          summary.stages=registrationStagesWithImageReviews(product.id,summary.stages,selected,reviews);
        }
        if(summary.stages&&executionStages[product.id])summary.stages=mergeRegistrationStages(summary.stages,executionStages[product.id]);
        const validationRow=labelRecords?.get(product.id);
        if(summary.stages&&validationRow?.quotation_payload?.includes('"savedValidation"')){
          validationEnvironment??=quotationValidationEnvironment(ownerId);
          const checked=await savedQuotationValidationForListing(ownerId,product,content,validationRow,await validationEnvironment);
          summary.stages.quotation=checked?savedQuotationValidationStage(checked):{state:'pending',detail:'저장본 검사 이후 상품·옵션·설정·양식 또는 회원 회사가 바뀌었습니다. 저장본 입력 검사를 다시 확인해주세요.'};
        }
        const stages=summary.stages;
        // A generated PNG is attached through an ordinary quotation override.
        // Its filename only locates a proof. Keep manual and legacy attachments
        // classified by their saved references unless marked by the renderer.
        const labelCandidates=stages?.koreanLabel.state==='complete'?observed.finalLabelKeys.filter(key=>/\/quotation-label-[a-f0-9]{64}\.png$/.test(key)):[];
        if(stages&&validationRow&&labelCandidates.length){
          for(const key of labelCandidates)labelObjects.set(key,null);
          labelChecks.push(async()=>{
            try{
              if(labelCandidates.some(key=>!labelObjects.get(key)))throw Error('Label file not confirmed');
              if(!labelCandidates.some(key=>labelObjects.get(key)?.customMetadata?.productLabelRecipe===PRODUCT_LABEL_PROOF_RECIPE))return;
              const saved=await stableQuotationFieldsView(ownerId,product.id,null);
              if(saved.source.productVersion!==validationRow.product_version||saved.source.imageKeys!==validationRow.image_keys
                ||saved.source.contentRevision!==(validationRow.content_revision??0)||saved.options.revision!==(validationRow.option_revision??0)
                ||saved.labelsState.revision!==(validationRow.label_revision??0)||saved.state.revision!==(validationRow.quotation_revision??0)
                ||saved.source.settingsPayload!==validationRow.settings_payload
                ||saved.source.collection?.snapshot?.linked&&saved.source.collection.snapshot.payload!==validationRow.context_payload)
                throw Error('Label source changed');
              const {view}=await productLabelsSnapshotFromSource({owner:ownerId,id:product.id,profileId:null,...saved.labelInputs,options:saved.options,state:saved.labelsState,source:saved.source,quotation:saved.view});
              const [issue]=await inspectGeneratedProductLabels({ownerId,productId:product.id,profileId:view.categoryContext.profileId,resolved:saved.view.resolved,
                head:async key=>labelObjects.get(key)??null,readView:async()=>view});
              if(issue)stages.koreanLabel={state:'pending',detail:issue.message};
            }catch{stages.koreanLabel={state:'pending',detail:'한글표시사항 PNG와 현재 저장값의 일치를 확인하지 못했습니다. 표시사항에서 저장본을 다시 확인해주세요.'};}
          });
        }
        summaries[product.id]=summary;
      } catch { summaries[product.id]=null; }
    }
    const labelKeys=[...labelObjects.keys()];
    for(let start=0;start<labelKeys.length;start+=6)await Promise.all(labelKeys.slice(start,start+6).map(async key=>{
      try{labelObjects.set(key,await env.FILES.head(key));}catch{/* An unreadable object cannot confirm this label. */}
    }));
    for(let start=0;start<labelChecks.length;start+=4)await Promise.all(labelChecks.slice(start,start+4).map(check=>check()));
  }
  return summaries;
}
