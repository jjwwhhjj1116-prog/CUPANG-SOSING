export type PagePriceRaw=string|number|boolean|null;
export type PagePriceBasis={format:'1688-page-price-basis-v1';offerId:string;source:'1688-context-primary-v1';selection:'common-original-first-tier'|'original-per-sku'|'observed-page';rows:{key:string;sku:string;specId:string|null;observedPrice:PagePriceRaw;originalPrice:PagePriceRaw}[];flags:{path:string;value:boolean|null}[];tiers:{path:string;rows:{beginAmount:PagePriceRaw;price:PagePriceRaw}[]|null}[];originalSkus:{path:string;rows:{sku:string|null;specId:string|null;price:PagePriceRaw;discountPrice:PagePriceRaw}[]|null}[];review?:{sourceKeys:string[];overrides:{key:string;unitPriceCny:number}[]}};
export function readPagePriceBasis(root:unknown,options:{key:string;supplierSku:string|null}[]):PagePriceBasis;
export function pagePriceNumber(value:unknown):number|null;
export function pagePriceDefault(basis:PagePriceBasis,key:string):number|null;
export function validatePagePriceBasis(input:unknown,options:unknown[],settings?:{reviewed?:boolean;receipt?:boolean;offerId?:string}):PagePriceBasis;
export function reviewPagePriceBasis(basis:PagePriceBasis,options:unknown[]):PagePriceBasis;
