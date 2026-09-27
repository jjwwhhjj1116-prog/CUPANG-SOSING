/** Same saved source keeps its name; edits and other products get another name. */
export function quotationFilename(fingerprint: string, format: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || !['xlsx','csv','tsv'].includes(format)) throw new Error('견적서 파일 식별 정보를 확인해주세요.');
  return `YOOFAM-${fingerprint}.${format}`;
}

export function isQuotationFilename(filename: string) {
  return /^(?:YOOFAM-[a-f0-9]{64}|quotation-filled)\.(xlsx|csv|tsv)$/.test(filename);
}
