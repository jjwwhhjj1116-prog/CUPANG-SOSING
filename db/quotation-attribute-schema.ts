import {findProduct} from '@/db/queries';
import {getCategoryProfile} from '@/db/category-profiles';
import {readTranslationCategorySource} from '@/db/translation-category-source';
import {parseCollectionRequest} from '@/app/sourcing';
import {validateCategoryProfile} from '@/app/category-profiles';
import {capturedAttributeCategory,attributeCategorySchema} from '@/app/quotation-attribute-schema';

export class AttributeRuleSchemaError extends Error{constructor(message:string,public status:number){super(message);}}
/** Resolve only owner-bound product/profile data, never a client-supplied schema or field list. */
export async function readProductAttributeSchema(owner:string,productId:string,categoryId:string,profileId:string|null,company:{code:string;name:string}){
 try{
 const product=await findProduct(owner,productId);if(!product)throw new AttributeRuleSchemaError('상품을 찾을 수 없습니다.',404);
 let source;
 let hasOffer=false;try{hasOffer=Boolean(parseCollectionRequest({urls:[product.source_url]})[0].offerId);}catch{/* Legacy manually entered products can use an explicitly selected profile. */}
 try{if(hasOffer)source=await readTranslationCategorySource(owner,productId,product.source_url,categoryId);}
 catch(error){throw new AttributeRuleSchemaError(error instanceof Error?error.message:'상품추가 카테고리를 확인해주세요.',409);}
 let captured;try{captured=capturedAttributeCategory(categoryId,source);}catch(error){throw new AttributeRuleSchemaError(error instanceof Error?error.message:'상품추가 양식을 확인해주세요.',409);}
 let profile=null;
 if(profileId){
  profile=await getCategoryProfile(owner,profileId);if(!profile)throw new AttributeRuleSchemaError('카테고리 프로필을 찾을 수 없습니다.',404);
  if(profile.categoryId!==categoryId||captured&&(JSON.stringify(profile.categoryPath)!==JSON.stringify(captured.categoryPath)
   ||JSON.parse(source!.snapshot!.payload).category.id!==profileId))throw new AttributeRuleSchemaError('선택한 프로필과 상품추가 카테고리가 다릅니다.',409);
 }
 const category=captured??(profile?validateCategoryProfile(profile):null);
 if(category?.hubSchema&&(category.hubSchema.company.code!==company.code||category.hubSchema.company.name!==company.name))throw new AttributeRuleSchemaError('회원 회사와 상품추가 양식의 회사가 다릅니다.',409);
 return attributeCategorySchema(categoryId,category);
 }catch(error){if(error instanceof AttributeRuleSchemaError)throw error;throw new AttributeRuleSchemaError('상품의 카테고리 양식을 불러오지 못했습니다. 저장하지 않았습니다.',503);}
}
