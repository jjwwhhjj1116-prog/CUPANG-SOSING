import {exchange} from '@/app/supplier-hub-handoff';
import type {CategoryChoice} from '@/app/category-catalog';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {validateHubSchemaSnapshot,type HubSchemaSnapshot} from '@/app/supplier-hub-schema';
import type {CategoryProfileInput} from '@/app/category-profiles';
import {readBoundedStream} from '@/app/request-body';

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
export async function loadLiveHubCategorySchema(choice:CategoryChoice,signal:AbortSignal):Promise<HubSchemaSnapshot>{
  if(!choice.supplierHub||!choice.isLeaf)throw Error('Supplier Hub 최종 카테고리를 선택해주세요.');
  const capability=await exchange('PING',null,signal);
  if(capability.categorySchema!==true)throw Error('상세 견적 양식을 지원하는 상품 수집·전송 확장 0.2.37으로 갱신해주세요.');
  const {trail,ownerId,company}=choice.supplierHub;
  const result=await exchange('SCHEMA',{trail,selection:{categoryId:choice.categoryId,name:choice.path.at(-1)}},signal),branch=validateHubCategoryBranch(result.branch,trail);
  if(branch.ownerId!==ownerId||branch.company.code!==company.code||branch.company.name!==company.name||!branch.children.some(node=>node.isLeaf&&node.categoryId===choice.categoryId&&node.name===choice.path.at(-1)))throw Error('상세 양식의 회원·회사·최종 분류가 변경되었습니다.');
  const schema=validateHubSchemaSnapshot((result.branch as {schema?:unknown}).schema,choice.categoryId,choice.path);
  if(schema.company.code!==company.code||schema.company.name!==company.name)throw Error('상세 견적 양식의 회사가 다릅니다.');
  return schema;
}

/** Auto-connect a blank official workbook only when the selected profile has no saved template. */
export async function loadLiveHubCategoryTemplate(choice:CategoryChoice,snapshot:HubSchemaSnapshot,signal:AbortSignal):Promise<Pick<CategoryProfileInput,'template'|'mappings'>>{
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  if(!choice.supplierHub||!choice.isLeaf)throw Error('Supplier Hub 최종 카테고리를 선택해주세요.');
  validateHubSchemaSnapshot(snapshot,choice.categoryId,choice.path);
  const capability=await exchange('PING',null,signal);if(capability.categoryTemplate!==true)throw Error('공식 Excel 연결을 지원하는 상품 수집·전송 확장 0.2.37로 갱신해주세요.');
  const {trail,ownerId,company}=choice.supplierHub;
  if(snapshot.company.code!==company.code||snapshot.company.name!==company.name)throw Error('선택한 회사와 상세 양식 회사가 다릅니다.');
  const result=await exchange('TEMPLATE',{trail,selection:{categoryId:choice.categoryId,name:choice.path.at(-1)},expectedSchema:{schemaString:snapshot.schemaString,metadata:snapshot.metadata}},signal);
  const branch=validateHubCategoryBranch(result.branch,trail),data=(result.branch as {template?:Record<string,unknown>;schema?:unknown}).template;
  const schema=validateHubSchemaSnapshot((result.branch as {schema?:unknown}).schema,choice.categoryId,choice.path);
  const kan=String(snapshot.metadata.kanCategoryId??snapshot.metadata.categoryId??'');
  if(branch.ownerId!==ownerId||branch.company.code!==company.code||branch.company.name!==company.name||!branch.children.some(node=>node.isLeaf&&node.categoryId===choice.categoryId&&node.name===choice.path.at(-1))
    ||schema.schemaString!==snapshot.schemaString||JSON.stringify(schema.metadata)!==JSON.stringify(snapshot.metadata)||schema.company.code!==company.code||schema.company.name!==company.name
    ||!data||data.format!=='supplier-hub-template-v1'||data.registered!==false||data.categoryId!==choice.categoryId||JSON.stringify(data.categoryPath)!==JSON.stringify(choice.path)
    ||(data.company as SupplierHubCompany)?.code!==company.code||(data.company as SupplierHubCompany)?.name!==company.name||!/^[1-9]\d{0,19}$/.test(kan)||data.kanCategoryId!==kan
    ||data.sourceUrl!==`https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=${kan}&locale=ko`
    ||!Number.isSafeInteger(data.observedAt)||Number(data.observedAt)<=0||Number(data.observedAt)>Date.now()+60000
    ||!Number.isSafeInteger(data.size)||Number(data.size)<22||Number(data.size)>5000000||typeof data.base64!=='string'||data.base64.length>6666668||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)
    ||typeof data.sha256!=='string'||!/^[a-f0-9]{64}$/.test(data.sha256)||data.name!==`SupplierHub-${company.code}-Kan${kan}.xlsx`)throw Error('선택한 회원·회사·분류의 공식 Excel 결과를 확인하지 못했습니다.');
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  const binary=atob(data.base64),bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==data.size||sha256!==data.sha256||btoa(binary)!==data.base64)throw Error('공식 Excel 원본 바이트와 파일 지문이 다릅니다.');
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  const form=new FormData();form.set('file',new File([bytes],data.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));form.set('schema',JSON.stringify(snapshot));
  const response=await fetch('/api/category-profiles/official-template',{method:'POST',body:form,signal,credentials:'same-origin',redirect:'error',cache:'no-store'});
  const saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedStream(response.body,300000))) as {template:NonNullable<CategoryProfileInput['template']>;mappings:CategoryProfileInput['mappings'];report:{categoryId:string;categoryPath:string[];company:SupplierHubCompany;kanCategoryId:string;registered:false};error?:string};
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  if(!response.ok)throw Error(saved.error??'공식 Excel을 저장하지 못했습니다.');
  if(saved.template?.sha256!==sha256||saved.template.name!==data.name||saved.template.format!=='xlsx'||!saved.template.storageKey||saved.template.headerRow!==5||saved.template.dataStartRow!==9||!Array.isArray(saved.template.headers)||!Array.isArray(saved.mappings)
    ||saved.report?.categoryId!==choice.categoryId||JSON.stringify(saved.report.categoryPath)!==JSON.stringify(choice.path)||saved.report.company?.code!==company.code||saved.report.company?.name!==company.name||saved.report.kanCategoryId!==kan||saved.report.registered!==false)throw Error('공식 Excel 저장 결과의 카테고리·회사·원본 지문이 다릅니다.');
  return {template:saved.template,mappings:saved.mappings};
}
