import { env } from 'cloudflare:workers';
import type { ProductRecord } from '@/db/queries';
import type { ProductOptions } from '@/app/product-options';
import type { SeoOptionOriginalReference } from '@/app/seo-workspace';
import { collectionSourceReference } from '@/app/sourcing';
import { translationAttributeIssue } from '@/app/translation-attribute-evidence';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const line = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value === value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const clock = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Read-only display evidence, never a new translation or an option mutation.
 * Missing legacy tables/history and ambiguous bindings leave the original plain.
 * The owner/product/source tuple is checked again after reading the bounded jobs. */
export async function readSeoOptionOriginalReferences(owner: string, product: Pick<ProductRecord, 'id' | 'source_url' | 'updated_at'>, options: ProductOptions): Promise<Record<string, SeoOptionOriginalReference>> {
  const db = env.DB;
  if (!db || options.productId !== product.id || !options.rows.length) return {};
  const readLink = async () => (await db.prepare(`SELECT j.id,j.source_url,j.offer_id,j.updated_at
    FROM collection_products cp JOIN products p ON p.id=cp.product_id AND p.owner_id=cp.owner_id
    JOIN collection_jobs j ON j.id=cp.job_id AND j.owner_id=cp.owner_id
    WHERE cp.owner_id=? AND cp.product_id=? AND p.source_url=j.source_url AND j.status='awaiting_connector'
    AND p.updated_at=? LIMIT 2`).bind(owner, product.id, product.updated_at).all<{ id: string; source_url: string; offer_id: string; updated_at: string }>()).results;
  const links = await readLink();
  if (links.length !== 1) return {};
  const link = links[0];
  if (link.source_url !== product.source_url || !/^[A-Za-z0-9_-]{1,100}$/u.test(link.id)
    || link.source_url !== `https://detail.1688.com/offer/${link.offer_id}.html`) return {};
  const reference = collectionSourceReference(link.id, link.source_url);
  const jobs = (await db.prepare(`SELECT product_version,status,review,result,finished_at FROM translation_jobs
    WHERE owner_id=? AND product_id=? ORDER BY created_at DESC,id DESC LIMIT 20`).bind(owner, product.id)
    .all<{ product_version: string; status: string; review: string; result: string | null; finished_at: string | null }>()).results;
  // A full bounded window cannot establish that another matching older result
  // is absent. Retain the plain caption instead of selecting an arbitrary job.
  if (jobs.length === 20) return {};
  const output: Record<string, SeoOptionOriginalReference> = Object.create(null);
  for (const row of options.rows) {
    const candidates: SeoOptionOriginalReference[] = [];
    if (!line(row.originalName, 500) || !clock(row.updatedAt)) continue;
    for (const job of jobs) {
      if (job.status !== 'completed' || !clock(job.finished_at) || !clock(job.product_version)
        || Date.parse(job.finished_at) > Date.parse(row.updatedAt) || Date.parse(job.product_version) > Date.parse(row.updatedAt)) continue;
      let review: unknown, result: unknown;
      try { review = JSON.parse(job.review); result = job.result ? JSON.parse(job.result) : null; } catch { continue; }
      if (!record(review) || !record(review.source) || review.source.reference !== reference || !Array.isArray(review.source.attributes)
        || review.source.attributes.length > 50 || !record(result) || !record(result.draft) || !Array.isArray(result.draft.attributes)
        || result.draft.attributes.length > 50 || !clock(result.generatedAt) || Date.parse(result.generatedAt) > Date.parse(job.finished_at)) continue;
      const originals = review.source.attributes.filter(item => record(item) && item.name === `option:${row.id}`);
      if (originals.length !== 1 || !record(originals[0]) || originals[0].value !== row.originalName) continue;
      const indices = result.draft.attributes.map(item => record(item) ? item.sourceIndex : undefined);
      if (indices.some(index => !Number.isInteger(index) || Number(index) < 0 || Number(index) >= (review.source as { attributes: unknown[] }).attributes.length)
        || new Set(indices).size !== indices.length) continue;
      const axes: SeoOptionOriginalReference['axes'] = [];
      let invalid = false;
      for (const field of ['color', 'size'] as const) {
        const sources = review.source.attributes.flatMap((item, sourceIndex) => record(item) && item.name === `option-${field}:${row.id}` ? [{ item, sourceIndex }] : []);
        if (!sources.length) continue;
        if (sources.length !== 1 || row.provenance[field] !== 'translated' || !line(row[field], 200) || !line(sources[0].item.value, 200)) { invalid = true; break; }
        const translated = result.draft.attributes.filter(item => record(item) && item.sourceIndex === sources[0].sourceIndex);
        if (translated.length !== 1 || !record(translated[0]) || translated[0].name !== sources[0].item.name || translated[0].value !== row[field]) { invalid = true; break; }
        if (translationAttributeIssue({ name: `option-${field}:${row.id}`, value: sources[0].item.value }, { name: `option-${field}:${row.id}`, value: row[field] })) { invalid = true; break; }
        axes.push({ field, original: sources[0].item.value, translated: row[field] });
      }
      // Joining immutable axes is only an exact coverage check. Never split or
      // infer axes from the combined label or the editable final Korean name.
      if (!invalid && axes.length && axes.map(axis => axis.original).join(' / ') === row.originalName) candidates.push({ originalName: row.originalName, axes });
    }
    // Even duplicate identical histories are ambiguous: do not pick by recency.
    if (candidates.length === 1) output[row.id] = candidates[0];
  }
  return JSON.stringify(await readLink()) === JSON.stringify(links) ? output : {};
}
