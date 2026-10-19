export type PageSource={format:'yoofam-page-source-v1';sourceUrl:string;offerId:string;collectedAt:string;title:string;description:string;options:{key:string;name:string;supplierSku:string|null;unitPriceCny:number|null;currency:'CNY'|null;minimumOrder:number|null;stock:number|null;imageUrl:string|null}[];images:{url:string;role:'main'|'additional'|'detail'}[];attributes:{name:string;value:string}[]};
export const PAGE_SOURCE_LIMIT:number;
export function pageSourceUrl(value:string):{sourceUrl:string;offerId:string};
export function pageJsonProperty(text:string,key:string):unknown;
export function extractPageSource(input:{sourceUrl:string;scripts:string[];title?:string;description?:string;gallery?:string[];detailImages?:string[];priceText?:string;minimumOrderText?:string},now?:number):PageSource;
export function validatePageSource(input:unknown,now?:number):PageSource;
export function pageSourceIssues(source:PageSource):string[];
