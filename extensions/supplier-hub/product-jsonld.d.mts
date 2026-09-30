export type PublicProductMetadata = {
  title: string; description: unknown;
  attributes?: {name:string;value:string}[];
  options: {sku:string;name:string;unitPriceCny:number;minimumOrder:number;stock:number|null;imageIndex?:number;color?:string;size?:string}[];
  images: {url:string;role:'main'|'additional'|'detail'}[];
};
export function parseProductJsonLd(nodes:unknown[],sourceUrl:string):PublicProductMetadata;
