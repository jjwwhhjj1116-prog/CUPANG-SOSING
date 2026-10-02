import {validateCategoryProfile,type CategoryProfileInput} from '@/app/category-profiles';
import {getQuotationSchema} from '@/app/quotation-schema';
import type {TranslationCategorySource} from '@/db/translation-category-source';

/** Reuse the intake's captured form; newer profile settings must not redefine a working product. */
export function capturedAttributeCategory(categoryId:string,source?:TranslationCategorySource):CategoryProfileInput|null{
 if(!source?.snapshot)return null;
 const context=JSON.parse(source.snapshot.payload),category=validateCategoryProfile(context.category);
 if(!source.snapshot.linked||category.categoryId!==categoryId)throw Error('상품추가 당시 카테고리와 속성 연결 카테고리가 다릅니다.');
 return category;
}
export function attributeCategorySchema(categoryId:string,category?:CategoryProfileInput|null){
 if(category&&category.categoryId!==categoryId)throw Error('속성 연결 카테고리를 확인해주세요.');
 return getQuotationSchema(categoryId,category?.categoryPath??[],category?.hubSchema);
}
