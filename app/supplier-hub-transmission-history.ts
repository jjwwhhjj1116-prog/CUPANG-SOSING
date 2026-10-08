import { parseStoredSupplierHubReceipt, type SupplierHubReceipt } from '@/app/supplier-hub-receipt';

export type SupplierHubTransmissionHistory = { schemaVersion: 1; productId: string; blocked: boolean; receipts: SupplierHubReceipt[] };

/** Only a conclusively rejected file with no assigned IDs permits a new upload. */
export function supplierHubReceiptAllowsNewTransmission(receipt: SupplierHubReceipt): boolean {
  return receipt.result.state === 'validation-rejected'
    && (receipt.result.quotationId === undefined || receipt.result.quotationId === '')
    && receipt.result.registration === undefined;
}

export function supplierHubTransmissionHistory(productId: string, receipts: SupplierHubReceipt[]): SupplierHubTransmissionHistory {
  if (!productId || productId.length > 100 || !Array.isArray(receipts) || receipts.length > 200) throw Error('상품의 전체 전송 이력을 확인하지 못했습니다.');
  const checked = receipts.map(receipt => parseStoredSupplierHubReceipt(JSON.stringify(receipt)));
  if (new Set(checked.map(receipt => receipt.fingerprint)).size !== checked.length) throw Error('상품의 전송 이력이 중복됐습니다.');
  return { schemaVersion: 1, productId, blocked: checked.some(receipt => !supplierHubReceiptAllowsNewTransmission(receipt)), receipts: checked };
}

export function validateSupplierHubTransmissionHistory(value: unknown, productId: string): SupplierHubTransmissionHistory {
  const history = value as SupplierHubTransmissionHistory;
  if (!history || history.schemaVersion !== 1 || history.productId !== productId || typeof history.blocked !== 'boolean') throw Error('상품의 전체 전송 이력 응답을 확인하지 못했습니다.');
  const checked = supplierHubTransmissionHistory(productId, history.receipts);
  if (checked.blocked !== history.blocked) throw Error('상품의 전송 이력과 전송 가능 여부가 다릅니다.');
  return checked;
}
