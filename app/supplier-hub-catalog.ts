import {exchange} from '@/app/supplier-hub-handoff';
import type {CategoryChoice} from '@/app/category-catalog';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {validateHubSchemaSnapshot,type HubSchemaSnapshot} from '@/app/supplier-hub-schema';
import {validateCategoryProfile,type CategoryProfile,type CategoryProfileInput} from '@/app/category-profiles';
import {readBoundedStream} from '@/app/request-body';
import {loadCategoryProfiles} from '@/app/load-category-profiles';
import {unwrapOfficialXlsxDownload} from '@/app/xlsx-template';

export type HubCategoryNode={categoryId:string;name:string;isLeaf:boolean};
export type HubCategoryBranch={trail:HubCategoryNode[];children:HubCategoryNode[];ownerId:string;company:SupplierHubCompany;observedAt:number;source:'supplier-hub-category-api';fullCatalogVerified:false};
const companies:Record<string,string>={A01526306:'유앤채',A01464742:'와이홉'};
const sameMetadata=(left:HubSchemaSnapshot['metadata'],right:HubSchemaSnapshot['metadata'])=>Object.keys(left).length===Object.keys(right).length&&Object.entries(left).every(([key,value])=>Object.hasOwn(right,key)&&right[key]===value);
// Compare observed node fields, not the key insertion order after Chrome transport.
function sameCategoryTrail(actual:unknown,expected:readonly HubCategoryNode[]){
  const keys=['categoryId','name','isLeaf'] as const;
  return Array.isArray(actual)&&actual.length===expected.length&&actual.every((node,index)=>{
    const other=expected[index];
    return node&&typeof node==='object'&&!Array.isArray(node)&&other&&Object.keys(node).length===keys.length&&Object.keys(other).length===keys.length
      &&keys.every(key=>Object.hasOwn(node,key)&&Object.hasOwn(other,key)&&node[key]===other[key]);
  });
}
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
    ||!sameCategoryTrail(branch.trail,trail)
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
  if(capability.categorySchema!==true)throw Error('상세 견적 양식을 지원하는 상품 수집·전송 확장 0.2.38으로 갱신해주세요.');
  const {trail,ownerId,company}=choice.supplierHub;
  const result=await exchange('SCHEMA',{trail,selection:{categoryId:choice.categoryId,name:choice.path.at(-1)}},signal),branch=validateHubCategoryBranch(result.branch,trail);
  if(branch.ownerId!==ownerId||branch.company.code!==company.code||branch.company.name!==company.name||!branch.children.some(node=>node.isLeaf&&node.categoryId===choice.categoryId&&node.name===choice.path.at(-1)))throw Error('상세 양식의 회원·회사·최종 분류가 변경되었습니다.');
  const schema=validateHubSchemaSnapshot((result.branch as {schema?:unknown}).schema,choice.categoryId,choice.path);
  if(schema.company.code!==company.code||schema.company.name!==company.name)throw Error('상세 견적 양식의 회사가 다릅니다.');
  // Version the app's draft behavior at capture time. Older working products
  // retain their stored snapshot instead of gaining new automatic values.
  return {...schema,draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'};
}

