import {env} from 'cloudflare:workers';
import {sourceGuard,type QuotationSourceGuard} from '@/db/quotation-fields';
import type {ProductRecord} from '@/db/queries';
import type {ProductContent} from '@/app/product-content';
import type {StageTwoPricingFence} from '@/db/stage-two-pricing';

/** The PNG object is immutable and independently stored. Only the SQL content,
 * pool and product clock are committed atomically; an orphan PNG is retained. */
export async function commitSizeChartSave(owner:string,product:ProductRecord,content:ProductContent,imageKeys:string[],source:QuotationSourceGuard,fence:StageTwoPricingFence){
 if(!env.DB||content.productId!==product.id||content.revision!==source.contentRevision+1||!content.updatedAt||product.updated_at!==source.productVersion)throw Error('Invalid size-chart save source');
 const id=product.id,version=content.updatedAt,payload=JSON.stringify(content),pool=JSON.stringify(imageKeys),guard=sourceGuard(owner,id,source),extra:string[]=[],args:(string|number|null)[]=[...guard.args];
 for(const key of ['source_url','title','source_price_cny','exchange_rate','supply_margin','coupang_margin','supply_price','sale_price','msrp','options_count','seo_status','image_status','quote_status','registration_status','supplier_hub_status','goal_stage','created_at'] as const){extra.push(`p.${key} IS ?`);args.push(product[key]);}
 const raw=(table:string,before:{payload:string;revision:number}|null)=>{if(before){extra.push(`EXISTS(SELECT 1 FROM ${table} f WHERE f.product_id=p.id AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)`);args.push(before.revision,before.payload);}else extra.push(`NOT EXISTS(SELECT 1 FROM ${table} f WHERE f.product_id=p.id)`);};
 raw('product_content',fence.content);raw('product_options',fence.options);raw('product_quotation_fields',fence.quotation);
 if(source.profile){if(!fence.profile)throw Error('Missing category source');extra.push('EXISTS(SELECT 1 FROM category_profiles f WHERE f.id=? AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)');args.push(source.profile.id,fence.profile.revision,fence.profile.payload);}
 if((env as {YOOFAM_AUTH_ENABLED?:string}).YOOFAM_AUTH_ENABLED==='true'){
  if(!fence.actor)throw Error('Missing member source');extra.push("EXISTS(SELECT 1 FROM members m WHERE m.id=p.owner_id AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=? AND m.company_name=?)");args.push(fence.actor.email.trim().toLowerCase(),fence.actor.role,fence.actor.companyCode,fence.actor.companyName);
 }
 const applied='EXISTS(SELECT 1 FROM product_content c WHERE c.product_id=p.id AND c.owner_id=p.owner_id AND c.revision=? AND c.payload=? AND c.updated_at=?)';
 const afterGuard=sourceGuard(owner,id,{...source,productVersion:version,imageKeys:pool,contentRevision:content.revision}),afterExtra:string[]=[],afterArgs:(string|number|null)[]=[];
 for(const key of ['source_url','title','source_price_cny','exchange_rate','supply_margin','coupang_margin','supply_price','sale_price','msrp','options_count','seo_status','image_status','quote_status','registration_status','supplier_hub_status','goal_stage','created_at'] as const){afterExtra.push(`p.${key} IS ?`);afterArgs.push(key==='quote_status'?'대기':product[key]);}
 for(const [table,before]of [['product_options',fence.options],['product_quotation_fields',fence.quotation]] as const){if(before){afterExtra.push(`EXISTS(SELECT 1 FROM ${table} f WHERE f.product_id=p.id AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)`);afterArgs.push(before.revision,before.payload);}else afterExtra.push(`NOT EXISTS(SELECT 1 FROM ${table} f WHERE f.product_id=p.id)`);}
 if(source.profile&&fence.profile){afterExtra.push('EXISTS(SELECT 1 FROM category_profiles f WHERE f.id=? AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)');afterArgs.push(source.profile.id,fence.profile.revision,fence.profile.payload);}
 if(fence.actor){afterExtra.push("EXISTS(SELECT 1 FROM members m WHERE m.id=p.owner_id AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=? AND m.company_name=?)");afterArgs.push(fence.actor.email.trim().toLowerCase(),fence.actor.role,fence.actor.companyCode,fence.actor.companyName);}
 const results=await env.DB.batch<{product_id?:string;id?:string}>([
  env.DB.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at) SELECT p.id,p.owner_id,?,?,? FROM products p WHERE ${guard.sql} AND ${extra.join(' AND ')} ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at RETURNING product_id`).bind(content.revision,payload,version,...args),
  env.DB.prepare(`UPDATE products AS p SET title=CASE WHEN p.updated_at=? AND p.image_keys=? AND ${applied} THEN title ELSE NULL END,image_keys=?,quote_status='대기',updated_at=? WHERE p.id=? AND p.owner_id=? AND changes()=1 RETURNING id`).bind(source.productVersion,source.imageKeys,content.revision,payload,version,pool,version,id,owner),
  // The first new content revision is a durable in-batch anchor even if a
  // trigger restores the product's old clock after its companion write.
  // A read-only assertion does not retrigger product/content UPDATE triggers.
  // Invalid JSON deliberately raises inside this same transaction; it cannot
  // be mistaken for a harmless zero-row companion after a successful write.
  env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM products p WHERE ${afterGuard.sql} AND ${afterExtra.join(' AND ')} AND ${applied}) THEN 1 ELSE json('size-chart-integrity-failure') END AS product_id WHERE changes()=1`).bind(...afterGuard.args,...afterArgs,content.revision,payload,version),
 ]);
 const saved=Boolean(results[0].results[0]);if(results.slice(1).some(result=>Boolean(result.results[0])!==saved))throw Error('Incomplete size-chart save');return saved;
}
