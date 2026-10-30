import { env } from 'cloudflare:workers';
import type { ProductRecord } from '@/db/queries';
import type { PricePolicy } from '@/app/pricing';
import type { ProductOptions } from '@/app/product-options';
import { sourceGuard, type QuotationFieldsState, type QuotationSourceGuard } from '@/db/quotation-fields';
import { prepareProductRegistrationOptions } from '@/db/product-registration';

type Raw = { payload: string; revision: number };
export type StageTwoPricingFence = { options: Raw | null; quotation: Raw | null; content: Raw | null; profile: Raw | null;
  actor?: { email: string; role: string; companyCode: string; companyName: string } };
/** Capture exact stored sidecar bytes; the caller rechecks the full resolved
 * snapshot after this read before asking the atomic batch to apply them. */
export async function readStageTwoPricingFence(owner: string, id: string, profileId: string | null): Promise<StageTwoPricingFence> {
  if (!env.DB) throw Error('D1 unavailable.');
  const read = (table: string) => env.DB.prepare(`SELECT payload,revision FROM ${table} WHERE product_id=? AND owner_id=?`).bind(id, owner).first<Raw>();
  const [options, quotation, content, profile] = await Promise.all([read('product_options'), read('product_quotation_fields'), read('product_content'),
    profileId ? env.DB.prepare('SELECT payload,revision FROM category_profiles WHERE id=? AND owner_id=?').bind(profileId, owner).first<Raw>() : null]);
  return { options, quotation, content, profile };
}
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** One guarded option mutation, the product and policy, the selected
 * quotation edits and immutable display companions share a transaction. A
 * skipped/changed companion causes an existing NOT NULL/CHECK constraint to
 * abort the whole batch; stale first predicates make every companion a no-op. */
