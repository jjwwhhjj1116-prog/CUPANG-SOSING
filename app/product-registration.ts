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
