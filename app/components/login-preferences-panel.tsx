'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {readLoginPreferences,saveLoginPreferences} from '@/app/login-preferences';

export function LoginPreferencesPanel({email}:{email:string}){
 const formRef=useRef<HTMLFormElement>(null),busyRef=useRef(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false);
 useEffect(()=>{
  const form=formRef.current;if(!form)return;
  const preferences=readLoginPreferences();
  for(const name of ['rememberEmail','rememberMe'] as const){
   const input=form.elements.namedItem(name) as HTMLInputElement|null;if(input)input.checked=preferences[name];
  }
 },[]);
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busyRef.current)return;
  const values=new FormData(event.currentTarget),rememberEmail=values.get('rememberEmail')==='on',rememberMe=values.get('rememberMe')==='on';
  busyRef.current=true;setBusy(true);setMessage('');setError(false);
  try{
   const response=await fetch('/api/membership',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'remember-session',rememberMe})});
   if(response.status===401){window.location.assign('/login');return;}
   const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||'로그인 설정을 저장하지 못했습니다.');
   saveLoginPreferences({email,rememberEmail,rememberMe});
   setMessage(rememberMe?'저장했습니다. 이 브라우저에서 30일 동안 자동 로그인됩니다.':'저장했습니다. 이 브라우저의 로그인은 8시간 동안 유지됩니다.');
  }catch(reason){setError(true);setMessage(reason instanceof Error?reason.message:'로그인 설정을 저장하지 못했습니다.');}
  finally{busyRef.current=false;setBusy(false);}
 }
 return <section className="membership-card login-preferences-card" aria-labelledby="login-preferences-heading">
  <h2 id="login-preferences-heading">이 브라우저의 로그인 설정</h2><p>다음 접속에도 이어서 사용할 수 있도록 설정하세요.</p>
  <form ref={formRef} onSubmit={save} aria-busy={busy}>
   <div className="login-preferences-options"><label><input name="rememberEmail" type="checkbox" defaultChecked disabled={busy}/>아이디 저장</label><label><input name="rememberMe" type="checkbox" defaultChecked disabled={busy}/>자동 로그인 유지 <small>30일</small></label></div>
   <button className="btn primary" disabled={busy}>{busy?'저장 중…':'로그인 설정 저장'}</button>
   {message&&<p role={error?'alert':'status'}>{message}</p>}
  </form>
 </section>;
}
