// Synthetic contract fixture based on the public getSchema/convertAllOfToItems
// frontend. These are not authenticated schemas or commercial category codes.
export const schemaCompanies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
export const schemaPath=['시험 대분류','시험 최종분류'];
const named=(name,value,requirement='선택')=>({contains:{type:'object',properties:{name:{type:'string',enum:[name],requirement},value}}});
export function hubSchemaSnapshot(company=schemaCompanies[0],categoryId='991234'){
 const raw={type:'object',properties:{
  startPage:{type:'object',required:['productName','categoryPath'],properties:{productName:{type:'string',title:'상품명',minLength:1,maxLength:500},categoryPath:{type:'string',title:'카테고리',minLength:1}}},
  productPage:{type:'object',properties:{basicAttributes:{type:'object',required:['brand'],properties:{brand:{type:'string',title:'브랜드'},modelNumber:{type:'string',title:'모델명',maxLength:50},taxationSchema:{type:'string',title:'과세여부',enum:['과세','면세','영세'],default:'과세'}}},
   commonAttributes:{type:'object',properties:{exposedAttributes:{type:'array',allOf:[named('색상',{type:'string'},'필수'),named('렌즈 유형',{type:['string','null'],enum:[null,'UV']},'필수')]},unexposedAttributes:{type:'array',allOf:[named('렌즈 소재',{type:['string','null'],enum:[null,'PC']}),named('표면 처리',{type:['string','null']})]}}},
   price:{type:'object',required:['supplyPrice','salePrice'],properties:{supplyPrice:{title:'공급가',type:'integer',minimum:1},salePrice:{title:'판매가',type:'integer',minimum:1}}}}},
  imagePage:{type:'object',properties:{alt:{title:'대체 텍스트',type:'string'}}},
  legalPage:{type:'object',properties:{notices:{type:'array',allOf:[named('품명 및 모델명',{type:'string'}),named('렌즈 관리방법',{type:'string'})]}}},
  logisticsPage:{type:'object',properties:{shelfLifeDays:{type:'integer',title:'유통기간 · 식품의 경우 소비기간',minimum:0,default:0}}}
 }};
 return {format:'supplier-hub-schema-v1',categoryId,categoryPath:[...schemaPath],company:{...company},observedAt:Date.now(),schemaString:JSON.stringify(raw),metadata:{displayCategoryCode:categoryId,kanCategoryId:3000,version:190}};
}
