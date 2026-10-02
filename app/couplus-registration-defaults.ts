/** Couplus public applyDefaultSettings, observed 2026-10-02. These are the
 * owner's form inputs, not verified supplier facts or certification evidence. */
export type CouplusSettingInput='brand'|'tradeType'|'importType'|'handlingReason';
export type CouplusSettingRule={input:CouplusSettingInput;values?:(string|number|boolean|null)[]};
export function isCouplusSettingInput(input:unknown):input is CouplusSettingInput{
  return input==='brand'||input==='tradeType'||input==='importType'||input==='handlingReason';
}
/** Public applySettingWithDropdownCheck uses exact wire choices, then the first
 * choice. Only fresh captured drafts opt in; later manual values never use it. */
export function couplusSettingDraftValue(rule:CouplusSettingRule,value:string):string|undefined{
  if(!value)return undefined;
  const candidate=rule.input==='brand'&&value.includes(',')?value.split(',')[0].trim():value;
  if(!rule.values||rule.values.includes(candidate))return candidate;
  return String(rule.values[0]||'');
}

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
