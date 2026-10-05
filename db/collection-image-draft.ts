import { env } from 'cloudflare:workers';
import { findCollectionJob } from '@/db/collection-jobs';
import { findCollectionProduct } from '@/db/collection-products';
import { readCollectionResult } from '@/db/collection-results';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { collectionImagesSchema } from '@/db/collection-images';
import { collectedImageDraft, type CollectedImageLink } from '@/app/collection-image-draft';
import { productImageKeys } from '@/app/product-content';

export async function prepareCollectedImageDraft(owner: string, jobId: string, productId: string) {
  if (!env.DB) throw Error('이미지 초안 저장소 연결이 필요합니다.');
  const db = env.DB;
  const job = await findCollectionJob(owner, jobId), link = await findCollectionProduct(owner, jobId);
  const receipt = await readCollectionResult(owner, jobId), product = await findProduct(owner, productId);
  if (!job || job.status !== 'awaiting_connector' || job.goal !== 'work' || !job.context?.category?.id || link?.product_id !== productId || !receipt || !product
    || receipt.result.offerId !== job.offer_id || receipt.result.sourceUrl !== job.source_url || product.source_url !== job.source_url) return null;
  const content = await readProductContent(owner, productId), options = await readProductOptions(owner, productId);
  // Only a fully initialized source import can receive automatic image drafts.
  if (content.revision < 1 || options.revision < 1) return null;
  await db.prepare(collectionImagesSchema).run();
  const images = await db.prepare('SELECT image_index AS imageIndex,object_key AS key FROM collection_images WHERE owner_id=? AND job_id=? AND product_id=? ORDER BY image_index').bind(owner, jobId, productId).all<CollectedImageLink>();
  const now = new Date(Math.max(Date.now(), Date.parse(product.updated_at) + 1)).toISOString();
  const draft = collectedImageDraft(owner, receipt.result, images.results, productImageKeys(product.image_keys), content, options, now);
  const guard = `id=? AND owner_id=? AND source_url=? AND updated_at=? AND image_keys=?
    AND EXISTS(SELECT 1 FROM product_content WHERE product_id=products.id AND owner_id=products.owner_id AND revision=?)
    AND EXISTS(SELECT 1 FROM product_options WHERE product_id=products.id AND owner_id=products.owner_id AND revision=?)
    AND EXISTS(SELECT 1 FROM collection_products cp JOIN collection_jobs j ON j.id=cp.job_id AND j.owner_id=cp.owner_id
      JOIN collection_results r ON r.job_id=j.id AND r.owner_id=j.owner_id JOIN collection_context c ON c.job_id=j.id
      WHERE cp.product_id=products.id AND cp.owner_id=products.owner_id AND j.id=? AND j.status='awaiting_connector' AND j.goal='work'
      AND j.offer_id=? AND j.source_url=products.source_url AND r.payload=? AND c.payload=?)
    AND (SELECT count(*) FROM collection_images WHERE owner_id=products.owner_id AND product_id=products.id AND job_id=?)=json_array_length(?)
    AND NOT EXISTS(SELECT 1 FROM collection_images ci WHERE ci.owner_id=products.owner_id AND ci.product_id=products.id AND ci.job_id=?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) saved WHERE json_extract(saved.value,'$.imageIndex')=ci.image_index AND json_extract(saved.value,'$.key')=ci.object_key))`;
  const args = [productId, owner, product.source_url, product.updated_at, product.image_keys, content.revision, options.revision,
    jobId, job.offer_id, JSON.stringify(receipt.result), JSON.stringify(job.context), jobId, JSON.stringify(images.results), jobId, JSON.stringify(images.results)];
  if (!draft.changedRoles && !draft.changedOptions) {
    const unchanged = await db.prepare(`SELECT id FROM products WHERE ${guard}`).bind(...args).first();
    return unchanged ? { productId, changedRoles: 0, changedOptions: 0 } : null;
  }
  // changes() chains the three writes within the same transaction. Revision
  // checks are independent of the product clock; all manual edits win a race.
  const saved = await db.batch([
    db.prepare(`UPDATE products SET quote_status='대기',updated_at=? WHERE ${guard} RETURNING id`).bind(now, ...args),
    draft.changedRoles ? db.prepare(`UPDATE product_content SET revision=?,payload=?,updated_at=? WHERE product_id=? AND owner_id=? AND changes()=1`)
      .bind(draft.content.revision, JSON.stringify(draft.content), now, productId, owner) : db.prepare('SELECT changes() AS changed'),
    draft.changedOptions ? db.prepare(`UPDATE product_options SET revision=?,payload=?,updated_at=? WHERE product_id=? AND owner_id=? AND changes()=1`)
      .bind(draft.options.revision, JSON.stringify(draft.options), now, productId, owner) : db.prepare('SELECT changes() AS changed'),
  ]);
  return saved[0].results.length ? { productId, changedRoles: draft.changedRoles, changedOptions: draft.changedOptions } : null;
}
