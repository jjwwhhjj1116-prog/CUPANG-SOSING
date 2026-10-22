export type PagePackaging={source:'package-table';weightG?:number;widthMm?:number;lengthMm?:number;heightMm?:number};
export type PageDomFacts={format:'yoofam-page-dom-facts-v1';sourceUrl:string;offerId:string;attributes:{name:string;value:string}[];packaging:{name?:string;supplierSku?:string;packaging:PagePackaging}[]};
export function validatePagePackaging(input:unknown):PagePackaging;
export function readPageDomFacts(document:Pick<Document,'querySelectorAll'>):Pick<PageDomFacts,'attributes'|'packaging'>|null;
export function validatePageDomFacts(input:unknown):PageDomFacts;
export function mergePageDomFacts(attributes:{name:string;value:string}[],options:import('./page-source.mjs').PageSource['options'],facts:PageDomFacts):{attributes:{name:string;value:string}[];options:import('./page-source.mjs').PageSource['options']};
