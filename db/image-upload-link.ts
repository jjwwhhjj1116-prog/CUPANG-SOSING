import {env} from 'cloudflare:workers';
import {sourceGuard,readQuotationFields,type QuotationSourceGuard,type QuotationFieldsState} from '@/db/quotation-fields';
import type {StageTwoPricingFence} from '@/db/stage-two-pricing';
import type {ProductRecord} from '@/db/queries';
import {quotationScope} from '@/app/quotation-scopes';
import type {ProductContent} from '@/app/product-content';
import type {QuotationOverrides} from '@/app/quotation-schema';
export type ImageUploadLinkFence={raw:StageTwoPricingFence;product:ProductRecord};
type Member={email:string;role:string;companyCode:string;companyName:string};

/** Pool, role/content and category quote share one source-sealed transaction.
 * Both pre/post predicates bind exact stored sidecar bytes and product facts;
 * a skipped companion or mid-batch source change aborts through CHECK/NOT NULL. */
export async function commitImageUploadLink(owner:string,productId:string,source:QuotationSourceGuard,expectedQuoteRevision:number,categoryId:string|null,
 content:ProductContent,contentMutated:boolean,overrides:QuotationOverrides,imageKeys:string[],now:string,fence:ImageUploadLinkFence,member?:Member){
 const db=env.DB;if(!db)throw Error('D1 unavailable');
 if((env as {YOOFAM_AUTH_ENABLED?:string}).YOOFAM_AUTH_ENABLED==='true'&&!member)throw Error('회원 연결을 확인해주세요.');
 const previous=await readQuotationFields(owner,productId),raw=fence.raw,product=fence.product;
 if(previous.revision!==expectedQuoteRevision||product.id!==productId||product.owner_id!==owner||product.updated_at!==source.productVersion
  ||raw.quotation&&raw.quotation.revision!==expectedQuoteRevision||content.revision!==source.contentRevision+(contentMutated?1:0))return null;
 const quote:QuotationFieldsState={...previous,revision:expectedQuoteRevision+1,updatedAt:now,
  ...(categoryId?{categoryOverrides:{...previous.categoryOverrides,[quotationScope(categoryId)]:overrides}}:{overrides})};
 const quotePayload=JSON.stringify(quote),contentPayload=JSON.stringify(content),imagePayload=JSON.stringify(imageKeys);
 if(new TextEncoder().encode(quotePayload).length>512*1024)throw Error('견적 자료 저장 한도를 초과했습니다.');
 const productFields=['source_url','title','source_price_cny','exchange_rate','supply_margin','coupang_margin','supply_price','sale_price','msrp','options_count','seo_status','image_status','quote_status','registration_status','supplier_hub_status','goal_stage','created_at'] as const;
 function guard(phase:'before'|'quote'|'companions'|'after'){
  const changedContent=contentMutated&&(phase==='companions'||phase==='after'),changedQuote=phase!=='before',after=phase==='after';
  const base=sourceGuard(owner,productId,{...source,...(changedContent?{contentRevision:content.revision}:{}),...(after?{productVersion:now,imageKeys:imagePayload}:{})}),sql=[base.sql],args:(string|number|null)[]=[...base.args];
  for(const key of productFields){sql.push(`p.${key} IS ?`);args.push(after&&key==='quote_status'?'대기':product[key]);}
  const rows=[['product_options',raw.options],['product_quotation_fields',changedQuote?{revision:quote.revision,payload:quotePayload}:raw.quotation],
   ['product_content',changedContent?{revision:content.revision,payload:contentPayload}:raw.content]] as const;
  for(const[table,before]of rows){
   if(before){sql.push(`EXISTS(SELECT 1 FROM ${table} f WHERE f.product_id=p.id AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)`);args.push(before.revision,before.payload);}
   else sql.push(`NOT EXISTS(SELECT 1 FROM ${table} f WHERE f.product_id=p.id)`);
  }
  if(source.profile){if(!raw.profile||raw.profile.revision!==source.profile.revision)throw Error('카테고리 원본을 확인해주세요.');sql.push('EXISTS(SELECT 1 FROM category_profiles f WHERE f.id=? AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)');args.push(source.profile.id,raw.profile.revision,raw.profile.payload);}
  if(member){sql.push("EXISTS(SELECT 1 FROM members m WHERE m.id=p.owner_id AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=? AND m.company_name=?)");args.push(member.email.trim().toLowerCase(),member.role,member.companyCode,member.companyName);}
  return{sql:sql.join(' AND '),args};
 }
 const before=guard('before'),quoteGuard=guard('quote'),companions=guard('companions'),after=guard('after');
 const statements=[db.prepare(`INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at)
  SELECT p.id,p.owner_id,?,?,? FROM products p WHERE ${before.sql}
  ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
  WHERE product_quotation_fields.owner_id=excluded.owner_id AND product_quotation_fields.revision=? RETURNING revision,payload`)
  .bind(quote.revision,quotePayload,now,...before.args,expectedQuoteRevision)];
 if(contentMutated)statements.push(db.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at)
  SELECT p.id,p.owner_id,?,?,? FROM products p WHERE ${quoteGuard.sql} AND changes()=1
  ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
  WHERE product_content.owner_id=excluded.owner_id AND product_content.revision=? RETURNING revision,payload`)
  .bind(content.revision,contentPayload,now,...quoteGuard.args,source.contentRevision));
 statements.push(db.prepare(`UPDATE products AS p SET image_keys=?,quote_status='대기',updated_at=? WHERE ${companions.sql} AND changes()=1 RETURNING id,updated_at`)
  .bind(imagePayload,now,...companions.args));
 const updatedIndex=statements.length-1;
 // An unchanged pre-state is a legitimate rejected/no-op first write. Every
 // partial state is neither before nor after and must roll back the batch.
 statements.push(db.prepare(`UPDATE products AS p SET title=CASE WHEN (${after.sql}) OR (${before.sql}) THEN title ELSE NULL END WHERE p.id=? AND p.owner_id=? RETURNING id`)
  .bind(...after.args,...before.args,productId,owner));
 // Independent of the product UPDATE trigger boundary, recheck the entire
 // tuple through the quote's CHECK constraint without relying on old clocks.
 statements.push(db.prepare(`UPDATE product_quotation_fields SET revision=CASE WHEN EXISTS(SELECT 1 FROM products p WHERE (${after.sql}) OR (${before.sql})) THEN revision ELSE 0 END
  WHERE product_id=? AND owner_id=? RETURNING revision,payload`)
  .bind(...after.args,...before.args,productId,owner));
 const results=await db.batch(statements),applied=Boolean(results[0].results[0]);
 if(applied!==Boolean(results[updatedIndex].results[0]))throw Error('이미지 연결 응답을 읽기로 확인해주세요.');
 return applied?{quote,content,imageKeys,productVersion:now}:null;
}
