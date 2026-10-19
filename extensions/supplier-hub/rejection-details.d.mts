export type RejectionDetails={format:'yoofam-hub-rejection-details-v1';status:'available'|'unavailable';errors:readonly {columnName:string;message:string}[]};
export function isRejectionDetails(value:unknown):value is RejectionDetails;
export function receiptRejectionDetailsValid(receipt:unknown):boolean;
export function normalizeRejectionDetails(remark:unknown):RejectionDetails;
