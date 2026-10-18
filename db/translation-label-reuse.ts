import {env} from 'cloudflare:workers';
import type {ProductContent} from '@/app/product-content';
import {sourceGuard,type QuotationSourceGuard} from '@/db/quotation-fields';
import {effectiveCollectionPayload} from '@/db/collection-results';
export type TranslationLabelReuseGuard={source:QuotationSourceGuard;member:{id:string;email:string;role:string;companyCode:string;companyName:string};
 contentPayload:string|null;optionPayload:string|null;quotationPayload:string|null;labelsPayload:string|null;profilePayload:string|null;
 collectionId:string;receiptPayload:string;job:{id:string;review:string;result:string;productVersion:string;contentRevision:number}};
/** Only label content and its product clock advance, in one guarded batch. */
export async function saveTranslationLabelReuse(owner:string,content:ProductContent,guard:TranslationLabelReuseGuard){
 if(!env.DB||!content.updatedAt||content.revision!==guard.source.contentRevision+1)throw Error('Invalid translated label commit');
 const id=content.productId,db=env.DB,before=sourceGuard(owner,id,guard.source),member=guard.member;
 const extra=` AND (SELECT payload FROM product_content WHERE product_id=p.id AND owner_id=p.owner_id) IS ?
 AND (SELECT payload FROM product_options WHERE product_id=p.id AND owner_id=p.owner_id) IS ?
 AND (SELECT payload FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id) IS ?
 AND (SELECT payload FROM product_labels WHERE product_id=p.id AND owner_id=p.owner_id) IS ?
 AND NOT EXISTS(SELECT 1 FROM product_content WHERE product_id=p.id AND owner_id<>p.owner_id)
 AND (? IS NULL OR EXISTS(SELECT 1 FROM category_profiles WHERE id=? AND owner_id=p.owner_id AND payload=?))
 AND EXISTS(SELECT 1 FROM members WHERE id=p.owner_id AND id=? AND email=? AND role=? AND status='approved' AND company_code=? AND company_name=?)
 AND EXISTS(SELECT 1 FROM translation_jobs WHERE id=? AND product_id=p.id AND owner_id=p.owner_id AND status='completed' AND review=? AND result=? AND product_version=? AND content_revision=?)
 AND EXISTS(SELECT 1 FROM collection_results r WHERE r.job_id=? AND r.owner_id=p.owner_id AND ${effectiveCollectionPayload}=?)`;
 const args=[...before.args,guard.contentPayload,guard.optionPayload,guard.quotationPayload,guard.labelsPayload,guard.profilePayload,guard.source.profile?.id??null,guard.profilePayload,member.id,member.email,member.role,member.companyCode,member.companyName,guard.job.id,guard.job.review,guard.job.result,guard.job.productVersion,guard.job.contentRevision,guard.collectionId,guard.receiptPayload];
 const payload=JSON.stringify(content),now=content.updatedAt;
 const result=await db.batch([
  db.prepare(`UPDATE products AS p SET updated_at=?,quote_status='대기' WHERE ${before.sql}${extra} RETURNING id`).bind(now,...args),
  db.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at) SELECT ?,?,?,?,? WHERE changes()=1
   ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`).bind(id,owner,content.revision,payload,now),
  // A trigger that ignores a companion cannot commit a lone product update.
  db.prepare(`UPDATE products SET title=CASE WHEN changes()=1 AND EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=? AND payload=?) THEN title ELSE NULL END
    WHERE id=? AND owner_id=? AND updated_at=? RETURNING id`).bind(id,owner,content.revision,payload,id,owner,now),
 ]);
 return Boolean(result[0]?.results?.length&&result[2]?.results?.length);
}
