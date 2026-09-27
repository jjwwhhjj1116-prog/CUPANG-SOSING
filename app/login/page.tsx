'use client';
import {useState,type FormEvent} from 'react';
export default function LoginPage(){
 const [signup,setSignup]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setMessage('');
  try{const response=await fetch('/api/membership',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:signup?'signup':'login',email:data.get('email'),password:data.get('password'),companyCode:data.get('companyCode'),companyName:data.get('companyName')})});const body=await response.json() as {error?:string;message?:string};
   if(!response.ok)throw Error(body.error||'요청에 실패했습니다.');
   if(signup)setMessage(body.message??'가입 요청을 접수했습니다.');else window.location.assign('/');
  }catch(error){setMessage(error instanceof Error?error.message:'요청에 실패했습니다.');}finally{setBusy(false);}
 }
 return <main style={{maxWidth:440,margin:'8vh auto',padding:32,border:'1px solid #ddd',borderRadius:16}}><h1>YOOFAM PLUS</h1><h2>{signup?'회원가입 요청':'로그인'}</h2><form onSubmit={submit} style={{display:'grid',gap:16}}><label>이메일<input name="email" type="email" required autoComplete="username" style={{width:'100%'}}/></label><label>비밀번호<input name="password" type="password" required minLength={10} maxLength={128} autoComplete={signup?'new-password':'current-password'} style={{width:'100%'}}/></label>{signup&&<><label>Supplier Hub 회사코드<input name="companyCode" required maxLength={200} style={{width:'100%'}}/></label><label>회사명<input name="companyName" required maxLength={200} style={{width:'100%'}}/></label><p>관리자가 회사정보를 확인하여 승인한 후 이용할 수 있습니다.</p></>}<button disabled={busy}>{busy?'처리 중…':signup?'가입 요청':'로그인'}</button></form><p role="status">{message}</p><button disabled={busy} onClick={()=>{setSignup(!signup);setMessage('');}}>{signup?'로그인으로 돌아가기':'회원가입 요청'}</button></main>;
}
