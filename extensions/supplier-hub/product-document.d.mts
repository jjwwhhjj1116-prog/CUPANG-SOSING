import type { SupplierHubProductDocumentReview } from '../../app/supplier-hub-product-document';

export const PRODUCT_DOCUMENT_REQUEST_TYPE: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST';
export const PRODUCT_DOCUMENT_REQUEST_VERSION: 1;
export const PRODUCT_DOCUMENT_REQUEST_TTL: 120000;
export const PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT: 90000;
export const PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT: 95000;
export class ProductDocumentTransportError extends Error { code: string; constructor(code: string, message?: string); }
export type ProductDocumentPacket = Readonly<{ type: typeof PRODUCT_DOCUMENT_REQUEST_TYPE; version: typeof PRODUCT_DOCUMENT_REQUEST_VERSION; requestId: string; createdAt: number; review: SupplierHubProductDocumentReview }>;
export type ProductDocumentBinding = Readonly<{ format: SupplierHubProductDocumentReview['format']; identity: SupplierHubProductDocumentReview['identity']; members: SupplierHubProductDocumentReview['members']; identityDigest: string;
  originalBodySha256: string; preparedBodySha256: string; reviewDigest: string; packetDigest: string; registered: false; remoteWrites: false; submissionReady: false }>;
export type ProductDocumentValidationOptions = { now?: number; ownerId?: string; company?: SupplierHubProductDocumentReview['identity']['company'] };
export function createProductDocumentPacket(review: SupplierHubProductDocumentReview, options?: { requestId?: string; createdAt?: number; now?: number }): Promise<ProductDocumentPacket>;
export function validateProductDocumentPacket(packet: unknown, options?: ProductDocumentValidationOptions): Promise<Readonly<{ packet: ProductDocumentPacket; binding: ProductDocumentBinding; preparedBody: SupplierHubProductDocumentReview['body']; registered: false; remoteWrites: false; submissionReady: false }>>;
export function productDocumentPacketBinding(packet: unknown, options?: ProductDocumentValidationOptions): Promise<ProductDocumentBinding>;
