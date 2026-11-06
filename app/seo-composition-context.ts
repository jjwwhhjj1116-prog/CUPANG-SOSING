import type {ProductOptions} from '@/app/product-options';
export type SeoCompositionContext={sourceFingerprint?:string;company?:{code:string;name:string};optionRevision:number;selectedOptions:{id:string;name:string;nameTrans:string;color:string;size:string;bundleQuantity:number;manualName:boolean;manualColor:boolean;manualSize:boolean}[];bundleQuantity:number|null};
export function seoCompositionContext(options:ProductOptions):SeoCompositionContext{
 const selectedOptions=options.rows.filter(row=>row.included).map(row=>({id:row.id,name:row.originalName,nameTrans:row.translatedName,color:row.color??'',size:row.size??'',bundleQuantity:options.bundleSources?.[row.id]?.quantity??1,manualName:row.provenance.translatedName==='manual',manualColor:row.provenance.color==='manual',manualSize:row.provenance.size==='manual'}));
 const quantities=[...new Set(selectedOptions.map(row=>row.bundleQuantity))],quantity=quantities.length===1?quantities[0]:null;
 return {optionRevision:options.revision,selectedOptions,bundleQuantity:quantity!==null&&Number.isInteger(quantity)&&quantity>=2?quantity:null};
}
