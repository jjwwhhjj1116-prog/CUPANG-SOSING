import type { ProductContent } from '@/app/product-content';
export type RegistrationContentSummary = { seo: boolean; main: number; additional: number; detail: number; label: number; missingImages: boolean };
export function registrationContentSummary(product: {id:string;image_keys:string}, content: ProductContent | null): RegistrationContentSummary {
  const keys:unknown=JSON.parse(product.image_keys);
  if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'))throw Error('Invalid product images');
  if(content&&(content.productId!==product.id||content.schemaVersion!==1))throw Error('Invalid product content');
  let missingImages=false;
  const count=(roles:string[])=>{
    const saved=roles.flatMap(role=>{const values=content?.assets?.[role as keyof ProductContent['assets']]?.value??[];if(!Array.isArray(values)||values.some(key=>typeof key!=='string'))throw Error('Invalid content images');return values;});
    if(saved.some(key=>!keys.includes(key)))missingImages=true;
    return new Set(saved.filter(key=>keys.includes(key))).size;
  };
  return {seo:typeof content?.seo?.title?.value==='string'&&!!content.seo.title.value.trim(),main:count(['main']),additional:count(['additional']),detail:count(['detailTop','detail','detailBottom']),label:count(['label']),missingImages};
}
