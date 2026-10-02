import {exchange} from '@/app/supplier-hub-handoff';
import type {CategoryChoice} from '@/app/category-catalog';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export type HubCategoryNode={categoryId:string;name:string;isLeaf:boolean};
export type HubCategoryBranch={trail:HubCategoryNode[];children:HubCategoryNode[];ownerId:string;company:SupplierHubCompany;observedAt:number;source:'supplier-hub-category-api';fullCatalogVerified:false};
const companies:Record<string,string>={A01526306:'유앤채',A01464742:'와이홉'};
function validNode(value:unknown):value is HubCategoryNode{
  const node=value as HubCategoryNode;
  return Boolean(node&&typeof node.categoryId==='string'&&/^[1-9]\d{0,19}$/.test(node.categoryId)
    &&typeof node.name==='string'&&node.name.trim()===node.name&&node.name.length>0&&node.name.length<=240&&!/[\u0000-\u001f\u007f]/.test(node.name)&&typeof node.isLeaf==='boolean');
}
export function validateHubCategoryBranch(value:unknown,trail:readonly HubCategoryNode[]):HubCategoryBranch{
  const branch=value as HubCategoryBranch;
  if(!branch||branch.source!=='supplier-hub-category-api'||branch.fullCatalogVerified!==false
    ||typeof branch.ownerId!=='string'||!/^\w[\w-]{0,99}$/.test(branch.ownerId)
    ||!Object.hasOwn(companies,branch.company?.code)||companies[branch.company?.code]!==branch.company?.name
    ||!Number.isSafeInteger(branch.observedAt)||branch.observedAt<=0||branch.observedAt>Date.now()+60000
    ||!Array.isArray(branch.trail)||branch.trail.length>10||branch.trail.some(node=>!validNode(node)||node.isLeaf)
    ||new Set(branch.trail.map(node=>node.categoryId)).size!==branch.trail.length
    ||JSON.stringify(branch.trail)!==JSON.stringify(trail)
    ||!Array.isArray(branch.children)||!branch.children.length||branch.children.length>1000||branch.children.some(node=>!validNode(node))
    ||new Set(branch.children.map(node=>node.categoryId)).size!==branch.children.length
    ||branch.children.some(node=>trail.some(parent=>parent.categoryId===node.categoryId)))throw new Error('Supplier Hub의 회사·상위 경로·카테고리 목록을 확인하지 못했습니다.');
  return branch;
}
export async function loadSupplierHubCategoryBranch(trail:readonly HubCategoryNode[],signal:AbortSignal):Promise<HubCategoryBranch>{
  if(trail.length>10||trail.some(node=>!validNode(node)||node.isLeaf)||new Set(trail.map(node=>node.categoryId)).size!==trail.length)throw new Error('상위 카테고리 경로를 다시 선택해주세요.');
  const capability=await exchange('PING',null,signal);
  if(capability.categoryCatalog!==true)throw new Error('카테고리 조회를 지원하는 상품 수집·전송 확장 0.2.35로 갱신하고 앱 페이지를 새로고침해주세요.');
  const response=await exchange('CATEGORIES',{trail:trail.map(node=>({...node}))},signal);
  return validateHubCategoryBranch(response.branch,trail);
}
export function hubCategoryChoice(branch:HubCategoryBranch,node:HubCategoryNode):CategoryChoice{
  validateHubCategoryBranch(branch,branch.trail);
  if(!branch.children.some(child=>child.categoryId===node.categoryId&&child.name===node.name&&child.isLeaf===node.isLeaf))throw new Error('목록에서 카테고리를 선택해주세요.');
  const path=[...branch.trail.map(parent=>parent.name),node.name];
  return {key:`hub:${node.categoryId}:${JSON.stringify(path)}`,categoryId:node.categoryId,path,evidence:'observed',isLeaf:node.isLeaf,
    childrenObserved:false,templateLinked:false,codeEvidence:'supplier-hub',codeObservedAt:new Date(branch.observedAt).toISOString(),
    supplierHub:{trail:branch.trail.map(parent=>({...parent})),ownerId:branch.ownerId,company:{...branch.company}}};
}
/** Re-read the selected leaf before creating or reusing its saved profile. */
export async function verifyLiveHubCategoryChoice(choice:CategoryChoice,signal:AbortSignal):Promise<void>{
  if(!choice.supplierHub)return;
  const {trail,ownerId,company}=choice.supplierHub,branch=await loadSupplierHubCategoryBranch(trail,signal);
  const node=branch.children.find(node=>node.categoryId===choice.categoryId&&node.isLeaf&&node.name===choice.path.at(-1));
  if(!node||branch.ownerId!==ownerId||branch.company.code!==company.code||branch.company.name!==company.name
    ||JSON.stringify([...trail.map(node=>node.name),node.name])!==JSON.stringify(choice.path))throw new Error('선택한 회원·회사·최종 카테고리가 변경되었습니다. 분류를 다시 선택해주세요.');
}
