export const MANUAL_SIZE_CHART_COLUMNS = 20;
export const MANUAL_SIZE_CHART_ROWS = 60;
export const MANUAL_SIZE_CHART_BYTES = 64 * 1024;
export const manualSizeUnits = ['cm', 'mm', 'inch', '㎡'] as const;
export type ManualSizeChart = {
  sizeType: string; sizeUnits: typeof manualSizeUnits[number]; sizes: string[];
  measurements: { name: string; values: string[] }[];
};
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('사이즈표 형식을 확인해주세요.');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new Error(`사이즈표 내용은 ${maximum}자 이내의 일반 텍스트로 입력해주세요.`);
  return value;
}
/** Local rendering limits, not supplier facts or original service quotas. */
export function validateManualSizeChart(input: unknown): ManualSizeChart {
  const value = object(input, ['sizeType', 'sizeUnits', 'sizes', 'measurements']);
  if (!manualSizeUnits.includes(value.sizeUnits as ManualSizeChart['sizeUnits'])) throw new Error('사이즈표 단위는 cm, mm, inch, ㎡ 중에서 선택해주세요.');
  if (!Array.isArray(value.sizes) || value.sizes.length > MANUAL_SIZE_CHART_COLUMNS) throw new Error(`사이즈는 최대 ${MANUAL_SIZE_CHART_COLUMNS}열입니다.`);
  const sizes = value.sizes.map(item => text(item, 80).trim()).filter(Boolean);
  if (!sizes.length) throw new Error('사이즈를 한 개 이상 입력해주세요.');
  if (!Array.isArray(value.measurements) || value.measurements.length > MANUAL_SIZE_CHART_ROWS) throw new Error(`측정 항목은 최대 ${MANUAL_SIZE_CHART_ROWS}행입니다.`);
  const measurements = value.measurements.map(item => {
    const row = object(item, ['name', 'values']), name = text(row.name, 80);
    if (!Array.isArray(row.values) || row.values.length !== sizes.length) throw new Error('측정값 개수와 사이즈 열 개수를 맞춰주세요.');
    return { name, values: row.values.map(item => text(item, 200)) };
  }).filter(row => row.name !== '');
  if (!measurements.length) throw new Error('측정 항목을 한 개 이상 입력해주세요.');
  const result: ManualSizeChart = { sizeType: text(value.sizeType, 80), sizeUnits: value.sizeUnits as ManualSizeChart['sizeUnits'], sizes, measurements };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MANUAL_SIZE_CHART_BYTES) throw new Error('사이즈표 내용은 64KiB 이내로 줄여주세요.');
  return result;
}
