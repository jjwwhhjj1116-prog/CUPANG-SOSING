export type ProductRegistrationIdentity = { id: string; registration_number?: string };

function persistedRegistrationNumber(value: string | undefined): string | null {
  return typeof value === 'string' && value.length === 12 && /^[0-9]{12}$/.test(value) ? value : null;
}

/** Display metadata only; the saved product ID remains its action and route identity. */
export function registrationNumber(product: ProductRegistrationIdentity): string {
  return persistedRegistrationNumber(product.registration_number) ?? `YP-${product.id.slice(0, 8).toUpperCase()}`;
}

/** Observed suffix format for allocation; existing displays use persisted option metadata. */
export function optionRegistrationNumber(parent: string | undefined, index: number): string | null {
  const number = persistedRegistrationNumber(parent);
  return number && Number.isSafeInteger(index) && index >= 0 && index < 999
    ? number.substring(0, 9) + String(index + 1).padStart(3, '0') : null;
}

/** Validate optional display metadata against the current saved option identities. */
export function validOptionRegistrationNumbers(value: unknown, rows: readonly { id: string }[], parent?: string): value is Record<string, string> | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value), prefix = parent === undefined ? null : persistedRegistrationNumber(parent)?.substring(0, 9);
  if (entries.length > rows.length || (parent !== undefined && !prefix && entries.length)) return false;
  const ids = new Set(rows.map(row => row.id)), seen = new Set<string>(); let observedPrefix: string | null = null;
  return entries.every(([id, number]) => {
    if (!ids.has(id) || typeof number !== 'string' || number.length !== 12 || !/^[0-9]{12}$/.test(number) || number.substring(9) === '000' || seen.has(number)) return false;
    const currentPrefix = number.substring(0, 9);
    if ((prefix && currentPrefix !== prefix) || (observedPrefix && currentPrefix !== observedPrefix)) return false;
    seen.add(number); observedPrefix = currentPrefix; return true;
  });
}

/** Reordering/filtering never assigns numbers; actions continue to use optionId. */
export function savedOptionRegistrationNumber(optionId: string, numbers?: Readonly<Record<string, string>>): string {
  return numbers && Object.hasOwn(numbers, optionId) ? numbers[optionId] : optionId;
}

export function optionRegistrationLabel(optionId: string | null, label: string, numbers?: Readonly<Record<string, string>>): string {
  if (optionId === null || !numbers || !Object.hasOwn(numbers, optionId)) return label;
  const number = savedOptionRegistrationNumber(optionId, numbers);
  return !label || label === optionId ? number : `${number} · ${label}`;
}
