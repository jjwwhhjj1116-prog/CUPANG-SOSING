'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {parseCollectionRequest} from '@/app/sourcing';
import {normalizeQuerySourceCapture,querySourceFingerprint,querySourceCaptureSummary,type QuerySourceCapture,type QuerySourceCaptureSummary} from '@/app/query-source-capture';
import {querySourceCaptureSelection} from '@/app/source-capture-selection';
import {parseWorkspaceSettingsScope,type WorkspaceSettingsScope} from '@/app/workspace-settings-scope';

type Scope={ownerId:string;company:NonNullable<WorkspaceSettingsScope['company']>};
type PanelState={scope:object;items:QuerySourceCaptureSummary[];view:'active'|'archived';loaded:boolean;busy:boolean;message:string};
type CaptureAttempt={scope:object;id:string;sourceUrl:string};
class QuerySourcePanelError extends Error{}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const sameScope=(value:unknown,expected:Scope)=>{const actual=parseWorkspaceSettingsScope(value);return actual?.ownerId===expected.ownerId&&actual.company?.code===expected.company.code&&actual.company.name===expected.company.name;};
const notices:Record<string,string>={SOURCE_CONFIGURATION_REQUIRED:'상품조회 API의 서버 설정이 필요합니다. URL은 유지했습니다.',SOURCE_NOT_COLLECTED:'상품 페이지에서 유효한 원문을 받지 못했습니다. 수집 완료가 아닙니다.',SOURCE_PROVIDER_FAILED:'상품조회 API가 유효한 원문을 반환하지 않았습니다. 수집 완료가 아닙니다.',SOURCE_RESULT_INVALID:'상품번호·옵션·원가·이미지 원문을 확인하지 못했습니다.',QUERY_SCOPE_CHANGED:'로그인 계정 또는 회사가 변경되었습니다. 현재 계정으로 다시 열어주세요.',QUERY_CAPTURE_CONFLICT:'이 요청 번호에 다른 수집 원문이 있습니다. 기존 자료는 변경하지 않았습니다.',QUERY_CAPTURE_FULL:'서버 수집함 보관 한도에 도달했습니다. 기존 수집본을 확인해주세요.',INVALID_SOURCE_URL:'올바른 1688 상품 상세 URL을 입력해주세요.'};
function summary(value:unknown,scope:Scope,view:'active'|'archived'='active'):QuerySourceCaptureSummary{
 if(!object(value)||!sameScope(value,scope)||typeof value.id!=='string'||!UUID.test(value.id)||typeof value.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(value.fingerprint)||!Number.isSafeInteger(value.revision)||Number(value.revision)<1||!Number.isSafeInteger(value.captureVersion)||Number(value.captureVersion)<1||typeof value.sourceUrl!=='string'||typeof value.title!=='string'||!value.title.trim()||value.title.length>500||typeof value.offerId!=='string'||!Number.isSafeInteger(value.optionCount)||Number(value.optionCount)<1||Number(value.optionCount)>200||typeof value.receivedAt!=='string'||!Number.isFinite(Date.parse(value.receivedAt))||(view==='active'?value.archivedAt!==null:typeof value.archivedAt!=='string'||!Number.isFinite(Date.parse(value.archivedAt)))||value.thumbnailUrl!==null&&typeof value.thumbnailUrl!=='string')throw new QuerySourcePanelError('수집 결과의 계정·상품·버전 정보를 확인하지 못했습니다.');
 const source=parseCollectionRequest({urls:[value.sourceUrl]})[0];if(source.sourceUrl!==value.sourceUrl||source.offerId!==value.offerId)throw new QuerySourcePanelError('수집 상품번호와 URL이 다릅니다.');
 const checked={id:value.id,ownerId:scope.ownerId,company:{...scope.company},fingerprint:value.fingerprint,revision:Number(value.revision),captureVersion:Number(value.captureVersion),receivedAt:value.receivedAt,archivedAt:typeof value.archivedAt==='string'?value.archivedAt:null,sourceUrl:source.sourceUrl,offerId:source.offerId,title:value.title,optionCount:Number(value.optionCount),thumbnailUrl:typeof value.thumbnailUrl==='string'?value.thumbnailUrl:null};querySourceCaptureSelection(checked);return checked;
}
async function boundedJson(response:Response){
 if(response.redirected||response.type==='opaqueredirect'||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw new QuerySourcePanelError('로그인 또는 JSON 응답을 확인하지 못했습니다.');
 const maximum=1024*1024,length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>maximum))throw new QuerySourcePanelError('수집 응답의 크기를 확인해주세요.');
 const reader=response.body?.getReader();if(!reader)throw new QuerySourcePanelError('수집 응답을 확인하지 못했습니다.');let size=0;const parts:Uint8Array[]=[];
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum)throw new QuerySourcePanelError('수집 응답의 크기를 확인해주세요.');parts.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
}

