export const UNEXPECTED_LEGAL_AUDIT_FORMAT='yoofam-unexpected-legal-audit-v1';
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const TYPES=['missing','null','array','object','string-empty','string','number','boolean'];
const PATHS=['document-header','member-shape','startPage','productPage','imagePage','logisticsPage','sourcingPage','legalPage','legalPage.other','legalPage.certificates','legalPage.certificates.name','legalPage.certificates.value','legalPage.certificates.row-shape','legalPage.certificates.order'];
const KINDS=['missing','empty','na','present','not-applicable'];
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const dense=(rows,max)=>Array.isArray(rows)&&rows.length<=max&&Object.keys(rows).length===rows.length&&Object.keys(rows).every((key,index)=>key===String(index));
const integer=(value,max=100000)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>{throw Error('원래 문서의 읽기 전용 인증서 감사 결과를 확인하지 못했습니다. 문서·파일·본문을 변경하지 않았습니다.');};
/** This report is evidence for review only, never a cleanup/qualification
 * capability. It contains no filename, S3 key, schema title or raw value. */
export function validateUnexpectedLegalAuditReport(value,expected={},now=Date.now()){
 const keys=['format','requestId','docId','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','checkpointSequence','target','observedAt','imageCount','legalCount','bodyMatchesExpected','schemaBindingComplete','rawBodySha256','normalizedBodySha256','fileSetSha256','byteSetSha256','legalSetSha256','legalEntries','legalEntriesTruncated','differences','differenceCount','differencesTruncated','readOnly','remoteWrites','checkpointWrites','canResume','canDelete','registered','historicalAckRecovered'];
 if(!exact(value,keys)||value.format!==UNEXPECTED_LEGAL_AUDIT_FORMAT||!ID.test(value.requestId||'')||!(Number.isSafeInteger(value.docId)&&value.docId>0||typeof value.docId==='string'&&/^[1-9]\d{0,29}$/.test(value.docId))
  ||!['identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','rawBodySha256','normalizedBodySha256','fileSetSha256','byteSetSha256','legalSetSha256'].every(key=>HASH.test(value[key]||''))
  ||!integer(value.checkpointSequence)||value.checkpointSequence<1||!exact(value.target,['tabId','windowId'])||!integer(value.target.tabId,Number.MAX_SAFE_INTEGER)||!integer(value.target.windowId,Number.MAX_SAFE_INTEGER)
  ||!Number.isSafeInteger(value.observedAt)||value.observedAt<1||Math.abs(now-value.observedAt)>60000||!integer(value.imageCount,150)||value.imageCount<1||!integer(value.legalCount,2000)
  ||typeof value.bodyMatchesExpected!=='boolean'||typeof value.schemaBindingComplete!=='boolean'||value.bodyMatchesExpected!==(value.normalizedBodySha256===value.preparedBodySha256)
  ||!dense(value.legalEntries,12)||value.legalEntries.length!==Math.min(value.legalCount,12)||value.legalEntriesTruncated!==(value.legalCount>12)
  ||!integer(value.differenceCount)||!dense(value.differences,24)||value.differences.length!==Math.min(value.differenceCount,24)||value.differencesTruncated!==(value.differenceCount>24)||value.bodyMatchesExpected!==(value.differenceCount===0)
  ||value.readOnly!==true||value.remoteWrites!==false||value.checkpointWrites!==false||value.canResume!==false||value.canDelete!==false||value.registered!==false||value.historicalAckRecovered!==false)fail();
 for(const [index,row]of value.legalEntries.entries())if(!exact(row,['index','kind','descriptorSha256','association','schemaIndex','pairedImageDescriptorMatch','expectedLabelReferences'])||row.index!==index||!['certificate','other'].includes(row.kind)||!HASH.test(row.descriptorSha256||'')
  ||!['unlinked','linked','ambiguous','unknown'].includes(row.association)||!(row.schemaIndex===null||integer(row.schemaIndex,399))||((row.association==='linked')!==(row.schemaIndex!==null))
  ||!value.schemaBindingComplete&&row.association!=='unknown'||row.kind!=='certificate'&&row.association!=='unknown'||typeof row.pairedImageDescriptorMatch!=='boolean'||!(row.expectedLabelReferences===null||integer(row.expectedLabelReferences,40000)))fail();
 for(const row of value.differences)if(!exact(row,['documentIndex','schemaIndex','path','expectedType','actualType','expectedValueKind','actualValueKind'])||!(row.documentIndex===null||integer(row.documentIndex,199))||!(row.schemaIndex===null||integer(row.schemaIndex,399))
  ||!PATHS.includes(row.path)||!TYPES.includes(row.expectedType)||!TYPES.includes(row.actualType)||!KINDS.includes(row.expectedValueKind)||!KINDS.includes(row.actualValueKind)
  ||row.schemaIndex!==null&&(!value.schemaBindingComplete||!row.path.startsWith('legalPage.certificates.'))||row.path==='document-header'&&row.documentIndex!==null
  ||row.path!=='legalPage.certificates.value'&&(row.expectedValueKind!=='not-applicable'||row.actualValueKind!=='not-applicable'))fail();
 const binding=expected.binding??expected;
 for(const key of ['requestId','docId','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','checkpointSequence'])if(binding[key]!==undefined&&value[key]!==binding[key])fail();
 if(expected.target!==undefined&&!same(value.target,expected.target))fail();
 const result=structuredClone(value);const freeze=item=>{if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}return item;};return freeze(result);
}

/** Additional schema-bound read from the original authenticated app. No
 * credentials/storage are read; no request except these exact GETs exists. */
