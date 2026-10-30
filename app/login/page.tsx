'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {readLoginPreferences,saveLoginPreferences} from '@/app/login-preferences';
import styles from './page.module.css';

export default function LoginPage(){
 const [mode,setMode]=useState<'login'|'signup'>('login'),[requested,setRequested]=useState(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[showPassword,setShowPassword]=useState(false);
 const formRef=useRef<HTMLFormElement>(null),busyRef=useRef(false),mounted=useRef(false),request=useRef<AbortController|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
 useEffect(()=>{
  if(mode!=='login')return;const form=formRef.current;if(!form)return;
  const preferences=readLoginPreferences();
  const email=form.elements.namedItem('email') as HTMLInputElement|null;
  const rememberEmail=form.elements.namedItem('rememberEmail') as HTMLInputElement|null;
  const rememberMe=form.elements.namedItem('rememberMe') as HTMLInputElement|null;
  if(email&&!email.value)email.value=preferences.email;
  if(rememberEmail)rememberEmail.checked=preferences.rememberEmail;
  if(rememberMe)rememberMe.checked=preferences.rememberMe;
 },[mode,requested]);
 function switchMode(next:'login'|'signup'){
  if(busyRef.current)return;
  const password=formRef.current?.elements.namedItem('password') as HTMLInputElement|null;if(password)password.value='';
  setMode(next);setMessage('');setRequested(false);setShowPassword(false);
 }
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busyRef.current||!mounted.current)return;
  const data=new FormData(event.currentTarget),rememberEmail=data.get('rememberEmail')==='on',rememberMe=data.get('rememberMe')==='on';
  const controller=new AbortController();request.current=controller;busyRef.current=true;setBusy(true);setMessage('');
  try{
   const body=mode==='signup'?{action:'signup',loginId:data.get('loginId'),password:data.get('password'),name:data.get('name'),phone:data.get('phone')}:{action:'login',loginId:data.get('email'),password:data.get('password'),rememberMe};
   const response=await fetch('/api/membership',{method:'POST',credentials:'same-origin',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   const result=await response.json() as {error?:string;message?:string};
   if(!mounted.current||controller.signal.aborted||request.current!==controller)return;
   if(!response.ok)throw Error(result.error||'요청에 실패했습니다. 잠시 후 다시 시도해주세요.');
   if(mode==='signup'){
    const password=formRef.current?.elements.namedItem('password') as HTMLInputElement|null;if(password)password.value='';
    setRequested(true);setShowPassword(false);setMessage(result.message||'관리자에게 승인 요청을 보냈습니다. 승인 후 로그인할 수 있습니다.');
   }else{saveLoginPreferences({email:String(data.get('email')??''),rememberEmail,rememberMe});window.location.assign('/');}
  }catch(error){if(mounted.current&&!controller.signal.aborted)setMessage(error instanceof Error?error.message:'요청에 실패했습니다.');}
  finally{if(request.current===controller){request.current=null;busyRef.current=false;if(mounted.current)setBusy(false);}}
 }
 const signup=mode==='signup';
 return <main className={styles.page}>
  <header className={styles.brand}><span className={styles.mark} aria-hidden="true">Y<span>+</span></span><span>YOOFAM <strong>스튜디오</strong></span></header>
  <section className={styles.card} aria-labelledby="login-title">
   <div className={styles.heading}><p className={styles.eyebrow}>로켓배송 AI 상품등록</p><h1 id="login-title">{requested?'승인 요청 완료':signup?'회원가입':'로그인'}</h1><p>{requested?'관리자가 가입 정보를 확인한 후 이용을 승인합니다.':signup?'가입 정보를 입력하고 관리자 승인을 요청하세요.':'상품 소싱부터 견적서 작성까지, 이어서 시작하세요.'}</p></div>
   {requested?<div className={styles.requested}><span aria-hidden="true" className={styles.check}>✓</span><p className={`${styles.message} ${styles.success}`} role="status">{message}</p><button type="button" className={styles.submit} onClick={()=>switchMode('login')}>로그인으로 돌아가기</button></div>:<form key={mode} ref={formRef} onSubmit={submit} className={styles.form} aria-busy={busy}>
    <div className={styles.field}><label htmlFor="login-id">아이디</label><input id="login-id" name={signup?'loginId':'email'} type="text" required minLength={signup?4:undefined} maxLength={254} autoComplete="username" placeholder={signup?'사용할 아이디를 입력하세요':'아이디 또는 기존 이메일을 입력하세요'} spellCheck={false} autoCapitalize="none" disabled={busy}/>{signup&&<small>영문 소문자·숫자·점·밑줄·하이픈, 4~64자 또는 이메일</small>}</div>
    <div className={styles.field}><label htmlFor="login-password">비밀번호</label><div className={styles.password}><input id="login-password" name="password" type={showPassword?'text':'password'} required minLength={10} maxLength={128} autoComplete={signup?'new-password':'current-password'} placeholder={signup?'10자 이상 입력하세요':'비밀번호를 입력하세요'} disabled={busy}/><button type="button" className={styles.visibility} aria-label={showPassword?'비밀번호 숨기기':'비밀번호 보기'} aria-pressed={showPassword} disabled={busy} onClick={()=>setShowPassword(!showPassword)}>{showPassword?'숨기기':'보기'}</button></div></div>
    {signup?<>
     <div className={styles.field}><label htmlFor="signup-name">이름</label><input id="signup-name" name="name" required maxLength={80} autoComplete="name" placeholder="이름을 입력하세요" disabled={busy}/></div>
     <div className={styles.field}><label htmlFor="signup-phone">휴대폰 번호</label><input id="signup-phone" name="phone" type="tel" required maxLength={20} autoComplete="tel" placeholder="010-1234-5678" disabled={busy}/></div>
    </>:<div className={styles.preferences}>
     <label><input name="rememberEmail" type="checkbox" defaultChecked disabled={busy} onChange={event=>{if(!event.target.checked){const stored=readLoginPreferences();saveLoginPreferences({...stored,email:'',rememberEmail:false});}}}/>아이디 저장</label>
     <label><input name="rememberMe" type="checkbox" defaultChecked disabled={busy}/>자동 로그인 유지 <span className={styles.duration}>30일</span></label>
    </div>}
    {message&&<p className={`${styles.message} ${styles.error}`} role="alert">{message}</p>}
    <button className={styles.submit} disabled={busy} type="submit">{busy?'처리 중…':signup?'승인 요청':'로그인'}<span aria-hidden="true">→</span></button>
   </form>}
   {!requested&&<><div className={styles.switch}><span>{signup?'이미 계정이 있나요?':'계정이 없나요?'}</span><button type="button" disabled={busy} onClick={()=>switchMode(signup?'login':'signup')}>{signup?'로그인':'회원가입'}</button></div>{!signup&&<nav className={styles.recovery} aria-label="계정 찾기"><a href="/recover?purpose=find-id">아이디 찾기</a><span aria-hidden="true">·</span><a href="/recover?purpose=reset-password">비밀번호 재설정</a></nav>}</>}
  </section>
  <footer className={styles.footer}>YOOFAM 스튜디오 <span aria-hidden="true">·</span> 상품등록 워크스페이스</footer>
 </main>;
}
