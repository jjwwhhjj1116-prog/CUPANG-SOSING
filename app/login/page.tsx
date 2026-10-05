'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {readLoginPreferences,saveLoginPreferences} from '@/app/login-preferences';
import styles from './page.module.css';
export default function LoginPage(){
 const [signup,setSignup]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [success,setSuccess]=useState(false),[showPassword,setShowPassword]=useState(false);
 const formRef=useRef<HTMLFormElement>(null),busyRef=useRef(false);
 useEffect(()=>{
  const form=formRef.current;if(!form)return;
  const preferences=readLoginPreferences();
  const email=form.elements.namedItem('email') as HTMLInputElement|null;
  const rememberEmail=form.elements.namedItem('rememberEmail') as HTMLInputElement|null;
  const rememberMe=form.elements.namedItem('rememberMe') as HTMLInputElement|null;
  if(email&&!email.value)email.value=preferences.email;
  if(rememberEmail)rememberEmail.checked=preferences.rememberEmail;
  if(rememberMe)rememberMe.checked=preferences.rememberMe;
 },[signup]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busyRef.current)return;
  const data=new FormData(event.currentTarget),rememberEmail=data.get('rememberEmail')==='on',rememberMe=data.get('rememberMe')==='on';
  busyRef.current=true;setBusy(true);setMessage('');setSuccess(false);
  try{
   const response=await fetch('/api/membership',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:signup?'signup':'login',email:data.get('email'),password:data.get('password'),rememberMe,companyCode:data.get('companyCode'),companyName:data.get('companyName')})});
   const body=await response.json() as {error?:string;message?:string};
   if(!response.ok)throw Error(body.error||'요청에 실패했습니다. 잠시 후 다시 시도해주세요.');
   if(signup){setSuccess(true);setMessage(body.message??'가입 요청을 접수했습니다. 관리자 승인 후 로그인할 수 있습니다.');}
   else {saveLoginPreferences({email:String(data.get('email')??''),rememberEmail,rememberMe});window.location.assign('/');}
  }catch(error){setMessage(error instanceof Error?error.message:'요청에 실패했습니다.');}
  finally{busyRef.current=false;setBusy(false);}
 }
 return <main className={styles.page}>
  <header className={styles.brand}><span className={styles.mark} aria-hidden="true">Y<span>+</span></span><span>YOOFAM <strong>PLUS</strong></span></header>
  <section className={styles.card} aria-labelledby="login-title">
   <div className={styles.heading}><p className={styles.eyebrow}>로켓배송 AI 상품등록</p><h1 id="login-title">{signup?'회원가입 요청':'로그인'}</h1><p>{signup?'회사정보를 입력하면 관리자에게 가입 요청이 전달됩니다.':'상품 소싱부터 견적서 작성까지, 이어서 시작하세요.'}</p></div>
   <form ref={formRef} onSubmit={submit} className={styles.form} aria-busy={busy}>
    <div className={styles.field}><label htmlFor="login-email">이메일</label><input id="login-email" name="email" type="email" required autoComplete="username" placeholder="이메일 주소를 입력하세요" spellCheck={false} autoCapitalize="none" disabled={busy}/></div>
    <div className={styles.field}><label htmlFor="login-password">비밀번호</label><div className={styles.password}><input id="login-password" name="password" type={showPassword?'text':'password'} required minLength={10} maxLength={128} autoComplete={signup?'new-password':'current-password'} placeholder={signup?'10자 이상 입력하세요':'비밀번호를 입력하세요'} disabled={busy}/><button type="button" className={styles.visibility} aria-label={showPassword?'비밀번호 숨기기':'비밀번호 보기'} aria-pressed={showPassword} disabled={busy} onClick={()=>setShowPassword(!showPassword)}>{showPassword?'숨기기':'보기'}</button></div></div>
    {signup?<>
     <div className={styles.field}><label htmlFor="signup-company-code">Supplier Hub 회사코드</label><input id="signup-company-code" name="companyCode" required maxLength={200} placeholder="예: A01234567" disabled={busy} autoCapitalize="characters"/></div>
     <div className={styles.field}><label htmlFor="signup-company-name">회사명</label><input id="signup-company-name" name="companyName" required maxLength={200} autoComplete="organization" placeholder="Supplier Hub에 등록된 회사명" disabled={busy}/></div>
     <p className={styles.hint}>회사코드와 회사명을 확인하여 승인한 계정만 이용할 수 있습니다.</p>
    </>:<div className={styles.preferences}>
     <label><input name="rememberEmail" type="checkbox" defaultChecked disabled={busy} onChange={event=>{if(!event.target.checked){const stored=readLoginPreferences();saveLoginPreferences({...stored,email:'',rememberEmail:false});}}}/>아이디 저장</label>
     <label><input name="rememberMe" type="checkbox" defaultChecked disabled={busy}/>자동 로그인 유지 <span className={styles.duration}>30일</span></label>
    </div>}
    {message&&<p className={`${styles.message} ${success?styles.success:styles.error}`} role={success?'status':'alert'}>{message}</p>}
    <button className={styles.submit} disabled={busy||success} type="submit">{busy?'처리 중…':signup?'회원가입 요청':'로그인'}<span aria-hidden="true">→</span></button>
   </form>
   <div className={styles.switch}><span>{signup?'이미 계정이 있으신가요?':'아직 계정이 없으신가요?'}</span><button type="button" disabled={busy} onClick={()=>{setSignup(!signup);setMessage('');setSuccess(false);setShowPassword(false);}}>{signup?'로그인':'회원가입 요청'}</button></div>
  </section>
  <footer className={styles.footer}>YOOFAM PLUS <span aria-hidden="true">·</span> 상품등록 워크스페이스</footer>
 </main>;
}
