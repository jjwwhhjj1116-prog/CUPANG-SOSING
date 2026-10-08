import { registrationContentSummary, type RegistrationQuotationLabels } from '@/app/registration-content-summary';
import { validateCategoryProfile } from '@/app/category-profiles';
import { validateCategoryIdentity } from '@/app/category-identity';
import { parseCollectionRequest } from '@/app/sourcing';
import { env } from 'cloudflare:workers';
import { emptyProductContent, withCurrentLabelFields, type ProductContent } from '@/app/product-content';

type ContentRow = { payload: string; revision: number };
type ListingLabelRow={product_id:string;image_keys:string;source_url:string;content_revision:number|null;option_payload:string|null;option_revision:number|null;quotation_payload:string|null;quotation_revision:number|null;linked_job:string|null;valid_job:string|null;job_offer:string|null;context_payload:string|null};
function listingLabels(ownerId:string,product:{id:string;image_keys:string},row:ListingLabelRow,contentRevision:number):RegistrationQuotationLabels{
 if(row.product_id!==product.id||row.image_keys!==product.image_keys||(row.content_revision??0)!==contentRevision)throw Error('Listing source changed');
 const options=row.option_payload?JSON.parse(row.option_payload):{schemaVersion:1,productId:product.id,revision:0,rows:[]};
 if(options.schemaVersion!==1||options.productId!==product.id||options.revision!==(row.option_revision??0))throw Error('Invalid listing options');
 const state=row.quotation_payload?JSON.parse(row.quotation_payload):{schemaVersion:1,productId:product.id,revision:0,overrides:{common:{},options:{}}};
 if(state.schemaVersion!==1||state.productId!==product.id||state.revision!==(row.quotation_revision??0))throw Error('Invalid listing quotation');
 let categoryId:string|null=null,categoryPath:string[]=[],hubSchema:RegistrationQuotationLabels['hubSchema'];
 if(row.linked_job){
  if(row.valid_job!==row.linked_job||!row.context_payload||parseCollectionRequest({urls:[row.source_url]})[0].offerId!==row.job_offer)throw Error('Invalid listing capture link');
  const captured=JSON.parse(row.context_payload);
  if(captured?.category){const category=validateCategoryProfile(captured.category);validateCategoryIdentity(category);categoryId=category.categoryId||null;categoryPath=category.categoryPath;hubSchema=category.hubSchema;}
 }
 return {ownerId,categoryId,categoryPath,...(hubSchema?{hubSchema}:{}),options:{revision:options.revision,rows:options.rows},state};
}
async function database() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS product_content (
    product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  return env.DB;
}

export async function readProductContent(ownerId: string, productId: string): Promise<ProductContent> {
  const db = await database();
  const row = await db.prepare('SELECT payload, revision FROM product_content WHERE owner_id=? AND product_id=?').bind(ownerId, productId).first<ContentRow>();
  if (!row) return emptyProductContent(productId);
  const content: ProductContent = JSON.parse(row.payload);
  if (content.schemaVersion !== 1 || content.productId !== productId || content.revision !== row.revision) throw new Error('Invalid stored content');
  return withCurrentLabelFields(content);
}

