import {env} from 'cloudflare:workers';
import type {ProductRecord} from '@/db/queries';
import type {ProductOptions} from '@/app/product-options';
import type {MainImageLibraryEvidence} from '@/app/main-image-library';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import {validateCollectionResult,COLLECTION_RESULT_LIMIT} from '@/app/collection-result';
import {isOwnedImageKey,MAX_IMAGE_BYTES,PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-files';
import {effectiveCollectionPayload} from '@/db/collection-results';

type Capture={job_id:string;offer_id:string;source_url:string;original_payload:string;payload:string;received_at:string;context:string};
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const captureSQL=`SELECT cp.job_id,j.offer_id,j.source_url,r.payload AS original_payload,${effectiveCollectionPayload} AS payload,r.received_at,c.payload AS context
 FROM collection_products cp JOIN collection_jobs j ON j.id=cp.job_id AND j.owner_id=cp.owner_id
 JOIN collection_results r ON r.job_id=j.id AND r.owner_id=j.owner_id JOIN collection_context c ON c.job_id=j.id
 WHERE cp.owner_id=? AND cp.product_id=? LIMIT 2`;

/** Read-only classification. Neither a selected content role, a filename alone,
 * nor an arbitrary upload proves that a file was collected or processed.
 * Original gallery roles come only from the immutable receipt and its exact
 * stored index links. Supplements and manually edited stage assets cannot
 * rewrite this display provenance. No image or source bytes are fetched. */
export async function readMainImageLibraryEvidence(owner:string,product:ProductRecord,options:ProductOptions,company:SupplierHubCompany|null):Promise<MainImageLibraryEvidence|null>{
 if(!env.DB||!company||!supplierHubCompany(company.code,company.name)||product.owner_id!==owner||options.productId!==product.id)return null;
 let parsed:unknown;try{parsed=JSON.parse(product.image_keys);}catch{return null;}
 if(!Array.isArray(parsed)||parsed.length>PRODUCT_IMAGE_POOL_LIMIT||parsed.some(key=>!isOwnedImageKey(owner,key))||new Set(parsed).size!==parsed.length)return null;
 const pool=parsed as string[],owned=new Set(pool),db=env.DB;
 const currentSQL=`SELECT p.id FROM products p WHERE p.owner_id=? AND p.id=? AND p.updated_at=? AND p.image_keys=?
  AND COALESCE((SELECT revision FROM product_options WHERE owner_id=p.owner_id AND product_id=p.id),0)=?
  AND NOT EXISTS(SELECT 1 FROM product_removals x WHERE x.owner_id=p.owner_id AND x.product_id=p.id)`;
 const clocks=[owner,product.id,product.updated_at,product.image_keys,options.revision];
 if(!await db.prepare(currentSQL).bind(...clocks).first())return null;
 const readLinks=async()=>await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='collection_products'").first()
  ?(await db.prepare('SELECT job_id FROM collection_products WHERE owner_id=? AND product_id=? LIMIT 2').bind(owner,product.id).all<{job_id:string}>()).results:[];
 const links=await readLinks();
 const captures=links.length?(await db.prepare(captureSQL).bind(owner,product.id).all<Capture>()).results:[];
 // A product may have no source. A dangling/ambiguous source is not evidence.
 if(links.length!==captures.length||links.length>1)return null;
 const main:string[]=[],detail:string[]=[],sourceOptions:string[]=[];
 let source:MainImageLibraryEvidence['source']=null;
 let imageSnapshot:string|null=null;
 const imageSQL='SELECT image_index,object_key FROM collection_images WHERE owner_id=? AND product_id=? AND job_id=? ORDER BY image_index LIMIT 201';
 if(captures.length){
  const capture=captures[0];
  if(capture.source_url!==product.source_url||[capture.payload,capture.original_payload].some(value=>value.length>COLLECTION_RESULT_LIMIT||new TextEncoder().encode(value).length>COLLECTION_RESULT_LIMIT)||capture.context.length>512*1024)return null;
  let raw:unknown,original:unknown,context:unknown;try{raw=JSON.parse(capture.payload);original=JSON.parse(capture.original_payload);context=JSON.parse(capture.context);}catch{return null;}
  if(!object(raw)||raw.offerId!==capture.offer_id||!object(context)||!object(context.company)
   ||context.company.code!==company.code||context.company.name!==company.name||raw.sourceUrl!==capture.source_url)return null;
  const {offerId:ignored,...input}=raw;void ignored;
  let receipt;try{receipt=validateCollectionResult(input,capture.offer_id);}catch{return null;}
  // The supported supplement preserves the entire original image prefix and
  // source option identities. It may add detail images, never relabel originals.
  if(!object(original)||original.offerId!==raw.offerId||original.sourceUrl!==raw.sourceUrl||!Array.isArray(original.images)
   ||JSON.stringify(original.options)!==JSON.stringify(raw.options)||JSON.stringify(receipt.images.slice(0,original.images.length))!==JSON.stringify(original.images))return null;
  // The primary key is the receipt's immutable zero-based image index, never
  // an editable option order or a URL match against another collection.
  const images=(await db.prepare(imageSQL)
   .bind(owner,product.id,capture.job_id).all<{image_index:number;object_key:string}>()).results;
  if(images.length>200)return null;
  imageSnapshot=JSON.stringify(images);
  const indexKeys=new Map<number,string>();
  for(const row of images){
   if(!Number.isInteger(row.image_index)||row.image_index<0||!receipt.images[row.image_index]||indexKeys.has(row.image_index)||!isOwnedImageKey(owner,row.object_key))return null;
   if(owned.has(row.object_key))indexKeys.set(row.image_index,row.object_key);
  }
  for(const [index,key]of indexKeys){
   const role=receipt.images[index].role;
   if(role==='main'||role==='additional'&&receipt.sourceGallery?.imageIndices.includes(index))main.push(key);
   if(role==='detail')detail.push(key);
  }
  for(const option of receipt.options){const key=option.imageIndex===undefined?undefined:indexKeys.get(option.imageIndex);if(key)sourceOptions.push(key);}
  source={jobId:capture.job_id,receivedAt:capture.received_at,fingerprint:await digest(capture.payload)};
 }
 const jobs=new Map<string,{id:string;sha256:string}>();
 // No new schema/mutation is needed to read an older workspace. Only completed
 // results that are still in this product's library are eligible.
 if(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_jobs'").first()){
  const results=await db.prepare(`SELECT id,result FROM image_jobs WHERE owner_id=? AND product_id=? AND status='completed'
   AND EXISTS(SELECT 1 FROM json_each(?) p WHERE p.value=json_extract(CASE WHEN json_valid(result) THEN result ELSE '{}' END,'$.storageKey')) LIMIT 151`)
   .bind(owner,product.id,product.image_keys).all<{id:string;result:string}>();
  if(results.results.length>PRODUCT_IMAGE_POOL_LIMIT)return null;
  for(const row of results.results){let result:unknown;try{result=JSON.parse(row.result);}catch{continue;}
   if(object(result)&&result.provenance==='generated'&&result.storageKey===`${owner}/ai-${row.id}.png`&&hash(result.sha256)&&owned.has(result.storageKey))jobs.set(result.storageKey,{id:row.id,sha256:result.sha256});
  }
 }
 const processed=new Set<string>();
 if(env.FILES){
  const candidates=pool.filter(key=>jobs.has(key)||key.startsWith(`${owner}/free-image-${product.id}-`)||key.startsWith(`${owner}/free-image-workspace-${product.id}-`));
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{while(cursor<candidates.length){
   const key=candidates[cursor++],file=await env.FILES.head(key),meta=file?.customMetadata;
   if(!file||!meta||file.size<1||file.size>MAX_IMAGE_BYTES||file.httpMetadata?.contentType!=='image/png')continue;
   const job=jobs.get(key);
   if(job&&meta.imageJobId===job.id&&meta.provenance==='generated'&&meta.sha256===job.sha256){processed.add(key);continue;}
   const workspace=key.startsWith(`${owner}/free-image-workspace-${product.id}-`);
   const prefix=workspace?`${owner}/free-image-workspace-${product.id}-`:`${owner}/free-image-${product.id}-`;
   const suffix=key.slice(prefix.length),match=/^([a-f0-9]{64})-([a-f0-9]{64})\.png$/.exec(suffix);
   if(match&&hash(meta.freeImageSourceSha256)&&(workspace?hash(meta.freeImageEditDocumentSha256)&&hash(meta.freeImageEditRecordSha256):hash(meta.freeImageOptionIdsSha256))&&meta.freeImageOutputSha256===match[2]
    &&meta.imageValidation==='header-v1'&&meta.dimensionValidation==='header-v1')processed.add(key);
  }}));
 }
 // The complete metadata read may straddle a manual edit or a company/source
 // change. Do not publish even display-only classifications for that scope.
 const afterLinks=await readLinks();
 const after=afterLinks.length?(await db.prepare(captureSQL).bind(owner,product.id).all<Capture>()).results:[];
 if(JSON.stringify(after)!==JSON.stringify(captures)||JSON.stringify(afterLinks)!==JSON.stringify(links)||!await db.prepare(currentSQL).bind(...clocks).first())return null;
 if(imageSnapshot!==null&&JSON.stringify((await db.prepare(imageSQL).bind(owner,product.id,captures[0].job_id).all()).results)!==imageSnapshot)return null;
 const unique=(values:string[])=>[...new Set(values)].filter(key=>owned.has(key));
 return {format:'main-image-library-evidence-v1',productId:product.id,productVersion:product.updated_at,optionRevision:options.revision,company:{...company},source,
  work:pool.filter(key=>processed.has(key)),main:unique(main),options:unique(sourceOptions),detail:unique(detail)};
}
