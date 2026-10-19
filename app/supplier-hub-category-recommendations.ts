import {exchange} from '@/app/supplier-hub-handoff';
import {loadSupplierHubCategoryBranch,hubCategoryChoice,type HubCategoryNode} from '@/app/supplier-hub-catalog';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedStream} from '@/app/request-body';

export type HubCategoryRecommendation={id:string;code:string;path:string[];label:string};
export type HubCategoryRecommendations={source:'supplier-hub-category-predict-api';ownerId:string;company:SupplierHubCompany;productName:string;queryProductName?:string;observedAt:number;items:HubCategoryRecommendation[]};
const companies:Record<string,string>={A01526306:'유앤채',A01464742:'와이홉'};
const validName=(value:unknown):value is string=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=500&&!/[\u0000-\u001f\u007f]/.test(value);
export function validateHubCategoryRecommendations(value:unknown,name:string,ownerId:string):HubCategoryRecommendations{
 const body=value as HubCategoryRecommendations;
 if(!validName(name)||!body||body.source!=='supplier-hub-category-predict-api'||body.ownerId!==ownerId||body.productName!==name
  ||companies[body.company?.code]!==body.company?.name||!Object.hasOwn(companies,body.company?.code??'')
  ||!Number.isSafeInteger(body.observedAt)||body.observedAt>Date.now()+60000||body.observedAt<Date.now()-5*60*1000
  ||!Array.isArray(body.items)||body.items.length>3)throw Error('현재 회원·회사·상품명의 추천 결과를 확인하지 못했습니다. 다시 추천해주세요.');
 const seen=new Set<string>();
 for(const item of body.items){
  if(!item||typeof item.id!=='string'||!item.id||item.id.length>100||!/^[1-9]\d{0,19}$/.test(item.code)
   ||!Array.isArray(item.path)||item.path.length<1||item.path.length>10||item.path.some(part=>!validName(part)||part.length>240)
   ||item.label!==item.path.join(' > ')||seen.has(item.code))throw Error('추천 카테고리의 코드와 전체 경로를 확인하지 못했습니다.');
  seen.add(item.code);
 }
 return body;
}
/** Translate the search name only. The captured source and editable product
 * are never rewritten by recommendations or by a translated search query. */
export async function loadSupplierHubCategoryRecommendations(productName:string,{workspaceOwnerId,signal}:{workspaceOwnerId?:string;signal:AbortSignal;force?:boolean}):Promise<HubCategoryRecommendations>{
 const name=productName.trim();if(!validName(name)||!workspaceOwnerId)throw Error('로그인 회원과 추천할 상품명을 확인해주세요.');
 signal.throwIfAborted();let query=name,translationCompany:SupplierHubCompany|undefined;
 if(/\p{Script=Han}/u.test(name)){
  const response=await fetch('/api/category-recommendation-title',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:workspaceOwnerId,productName:name}),cache:'no-store',redirect:'error',signal});
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedStream(response.body,8192))) as {ownerId?:string;company?:SupplierHubCompany;productName?:string;queryProductName?:string;error?:string};
  signal.throwIfAborted();
  if(!response.ok||body.ownerId!==workspaceOwnerId||body.productName!==name||!validName(body.queryProductName)||!body.company||companies[body.company.code]!==body.company.name)throw Error(body.error||'상품명 번역을 확인하지 못했습니다. 한국어 상품명으로 다시 추천해주세요.');
  query=body.queryProductName;translationCompany=body.company;
 }
 const capability=await exchange('PING',null,signal);
 if(capability.categoryRecommendations!==true)throw Error('상품명 카테고리 추천을 지원하는 통합 확장 2.1.1을 적용한 뒤 앱을 새로고침해주세요.');
 const response=await exchange('RECOMMEND_CATEGORIES',{productName:query,expectedOwnerId:workspaceOwnerId},signal);
 signal.throwIfAborted();const result=validateHubCategoryRecommendations(response.recommendations,query,workspaceOwnerId);
 if(translationCompany&&(translationCompany.code!==result.company.code||translationCompany.name!==result.company.name))throw Error('상품명을 추천하는 동안 로그인 회사가 변경되었습니다. 다시 추천해주세요.');
 return {...result,productName:name,...(query!==name?{queryProductName:query}:{})};
}

/** Prediction is a suggestion. Pin every ancestor and the exact leaf to the
 * current company's live catalogue before opening its quotation definition. */
export async function resolveRecommendedHubCategoryChoice(item:HubCategoryRecommendation,result:HubCategoryRecommendations,ownerId:string|undefined,signal:AbortSignal){
 if(!ownerId)throw Error('로그인 회원을 확인해주세요.');
 validateHubCategoryRecommendations({...result,productName:result.queryProductName??result.productName},result.queryProductName??result.productName,ownerId);
 if(!result.items.some(candidate=>candidate.code===item.code&&candidate.id===item.id&&candidate.label===item.label&&JSON.stringify(candidate.path)===JSON.stringify(item.path)))throw Error('현재 추천 목록에서 카테고리를 다시 선택해주세요.');
 const trail:HubCategoryNode[]=[];
 for(let depth=0;depth<item.path.length;depth++){
  signal.throwIfAborted();const branch=await loadSupplierHubCategoryBranch(trail,signal);signal.throwIfAborted();
  if(branch.ownerId!==ownerId||branch.company.code!==result.company.code||branch.company.name!==result.company.name)throw Error('추천한 회사와 현재 카테고리 회사가 다릅니다.');
  const leaf=depth===item.path.length-1;
  const matches=branch.children.filter(node=>node.name===item.path[depth]);
  if(matches.length!==1||matches[0].isLeaf!==leaf||(leaf&&matches[0].categoryId!==item.code))throw Error('추천한 전체 경로·최종 코드가 현재 Supplier Hub 카테고리와 일치하지 않습니다. 목록에서 직접 선택해주세요.');
  if(leaf)return hubCategoryChoice(branch,matches[0]);
  trail.push({...matches[0]});
 }
 throw Error('추천 카테고리 경로를 확인해주세요.');
}