export async function saveProductContent(ownerId: string, content: ProductContent, expectedRevision: number, expectedImageKeys?: string): Promise<ProductContent | null> {
  const db = await database();
  if (content.revision !== expectedRevision + 1 || !content.updatedAt) throw new Error('Invalid content revision');
  // Both the insert and update compare the revision inside SQLite. The second
  // statement invalidates the quotation only if this writer changed one row.
  const result = await db.batch<ContentRow>([
    db.prepare(`INSERT INTO product_content(product_id, owner_id, revision, payload, updated_at)
      SELECT id, owner_id, ?, ?, ? FROM products WHERE id=? AND owner_id=? AND (? IS NULL OR image_keys=?)
        AND (?=0 OR EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?))
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision, payload=excluded.payload, updated_at=excluded.updated_at
        WHERE product_content.owner_id=excluded.owner_id AND product_content.revision=?
      RETURNING payload, revision`).bind(content.revision, JSON.stringify(content), content.updatedAt, content.productId, ownerId, expectedImageKeys ?? null, expectedImageKeys ?? null,
      expectedRevision, content.productId, ownerId, expectedRevision, expectedRevision),
    db.prepare(`UPDATE products SET quote_status='대기', updated_at=CASE WHEN updated_at < ? THEN ? ELSE updated_at END
      WHERE id=? AND owner_id=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?)`)
      .bind(content.updatedAt, content.updatedAt, content.productId, ownerId, content.productId, ownerId, content.revision),
  ]);
  return result[0].results[0] ? content : null;
}

/** Batched read for the visible product listing; never query another owner's data. */
export async function readRegistrationSummaries(ownerId: string, products: {id:string;image_keys:string}[]) {
  const summaries: Record<string, import('@/app/registration-content-summary').RegistrationContentSummary | null> = {};
  if (!products.length) return summaries;
  const db = await database();
  for (let offset=0;offset<products.length;offset+=80) {
    const chunk=products.slice(offset,offset+80);
    const rows=await db.prepare(`SELECT product_id, payload, revision FROM product_content WHERE owner_id=? AND product_id IN (${chunk.map(()=>'?').join(',')})`).bind(ownerId,...chunk.map(product=>product.id)).all<{product_id:string;payload:string;revision:number}>();
    const records=new Map(rows.results.map(row=>[row.product_id,row]));
    // One owner-scoped metadata read per chunk, independent of SKU count. Only
    // the exact linked intake supplies category scope; equal URLs are never a
    // reason to borrow another job, company or product's quotation overrides.
    let labelRecords:Map<string,ListingLabelRow>|null=null;
    try{const source=await db.prepare(`SELECT p.id AS product_id,p.image_keys,p.source_url,pc.revision AS content_revision,
      o.payload AS option_payload,o.revision AS option_revision,q.payload AS quotation_payload,q.revision AS quotation_revision,
      cp.job_id AS linked_job,j.id AS valid_job,j.offer_id AS job_offer,c.payload AS context_payload
      FROM products p LEFT JOIN product_options o ON o.product_id=p.id AND o.owner_id=p.owner_id
      LEFT JOIN product_content pc ON pc.product_id=p.id AND pc.owner_id=p.owner_id
      LEFT JOIN product_quotation_fields q ON q.product_id=p.id AND q.owner_id=p.owner_id
      LEFT JOIN collection_products cp ON cp.product_id=p.id AND cp.owner_id=p.owner_id
      LEFT JOIN collection_jobs j ON j.id=cp.job_id AND j.owner_id=p.owner_id AND j.status='awaiting_connector'
      LEFT JOIN collection_context c ON c.job_id=j.id
      WHERE p.owner_id=? AND p.id IN (${chunk.map(()=>'?').join(',')})`).bind(ownerId,...chunk.map(product=>product.id)).all<ListingLabelRow>();labelRecords=new Map(source.results.map(row=>[row.product_id,row]));}
    catch{/* Older partial databases retain content counts with a connection warning. */}
    for(const product of chunk) {
      try {
        const row=records.get(product.id);
        const content=row?JSON.parse(row.payload) as ProductContent:null;
        if(row&&content?.revision!==row.revision)throw Error('Invalid content revision');
        let labels:RegistrationQuotationLabels|null=null;
        if(labelRecords){const source=labelRecords.get(product.id);if(!source)throw Error('Unowned listing product');try{labels=listingLabels(ownerId,product,source,row?.revision??0);}catch{/* A corrupt source must not turn zero references into a verified count. */}}
        summaries[product.id]=registrationContentSummary(product,content,labels);
      } catch { summaries[product.id]=null; }
    }
  }
  return summaries;
}
