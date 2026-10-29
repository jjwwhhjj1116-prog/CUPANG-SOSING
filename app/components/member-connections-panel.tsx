'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import type {MemberConnectionProfile,MemberConnectionsView} from '@/app/member-connections';
import './member-connections-panel.css';

type Props={ownerId:string;company:{code:string;name:string}};
type Draft={id:string;expectedRevision:number;service:MemberConnectionProfile['service'];alias:string;loginId:string};
const services={'supplier-hub':'Supplier Hub','1688':'1688'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const exact=(value:unknown,keys:string):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const newDraft=():Draft=>({id:crypto.randomUUID(),expectedRevision:0,service:'supplier-hub',alias:'',loginId:''});
const draftFor=(profile:MemberConnectionProfile):Draft=>({id:profile.id,expectedRevision:profile.revision,service:profile.service,alias:profile.alias,loginId:profile.loginId});
function readView(value:unknown,scope:Props):MemberConnectionsView{
 if(!exact(value,'company,ownerId,profiles')||value.ownerId!==scope.ownerId||!exact(value.company,'code,name')||value.company.code!==scope.company.code||value.company.name!==scope.company.name
  ||!Array.isArray(value.profiles)||value.profiles.length>20)throw Error('연동 계정 응답을 확인하지 못했습니다.');
 const ids=new Set<string>();
 for(const row of value.profiles){
  if(!exact(row,'alias,createdAt,enabled,hasPassword,id,loginId,revision,service,updatedAt')||typeof row.id!=='string'||!uuid.test(row.id)||ids.has(row.id)
   ||!Object.hasOwn(services,String(row.service))||typeof row.alias!=='string'||!row.alias.trim()||row.alias.length>60||typeof row.loginId!=='string'||!row.loginId.trim()||row.loginId.length>254
   ||typeof row.hasPassword!=='boolean'||typeof row.enabled!=='boolean'||!Number.isSafeInteger(row.revision)||Number(row.revision)<1
   ||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))throw Error('연동 계정 응답을 확인하지 못했습니다.');
  ids.add(row.id);
 }
 return value as unknown as MemberConnectionsView;
}
class RequestFailure extends Error{constructor(message:string,readonly known:boolean,readonly unconfigured=false){super(message);}}
async function readResponse(response:Response,scope:Props){
 if(response.redirected||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new RequestFailure('응답을 확인하지 못했습니다. 목록을 다시 불러와주세요.',false);
 let body:unknown;try{body=await response.json();}catch{throw new RequestFailure('응답을 확인하지 못했습니다. 목록을 다시 불러와주세요.',false);}
 if(!response.ok){
  const code=body&&typeof body==='object'&&'code' in body?body.code:undefined;
  if(response.status===503&&code==='MEMBER_CONNECTIONS_NOT_CONFIGURED')throw new RequestFailure('서버 암호화 키가 설정되지 않아 연동 계정을 저장하거나 불러올 수 없습니다.',true,true);
  throw new RequestFailure(response.status===409?'저장값이 변경되었습니다. 목록을 다시 불러온 뒤 확인해주세요.':response.status===401||response.status===403?'현재 승인 회원·회사를 다시 확인해주세요.':'연동 계정 요청을 처리하지 못했습니다.',response.status>=400&&response.status<500);
 }
 return readView(body,scope);
}

export function MemberConnectionsPanel(props:Props){
 return <MemberConnectionsScope key={JSON.stringify([props.ownerId,props.company.code,props.company.name])} {...props}/>;
}
function MemberConnectionsScope(scope:Props){
 const {ownerId,company:{code:companyCode,name:companyName}}=scope;
 const [view,setView]=useState<MemberConnectionsView|null>(null),[draft,setDraft]=useState<Draft>(newDraft),[busy,setBusy]=useState(true),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const mounted=useRef(true),request=useRef<AbortController|null>(null),password=useRef<HTMLInputElement|null>(null),unknownWrite=useRef(false),latest=useRef({view,draft});
 const bindPassword=useCallback((node:HTMLInputElement|null)=>{if(password.current&&password.current!==node)password.current.value='';password.current=node;},[]);
 useEffect(()=>{latest.current={view,draft};},[view,draft]);
 const clearPassword=()=>{if(password.current)password.current.value='';};
 function begin(){if(!mounted.current||request.current)return null;const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');return controller;}
 const active=(controller:AbortController)=>mounted.current&&request.current===controller&&!controller.signal.aborted;
 function finish(controller:AbortController){if(request.current===controller){request.current=null;if(mounted.current)setBusy(false);}}
 async function reload(){
  const controller=begin();if(!controller)return;
  try{
   const saved=await readResponse(await fetch('/api/member-connections',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal}),scope);
   if(!active(controller))return;const previous=latest.current.draft,current=saved.profiles.find(row=>row.id===previous.id);
   latest.current={view:saved,draft:current?draftFor(current):previous};setView(saved);if(current)setDraft(draftFor(current));clearPassword();unknownWrite.current=false;setUncertain(false);setMessage('목록을 불러왔습니다.');
  }catch(cause){if(active(controller)){if(cause instanceof RequestFailure&&cause.unconfigured){latest.current.view=null;setView(null);}setError(cause instanceof RequestFailure?cause.message:'연동 계정을 불러오지 못했습니다.');}}
  finally{finish(controller);}
 }
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();request.current=controller;
  void fetch('/api/member-connections',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal}).then(response=>readResponse(response,{ownerId,company:{code:companyCode,name:companyName}})).then(saved=>{
   if(!mounted.current||request.current!==controller||controller.signal.aborted)return;latest.current.view=saved;setView(saved);
  }).catch(cause=>{if(mounted.current&&request.current===controller&&!controller.signal.aborted)setError(cause instanceof RequestFailure?cause.message:'연동 계정을 불러오지 못했습니다.');}).finally(()=>{
   if(request.current===controller){request.current=null;if(mounted.current)setBusy(false);}
  });
  return()=>{mounted.current=false;controller.abort();request.current?.abort();request.current=null;};
 },[ownerId,companyCode,companyName]);
 function edit(profile?:MemberConnectionProfile){
  if(!mounted.current||request.current||unknownWrite.current||!latest.current.view||profile&&latest.current.view.profiles.find(row=>row.id===profile.id)!==profile)return;
  const next=profile?draftFor(profile):newDraft();latest.current.draft=next;setDraft(next);clearPassword();setError('');setMessage('');
 }
 function change(patch:Partial<Pick<Draft,'service'|'alias'|'loginId'>>){if(!mounted.current||request.current||unknownWrite.current)return;const next={...latest.current.draft,...patch};latest.current.draft=next;setDraft(next);}
 async function write(body:Record<string,unknown>,expected:{id:string;revision:number;service?:MemberConnectionProfile['service'];alias?:string;loginId?:string;enabled?:boolean}){
  if(unknownWrite.current||!latest.current.view)return;const controller=begin();if(!controller)return;clearPassword();
  try{
   const saved=await readResponse(await fetch('/api/member-connections',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({...body,expectedOwnerId:scope.ownerId,expectedCompany:scope.company})}),scope);
   if(!active(controller))return;const row=saved.profiles.find(item=>item.id===expected.id);
   if(!row||row.revision!==expected.revision+1||expected.service!==undefined&&(row.service!==expected.service||row.alias!==expected.alias||row.loginId!==expected.loginId||!row.hasPassword)||expected.enabled!==undefined&&row.enabled!==expected.enabled)throw new RequestFailure('저장 응답을 확인하지 못했습니다. 목록을 다시 불러와주세요.',false);
   latest.current={view:saved,draft:draftFor(row)};setView(saved);setDraft(draftFor(row));setMessage('저장했습니다.');setUncertain(false);
  }catch(cause){if(active(controller)){if(!(cause instanceof RequestFailure)||!cause.known){unknownWrite.current=true;setUncertain(true);}if(cause instanceof RequestFailure&&cause.unconfigured){latest.current.view=null;setView(null);}setError(cause instanceof RequestFailure?cause.message:'저장 응답을 확인하지 못했습니다. 목록을 다시 불러와주세요.');}}
  finally{finish(controller);}
 }
 function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!mounted.current||request.current||unknownWrite.current||!latest.current.view)return;const current=latest.current.draft,secret=password.current?.value??'',alias=current.alias.trim(),loginId=current.loginId.trim();
  if(!alias||alias.length>60||!loginId||loginId.length>254||secret.length>1024||!current.expectedRevision&&!secret){setError('별칭·로그인 ID와 비밀번호를 확인해주세요.');return;}
  void write({action:'save',...current,alias,loginId,password:secret},{id:current.id,revision:current.expectedRevision,service:current.service,alias,loginId});
 }
 const disabled=busy||uncertain||!view;
 return <section className="membership-card member-connections" aria-label="멀티 계정 설정" aria-busy={busy}>
  <div className="membership-header"><h2>멀티 계정 설정</h2><button type="button" className="btn ghost" disabled={busy} onClick={()=>void reload()}>목록 새로고침</button></div>
  {busy&&<p role="status">불러오는 중…</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {uncertain&&<p role="status">이전 저장 결과를 먼저 확인해주세요. 자동으로 다시 저장하지 않습니다.</p>}
  {view&&<><div className="member-connections-list"><table><thead><tr><th>서비스</th><th>별칭</th><th>로그인 ID</th><th>비밀번호</th><th>상태</th><th>관리</th></tr></thead><tbody>{view.profiles.map(profile=><tr key={profile.id}>
   <td>{services[profile.service]}</td><td>{profile.alias}</td><td>{profile.loginId}</td><td>{profile.hasPassword?'등록됨':'미등록'}</td><td>{profile.enabled?'사용':'비활성'}</td><td><button type="button" className="btn ghost" disabled={disabled} onClick={()=>edit(profile)}>수정</button><button type="button" className="btn ghost" disabled={disabled} onClick={()=>void write({action:'set-enabled',id:profile.id,expectedRevision:profile.revision,enabled:!profile.enabled},{id:profile.id,revision:profile.revision,enabled:!profile.enabled})}>{profile.enabled?'비활성화':'다시 사용'}</button></td>
  </tr>)}</tbody></table></div>
  <form onSubmit={save} className="member-connections-form" autoComplete="off">
   <label>서비스<select value={draft.service} disabled={disabled||draft.expectedRevision>0} onChange={event=>change({service:event.target.value as Draft['service']})}><option value="supplier-hub">Supplier Hub</option><option value="1688">1688</option></select></label>
   <label>별칭<input value={draft.alias} maxLength={60} required disabled={disabled} onChange={event=>change({alias:event.target.value})}/></label>
   <label>로그인 ID<input value={draft.loginId} maxLength={254} required disabled={disabled} autoComplete="off" onChange={event=>change({loginId:event.target.value})}/></label>
   <label>비밀번호<input ref={bindPassword} type="password" maxLength={1024} required={draft.expectedRevision===0} disabled={disabled} autoComplete="new-password"/></label>
   <div className="member-connections-actions"><button type="submit" className="btn primary" disabled={disabled}>{draft.expectedRevision?'변경 저장':'계정 등록'}</button><button type="button" className="btn ghost" disabled={disabled} onClick={()=>edit()}>계정 추가</button></div>
   {draft.expectedRevision>0&&<small>비밀번호 공란은 기존 값 유지</small>}
  </form></>}
 </section>;
}
