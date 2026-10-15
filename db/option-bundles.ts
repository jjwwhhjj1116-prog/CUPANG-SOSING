import { env } from 'cloudflare:workers';
import type { ProductOptions } from '@/app/product-options';
import { sourceGuard, quotationFieldsSchema, type QuotationFieldsState, type QuotationSourceGuard } from '@/db/quotation-fields';
import { prepareProductRegistrationOptions } from '@/db/product-registration';

type Row = { payload: string; revision: number };

/** The cloned source facts, display companions and current quotation scope are
 * one commit. A stale source/quotation predicate makes the first write a no-op;
 * a failed companion statement rolls back every write in the D1 batch. */
export async function commitOptionBundles(owner: string, options: ProductOptions, previousOptions: ProductOptions,
  quotation: QuotationFieldsState, previousQuotation: QuotationFieldsState, source: QuotationSourceGuard): Promise<boolean> {
  if (!env.DB) throw Error('D1 binding DB is unavailable.');
  const db = env.DB;
  if (options.productId !== previousOptions.productId || quotation.productId !== options.productId
    || previousQuotation.productId !== options.productId || options.revision !== previousOptions.revision + 1
    || quotation.revision !== previousQuotation.revision + 1 || !options.updatedAt || quotation.updatedAt !== options.updatedAt
    || previousOptions.revision !== source.optionRevision) throw Error('Invalid bundle commit clocks.');
  await db.prepare(quotationFieldsSchema).run();
  const optionPayload = JSON.stringify(options), oldOptionPayload = JSON.stringify(previousOptions);
  const quotePayload = JSON.stringify(quotation), oldQuotePayload = JSON.stringify(previousQuotation);
  if (new TextEncoder().encode(optionPayload).length > 512 * 1024 || new TextEncoder().encode(quotePayload).length > 512 * 1024)
    throw RangeError('번들 자료가 저장 한도를 초과했습니다.');
  const guard = sourceGuard(owner, options.productId, source);
  const quoteBefore = `((?=0 AND NOT EXISTS(SELECT 1 FROM product_quotation_fields q WHERE q.product_id=p.id))
    OR EXISTS(SELECT 1 FROM product_quotation_fields q WHERE q.product_id=p.id AND q.owner_id=p.owner_id AND q.revision=? AND q.payload=?))`;
  const result = await db.batch<Row>([
    db.prepare(`INSERT INTO product_options(product_id,owner_id,revision,payload,updated_at)
      SELECT p.id,p.owner_id,?,?,? FROM products p WHERE ${guard.sql}
      AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_options o WHERE o.product_id=p.id))
        OR EXISTS(SELECT 1 FROM product_options o WHERE o.product_id=p.id AND o.owner_id=p.owner_id AND o.revision=? AND o.payload=?))
      AND ${quoteBefore}
      AND NOT EXISTS(SELECT 1 FROM product_registration_options m JOIN json_each(?) target ON target.value=m.option_id
        WHERE m.product_id=p.id AND m.owner_id=p.owner_id)
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
        WHERE product_options.owner_id=excluded.owner_id AND product_options.revision=? AND product_options.payload=?
      RETURNING payload,revision`)
      .bind(options.revision, optionPayload, options.updatedAt, ...guard.args,
        previousOptions.revision, previousOptions.revision, oldOptionPayload,
        previousQuotation.revision, previousQuotation.revision, oldQuotePayload,
        JSON.stringify(options.rows.filter(row => !previousOptions.rows.some(before => before.id === row.id)).map(row => row.id)),
        previousOptions.revision, oldOptionPayload),
    db.prepare(`UPDATE products SET quote_status='대기',options_count=?,updated_at=?
      WHERE id=? AND owner_id=? AND updated_at=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_options o WHERE o.product_id=products.id AND o.owner_id=products.owner_id
        AND o.revision=? AND o.payload=? AND o.updated_at=?) RETURNING updated_at`)
      .bind(options.rows.filter(row => row.included).length, options.updatedAt, options.productId, owner, source.productVersion,
        options.revision, optionPayload, options.updatedAt),
    prepareProductRegistrationOptions(db, owner, options.productId, options.rows.map(row => row.id), options.updatedAt,
      { revision: options.revision, payload: optionPayload }),
    // A companion inconsistency after an applied first write is a CHECK error,
    // rather than an acknowledged partial commit. Legacy products can allocate
    // zero display rows, so changes() from that allocator is deliberately unused.
    db.prepare(`INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at)
      SELECT p.id,p.owner_id,CASE WHEN p.updated_at=? AND ${quoteBefore} THEN ? ELSE 0 END,?,?
      FROM products p WHERE p.id=? AND p.owner_id=?
      AND EXISTS(SELECT 1 FROM product_options o WHERE o.product_id=p.id AND o.owner_id=p.owner_id
        AND o.revision=? AND o.payload=? AND o.updated_at=?)
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
      RETURNING payload,revision`)
      .bind(options.updatedAt, previousQuotation.revision, previousQuotation.revision, oldQuotePayload,
        quotation.revision, quotePayload, options.updatedAt, options.productId, owner, options.revision, optionPayload, options.updatedAt),
  ]);
  if (Boolean(result[0].results[0]) !== Boolean(result[1].results[0])
    || Boolean(result[0].results[0]) !== Boolean(result[3].results[0])) throw Error('Incomplete bundle commit acknowledgement.');
  return Boolean(result[0].results[0]);
}