/** User-triggered server collection stays independent of extension PageSource. */
export function QuerySourcePanel({ownerId,company,disabled,onAdd}:{ownerId?:string;company:WorkspaceSettingsScope['company'];disabled:boolean;onAdd:(item:QuerySourceCaptureSummary)=>void}){
 const companyCode=company?.code,companyName=company?.name;
 const scope=useMemo(()=>({ownerId,company:companyCode&&companyName?{code:companyCode,name:companyName}:null}),[ownerId,companyCode,companyName]);
 const valid=ownerId&&company?{ownerId,company}:null;
 const [url,setUrl]=useState(''),[state,setState]=useState<PanelState>({scope,items:[],view:'active',loaded:false,busy:false,message:''});
 const alive=useRef(false),current=useRef(scope),running=useRef<{scope:object;controller:AbortController}|null>(null),attempt=useRef<CaptureAttempt|null>(null);
 useLayoutEffect(()=>{current.current=scope;attempt.current=null;return()=>{if(running.current?.scope===scope){running.current.controller.abort();running.current=null;}};},[scope]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;running.current?.controller.abort();};},[]);
 const shown=state.scope===scope?state:{scope,items:[],view:'active' as const,loaded:false,busy:false,message:''};
 const active=(controller:AbortController)=>alive.current&&current.current===scope&&!controller.signal.aborted;
 function update(patch:Partial<PanelState>){setState(previous=>({...((previous.scope===scope)?previous:{scope,items:[],view:'active',loaded:false,busy:false,message:''}),...patch,scope}));}
 function editUrl(value:string){let oldUrl:string|undefined,nextUrl:string|undefined;try{oldUrl=parseCollectionRequest({urls:[url]})[0].sourceUrl;}catch{}try{nextUrl=parseCollectionRequest({urls:[value]})[0].sourceUrl;}catch{}if(oldUrl!==nextUrl||!nextUrl)attempt.current=null;setUrl(value);}
 async function perform(mode:'load'|'capture'|'select'|'archive'|'restore',selected?:QuerySourceCaptureSummary,view=shown.view){
  if(!valid||running.current||disabled||!alive.current||current.current!==scope)return;
  const controller=new AbortController(),operation={scope,controller};running.current=operation;let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},mode==='capture'?70000:15000);update({busy:true,message:''});
  try{
   if(mode==='archive'||mode==='restore'){
    if(!selected||!shown.items.some(item=>item.id===selected.id&&item.revision===selected.revision&&item.fingerprint===selected.fingerprint))throw new QuerySourcePanelError('현재 목록에서 보관할 수집본을 다시 확인해주세요.');
    const response=await fetch('/api/query-captures',{method:'PATCH',cache:'no-store',credentials:'same-origin',redirect:'manual',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({id:selected.id,expectedRevision:selected.revision,action:mode,expectedOwnerId:valid.ownerId,expectedCompany:valid.company})}),body=await boundedJson(response);
    if(!active(controller))return;
    if(!response.ok||!object(body)||!sameScope(body,valid)||body.sourceStored!==true||body.draftCreated!==false)throw new QuerySourcePanelError('보관 변경 결과를 확인하지 못했습니다. 목록을 다시 불러온 뒤 확인해주세요.');
    const item=summary(body.item,valid,mode==='archive'?'archived':'active');if(item.id!==selected.id||item.revision!==selected.revision+1||item.fingerprint!==selected.fingerprint||item.sourceUrl!==selected.sourceUrl||item.captureVersion!==selected.captureVersion)throw new QuerySourcePanelError('수집 원문의 보관 버전을 확인하지 못했습니다. 목록을 다시 불러와주세요.');
    update({items:shown.items.filter(previous=>previous.id!==item.id),message:mode==='archive'?'수집본을 보관했습니다. 원문과 기존 작업 상품은 유지됩니다.':'보관을 해제했습니다. 서버 수집함에서 카테고리를 선택할 수 있습니다.'});return;
   }
   if(mode==='select'){
    if(!selected||!shown.items.some(item=>item.id===selected.id&&item.fingerprint===selected.fingerprint&&item.revision===selected.revision))throw new QuerySourcePanelError('현재 수집함에서 사용할 수집본을 다시 선택해주세요.');
    const response=await fetch('/api/supplier-hub/catalog-context',{cache:'no-store',credentials:'same-origin',redirect:'manual',signal:controller.signal}),body=await boundedJson(response);
    if(!active(controller))return;if(!response.ok||!sameScope(body,valid))throw new QuerySourcePanelError('로그인 계정 또는 회사가 변경되었습니다. 현재 계정으로 다시 열어주세요.');
    onAdd(summary(selected,valid));return;
   }
   let pending:CaptureAttempt|undefined;
   if(mode==='capture'){
    let source:ReturnType<typeof parseCollectionRequest>[number];try{source=parseCollectionRequest({urls:[url]})[0];}catch{throw new QuerySourcePanelError('올바른 1688 상품 상세 URL을 입력해주세요.');}
    const previous=attempt.current;pending=previous?.scope===scope&&previous.sourceUrl===source.sourceUrl?previous:{scope,id:crypto.randomUUID(),sourceUrl:source.sourceUrl};attempt.current=pending;
   }
   const response=await fetch('/api/query-captures'+(mode==='load'&&view==='archived'?'?view=archived':''),{method:mode==='capture'?'POST':'GET',cache:'no-store',credentials:'same-origin',redirect:'manual',signal:controller.signal,...(pending?{headers:{'content-type':'application/json'},body:JSON.stringify({id:pending.id,sourceUrl:pending.sourceUrl,expectedOwnerId:valid.ownerId,expectedCompany:valid.company})}:{})}),body=await boundedJson(response);
   if(!active(controller))return;
   if(!response.ok){const code=object(body)&&typeof body.code==='string'?body.code:'';throw new QuerySourcePanelError(notices[code]??(mode==='capture'?'수집 저장 여부를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.':'저장된 서버 수집함을 확인하지 못했습니다.'));}
   if(!object(body)||!sameScope(body,valid))throw new QuerySourcePanelError('현재 계정·회사의 수집 결과를 확인하지 못했습니다.');
   if(mode==='load'){
    if(!Array.isArray(body.captures)||body.captures.length>(view==='archived'?200:40))throw new QuerySourcePanelError('서버 수집함 목록을 확인하지 못했습니다.');
    const items=body.captures.map(item=>summary(item,valid,view));if(new Set(items.map(item=>item.id)).size!==items.length)throw new QuerySourcePanelError('수집함의 중복 항목을 확인해주세요.');
    update({items,view,loaded:true,message:items.length?(view==='archived'?'보관된 수집본입니다. 보관을 해제하면 다시 사용할 수 있습니다.':'저장된 원문입니다. 사용할 상품의 카테고리를 선택하세요.'):'저장된 서버 수집본이 없습니다.'});
   }else{
    if(!pending||body.sourceStored!==true||body.draftCreated!==false||typeof body.duplicate!=='boolean'||!object(body.item)||body.duplicate!==true&&body.item.id!==pending.id||!sameScope(body.item,valid))throw new QuerySourcePanelError('원문 저장 확인을 받지 못했습니다. 같은 요청으로 다시 확인해주세요.');
    const source=normalizeQuerySourceCapture(body.item.snapshot,parseCollectionRequest({urls:[pending.sourceUrl]})[0].offerId);if(source.sourceUrl!==pending.sourceUrl)throw new QuerySourcePanelError('요청 URL과 수집 원문이 다릅니다.');
    if(await querySourceFingerprint(source)!==body.item.fingerprint)throw new QuerySourcePanelError('저장 원문의 지문을 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.');if(!active(controller))return;
    const item=summary(querySourceCaptureSummary({...body.item,snapshot:source} as QuerySourceCapture),valid);
    update({items:[item,...(shown.view==='active'?shown.items.filter(previous=>previous.id!==item.id):[])],view:'active',loaded:true,message:'상품 원문을 서버 수집함에 저장했습니다. 카테고리를 선택하면 초안 작성을 시작합니다.'});attempt.current=null;
   }
  }catch(error){if(alive.current&&current.current===scope&&(!controller.signal.aborted||timedOut))update({message:timedOut?'응답 시간을 초과해 저장 여부를 확인하지 못했습니다. 입력을 유지했습니다. 같은 요청으로 다시 확인해주세요.':error instanceof QuerySourcePanelError?error.message:'수집 결과를 확인하지 못했습니다. 입력을 유지했습니다. 같은 요청으로 다시 확인해주세요.'});}
  finally{clearTimeout(timeout);if(running.current===operation)running.current=null;if(alive.current&&current.current===scope)update({busy:false});}
 }
 return <section className="collection-panel" aria-label="1688 URL 서버 수집">
  <div className="collection-heading"><div><h2>1688 URL로 상품 담기</h2><p>상품 URL로 원문을 먼저 수집한 뒤 카테고리를 선택하세요. SEO·가격·이미지·표시사항·견적서는 초안에서 확인하고 수정할 수 있습니다.</p></div><button type="button" className="btn ghost" disabled={shown.busy||disabled||!valid} onClick={()=>void perform('load',undefined,'active')}>서버 수집함 불러오기</button><button type="button" className="btn ghost" aria-pressed={shown.view==='archived'} disabled={shown.busy||disabled||!valid} onClick={()=>void perform('load',undefined,shown.view==='archived'?'active':'archived')}>{shown.view==='archived'?'수집함으로 돌아가기':'보관된 수집함'}</button></div>
  <form onSubmit={event=>{event.preventDefault();void perform('capture');}} style={{display:'flex',gap:10,alignItems:'end',flexWrap:'wrap',marginTop:16}}><label className="field" style={{flex:'1 1 320px'}}><span>1688 상품 URL</span><input type="url" aria-label="서버 수집할 1688 상품 URL" maxLength={2048} value={url} placeholder="https://detail.1688.com/offer/상품번호.html" disabled={shown.busy||disabled} onChange={event=>editUrl(event.target.value)}/></label><button type="submit" className="btn primary" disabled={shown.busy||disabled||!valid||!url.trim()}>{shown.busy?'확인 중…':'상품 수집'}</button></form>
  {!valid&&<p>현재 계정의 승인 회사 정보를 불러온 뒤 수집할 수 있습니다.</p>}{shown.message&&<p role="status" style={{fontSize:13,lineHeight:1.7}}>{shown.message}</p>}
  <ul className="collection-list">{shown.items.map(item=><li key={item.id}><div><strong>{item.title}</strong><small>{item.company.name} · 상품 {item.offerId} · 옵션 {item.optionCount}개 · 수집본 {item.captureVersion}</small><small>{shown.view==='archived'?'보관됨 · 원문 유지':'원문 저장 완료 · 상품 초안 작성 전'}</small></div>{shown.view==='active'&&<button type="button" className="btn primary" disabled={shown.busy||disabled} onClick={()=>void perform('select',item)}>카테고리 선택·초안 작성</button>}<button type="button" className="btn ghost" disabled={shown.busy||disabled} onClick={()=>void perform(shown.view==='archived'?'restore':'archive',item)}>{shown.view==='archived'?'보관 해제':'보관'}</button></li>)}</ul>
 </section>;
}