export async function commitStageTwoPricing(owner: string, product: ProductRecord, policy: PricePolicy,
  calculation: { supplyPrice: number; salePrice: number; msrp: number }, options: ProductOptions, previousOptions: ProductOptions,
  quotation: QuotationFieldsState, previousQuotation: QuotationFieldsState, source: QuotationSourceGuard, fence: StageTwoPricingFence): Promise<boolean> {
  if (!env.DB) throw Error('D1 unavailable.');
  const db = env.DB, id = product.id, version = options.updatedAt;
  if (product.owner_id !== owner || options.productId !== id || previousOptions.productId !== id || quotation.productId !== id || previousQuotation.productId !== id
    || options.revision !== previousOptions.revision + 1 || quotation.revision !== previousQuotation.revision + 1
    || !version || quotation.updatedAt !== version || product.updated_at !== source.productVersion || previousOptions.revision !== source.optionRevision
    || (fence.options === null ? previousOptions.revision !== 0 : fence.options.revision !== previousOptions.revision || !equal(JSON.parse(fence.options.payload), previousOptions))
    || (fence.quotation === null ? previousQuotation.revision !== 0 : fence.quotation.revision !== previousQuotation.revision || !equal(JSON.parse(fence.quotation.payload), previousQuotation)))
    throw Error('Invalid atomic stage-two source.');
  const reviews=Object.values(quotation.stageTwoPricingReviews??{}).filter(review=>review.productVersion===version);
  if(options.rows.some(row=>row.included)?reviews.length!==1||reviews[0].ownerId!==owner||reviews[0].productId!==id||reviews[0].sourceProductVersion!==product.updated_at
    ||!/^[a-f0-9]{64}$/.test(reviews[0].sourceInputFingerprint)
    ||source.profile&&reviews[0].profileId!==source.profile.id
    ||fence.actor&&(reviews[0].companyCode!==fence.actor.companyCode||reviews[0].companyName!==fence.actor.companyName):reviews.length!==0)throw Error('Invalid atomic stage-two review.');
  const optionPayload = JSON.stringify(options), quotePayload = JSON.stringify(quotation), policyPayload = JSON.stringify(policy);
  if ([optionPayload, quotePayload].some(payload => new TextEncoder().encode(payload).length > 512 * 1024)) throw RangeError('가격·견적 자료가 저장 한도를 초과했습니다.');
  const guard = sourceGuard(owner, id, source), args: (string | number | null)[] = [...guard.args], extra: string[] = [];
  // A same-clock raw source edit cannot be hidden behind a valid option CAS.
  const productFields = ['source_url', 'title', 'source_price_cny', 'exchange_rate', 'supply_margin', 'coupang_margin', 'supply_price', 'sale_price', 'msrp',
    'options_count', 'seo_status', 'image_status', 'quote_status', 'registration_status', 'supplier_hub_status', 'goal_stage', 'created_at'] as const;
  for (const key of productFields) { extra.push(`p.${key} IS ?`); args.push(product[key]); }
  for (const [table, before] of [['product_options', fence.options], ['product_quotation_fields', fence.quotation], ['product_content', fence.content]] as const) {
    if (before) { extra.push(`EXISTS(SELECT 1 FROM ${table} f WHERE f.product_id=p.id AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)`); args.push(before.revision, before.payload); }
    else extra.push(`NOT EXISTS(SELECT 1 FROM ${table} f WHERE f.product_id=p.id)`);
  }
  if (source.profile) {
    if (!fence.profile || fence.profile.revision !== source.profile.revision) throw Error('Invalid category source.');
    extra.push('EXISTS(SELECT 1 FROM category_profiles f WHERE f.id=? AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)');
    args.push(source.profile.id, fence.profile.revision, fence.profile.payload);
  }
  if ((env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED === 'true') {
    if (!fence.actor) throw Error('Invalid member source.');
    extra.push("EXISTS(SELECT 1 FROM members m WHERE m.id=p.owner_id AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=? AND m.company_name=?)");
    args.push(fence.actor.email.trim().toLowerCase(), fence.actor.role, fence.actor.companyCode, fence.actor.companyName);
  }
  const applied = `EXISTS(SELECT 1 FROM products p WHERE p.id=? AND p.owner_id=? AND p.updated_at=?)`;
  const newOptions = `EXISTS(SELECT 1 FROM product_options o WHERE o.product_id=p.id AND o.owner_id=p.owner_id AND o.revision=? AND o.payload=? AND o.updated_at=?)`;
  const newQuote = `EXISTS(SELECT 1 FROM product_quotation_fields q WHERE q.product_id=p.id AND q.owner_id=p.owner_id AND q.revision=? AND q.payload=? AND q.updated_at=?)`;
  const postGuard = sourceGuard(owner, id, { ...source, productVersion: version, pricingPolicy: policyPayload, optionRevision: options.revision });
  const postRaw: string[] = [], postArgs: (string | number | null)[] = [];
  if (fence.content) { postRaw.push('EXISTS(SELECT 1 FROM product_content c WHERE c.product_id=p.id AND c.owner_id=p.owner_id AND c.revision=? AND c.payload=?)'); postArgs.push(fence.content.revision, fence.content.payload); }
  else postRaw.push('NOT EXISTS(SELECT 1 FROM product_content c WHERE c.product_id=p.id)');
  if (source.profile && fence.profile) { postRaw.push('EXISTS(SELECT 1 FROM category_profiles f WHERE f.id=? AND f.owner_id=p.owner_id AND f.revision=? AND f.payload=?)'); postArgs.push(source.profile.id, fence.profile.revision, fence.profile.payload); }
  if (fence.actor) { postRaw.push("EXISTS(SELECT 1 FROM members m WHERE m.id=p.owner_id AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=? AND m.company_name=?)"); postArgs.push(fence.actor.email.trim().toLowerCase(), fence.actor.role, fence.actor.companyCode, fence.actor.companyName); }
  const result = await db.batch<{ id?: string; product_id?: string }>([
    // This new revision is the transaction's applied anchor. Product-clock
    // triggers cannot hide it by moving the product back to its old version.
    db.prepare(`INSERT INTO product_options(product_id,owner_id,revision,payload,updated_at)
      SELECT p.id,p.owner_id,?,?,? FROM products p WHERE ${guard.sql} AND ${extra.join(' AND ')}
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at RETURNING product_id`)
      .bind(options.revision, optionPayload, version, ...args),
    db.prepare(`UPDATE products AS p SET exchange_rate=?,supply_margin=?,coupang_margin=?,supply_price=?,sale_price=?,msrp=?,options_count=?,quote_status='대기',updated_at=?
      WHERE p.id=? AND p.owner_id=? AND p.updated_at=? AND changes()=1 AND ${newOptions} RETURNING id`)
      .bind(policy.exchangeRate, policy.supplyMargin, policy.coupangMargin, calculation.supplyPrice, calculation.salePrice, calculation.msrp,
        options.rows.filter(row => row.included).length, version, id, owner, source.productVersion, options.revision, optionPayload, version),
    db.prepare(`INSERT INTO product_price_policy(product_id,payload) SELECT p.id,CASE WHEN p.updated_at=? THEN ? ELSE NULL END FROM products p WHERE p.id=? AND p.owner_id=? AND changes()=1
      ON CONFLICT(product_id) DO UPDATE SET payload=excluded.payload RETURNING product_id`)
      .bind(version, policyPayload, id, owner),
    // This allocator follows the one-row option write. Zero new identifiers is
    // valid, so the final integrity assertion checks its contents, not changes().
    prepareProductRegistrationOptions(db, owner, id, options.rows.map(row => row.id), version, { revision: options.revision, payload: optionPayload }),
    db.prepare(`INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at)
      SELECT p.id,p.owner_id,CASE WHEN ${newOptions} AND EXISTS(SELECT 1 FROM product_price_policy pp WHERE pp.product_id=p.id AND pp.payload=?) THEN ? ELSE 0 END,?,?
      FROM products p WHERE p.id=? AND p.owner_id=? AND p.updated_at=?
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at RETURNING product_id`)
      .bind(options.revision, optionPayload, version, policyPayload, quotation.revision, quotePayload, version, id, owner, version),
    db.prepare(`UPDATE products AS p SET title=CASE WHEN changes()=1 AND ${newOptions} AND ${newQuote}
      AND EXISTS(SELECT 1 FROM product_price_policy pp WHERE pp.product_id=p.id AND pp.payload=?)
      AND (NOT EXISTS(SELECT 1 FROM product_registration_numbers n WHERE n.product_id=p.id AND n.owner_id=p.owner_id)
        OR NOT EXISTS(SELECT 1 FROM json_each(?) ids WHERE NOT EXISTS(SELECT 1 FROM product_registration_options m WHERE m.product_id=p.id AND m.owner_id=p.owner_id AND m.option_id=ids.value)))
      AND ${postGuard.sql} AND ${postRaw.join(' AND ')} THEN title ELSE NULL END WHERE p.id=? AND p.owner_id=?
      AND ${newOptions} RETURNING id`)
      .bind(options.revision, optionPayload, version, quotation.revision, quotePayload, version, policyPayload, JSON.stringify(options.rows.map(row => row.id)),
        ...postGuard.args, ...postArgs, id, owner, options.revision, optionPayload, version),
    // A trigger that changes the product clock at a companion boundary must
    // also roll back. This assertion is independent of a product UPDATE trigger.
    db.prepare(`UPDATE product_options SET revision=CASE WHEN ${applied} THEN revision ELSE 0 END
      WHERE product_id=? AND owner_id=? AND revision=? AND payload=? AND updated_at=? RETURNING product_id`)
      .bind(id, owner, version, id, owner, options.revision, optionPayload, version),
  ]);
  const saved = Boolean(result[0].results[0]);
  if ([1, 2, 4, 5, 6].some(index => Boolean(result[index].results[0]) !== saved)) throw Error('Incomplete atomic stage-two acknowledgement.');
  return saved;
}
