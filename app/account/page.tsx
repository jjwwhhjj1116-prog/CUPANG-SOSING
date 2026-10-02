'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {WorkspaceMember} from '@/app/workspace-members';
import {SUPPLIER_HUB_COMPANIES,supplierHubCompany} from '@/app/supplier-hub-company';
const labels={pending:'승인 대기',approved:'승인',rejected:'거절',suspended:'이용 정지'};
type Company={companyCode:string;companyName:string};
async function readMembership(signal?:AbortSignal){
 const response=await fetch('/api/membership',{cache:'no-store',signal});
 if(response.status===401)return null;
 const data=await response.json() as {error?:string;member:WorkspaceMember;members?:WorkspaceMember[]};
 if(!response.ok)throw Error(data.error||'계정을 불러오지 못했습니다.');
 return data;
}
export default function AccountPage(){
 const [self,setSelf]=useState<WorkspaceMember|null>(null),[members,setMembers]=useState<WorkspaceMember[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[editing,setEditing]=useState<WorkspaceMember|null>(null);
 const [editingCompany,setEditingCompany]=useState('');
 function editCompany(member:WorkspaceMember){setEditing(member);setEditingCompany(supplierHubCompany(member.companyCode,member.companyName)?.code??'');}
 async function refresh(){
  const data=await readMembership();
  if(!data){window.location.replace('/login');return;}
  setSelf(data.member);setMembers(data.members??[]);
 }
 useEffect(()=>{
  const controller=new AbortController();
  void readMembership(controller.signal).then(data=>{
   if(controller.signal.aborted)return;
   if(!data){window.location.replace('/login');return;}
   setSelf(data.member);setMembers(data.members??[]);
  }).catch(error=>{if(!controller.signal.aborted)setMessage(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[]);
 async function act(action:string,memberId?:string,company?:Company){
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/membership',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,memberId,...company})});
   if(response.status===401){window.location.replace('/login');return;}
   const data=await response.json() as {error?:string;reauthenticate?:boolean};
   if(!response.ok)throw Error(data.error||'요청을 처리하지 못했습니다.');
   if(action==='logout'||data.reauthenticate){window.location.assign('/login');return;}
   await refresh();setEditing(null);setMessage(action==='company'?'회사정보를 저장했습니다. 해당 회원은 다시 로그인해야 합니다.':'처리했습니다.');
  }catch(error){setMessage(error instanceof Error?error.message:'처리 실패');}finally{setBusy(false);}
 }
 const approved=members.filter(member=>member.status==='approved').length;
 const ordered=[...members].sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending'));
 return <main className="membership-page">
  <header className="membership-header"><div><Link href="/">← 상품등록</Link><h1>YOOFAM PLUS 계정 관리</h1></div>{self&&<button className="btn ghost" disabled={busy} onClick={()=>void act('logout')}>로그아웃</button>}</header>
  <p role="status" aria-live="polite">{loading?'계정을 불러오는 중…':message}</p>
  {self&&<section className="membership-card"><h2>{self.role==='admin'?'관리자':'회원'} 계정</h2><p>{self.email}</p><p>{self.companyName||'회사정보 미설정'} {self.companyCode}</p>{self.role==='admin'&&<button className="btn ghost" disabled={busy} onClick={()=>editCompany(self)}>회사정보 수정</button>}</section>}
  {self?.role==='admin'&&<section className="membership-card"><div className="membership-header"><h2>회원가입 요청 및 승인 계정</h2><button className="btn ghost" disabled={busy} onClick={()=>{setBusy(true);void refresh().catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}>새로고침</button></div>
   <p>승인 {approved} / 2개 · 승인 대기 {members.filter(member=>member.status==='pending').length}개</p><p>회사정보를 확인한 후 승인해주세요. 회사정보 변경 시 해당 계정의 기존 로그인은 해제됩니다.</p>
   <div className="membership-table"><table><thead><tr><th>이메일</th><th>회사코드</th><th>회사명</th><th>상태</th><th>처리</th></tr></thead><tbody>{ordered.map(member=><tr key={member.id}>
    <td>{member.email}{member.role==='admin'?' (관리자)':''}</td><td>{member.companyCode||'미설정'}</td><td>{member.companyName||'미설정'}</td><td>{labels[member.status]}</td>
    <td><div className="membership-actions"><button className="btn ghost" disabled={busy} onClick={()=>editCompany(member)}>회사정보</button>{member.role!=='admin'&&(member.status==='approved'?<button className="btn rose" disabled={busy} onClick={()=>void act('suspend',member.id)}>이용 정지</button>:<>
     <button className="btn primary" disabled={busy||approved>=2||!supplierHubCompany(member.companyCode,member.companyName)} onClick={()=>void act('approve',member.id)}>{member.status==='suspended'?'이용 재개':member.status==='rejected'?'재승인':'승인'}</button>
     {member.status==='pending'&&<button className="btn ghost" disabled={busy} onClick={()=>void act('reject',member.id)}>거절</button>}</>)}</div></td>
   </tr>)}</tbody></table></div>
  </section>}
  {editing&&<section className="membership-card" aria-label="회사정보 수정"><h2>회사정보 수정</h2><p>{editing.email}</p><form key={editing.id} onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void act('company',editing.id,{companyCode:String(data.get('companyCode')),companyName:String(data.get('companyName'))});}}>
   <label>Supplier Hub 회사<select name="companyCode" value={editingCompany} required disabled={busy} onChange={event=>setEditingCompany(event.target.value)}><option value="">회사를 선택해주세요</option>{SUPPLIER_HUB_COMPANIES.map(company=><option key={company.code} value={company.code}>{company.name} · {company.code}</option>)}</select></label><label>회사명<input name="companyName" value={SUPPLIER_HUB_COMPANIES.find(company=>company.code===editingCompany)?.name??''} readOnly required/></label>
   <div className="membership-actions"><button className="btn primary" disabled={busy||!editingCompany}>저장</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setEditing(null)}>취소</button></div>
  </form></section>}
 </main>;
}