/** Auto-connect a blank official workbook only when the selected profile has no saved template. */
export async function loadLiveHubCategoryTemplate(choice:CategoryChoice,snapshot:HubSchemaSnapshot,signal:AbortSignal):Promise<Pick<CategoryProfileInput,'template'|'mappings'>>{
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  if(!choice.supplierHub||!choice.isLeaf)throw Error('Supplier Hub 최종 카테고리를 선택해주세요.');
  validateHubSchemaSnapshot(snapshot,choice.categoryId,choice.path);
  const capability=await exchange('PING',null,signal);if(capability.categoryTemplate!==true)throw Error('공식 Excel 연결을 지원하는 상품 수집·전송 확장 0.2.38로 갱신해주세요.');
  const separateExcel=(snapshot.metadata.scopeType??snapshot.metadata.scope)==='Retail_Categorized_Single';
  if(separateExcel&&capability.categoryExcelSchema!==true)throw Error('Single·Excel 양식 구분을 지원하는 최신 상품 수집·전송 확장으로 갱신한 뒤 앱을 새로고침해주세요.');
  const {trail,ownerId,company}=choice.supplierHub;
  if(snapshot.company.code!==company.code||snapshot.company.name!==company.name)throw Error('선택한 회사와 상세 양식 회사가 다릅니다.');
  const result=await exchange('TEMPLATE',{trail,selection:{categoryId:choice.categoryId,name:choice.path.at(-1)},expectedSchema:{schemaString:snapshot.schemaString,metadata:snapshot.metadata}},signal);
  const branch=validateHubCategoryBranch(result.branch,trail),data=(result.branch as {template?:Record<string,unknown>;schema?:unknown}).template;
  const schema=validateHubSchemaSnapshot((result.branch as {schema?:unknown}).schema,choice.categoryId,choice.path);
  const kan=String(snapshot.metadata.kanCategoryId??snapshot.metadata.categoryId??'');
  if(branch.ownerId!==ownerId||branch.company.code!==company.code||branch.company.name!==company.name||!branch.children.some(node=>node.isLeaf&&node.categoryId===choice.categoryId&&node.name===choice.path.at(-1))
    ||schema.schemaString!==snapshot.schemaString||!sameMetadata(schema.metadata,snapshot.metadata)||schema.company.code!==company.code||schema.company.name!==company.name
    ||!data||data.format!=='supplier-hub-template-v1'||data.registered!==false||data.categoryId!==choice.categoryId||JSON.stringify(data.categoryPath)!==JSON.stringify(choice.path)
    ||(data.company as SupplierHubCompany)?.code!==company.code||(data.company as SupplierHubCompany)?.name!==company.name||!/^[1-9]\d{0,19}$/.test(kan)||data.kanCategoryId!==kan
    ||data.sourceUrl!==`https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=${kan}&locale=ko`
    ||!Number.isSafeInteger(data.observedAt)||Number(data.observedAt)<=0||Number(data.observedAt)>Date.now()+60000
    ||!Number.isSafeInteger(data.size)||Number(data.size)<22||Number(data.size)>5000000||typeof data.base64!=='string'||data.base64.length>6666668||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)
    ||typeof data.sha256!=='string'||!/^[a-f0-9]{64}$/.test(data.sha256)||data.name!==`SupplierHub-${company.code}-Kan${kan}.xlsx`)throw Error('선택한 회원·회사·분류의 공식 Excel 결과를 확인하지 못했습니다.');
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  const binary=atob(data.base64),bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
  const downloadSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==data.size||downloadSha256!==data.sha256||btoa(binary)!==data.base64)throw Error('공식 Excel 원본 바이트와 파일 지문이 다릅니다.');
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  const workbook=await unwrapOfficialXlsxDownload(bytes.buffer);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',workbook)),byte=>byte.toString(16).padStart(2,'0')).join('');
  signal.throwIfAborted();
  const form=new FormData();form.set('file',new File([workbook],data.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));form.set('schema',JSON.stringify(snapshot));
  if(separateExcel){
    form.set('action','inspect');
    const inspected=await fetch('/api/category-profiles/official-template',{method:'POST',body:form,signal,credentials:'same-origin',redirect:'error',cache:'no-store'});
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedStream(inspected.body,10000))) as {identity?:{scopeType:string;kanCategoryId:string;noticeNumber:string;version:string};registered?:false;error?:string};
    signal.throwIfAborted();
    if(!inspected.ok)throw Error(body.error??'원본 Excel 식별값을 확인하지 못했습니다.');
    const identity=body.identity;
    if(body.registered!==false||!identity||identity.scopeType!=='Retail_Categorized_Excel'||identity.kanCategoryId!==kan||!/^\d{1,20}$/.test(identity.noticeNumber)||!/^\d{1,20}$/.test(identity.version))throw Error('원본 Excel의 scope·분류·고시·버전을 확인하지 못했습니다.');
    const loaded=await exchange('SCHEMA',{trail,selection:{categoryId:choice.categoryId,name:choice.path.at(-1)},expectedSchema:{schemaString:snapshot.schemaString,metadata:snapshot.metadata},excelIdentity:identity},signal);
    const returned=loaded.branch as {schema?:unknown;excelSchema?:unknown},verified=validateHubCategoryBranch(returned,trail),source=validateHubSchemaSnapshot(returned.schema,choice.categoryId,choice.path),excel=validateHubSchemaSnapshot(returned.excelSchema,choice.categoryId,choice.path);
    const matches=(keys:string[],value:string)=>keys.some(key=>excel.metadata[key]!==undefined)&&keys.every(key=>excel.metadata[key]===undefined||String(excel.metadata[key])===value);
    if(verified.ownerId!==ownerId||verified.company.code!==company.code||verified.company.name!==company.name||!verified.children.some(node=>node.isLeaf&&node.categoryId===choice.categoryId&&node.name===choice.path.at(-1))
      ||source.schemaString!==snapshot.schemaString||!sameMetadata(source.metadata,snapshot.metadata)||source.company.code!==company.code||source.company.name!==company.name
      ||excel.company.code!==company.code||excel.company.name!==company.name||!matches(['scope','scopeType'],identity.scopeType)||!matches(['categoryId','kanCategoryId'],identity.kanCategoryId)||!matches(['noticeNumber','productNoticeNumber'],identity.noticeNumber)||String(excel.metadata.version)!==identity.version)throw Error('별도 Excel 상세 양식의 회원·회사·분류·버전이 다릅니다.');
    signal.throwIfAborted();form.delete('action');
    form.set('excelSchema',JSON.stringify({...excel,...(snapshot.inputBindings?{inputBindings:snapshot.inputBindings}:{})}));
  }
  const response=await fetch('/api/category-profiles/official-template',{method:'POST',body:form,signal,credentials:'same-origin',redirect:'error',cache:'no-store'});
  const saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedStream(response.body,300000))) as {template:NonNullable<CategoryProfileInput['template']>;mappings:CategoryProfileInput['mappings'];report:{categoryId:string;categoryPath:string[];company:SupplierHubCompany;kanCategoryId:string;registered:false};error?:string};
  if(signal.aborted)throw Error('작업을 취소했습니다.');
  if(!response.ok)throw Error(saved.error??'공식 Excel을 저장하지 못했습니다.');
  if(saved.template?.sha256!==sha256||saved.template.name!==data.name||saved.template.format!=='xlsx'||!saved.template.storageKey||saved.template.headerRow!==5||saved.template.dataStartRow!==9||!Array.isArray(saved.template.headers)||!Array.isArray(saved.mappings)
    ||saved.report?.categoryId!==choice.categoryId||JSON.stringify(saved.report.categoryPath)!==JSON.stringify(choice.path)||saved.report.company?.code!==company.code||saved.report.company?.name!==company.name||saved.report.kanCategoryId!==kan||saved.report.registered!==false)throw Error('공식 Excel 저장 결과의 카테고리·회사·원본 지문이 다릅니다.');
  return {template:saved.template,mappings:saved.mappings};
}

