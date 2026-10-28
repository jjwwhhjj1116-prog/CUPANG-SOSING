import type {ProductDocumentState} from './supplier-hub-product-client';
export function runReservedSegments(input:{expected:{requestId:string;docId:string|number;packetDigest:string;preparedBodySha256:string};send:()=>Promise<ProductDocumentState>;fresh:()=>Promise<void>;signal:AbortSignal;onProgress?:(groups:number)=>void;maxSegments?:number}):Promise<ProductDocumentState>;
