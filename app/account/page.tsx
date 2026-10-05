'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {WorkspaceMember} from '@/app/workspace-members';
import {LoginPreferencesPanel} from '@/app/components/login-preferences-panel';
const labels={pending:'승인 대기',approved:'사용 중',rejected:'거절',suspended:'이용 정지'};
async function readMembership(signal?:AbortSignal){
 const response=await fetch('/api/membership',{cache:'no-store',signal});
 if(response.status===401)return null;
 const data=await response.json() as {error?:string;member:WorkspaceMember;members?:WorkspaceMember[]};
 if(!response.ok)throw Error(data.error||'계정을 불러오지 못했습니다.');
 return data;
}
export default function AccountPage(){
 const [self,setSelf]=useState<WorkspaceMember|null>(null),[members,setMembers]=useState<WorkspaceMember[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 async function refresh(){const data=await readMembership();if(!data){window.location.replace('/login');return;}setSelf(data.member);setMembers(data.members??[]);}
 useEffect(()=>{const controller=new AbortController();void readMembership(controller.signal).then(data=>{if(controller.signal.aborted)return;if(!data){window.location.replace('/login');return;}setSelf(data.member);setMembers(data.members??[]);}).catch(error=>{if(!controller.signal.aborted)setMessage(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[]);
 async function act(action:string,memberId?:string){
  setBusy(true);setMessage('');
  try{const response=await fetch('/api/membership',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,memberId})});if(response.status===401){window.location.replace('/login');return;}const data=await response.json() as {error?:string;reauthenticate?:boolean};if(!response.ok)throw Error(data.error||'요청을 처리하지 못했습니다.');if(action==='logout'||data.reauthenticate){window.location.assign('/login');return;}await refresh();setMessage('처리했습니다.');}catch(error){setMessage(error instanceof Error?error.message:'처리 실패');}finally{setBusy(false);}
 }
 return <main className="membership-page">
  <header className="membership-header"><div><Link href="/">← 상품등록</Link><h1>YOOFAM PLUS 계정 관리</h1></div>{self&&<button className="btn ghost" disabled={busy} onClick={()=>void act('logout')}>로그아웃</button>}</header>
  <p role="status" aria-live="polite">{loading?'계정을 불러오는 중…':message}</p>
  {self&&<section className="membership-card"><h2>{self.role==='admin'?'관리자':'회원'} 계정</h2><p>{self.email}</p><p>{self.companyName} · {self.companyCode}</p><p>로그인 계정에 지정된 Supplier Hub 회사로 상품과 견적서를 관리합니다.</p></section>}
  {self&&<LoginPreferencesPanel email={self.email}/>}
  {self?.role==='admin'&&<section className="membership-card"><div className="membership-header"><h2>지정 계정 관리</h2><button className="btn ghost" disabled={busy} onClick={()=>{setBusy(true);void refresh().catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}>새로고침</button></div><p>유앤채·와이홉의 지정 계정 2개만 사용할 수 있습니다.</p>
   <div className="membership-table"><table><thead><tr><th>이메일</th><th>회사코드</th><th>회사명</th><th>상태</th><th>처리</th></tr></thead><tbody>{members.map(member=><tr key={member.id}><td>{member.email}{member.role==='admin'?' (관리자)':''}</td><td>{member.companyCode}</td><td>{member.companyName}</td><td>{labels[member.status]}</td><td>{member.role!=='admin'&&(member.status==='approved'?<button className="btn rose" disabled={busy} onClick={()=>void act('suspend',member.id)}>이용 정지</button>:<button className="btn primary" disabled={busy} onClick={()=>void act('approve',member.id)}>이용 재개</button>)}</td></tr>)}</tbody></table></div>
  </section>}
 </main>;
}
