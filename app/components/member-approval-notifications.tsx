'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import type {WorkspaceMember} from '@/app/workspace-members';
import './member-approval-notifications.css';

type Membership={member:WorkspaceMember;members?:WorkspaceMember[]};
const interval=60_000;
const registrationDate=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';

/** Public authentication pages do not make a background membership request. */
export function MemberApprovalNotifications(){
 const pathname=usePathname();
 if(!pathname||/^\/(?:login|signup|recover|recovery)(?:\/|$)/u.test(pathname))return null;
 return <ApprovalNotificationsScope/>;
}

function ApprovalNotificationsScope(){
 const [admin,setAdmin]=useState<WorkspaceMember|null>(null),[pending,setPending]=useState<WorkspaceMember[]>([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const mounted=useRef(false),request=useRef<AbortController|null>(null),lastRead=useRef(0),authenticated=useRef(false),seen=useRef(new Set<string>());
 const latest=useRef<{member:WorkspaceMember|null;pending:WorkspaceMember[];epoch:number}>({member:null,pending:[],epoch:0});
 const dialog=useRef<HTMLDivElement|null>(null),opener=useRef<HTMLButtonElement|null>(null);
 function clear(){
  latest.current={member:null,pending:[],epoch:latest.current.epoch+1};authenticated.current=false;seen.current.clear();
  if(mounted.current){setAdmin(null);setPending([]);setOpen(false);setMessage('');}
 }
 function accept(data:Membership){
  const member=data.member;
  if(!member||typeof member.id!=='string'){clear();return;}
  authenticated.current=true;
  if(member.role!=='admin'||member.status!=='approved'){clear();return;}
  if(latest.current.member?.id!==member.id){clear();authenticated.current=true;}
  const rows=Array.isArray(data.members)?data.members.filter(row=>row&&typeof row.id==='string'&&row.role==='member'&&row.status==='pending'):[];
  const fresh=rows.some(row=>!seen.current.has(row.id));rows.forEach(row=>seen.current.add(row.id));
  latest.current={member,pending:rows,epoch:latest.current.epoch};setAdmin(member);setPending(rows);
  if(fresh)setOpen(true);
 }
 async function refresh(force=false){
  if(!mounted.current||request.current||document.visibilityState!=='visible'||!force&&Date.now()-lastRead.current<interval)return;
  const controller=new AbortController();request.current=controller;lastRead.current=Date.now();
  try{
   const response=await fetch('/api/membership',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
   if(!mounted.current||request.current!==controller||controller.signal.aborted)return;
   if(response.status===401||response.status===403){clear();return;}
   if(!response.ok)return;
   const data=await response.json() as Membership;
   if(mounted.current&&request.current===controller&&!controller.signal.aborted)accept(data);
  }catch{/* Background checks stay quiet; explicit actions report errors. */}
  finally{if(request.current===controller)request.current=null;}
 }
 useEffect(()=>{
  mounted.current=true;void Promise.resolve().then(()=>refresh(true));
  const check=()=>{if(authenticated.current)void refresh();};
  const reset=()=>{request.current?.abort();request.current=null;clear();setBusy(false);};
  const changed=()=>{if(authenticated.current)void refresh(true);};
  const timer=window.setInterval(check,interval);
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  window.addEventListener('membership-session-changed',reset);window.addEventListener('membership-updated',changed);
  return()=>{mounted.current=false;request.current?.abort();request.current=null;latest.current={member:null,pending:[],epoch:latest.current.epoch+1};window.clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);window.removeEventListener('membership-session-changed',reset);window.removeEventListener('membership-updated',changed);};
  // The mounted scope owns its request and event handlers for the whole session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{
  if(!open)return;const previous=document.activeElement;dialog.current?.focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
   if(event.key!=='Tab')return;
   const controls=dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),[tabindex="0"]');if(!controls?.length){event.preventDefault();return;}
   const first=controls[0],last=controls[controls.length-1];
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('keydown',key);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[open]);
 async function review(action:'approve'|'reject',candidate:WorkspaceMember,owner:WorkspaceMember,epoch:number){
  if(!mounted.current||request.current||latest.current.epoch!==epoch||latest.current.member!==owner||latest.current.pending.find(row=>row.id===candidate.id)!==candidate||candidate.status!=='pending')return;
  const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/membership',{method:'POST',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action,memberId:candidate.id,expectedStatus:'pending'})});
   if(!mounted.current||request.current!==controller||controller.signal.aborted||latest.current.epoch!==epoch||latest.current.member!==owner)return;
   if(response.status===401||response.status===403){clear();return;}
   const data=await response.json() as {error?:string};
   if(!mounted.current||request.current!==controller||controller.signal.aborted||latest.current.epoch!==epoch||latest.current.member!==owner)return;
   if(!response.ok)throw Error(data.error||(response.status===409?'이미 처리된 요청입니다. 목록을 다시 확인해주세요.':'승인 요청을 처리하지 못했습니다.'));
   latest.current.pending=latest.current.pending.filter(row=>row!==candidate);setPending(latest.current.pending);setMessage(action==='approve'?'가입을 승인했습니다.':'가입 요청을 거절했습니다.');
   window.dispatchEvent(new Event('membership-updated'));
  }catch(error){if(mounted.current&&request.current===controller&&!controller.signal.aborted)setMessage(error instanceof Error?error.message:'처리 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.');}
  finally{if(request.current===controller){request.current=null;if(mounted.current){setBusy(false);void refresh(true);}}}
 }
 if(!admin)return null;
 const epoch=latest.current.epoch;
 return <aside className="member-approvals" aria-label="회원 승인 알림">
  <button type="button" ref={opener} className="member-approval-notice" aria-label={`가입 승인 요청 ${pending.length}건 보기`} aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setOpen(true);void refresh();}}><span aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></span> 가입 승인 요청 <strong>{pending.length}</strong></button>
  {open&&<div className="member-approval-backdrop" onClick={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
   <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="member-approval-title" className="member-approval-dialog" aria-busy={busy}>
    <header><div><p>회원 알림</p><h2 id="member-approval-title">가입 승인 요청 <span>{pending.length}</span></h2></div><button type="button" className="member-approval-close" aria-label="승인 요청 창 닫기" onClick={()=>setOpen(false)}>×</button></header>
    <p className="member-approval-description">가입 정보를 확인한 뒤 승인 또는 거절해주세요.</p>
    {message&&<p className="member-approval-feedback" role="status">{message}</p>}
    {pending.length?<div className="member-approval-list"><table><thead><tr><th>아이디</th><th>이름</th><th>휴대폰 번호</th><th>요청일</th><th>처리</th></tr></thead><tbody>{pending.map(member=><tr key={member.id}><td>{member.loginId||member.email}</td><td>{member.name||'—'}</td><td>{member.phoneNumber||'—'}</td><td>{registrationDate(member.createdAt)}</td><td><div className="member-approval-actions"><button type="button" className="member-approval-approve" disabled={busy} onClick={()=>void review('approve',member,admin,epoch)}>승인</button><button type="button" className="member-approval-reject" disabled={busy} onClick={()=>void review('reject',member,admin,epoch)}>거절</button></div></td></tr>)}</tbody></table></div>:<div className="member-approval-empty">대기 중인 가입 요청이 없습니다.</div>}
    <footer><a href="/account">전체 회원 관리</a><button type="button" disabled={busy} onClick={()=>void refresh(true)}>새로고침</button><button type="button" onClick={()=>setOpen(false)}>닫기</button></footer>
   </div>
  </div>}
 </aside>;
}