export async function unexpectedLegalAuditSchemaPage(input){
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),canon=value=>value===undefined?'undefined':value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
 let phase='input';const controllers=new Set(),failure=code=>Object.assign(Error('UNEXPECTED_LEGAL_SCHEMA_READ'),{schemaReadCode:code}),fail=code=>{throw failure(code);};
 try{
  if(!object(input)||!object(input.identity)||!object(input.expectedBody)||!Array.isArray(input.expectedBody.jsonDocument)||!object(input.identity.source))fail('input');
  const {identity,expectedBody}=input,origin=location.origin;
  const fence=()=>{if(location.origin!==origin||origin!==identity.origin||!['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'].includes(origin))fail('source-origin');};
  fence();
  const read=async path=>{
   fence();const controller=new AbortController();controllers.add(controller);let timer;
   // Each authenticated GET owns its complete fetch/body deadline. A slow
   // first catalog read must not consume the legal/closing catalog budget.
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('http-timeout'));},30000);});
   const consume=async()=>{
    const url=origin+path;let response;try{response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});}catch{fail(controller.signal.aborted?'http-timeout':'http-network');}
    fence();if(controller.signal.aborted)fail('http-timeout');
    if(!response||response.redirected||response.type==='opaqueredirect'||response.status===0||response.status>=300&&response.status<400)fail('http-redirect');
    if(response.url!==url)fail('http-response');
    if(!response.ok||response.status!==200)fail([401,403,404,429,500,502,503,504].includes(response.status)?'http-'+response.status:'http-status');
    if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))fail('http-type');
    const size=response.headers.get('content-length');if(size!==null&&(!/^\d+$/.test(size)||Number(size)>6*1024*1024))fail('http-size');
    let text;try{text=await response.text();}catch{fail(controller.signal.aborted?'http-timeout':'http-network');}
    fence();if(controller.signal.aborted)fail('http-timeout');if(new TextEncoder().encode(text).length>6*1024*1024)fail('http-size');
    try{return JSON.parse(text);}catch{fail('http-json');}
   };
   try{return await Promise.race([consume(),timeout]);}finally{clearTimeout(timer);controller.abort();controllers.delete(controller);}
  };
  phase='catalog-before';const before=await read('/api/supplier-hub/catalog-context');if(!object(before)||before.ownerId!==identity.ownerId||canon(before.company)!==canon(identity.company))fail('source-changed');
  phase='legal-documents';const view=await read('/api/products/'+encodeURIComponent(identity.productId)+'/legal-documents');if(!object(view))fail('schema-shape');const native=view.native;
  phase='catalog-after';const after=await read('/api/supplier-hub/catalog-context');if(canon(before)!==canon(after)||view.revision!==identity.source.contentRevision)fail('source-changed');
  phase='schema';fence();
  // This endpoint compiles every allOf certificate row and records an issue
  // for any missing/ambiguous/shared-value failure. A nonempty issue list is
  // not full schema coverage, even if some targets are present.
  if(identity.requestedProfileId!==null||!native||native.schemaSha256!==identity.schemaSha256||native.categoryId!==identity.categoryId||canon(native.company)!==canon(identity.company)
   ||!Array.isArray(native.issues)||native.issues.length||!Array.isArray(native.targets)||native.targets.length>405||!Array.isArray(native.files)||native.files.length
   ||view.documents?.applicability!=='not-applicable'||!Array.isArray(view.documents.files)||view.documents.files.length)return{complete:false,bindings:[]};
  const bindings=[];for(const target of native.targets){const binding=target?.binding;if(!object(binding)||binding.format!=='supplier-hub-native-legal-binding-v1'||binding.schemaSha256!==identity.schemaSha256||binding.categoryId!==identity.categoryId)return{complete:false,bindings:[]};if(binding.nativeType!=='certificate')continue;
   const row=binding.certificate;if(!object(row)||!Number.isSafeInteger(row.schemaIndex)||row.schemaIndex<0||row.schemaIndex>=400||canon(row.path)!==canon(['legalPage','certificates'])
    ||!['nameKey','valueKey'].every(key=>typeof row[key]==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(row[key]))||row.nameKey===row.valueKey||typeof row.name!=='string'||row.name.length>2000||!(row.value===null||['string','boolean','number'].includes(typeof row.value)))return{complete:false,bindings:[]};bindings.push({schemaIndex:row.schemaIndex,nameKey:row.nameKey,valueKey:row.valueKey,name:row.name,value:row.value});}
  bindings.sort((a,b)=>a.schemaIndex-b.schemaIndex);if(bindings.some((row,index)=>row.schemaIndex!==index)||new Set(bindings.map(row=>canon([row.nameKey,row.name]))).size!==bindings.length)return{complete:false,bindings:[]};
  for(const member of expectedBody.jsonDocument){const rows=member?.legalPage?.certificates;if(bindings.length===0&&(rows===undefined||Array.isArray(rows)&&rows.length===0))continue;if(!Array.isArray(rows)||rows.length!==bindings.length)return{complete:false,bindings:[]};
   for(const binding of bindings){const hits=rows.filter(row=>object(row)&&row[binding.nameKey]===binding.name);if(hits.length!==1||Object.keys(hits[0]).length!==2||!Object.hasOwn(hits[0],binding.valueKey)||canon(hits[0][binding.valueKey])!==canon(binding.value))return{complete:false,bindings:[]};}}
  return{complete:true,bindings};
 }catch(error){
  const codes=['input','source-origin','source-changed','schema-shape','http-timeout','http-network','http-redirect','http-response','http-status','http-type','http-size','http-json','http-401','http-403','http-404','http-429','http-500','http-502','http-503','http-504'];
  return{schemaReadFailure:{format:'yoofam-unexpected-legal-schema-read-failure-v1',phase,code:codes.includes(error?.schemaReadCode)?error.schemaReadCode:'unexpected'}};
 }finally{for(const controller of controllers)controller.abort();}
}
