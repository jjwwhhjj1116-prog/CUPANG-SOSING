/** Couplus public applyDefaultSettings, observed 2026-10-02. These are the
 * owner's form inputs, not verified supplier facts or certification evidence. */
export function washingPrecautionsText(settings: unknown): string {
  const stored = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings as Record<string, unknown> : {};
  const text = (key: string) => typeof stored[key] === 'string' && stored[key].length <= 500
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(stored[key]) ? stored[key].trim() : '';
  const washing = text('washingMethod'), precautions = text('handlingPrecautions');
  return washing && precautions ? `세탁방법: ${washing}, 취급시 주의사항: ${precautions}` : washing || precautions;
}

/** Stable Korean calendar month from the intake timestamp, never the read/export
 * clock. Calculate the month index directly: setMonth on a 31st can overflow. */
export function previousRegistrationMonth(referenceTime: unknown): string {
  if (typeof referenceTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(referenceTime)) return '';
  const [year, month, day] = referenceTime.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return '';
  const timestamp = Date.parse(referenceTime);
  if (!Number.isFinite(timestamp)) return '';
  const korean = new Date(timestamp + 9 * 60 * 60 * 1000);
  const previous = korean.getUTCFullYear() * 12 + korean.getUTCMonth() - 1;
  return `${Math.floor(previous / 12)}.${String(previous % 12 + 1).padStart(2, '0')}`;
}
