'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import type {WorkspaceMember} from '@/app/workspace-members';
import {LoginPreferencesPanel} from '@/app/components/login-preferences-panel';
import {MemberConnectionsPanel} from '@/app/components/member-connections-panel';
import {AccountSecurityPanel} from '@/app/components/account-security-panel';
import styles from './page.module.css';

const labels={pending:'승인 대기',approved:'사용 중',rejected:'거절',suspended:'이용 정지'};
const dateLabel=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium'}).format(new Date(value)):'—';
type Membership={member:WorkspaceMember;members?:WorkspaceMember[]};

export default function AccountPage(){
 const [self,setSelf]=useState<WorkspaceMember|null>(null),[members,setMembers]=useState<WorkspaceMember[]>([]),[message,setMessage]=useState(''),[error,setError]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const mounted=useRef(false),request=useRef<AbortController|null>(null),latest=useRef<{self:WorkspaceMember|null;members:WorkspaceMember[];epoch:number}>({self:null,members:[],epoch:0});
 const passwordForm=useRef<HTMLFormElement|null>(null);
 function active(controller:AbortController){return mounted.current&&request.current===controller&&!controller.signal.aborted;}
 function clearPasswords(form=passwordForm.current){for(const name of ['currentPassword','newPassword','confirmPassword']){const input=form?.elements.namedItem(name) as HTMLInputElement|null;if(input)input.value='';}}
 function clear(){latest.current={self:null,members:[],epoch:latest.current.epoch+1};if(mounted.current){setSelf(null);setMembers([]);setMessage('');}}
 function expire(){clear();window.dispatchEvent(new Event('membership-session-changed'));window.location.replace('/login');}
 function accept(data:Membership){
  if(!data.member||typeof data.member.id!=='string')throw Error('계정을 불러오지 못했습니다.');
  const next=data.member,rows=next.role==='admin'&&Array.isArray(data.members)?data.members:[];
  if(latest.current.self?.id!==next.id){clear();setError(false);}
  latest.current={self:next,members:rows,epoch:latest.current.epoch};setSelf(next);setMembers(rows);
 }
 async function read(controller:AbortController){
  const response=await fetch('/api/membership',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
  if(!active(controller))return;
  if(response.status===401||response.status===403){expire();return;}
  const data=await response.json() as Membership&{error?:string};if(!active(controller))return;
  if(!response.ok)throw Error(data.error||'계정을 불러오지 못했습니다.');accept(data);
 }
 function finish(controller:AbortController){if(request.current===controller){request.current=null;if(mounted.current){setBusy(false);setLoading(false);}}}
 async function refresh(){
  if(!mounted.current||request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');setError(false);
  try{await read(controller);}catch(cause){if(active(controller)){setError(true);setMessage(cause instanceof Error?cause.message:'계정을 불러오지 못했습니다.');}}finally{finish(controller);}
 }
 useEffect(()=>{
  mounted.current=true;void Promise.resolve().then(()=>refresh());const changed=()=>void refresh(),reset=()=>{request.current?.abort();request.current=null;clear();setBusy(false);};window.addEventListener('membership-updated',changed);window.addEventListener('membership-session-changed',reset);
  return()=>{mounted.current=false;request.current?.abort();request.current=null;clearPasswords();latest.current={self:null,members:[],epoch:latest.current.epoch+1};window.removeEventListener('membership-updated',changed);window.removeEventListener('membership-session-changed',reset);};
  // This scope owns all account reads and cancels them on exit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function act(action:'logout'|'approve'|'reject'|'suspend',owner:WorkspaceMember,candidate?:WorkspaceMember){
  if(!mounted.current||request.current||latest.current.self!==owner||candidate&&latest.current.members.find(row=>row.id===candidate.id)!==candidate)return;
  if(candidate&&(owner.role!=='admin'||candidate.role==='admin'||action==='reject'&&candidate.status!=='pending'||action==='approve'&&!['pending','suspended'].includes(candidate.status)||action==='suspend'&&candidate.status!=='approved'))return;
  const controller=new AbortController(),epoch=latest.current.epoch;request.current=controller;setBusy(true);setMessage('');setError(false);
  try{
   const response=await fetch('/api/membership',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action,...(candidate?{memberId:candidate.id,...(candidate.status==='pending'?{expectedStatus:'pending'}:{})}:{})})});
   if(!active(controller)||latest.current.epoch!==epoch||latest.current.self!==owner)return;
   if(response.status===401||response.status===403){expire();return;}
   const data=await response.json() as {error?:string;reauthenticate?:boolean};if(!active(controller)||latest.current.epoch!==epoch||latest.current.self!==owner)return;
   if(!response.ok)throw Error(data.error||'요청을 처리하지 못했습니다.');
   if(action==='logout'||data.reauthenticate){clear();window.dispatchEvent(new Event('membership-session-changed'));window.location.assign('/login');return;}
   await read(controller);if(!active(controller))return;setMessage(action==='reject'?'가입 요청을 거절했습니다.':action==='suspend'?'이용을 정지했습니다.':candidate?.status==='pending'?'가입을 승인했습니다.':'이용을 재개했습니다.');
   window.dispatchEvent(new Event('membership-updated'));
  }catch(cause){if(active(controller)){setError(true);setMessage(cause instanceof Error?cause.message:'처리 결과를 확인하지 못했습니다. 새로고침 후 확인해주세요.');}}
  finally{finish(controller);}
 }
 async function changePassword(event:FormEvent<HTMLFormElement>,owner:WorkspaceMember){
  event.preventDefault();if(!mounted.current||request.current||latest.current.self!==owner)return;
  const form=event.currentTarget,values=new FormData(form),currentPassword=String(values.get('currentPassword')??''),newPassword=String(values.get('newPassword')??'');
  if(newPassword!==values.get('confirmPassword')){setError(true);setMessage('새 비밀번호가 일치하지 않습니다.');return;}
  const controller=new AbortController(),epoch=latest.current.epoch;request.current=controller;setBusy(true);setMessage('');setError(false);
  clearPasswords(form);
  try{
   const response=await fetch('/api/membership',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'change-password',memberId:owner.id,currentPassword,newPassword})});
   if(!active(controller)||latest.current.epoch!==epoch||latest.current.self!==owner)return;
   if(response.status===401){expire();return;}
   const data=await response.json() as {error?:string;reauthenticate?:boolean};if(!active(controller)||latest.current.epoch!==epoch||latest.current.self!==owner)return;
   if(!response.ok)throw Error(data.error||'비밀번호를 변경하지 못했습니다.');
   clear();window.dispatchEvent(new Event('membership-session-changed'));window.location.assign('/login');
  }catch(cause){if(active(controller)){setError(true);setMessage(cause instanceof Error?cause.message:'변경 결과를 확인하지 못했습니다. 다시 로그인해 확인해주세요.');}}
  finally{finish(controller);}
 }
 const companyConfigured=!!self?.companyCode&&!!self?.companyName;
 return <main className="membership-page">
  <header className="membership-header"><div><Link href="/">← 상품등록</Link><h1>계정 관리</h1></div>{self&&<button className="btn ghost" disabled={busy} onClick={()=>void act('logout',self)}>로그아웃</button>}</header>
  {(loading||message)&&<p className={error?styles.error:styles.feedback} role={error?'alert':'status'} aria-live="polite">{loading?'계정을 불러오는 중…':message}</p>}
  {!loading&&!self&&error&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void refresh()}>다시 불러오기</button>}
  {self&&<>
   <section className={'membership-card '+styles.summary}><div><p className={styles.eyebrow}>{self.role==='admin'?'관리자':'회원'} 계정</p><h2>{self.name||self.loginId||self.email}</h2><p>{self.loginId||self.email}</p></div><span className={styles.badge} data-status={self.status}>{labels[self.status]}</span><div className={styles.company}>{companyConfigured?<><strong>{self.companyName}</strong><span>{self.companyCode}</span><p>이 회사의 상품과 견적서를 관리합니다.</p></>:<><strong>회사 연동 미설정</strong><p>회사 연동이 아직 설정되지 않았습니다. 관리자에게 문의해주세요.</p></>}</div></section>
   <AccountSecurityPanel key={self.id} ownerId={self.id} isAdmin={self.role==='admin'}/>
   <LoginPreferencesPanel key={'preferences:'+self.id} email={self.loginId||self.email}/>
   {self.status==='approved'&&companyConfigured&&<MemberConnectionsPanel key={JSON.stringify([self.id,self.companyCode,self.companyName])} ownerId={self.id} company={{code:self.companyCode,name:self.companyName}}/>}
   <section className="membership-card"><h2>비밀번호 변경</h2><p>비밀번호를 변경하면 모든 기기에서 로그아웃됩니다.</p><form ref={passwordForm} key={'password:'+self.id} onSubmit={event=>void changePassword(event,self)} aria-busy={busy} autoComplete="off">
    <label>현재 비밀번호<input name="currentPassword" type="password" required minLength={10} maxLength={128} autoComplete="current-password" disabled={busy}/></label>
    <label>새 비밀번호<input name="newPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="10자 이상 입력하세요" disabled={busy}/></label>
    <label>새 비밀번호 확인<input name="confirmPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" disabled={busy}/></label>
    <button type="submit" className="btn primary" disabled={busy}>비밀번호 변경</button>
   </form></section>
  </>}
  {self?.role==='admin'&&<section className="membership-card"><div className="membership-header"><div><h2>회원 관리</h2><p>가입 요청을 검토하고 회원의 이용 상태를 관리하세요.</p></div><button className="btn ghost" disabled={busy} onClick={()=>void refresh()}>새로고침</button></div>
   <div className="membership-table"><table><thead><tr><th>아이디</th><th>이름</th><th>휴대폰 번호</th><th>가입일</th><th>회사</th><th>상태</th><th>처리</th></tr></thead><tbody>{members.map(member=><tr key={member.id}><td>{member.loginId||member.email}{member.role==='admin'&&<span className={styles.admin}>관리자</span>}</td><td>{member.name||'—'}</td><td className={styles.nowrap}>{member.phoneNumber||'—'}</td><td className={styles.nowrap}>{dateLabel(member.createdAt)}</td><td>{member.companyName||'미설정'}</td><td><span className={styles.badge} data-status={member.status}>{labels[member.status]}</span></td><td><div className={styles.actions}>{member.role!=='admin'&&(member.status==='pending'?<><button className="btn primary" disabled={busy} onClick={()=>void act('approve',self,member)}>승인</button><button className="btn rose" disabled={busy} onClick={()=>void act('reject',self,member)}>거절</button></>:member.status==='approved'?<button className="btn rose" disabled={busy} onClick={()=>void act('suspend',self,member)}>이용 정지</button>:member.status==='suspended'?<button className="btn primary" disabled={busy} onClick={()=>void act('approve',self,member)}>이용 재개</button>:<span className={styles.muted}>처리 완료</span>)}</div></td></tr>)}</tbody></table></div>
  </section>}
 </main>;
}