/** Official files are prepared explicitly after draft review. Resolve every
 * saved path segment exactly; never infer a different branch from a leaf name. */
export async function prepareOfficialHubProfileTemplate(profile:CategoryProfile,signal:AbortSignal):Promise<CategoryProfile>{
  signal.throwIfAborted();
  if(profile.template)throw Error('이미 연결된 견적 양식은 유지합니다. 변경은 카테고리·양식 관리에서 확인해주세요.');
  const current=(await loadCategoryProfiles(signal)).find(item=>item.id===profile.id);
  signal.throwIfAborted();
  if(!current||current.revision!==profile.revision||current.categoryId!==profile.categoryId
    ||JSON.stringify(current.categoryPath)!==JSON.stringify(profile.categoryPath)||JSON.stringify(current.hubSchema)!==JSON.stringify(profile.hubSchema)
    ||current.template||current.mappings.length)throw Error('카테고리·양식 설정이 변경되었습니다. 저장한 양식을 새로고침한 뒤 다시 준비해주세요.');
  if(!current.hubSchema)throw Error('확인된 Supplier Hub 상세 양식이 없습니다. 카테고리·양식 관리에서 먼저 확인해주세요.');
  const snapshot=current.hubSchema,trail:HubCategoryNode[]=[];
  let ownerId:string|undefined,choice:CategoryChoice|undefined;
  for(let depth=0;depth<current.categoryPath.length;depth++){
    const branch=await loadSupplierHubCategoryBranch(trail,signal);signal.throwIfAborted();
    if(branch.company.code!==snapshot.company.code||branch.company.name!==snapshot.company.name||ownerId!==undefined&&branch.ownerId!==ownerId)throw Error('선택한 양식의 회원·회사와 현재 Supplier Hub가 다릅니다.');
    ownerId=branch.ownerId;
    const matches=branch.children.filter(node=>node.name===current.categoryPath[depth]),last=depth===current.categoryPath.length-1;
    if(matches.length!==1||matches[0].isLeaf!==last||last&&matches[0].categoryId!==current.categoryId)throw Error('저장한 전체 카테고리 경로·최종 코드를 하나로 확인하지 못했습니다. 양식 연결을 중단했습니다.');
    if(last)choice=hubCategoryChoice(branch,matches[0]);else trail.push(matches[0]);
  }
  if(!choice)throw Error('저장한 카테고리 경로를 확인해주세요.');
  const live=await loadLiveHubCategorySchema(choice,signal);signal.throwIfAborted();
  if(live.schemaString!==snapshot.schemaString||!sameMetadata(live.metadata,snapshot.metadata))throw Error('현재 상세 양식이 저장 당시와 다릅니다. 기존 초안은 유지하며 카테고리·양식 관리에서 확인해주세요.');
  const connection=await loadLiveHubCategoryTemplate(choice,snapshot,signal);signal.throwIfAborted();
  const expected=validateCategoryProfile({...current,...connection});
  const response=await fetch('/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},signal,
    body:JSON.stringify({id:current.id,expectedRevision:current.revision,profile:expected})});
  const result=await response.json() as {profile?:CategoryProfile;error?:string};signal.throwIfAborted();
  if(!response.ok)throw Error(result.error??'공식 견적 양식을 연결하지 못했습니다. 저장한 양식을 새로고침해주세요.');
  const saved=result.profile;
  if(!saved||saved.id!==current.id||saved.revision!==current.revision+1||saved.name!==current.name||saved.categoryId!==current.categoryId
    ||JSON.stringify(saved.categoryPath)!==JSON.stringify(current.categoryPath)||JSON.stringify(saved.hubSchema)!==JSON.stringify(current.hubSchema)
    ||JSON.stringify(saved.template)!==JSON.stringify(expected.template)||JSON.stringify(saved.mappings)!==JSON.stringify(expected.mappings))throw Error('공식 양식 연결 결과를 확인하지 못했습니다. 저장한 양식을 새로고침해주세요.');
  return saved;
}
