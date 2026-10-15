/** YOOFAM allocation policy: a member's new products share a KST calendar-day
 * sequence. The vendor's server-side allocation scope is unknown. UUIDs remain
 * the product identity; this immutable companion is display metadata only. */
export const productRegistrationCounterSchema = `CREATE TABLE IF NOT EXISTS product_registration_counters (
  owner_id TEXT NOT NULL, registration_day TEXT NOT NULL,
  last_sequence INTEGER NOT NULL CHECK(last_sequence BETWEEN 1 AND 999),
  PRIMARY KEY(owner_id, registration_day)
)`;
export const productRegistrationSchema = `CREATE TABLE IF NOT EXISTS product_registration_numbers (
  product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
  registration_day TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 999),
  registration_number TEXT NOT NULL CHECK(
    registration_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND length(registration_number)=12
    AND registration_number=replace(substr(registration_day,3),'-','') || printf('%03d',sequence) || '001'
  ), created_at TEXT NOT NULL,
  UNIQUE(owner_id, registration_day, sequence), UNIQUE(owner_id, registration_number),
  FOREIGN KEY(owner_id, registration_day) REFERENCES product_registration_counters(owner_id, registration_day)
)`;
export const productRegistrationOptionsSchema = `CREATE TABLE IF NOT EXISTS product_registration_options (
  product_id TEXT NOT NULL REFERENCES product_registration_numbers(product_id), owner_id TEXT NOT NULL,
  option_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 999),
  PRIMARY KEY(product_id, option_id), UNIQUE(product_id, sequence)
)`;

export function registrationDay(createdAt: string) {
  const instant = Date.parse(createdAt);
  if (!Number.isFinite(instant)) throw new Error('Invalid product registration time.');
  return new Date(instant + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Append only to the transaction that creates this fresh product UUID. A
 * guarded no-op product INSERT must consume no number. Counter exhaustion is
 * a CHECK failure, rolling back the product and all of its companions. */
export function prepareProductRegistration(db: D1Database, owner: string, productId: string, createdAt: string) {
  const day = registrationDay(createdAt);
  return [
    db.prepare(`INSERT INTO product_registration_counters(owner_id, registration_day, last_sequence)
      SELECT owner_id, ?, 1 FROM products p WHERE p.id=? AND p.owner_id=?
        AND NOT EXISTS(SELECT 1 FROM product_registration_numbers n WHERE n.product_id=p.id)
      ON CONFLICT(owner_id, registration_day) DO UPDATE SET last_sequence=last_sequence+1`)
      .bind(day, productId, owner),
    db.prepare(`INSERT INTO product_registration_numbers(product_id, owner_id, registration_day, sequence, registration_number, created_at)
      SELECT p.id, p.owner_id, c.registration_day, c.last_sequence,
        replace(substr(c.registration_day,3),'-','') || printf('%03d',c.last_sequence) || '001', ?
      FROM products p JOIN product_registration_counters c ON c.owner_id=p.owner_id AND c.registration_day=?
      WHERE p.id=? AND p.owner_id=? AND NOT EXISTS(SELECT 1 FROM product_registration_numbers n WHERE n.product_id=p.id)
      RETURNING registration_number`).bind(createdAt, day, productId, owner),
  ];
}

/** Numbers follow an option UUID for its lifetime, including removal and later
 * re-addition. Only previously unseen UUIDs consume the next suffix. Materialize
 * the old maximum before INSERT so every new row uses the same allocation base. */
export function prepareProductRegistrationOptions(db: D1Database, owner: string, productId: string, optionIds: readonly string[], productVersion: string, applied?: {revision:number;payload:string}) {
  return db.prepare(`WITH allocation AS MATERIALIZED (
      SELECT COALESCE(MAX(sequence),0) AS last_sequence FROM product_registration_options WHERE product_id=? AND owner_id=?
    ), fresh AS MATERIALIZED (
      SELECT i.value AS option_id, CAST(i.key AS INTEGER) AS ordinal FROM json_each(?) i
      WHERE NOT EXISTS(SELECT 1 FROM product_registration_options m WHERE m.product_id=? AND m.option_id=i.value)
    ) INSERT INTO product_registration_options(product_id,owner_id,option_id,sequence)
      SELECT p.id,p.owner_id,f.option_id,a.last_sequence+ROW_NUMBER() OVER (ORDER BY f.ordinal)
      FROM products p JOIN product_registration_numbers n ON n.product_id=p.id AND n.owner_id=p.owner_id
      CROSS JOIN allocation a CROSS JOIN fresh f
      WHERE p.id=? AND p.owner_id=? AND p.updated_at=?
        AND (?=0 OR (changes()=1 AND EXISTS(SELECT 1 FROM product_options o
          WHERE o.product_id=p.id AND o.owner_id=p.owner_id AND o.revision=? AND o.payload=? AND o.updated_at=p.updated_at)))`)
    .bind(productId,owner,JSON.stringify(optionIds),productId,productId,owner,productVersion,applied?1:0,applied?.revision??0,applied?.payload??'');
}

/** SQL joins return NULL for historical products. Omit that property so the
 * original API object shape and existing operation fingerprints remain intact. */
export function withRegistrationNumber<T extends { registration_number?: string | null }>(row: T): Omit<T, 'registration_number'> & { registration_number?: string } {
  const { registration_number, ...product } = row;
  return registration_number ? { ...product, registration_number } : product;
}
