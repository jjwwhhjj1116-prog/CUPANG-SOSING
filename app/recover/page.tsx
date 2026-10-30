'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import styles from './page.module.css';

type Purpose='find-id'|'reset-password';
type Stage='start'|'verify'|'reset'|'found'|'done';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
class RecoveryFailure extends Error{}
async function responseBody(response:Response){
 if(response.redirected||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new RecoveryFailure('처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
 let body:unknown;try{body=await response.json();}catch{throw new RecoveryFailure('처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');}
 if(!response.ok){
  if(response.status===503)throw new RecoveryFailure('문자 인증 서비스가 아직 준비되지 않았습니다. 관리자에게 문의해주세요.');
  if(response.status===429)throw new RecoveryFailure('요청이 많습니다. 잠시 후 다시 시도해주세요.');
  if(response.status===409||response.status===410)throw new RecoveryFailure('인증이 만료되었거나 이미 사용되었습니다. 처음부터 다시 진행해주세요.');
  throw new RecoveryFailure('입력한 정보와 인증번호를 확인해주세요.');
 }
 if(!object(body))throw new RecoveryFailure('인증 응답을 확인하지 못했습니다. 처음부터 다시 진행해주세요.');
 return body;
}

export default function RecoverPage(){
 const [purpose,setPurpose]=useState<Purpose>('find-id'),[stage,setStage]=useState<Stage>('start'),[name,setName]=useState(''),[phone,setPhone]=useState(''),[loginId,setLoginId]=useState(''),[foundId,setFoundId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const mounted=useRef(false),request=useRef<AbortController|null>(null),challenge=useRef(''),resetToken=useRef(''),currentPurpose=useRef<Purpose>('find-id'),currentStage=useRef<Stage>('start');
 const code=useRef<HTMLInputElement|null>(null),password=useRef<HTMLInputElement|null>(null),confirmation=useRef<HTMLInputElement|null>(null);
 const bindCode=useCallback((node:HTMLInputElement|null)=>{if(code.current&&code.current!==node)code.current.value='';code.current=node;},[]);
 const bindPassword=useCallback((node:HTMLInputElement|null)=>{if(password.current&&password.current!==node)password.current.value='';password.current=node;},[]);
 const bindConfirmation=useCallback((node:HTMLInputElement|null)=>{if(confirmation.current&&confirmation.current!==node)confirmation.current.value='';confirmation.current=node;},[]);
 const clearSecrets=()=>{for(const field of [code,password,confirmation])if(field.current)field.current.value='';};
 useEffect(()=>{
  mounted.current=true;
  const query=new URLSearchParams(window.location.search);
  if(query.getAll('purpose').length===1&&query.get('purpose')==='reset-password'){
   currentPurpose.current='reset-password';
   // Read the browser URL after hydration while keeping the server's initial render stable.
   // eslint-disable-next-line react-hooks/set-state-in-effect
   setPurpose('reset-password');
  }
  return()=>{mounted.current=false;request.current?.abort();request.current=null;challenge.current='';resetToken.current='';for(const field of [code,password,confirmation])if(field.current)field.current.value='';};
 },[]);
 function reset(next:Purpose=purpose){
  if(!mounted.current)return;request.current?.abort();request.current=null;challenge.current='';resetToken.current='';clearSecrets();currentPurpose.current=next;currentStage.current='start';setPurpose(next);setStage('start');setFoundId('');setBusy(false);setMessage('');setError('');
 }
 function begin(expected:Stage){if(!mounted.current||request.current||currentStage.current!==expected)return null;const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');return controller;}
 const active=(controller:AbortController)=>mounted.current&&request.current===controller&&!controller.signal.aborted;
 function advance(next:Stage){currentStage.current=next;setStage(next);}
 async function send(controller:AbortController,body:Record<string,unknown>,complete:(saved:Record<string,unknown>)=>void){
  clearSecrets();
  try{const saved=await responseBody(await fetch('/api/account-recovery',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify(body)}));if(active(controller))complete(saved);}
  catch(cause){if(active(controller))setError(cause instanceof RecoveryFailure?cause.message:'처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');}
  finally{if(request.current===controller){request.current=null;if(mounted.current)setBusy(false);}}
 }
 function start(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!mounted.current||request.current||currentStage.current!=='start')return;
  const enteredName=name.trim(),enteredPhone=phone.trim(),enteredId=loginId.trim();
  if(!enteredName||enteredName.length>80||!enteredPhone||enteredPhone.length>20||!/^[+\d\s()-]+$/u.test(enteredPhone)||currentPurpose.current==='reset-password'&&(!enteredId||enteredId.length>254)){setError('이름·휴대전화와 아이디를 확인해주세요.');return;}
  const controller=begin('start');if(!controller)return;
  void send(controller,{action:'start',purpose:currentPurpose.current,name:enteredName,phone:enteredPhone,...(currentPurpose.current==='reset-password'?{loginId:enteredId}:{})},saved=>{
   if(typeof saved.challengeId!=='string'||!saved.challengeId||saved.challengeId.length>256)throw new RecoveryFailure('인증 요청을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
   challenge.current=saved.challengeId;advance('verify');setMessage('입력한 정보가 등록된 인증 정보와 일치하면 문자로 인증번호를 보냅니다. 5분 안에 입력해주세요.');
  });
 }
 function verify(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!mounted.current||request.current||currentStage.current!=='verify'||!challenge.current)return;const value=code.current?.value??'';if(!/^\d{6}$/u.test(value)){setError('6자리 인증번호를 입력해주세요.');return;}
  const controller=begin('verify');if(!controller)return;
  void send(controller,{action:'verify',challengeId:challenge.current,code:value},saved=>{
   if(currentPurpose.current==='find-id'){
    if(typeof saved.loginId!=='string'||!saved.loginId||saved.loginId.length>254)throw new RecoveryFailure('아이디를 확인하지 못했습니다. 처음부터 다시 진행해주세요.');
    challenge.current='';setFoundId(saved.loginId);advance('found');setMessage('휴대전화 인증을 마쳤습니다.');
   }else{
    if(typeof saved.resetToken!=='string'||!saved.resetToken||saved.resetToken.length>512)throw new RecoveryFailure('비밀번호 재설정 인증을 확인하지 못했습니다. 처음부터 다시 진행해주세요.');
    challenge.current='';resetToken.current=saved.resetToken;advance('reset');setMessage('새 비밀번호를 입력해주세요.');
   }
  });
 }
 function changePassword(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!mounted.current||request.current||currentStage.current!=='reset'||!resetToken.current)return;const next=password.current?.value??'',confirm=confirmation.current?.value??'';
  if(next.length<10||next.length>128||next!==confirm){setError('새 비밀번호는 10~128자로 입력하고 확인란과 같아야 합니다.');return;}
  const controller=begin('reset');if(!controller)return;
  void send(controller,{action:'reset',resetToken:resetToken.current,newPassword:next},saved=>{if(saved.ok!==true)throw new RecoveryFailure('비밀번호 변경 결과를 확인하지 못했습니다.');resetToken.current='';advance('done');setMessage('비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.');});
 }
 return <main className={styles.page}>
  <Link href="/login" className={styles.brand}>YOOFAM <strong>스튜디오</strong></Link>
  <section className={styles.card} aria-labelledby="recover-heading" aria-busy={busy}>
   <p className={styles.eyebrow}>계정 찾기</p><h1 id="recover-heading">다시 이어서 시작하세요</h1><p className={styles.description}>미리 인증한 휴대전화로 아이디를 찾거나 비밀번호를 재설정합니다.</p>
   <div className={styles.tabs} role="group" aria-label="계정 찾기 방법"><button type="button" aria-pressed={purpose==='find-id'} onClick={()=>reset('find-id')}>아이디 찾기</button><button type="button" aria-pressed={purpose==='reset-password'} onClick={()=>reset('reset-password')}>비밀번호 재설정</button></div>
   {stage==='start'&&<form className={styles.form} aria-label="계정 인증 요청" onSubmit={start}>
    {purpose==='reset-password'&&<label>아이디<input name="recoveryLoginId" value={loginId} maxLength={254} required autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} onChange={event=>{if(!request.current)setLoginId(event.target.value);}}/></label>}
    <label>이름<input name="recoveryName" value={name} maxLength={80} required autoComplete="name" disabled={busy} onChange={event=>{if(!request.current)setName(event.target.value);}}/></label>
    <label>인증한 휴대전화<input name="recoveryPhone" type="tel" inputMode="tel" value={phone} maxLength={20} required autoComplete="tel" placeholder="010-1234-5678" disabled={busy} onChange={event=>{if(!request.current)setPhone(event.target.value);}}/></label>
    <button type="submit" className={styles.primary} disabled={busy}>{busy?'요청 중…':'인증번호 받기'}</button>
   </form>}
   {stage==='verify'&&<form className={styles.form} aria-label="계정 인증번호 확인" autoComplete="off" onSubmit={verify}>
    <label>인증번호<input name="recoveryCode" ref={bindCode} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoComplete="one-time-code" disabled={busy}/></label>
    <button type="submit" className={styles.primary} disabled={busy}>{busy?'확인 중…':'인증번호 확인'}</button>
    <button type="button" className={styles.secondary} onClick={()=>reset()}>처음부터 다시 입력</button>
   </form>}
   {stage==='reset'&&<form className={styles.form} aria-label="새 비밀번호 설정" autoComplete="off" onSubmit={changePassword}>
    <label>새 비밀번호<input name="recoveryPassword" ref={bindPassword} type="password" minLength={10} maxLength={128} required autoComplete="new-password" disabled={busy}/></label>
    <label>새 비밀번호 확인<input name="recoveryConfirmation" ref={bindConfirmation} type="password" minLength={10} maxLength={128} required autoComplete="new-password" disabled={busy}/></label>
    <button type="submit" className={styles.primary} disabled={busy}>{busy?'변경 중…':'비밀번호 재설정'}</button>
    <button type="button" className={styles.secondary} onClick={()=>reset()}>처음부터 다시 입력</button>
   </form>}
   {stage==='found'&&<div className={styles.result}><p>가입한 아이디</p><strong>{foundId}</strong><Link href="/login" className={styles.primary}>로그인하러 가기</Link></div>}
   {stage==='done'&&<div className={styles.result}><Link href="/login" className={styles.primary}>로그인하러 가기</Link></div>}
   {error&&<p className={styles.error} role="alert">{error}</p>}{message&&<p className={styles.message} role="status">{message}</p>}
   <p className={styles.help}>인증한 번호를 사용할 수 없다면 관리자에게 계정 확인을 요청해주세요.</p><Link href="/login" className={styles.back}>로그인으로 돌아가기</Link>
  </section>
 </main>;
}
