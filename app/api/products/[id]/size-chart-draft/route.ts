import {env} from 'cloudflare:workers';
import {NextResponse} from 'next/server';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {findProduct} from '@/db/queries';
import {readProductContent} from '@/db/product-content';
import {reserveQuotationAiRequest} from '@/db/quotation-ai-jobs';
import {contentDetailImageKeys,productImageKeys} from '@/app/product-content';
import {inspectImage} from '@/app/automation/image-edit';
import {translateImageRegions} from '@/app/automation/free-image-text';
import {MAX_OCR_PIXELS,type FreeImageSource} from '@/app/free-image-translation';
import {isOwnedImageKey,MAX_IMAGE_BYTES,PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-files';
import {readBoundedJson,readBoundedStream,RequestBodyError} from '@/app/request-body';
import {SIZE_CHART_EXTRACTION_PURPOSE,SizeChartExtractionError,validateSizeChartExtractionSource,parseSizeChartExtractionRequest,buildSizeChartExtractionPlan,executeSizeChartExtraction,verifySizeChartExtractionResult,sizeChartRowNameTranslationIssue} from '@/app/size-chart-extraction';

type Context={params:Promise<{id:string}>};
type AiEnvironment={SOURCEFLOW_QUOTATION_AI_PROVIDER?:string;SOURCEFLOW_QUOTATION_AI_FREE_ONLY?:string;AI?:{run(model:string,input:Record<string,unknown>):Promise<unknown>}};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const changed=()=>new SizeChartExtractionError('SIZE_CHART_EXTRACTION_SOURCE_CHANGED','상품·회사·저장한 내용 또는 원본 이미지가 변경되었습니다. 이미지를 다시 선택해주세요.',409);
const error=(message:string,status=400,code='SIZE_CHART_EXTRACTION_INPUT')=>new SizeChartExtractionError(code,message,status);
function configuration(){const settings=env as AiEnvironment;return settings.SOURCEFLOW_QUOTATION_AI_PROVIDER==='workers-ai'&&settings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY==='true'&&typeof settings.AI?.run==='function';}
async function authorization(){
 const user=await getChatGPTUser(),owner=await getWorkspaceOwnerId(),company=approvedSupplierHubCompany(user?.membership);
 if(!user?.verifiedAccess||user.userId!==owner||user.membership?.id!==owner||!company||!['admin','member'].includes(user.membership.role))throw error('승인된 회원으로 로그인해주세요.',403,'SIZE_CHART_EXTRACTION_AUTH');
 return{owner,company:{...company},member:{id:user.membership.id,email:user.membership.email,role:user.membership.role}};
}
async function state(owner:string,id:string){
 if(!/^[A-Za-z0-9_-]{1,80}$/u.test(id))throw error('상품 식별값을 확인해주세요.');
 const product=await findProduct(owner,id);if(!product)throw error('상품을 찾을 수 없습니다.',404);
 const content=await readProductContent(owner,id),keys=productImageKeys(product.image_keys);
 if(keys.length>PRODUCT_IMAGE_POOL_LIMIT||new Set(keys).size!==keys.length||keys.some(key=>!isOwnedImageKey(owner,key)))throw error('저장한 상품 이미지 목록을 확인해주세요.',409);
 return{product,content,keys};
}
async function current(auth:Awaited<ReturnType<typeof authorization>>,id:string,before:Awaited<ReturnType<typeof state>>){
 if(!same(auth,await authorization())||!same(before,await state(auth.owner,id)))throw changed();
}
async function image(key:string){
 if(!env.FILES)throw error('이미지 저장소가 연결되지 않았습니다.',503);
 const object=await env.FILES.get(key);if(!object)throw error('저장된 원본 이미지를 찾을 수 없습니다.',409);
 if(object.size<1||object.size>MAX_IMAGE_BYTES)throw error('이미지 한 장은 10MB 이하여야 합니다.',413);
 const bytes=await readBoundedStream(object.body,MAX_IMAGE_BYTES);if(bytes.length!==object.size)throw error('원본 이미지를 끝까지 읽지 못했습니다.',503);
 let metadata;try{metadata=inspectImage(bytes);}catch{throw error('PNG·JPEG·WebP 정지 이미지를 선택해주세요.',415);}
 if(metadata.width*metadata.height>MAX_OCR_PIXELS)throw error('OCR 이미지는 1,200만 픽셀 이내여야 합니다.',413);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),byte=>byte.toString(16).padStart(2,'0')).join('');
 return{...metadata,sha256};
}
async function source(auth:Awaited<ReturnType<typeof authorization>>,id:string,key:string,before:Awaited<ReturnType<typeof state>>):Promise<FreeImageSource>{
 if(!isOwnedImageKey(auth.owner,key)||!before.keys.includes(key))throw error('현재 상품에 저장된 본인 소유 이미지를 선택해주세요.',404);
 const metadata=await image(key);await current(auth,id,before);
 // The role is only the existing pixel-loader compatibility shape. No role is
 // assigned or relaxed on the general image-edit endpoints by this reader.
 return validateSizeChartExtractionSource({productId:id,productVersion:before.product.updated_at,contentRevision:before.content.revision,sourceKey:key,sourceSha256:metadata.sha256,role:'detail',width:metadata.width,height:metadata.height});
}
function failure(cause:unknown){
 if(cause instanceof SizeChartExtractionError||cause instanceof RequestBodyError)return json({error:cause.message,...(cause instanceof SizeChartExtractionError?{code:cause.code}:{})},cause.status);
 return json({error:'사이즈표 추출 결과를 확인하지 못했습니다. 기존 자료는 유지되며 자동 재요청하지 않았습니다.',code:'SIZE_CHART_EXTRACTION_FAILED'},503);
}
export async function GET(request:Request,context:Context){
 try{
  const auth=await authorization(),{id}=await context.params,query=new URL(request.url).searchParams;
  if([...query.keys()].some(key=>key!=='sourceKey')||query.getAll('sourceKey').length>1)throw error('사이즈표를 읽을 이미지를 선택해주세요.');
  const before=await state(auth.owner,id),key=query.get('sourceKey');
  if(query.has('sourceKey')){if(!key)throw error('원본 이미지 키를 확인해주세요.');return json({purpose:SIZE_CHART_EXTRACTION_PURPOSE,source:await source(auth,id,key,before)});}
  if(!env.FILES)throw error('이미지 저장소가 연결되지 않았습니다.',503);
  const detail=new Set(contentDetailImageKeys(before.content)),ordered=[...before.keys.filter(key=>detail.has(key)),...before.keys.filter(key=>!detail.has(key))];
  const observed:{key:string;role:'detail'|'other';exists:boolean}[]=[];
  for(let index=0;index<ordered.length;index+=8)observed.push(...await Promise.all(ordered.slice(index,index+8).map(async key=>({key,role:detail.has(key)?'detail' as const:'other' as const,exists:Boolean(await env.FILES!.head(key))}))));
  await current(auth,id,before);return json({purpose:SIZE_CHART_EXTRACTION_PURPOSE,productId:id,productVersion:before.product.updated_at,contentRevision:before.content.revision,images:observed.filter(row=>row.exists).map(({key,role})=>({key,role}))});
 }catch(cause){return failure(cause);}
}
export async function POST(request:Request,context:Context){
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw error('같은 웹페이지에서 사이즈표를 읽어주세요.',403);
  if(new URL(request.url).search)throw error('사이즈표 요청 주소를 확인해주세요.');
  const auth=await authorization(),{id}=await context.params,body=parseSizeChartExtractionRequest(await readBoundedJson(request,96*1024));
  if(body.source.productId!==id)throw changed();
  if(!configuration())throw error('무료 사이즈표 AI 설정을 확인해주세요.',503,'SIZE_CHART_EXTRACTION_NOT_CONFIGURED');
  const before=await state(auth.owner,id),observed=await source(auth,id,body.source.sourceKey,before);if(!same(observed,body.source))throw changed();
  const plan=buildSizeChartExtractionPlan(body);request.signal.throwIfAborted();await current(auth,id,before);
  // Only the existing shared daily free-AI reservation is persisted. Product,
  // content, labels, grid, image roles/files and execution jobs remain untouched.
  if(!await reserveQuotationAiRequest())throw error('오늘의 무료 AI 요청 한도에 도달했습니다. OCR 원문은 유지됩니다.',429,'SIZE_CHART_EXTRACTION_LIMIT');
  const result=await executeSizeChartExtraction(plan,(env as AiEnvironment).AI!);
  if(result.chart){
   try{
    const translated=await translateImageRegions(result.chart.measurements.map((row,index)=>({id:'row-'+index,text:row.name})),body.language,fetch,request.signal);
    result.evidence.translations=translated.regions.map(row=>{
     const issue=row.translated!==null?(row.translated.length>80||!row.translated.trim()?'번역한 행이름이 너무 길어 원문을 유지했습니다.':sizeChartRowNameTranslationIssue(row.original,row.translated)):null;
     return issue?{...row,translated:null,issue}:row;
    });
    for(const[index,row]of result.evidence.translations.entries())if(row.translated!==null)result.chart.measurements[index].name=row.translated;
    if(result.evidence.translations.some(row=>row.translated===null))result.warnings.push('번역하지 못한 측정 항목은 OCR 원문으로 유지했습니다. 행이름을 확인해주세요.');
    if(translated.stoppedHttpStatus!==null)result.warnings.push(`Google 번역 HTTP ${translated.stoppedHttpStatus} 이후 요청을 멈췄습니다. 자동 재시도하지 않았습니다.`);
   }catch{result.warnings.push('측정 항목 번역을 확인하지 못해 OCR 원문을 유지했습니다. 숫자·사이즈·단위는 번역하지 않았습니다.');}
  }
  request.signal.throwIfAborted();if(!same(await source(auth,id,body.source.sourceKey,before),body.source))throw changed();
  return json(verifySizeChartExtractionResult(result,body.source,body.lines,body.display));
 }catch(cause){return failure(cause);}
}
