'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import './account-security-panel.css';

type Profile={name:string;phoneNumber:string|null;phoneVerifiedAt:string|null};
type View={profile:Profile;smsConfigured:boolean};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function profile(value:unknown):Profile{
 if(!object(value)||typeof value.name!=='string'||value.name.length>80||(value.phoneNumber!==null&&typeof value.phoneNumber!=='string')||(value.phoneVerifiedAt!==null&&(typeof value.phoneVerifiedAt!=='string'||!Number.isFinite(Date.parse(value.phoneVerifiedAt)))))throw Error('계정 정보를 확인하지 못했습니다.');
 return{name:value.name,phoneNumber:value.phoneNumber as string|null,phoneVerifiedAt:value.phoneVerifiedAt as string|null};
}
class SecurityFailure extends Error{constructor(message:string,readonly uncertain=false){super(message);}}
async function responseBody(response:Response,ownerId:string){
 if(response.redirected||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new SecurityFailure('처리 결과를 확인하지 못했습니다. 계정 정보를 새로고침해주세요.',true);
 let body:unknown;try{body=await response.json();}catch{throw new SecurityFailure('처리 결과를 확인하지 못했습니다. 계정 정보를 새로고침해주세요.',true);}
 if(!response.ok){
  if(response.status===401)throw new SecurityFailure('로그인 상태 또는 현재 비밀번호를 확인해주세요.');
  if(response.status===403)throw new SecurityFailure('현재 비밀번호와 계정 권한을 확인해주세요.');
  if(response.status===429)throw new SecurityFailure('요청이 많습니다. 잠시 후 다시 시도해주세요.');
  if(response.status===409)throw new SecurityFailure('계정 정보가 변경되었거나 인증이 만료되었습니다. 계정 정보를 새로고침해주세요.');
  if(response.status===503)throw new SecurityFailure('서버 또는 문자 인증 설정을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
  throw new SecurityFailure('입력값과 인증번호를 확인해주세요.');
 }
 if(!object(body)||(body.ownerId!==undefined&&body.ownerId!==ownerId))throw new SecurityFailure('로그인 계정이 변경되었습니다. 계정 정보를 새로고침해주세요.',true);
 return body;
}

export function AccountSecurityPanel({ownerId,isAdmin=false}:{ownerId:string;isAdmin?:boolean}){
 return <AccountSecurityScope key={JSON.stringify([ownerId,isAdmin])} ownerId={ownerId} isAdmin={isAdmin}/>;
}
function AccountSecurityScope({ownerId,isAdmin}:{ownerId:string;isAdmin:boolean}){
 const [view,setView]=useState<View|null>(null),[name,setName]=useState(''),[phone,setPhone]=useState(''),[busy,setBusy]=useState(true),[uncertain,setUncertain]=useState(false),[reauthenticating,setReauthenticating]=useState(false),[verification,setVerification]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const mounted=useRef(false),request=useRef<AbortController|null>(null),challenge=useRef(''),currentView=useRef<View|null>(null),blocked=useRef(false);
 const enrollmentPassword=useRef<HTMLInputElement|null>(null),code=useRef<HTMLInputElement|null>(null);
 const bindEnrollmentPassword=useCallback((node:HTMLInputElement|null)=>{if(enrollmentPassword.current&&enrollmentPassword.current!==node)enrollmentPassword.current.value='';enrollmentPassword.current=node;},[]);
 const bindCode=useCallback((node:HTMLInputElement|null)=>{if(code.current&&code.current!==node)code.current.value='';code.current=node;},[]);
 const clearSecrets=()=>{for(const field of [enrollmentPassword,code])if(field.current)field.current.value='';};
 const active=(controller:AbortController)=>mounted.current&&request.current===controller&&!controller.signal.aborted;
 function begin(){if(!mounted.current||request.current)return null;const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');return controller;}
 function finish(controller:AbortController){if(request.current===controller){request.current=null;if(mounted.current)setBusy(false);}}
 function adopt(saved:Profile,smsConfigured=currentView.current?.smsConfigured??false){const next={profile:saved,smsConfigured};currentView.current=next;setView(next);setName(saved.name);setPhone(saved.phoneNumber??'');}
 async function load(controller:AbortController){
  try{
   const body=await responseBody(await fetch('/api/account-security',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal}),ownerId);
   const saved=profile(body.profile);if(body.ownerId!==ownerId||typeof body.smsConfigured!=='boolean')throw Error();
   if(!active(controller))return;adopt(saved,body.smsConfigured);challenge.current='';setVerification(false);blocked.current=false;setUncertain(false);clearSecrets();
  }catch(cause){if(active(controller))setError(cause instanceof SecurityFailure?cause.message:'계정 정보를 불러오지 못했습니다. 다시 새로고침해주세요.');}
  finally{finish(controller);}
 }
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();request.current=controller;void Promise.resolve().then(()=>{if(active(controller))void load(controller);});
  return()=>{mounted.current=false;request.current?.abort();request.current=null;challenge.current='';currentView.current=null;clearSecrets();};
 // Each owner mounts a separate scope. An ordinary render must not reload it.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ownerId]);
 function reload(){const controller=begin();if(controller)void load(controller);}
 async function write(body:Record<string,unknown>,complete:(saved:Record<string,unknown>)=>void){
  if(blocked.current||!currentView.current)return;const controller=begin();if(!controller)return;clearSecrets();
  try{
   const saved=await responseBody(await fetch('/api/account-security',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({...body,expectedOwnerId:ownerId})}),ownerId);
   if(active(controller))complete(saved);
  }catch(cause){if(active(controller)){if(!(cause instanceof SecurityFailure)||cause.uncertain){blocked.current=true;setUncertain(true);}setError(cause instanceof SecurityFailure?cause.message:'처리 결과를 확인하지 못했습니다. 계정 정보를 새로고침해주세요.');}}
  finally{finish(controller);}
 }
 function saveName(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!mounted.current||request.current||blocked.current)return;const value=name.trim();if(!value||value.length>80){setError('이름을 80자 이내로 입력해주세요.');return;}
  void write({action:'update-profile',name:value},saved=>{adopt(profile(saved.profile));setMessage('이름을 저장했습니다.');window.dispatchEvent(new Event('membership-updated'));});
 }
 function startPhone(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!mounted.current||request.current||blocked.current)return;
  if(!currentView.current?.smsConfigured){setError('문자 인증 서비스가 아직 설정되지 않았습니다. 관리자 설정 후 이용할 수 있습니다.');return;}
  const value=phone.trim(),password=enrollmentPassword.current?.value??'';
  if(!value||value.length>20||!/^[+\d\s()-]+$/u.test(value)||password.length<10||password.length>128){setError('휴대전화와 현재 비밀번호를 확인해주세요.');return;}
  void write({action:'phone-start',phone:value,currentPassword:password},saved=>{if(typeof saved.challengeId!=='string'||!saved.challengeId||saved.challengeId.length>256)throw Error();challenge.current=saved.challengeId;setVerification(true);setMessage('입력한 휴대전화로 보낸 인증번호를 5분 안에 입력해주세요.');});
 }
 function verifyPhone(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!mounted.current||request.current||blocked.current||!challenge.current)return;const value=code.current?.value??'';if(!/^\d{6}$/u.test(value)){setError('6자리 인증번호를 입력해주세요.');return;}
  void write({action:'phone-verify',challengeId:challenge.current,code:value},saved=>{
   adopt(profile(saved.profile));challenge.current='';setVerification(false);
   if(saved.reauthenticate===true){blocked.current=true;setReauthenticating(true);setMessage('휴대전화 인증을 마쳤습니다. 계정 보호를 위해 다시 로그인해주세요.');window.dispatchEvent(new Event('membership-session-changed'));window.location.assign('/login');}
   else{setMessage('휴대전화 인증을 마쳤습니다. 아이디 찾기와 비밀번호 재설정에 사용할 수 있습니다.');window.dispatchEvent(new Event('membership-updated'));}
  });
 }
 const disabled=busy||uncertain||reauthenticating||!view;
 return <section className="membership-card account-security" aria-labelledby="account-security-heading" aria-busy={busy}>
  <div className="membership-header"><h2 id="account-security-heading">내 정보와 계정 보안</h2><button type="button" className="btn ghost" disabled={busy} onClick={reload}>계정 정보 새로고침</button></div>
  {busy&&<p role="status">계정 정보를 확인하고 있습니다.</p>}{error&&<p className="account-security-error" role="alert">{error}</p>}{message&&<p className="account-security-success" role="status">{message}</p>}
  {uncertain&&<p>처리 결과를 먼저 확인해주세요. 새로고침하면 계정의 최신 정보를 불러옵니다.</p>}
  {view&&<>
   <form className="account-security-form" aria-label="이름 변경" onSubmit={saveName}>
    <label>이름<input name="profileName" value={name} maxLength={80} required autoComplete="name" disabled={disabled} onChange={event=>{if(!request.current&&!blocked.current)setName(event.target.value);}}/></label>
    <button type="submit" className="btn primary" disabled={disabled}>이름 저장</button>
   </form>
   <div className="account-security-divider"><h3>휴대전화 인증</h3><p>인증한 휴대전화로 아이디를 찾거나 비밀번호를 재설정할 수 있습니다.</p><p className="account-security-phone">{view.profile.phoneNumber||'등록된 휴대전화 없음'} <span>{view.profile.phoneVerifiedAt?'인증 완료':'미인증'}</span></p></div>
   {!view.smsConfigured&&<p className="account-security-notice" role="status">문자 인증 서비스가 아직 설정되지 않았습니다. 관리자 설정 후 휴대전화 인증과 계정 찾기를 이용할 수 있습니다.</p>}
   <form className="account-security-form" aria-label="휴대전화 인증 요청" autoComplete="off" onSubmit={startPhone}>
    <label>휴대전화<input name="enrollmentPhone" type="tel" inputMode="tel" value={phone} maxLength={20} required autoComplete="tel" placeholder="010-1234-5678" disabled={disabled||verification||!view.smsConfigured} onChange={event=>{if(!request.current&&!blocked.current&&!challenge.current)setPhone(event.target.value);}}/></label>
    <label>현재 비밀번호<input name="enrollmentPassword" ref={bindEnrollmentPassword} type="password" minLength={10} maxLength={128} required autoComplete="current-password" disabled={disabled||verification||!view.smsConfigured}/></label>
    <button type="submit" className="btn primary" disabled={disabled||verification||!view.smsConfigured}>인증번호 받기</button>
   </form>
   {verification&&<form className="account-security-form account-security-verification" aria-label="휴대전화 인증번호 확인" autoComplete="off" onSubmit={verifyPhone}>
    <label>인증번호<input name="phoneCode" ref={bindCode} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoComplete="one-time-code" disabled={disabled}/></label>
    <button type="submit" className="btn primary" disabled={disabled}>휴대전화 인증</button><button type="button" className="btn ghost" disabled={disabled} onClick={()=>{if(request.current||blocked.current)return;challenge.current='';clearSecrets();setVerification(false);setMessage('휴대전화 인증 요청을 다시 입력할 수 있습니다.');}}>다시 입력</button>
   </form>}
  </>}
  {isAdmin&&<AdminSmsSettingsPanel ownerId={ownerId} onSaved={reload}/>}
 </section>;
}

type SmsSettings={configured:boolean;sender:string|null;apiKeyHint:string|null};
export function AdminSmsSettingsPanel({ownerId,onSaved}:{ownerId:string;onSaved?:()=>void}){
 return <AdminSmsSettingsScope key={ownerId} ownerId={ownerId} onSaved={onSaved}/>;
}
function AdminSmsSettingsScope({ownerId,onSaved}:{ownerId:string;onSaved?:()=>void}){
 const [settings,setSettings]=useState<SmsSettings|null>(null),[sender,setSender]=useState(''),[busy,setBusy]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const mounted=useRef(false),request=useRef<AbortController|null>(null),blocked=useRef(false);
 const password=useRef<HTMLInputElement|null>(null),apiKey=useRef<HTMLInputElement|null>(null),apiSecret=useRef<HTMLInputElement|null>(null);
 const bindPassword=useCallback((node:HTMLInputElement|null)=>{if(password.current&&password.current!==node)password.current.value='';password.current=node;},[]);
 const bindApiKey=useCallback((node:HTMLInputElement|null)=>{if(apiKey.current&&apiKey.current!==node)apiKey.current.value='';apiKey.current=node;},[]);
 const bindApiSecret=useCallback((node:HTMLInputElement|null)=>{if(apiSecret.current&&apiSecret.current!==node)apiSecret.current.value='';apiSecret.current=node;},[]);
 const clearSecrets=()=>{for(const field of [password,apiKey,apiSecret])if(field.current)field.current.value='';};
 const active=(controller:AbortController)=>mounted.current&&request.current===controller&&!controller.signal.aborted;
 function begin(){if(!mounted.current||request.current)return null;const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');return controller;}
 function finish(controller:AbortController){if(request.current===controller){request.current=null;if(mounted.current)setBusy(false);}}
 async function load(controller:AbortController){
  try{
   const body=await responseBody(await fetch('/api/admin/sms-settings',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal}),ownerId);
   if(body.ownerId!==ownerId||typeof body.configured!=='boolean'||(body.sender!==null&&typeof body.sender!=='string')||(body.apiKeyHint!==null&&typeof body.apiKeyHint!=='string'))throw Error();
   if(!active(controller))return;const next={configured:body.configured,sender:body.sender as string|null,apiKeyHint:body.apiKeyHint as string|null};setSettings(next);setSender(next.sender??'');clearSecrets();blocked.current=false;setUncertain(false);
  }catch(cause){if(active(controller))setError(cause instanceof SecurityFailure?cause.message:'문자 인증 설정을 불러오지 못했습니다.');}
  finally{finish(controller);}
 }
 useEffect(()=>{mounted.current=true;const controller=new AbortController();request.current=controller;void Promise.resolve().then(()=>{if(active(controller))void load(controller);});return()=>{mounted.current=false;request.current?.abort();request.current=null;clearSecrets();};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ownerId]);
 function reload(){const controller=begin();if(controller)void load(controller);}
 function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!mounted.current||request.current||blocked.current||!settings)return;
  const currentPassword=password.current?.value??'',key=apiKey.current?.value.trim()??'',secret=apiSecret.current?.value.trim()??'',number=sender.trim();
  if(currentPassword.length<10||currentPassword.length>128||!/^[A-Za-z0-9_-]{8,128}$/u.test(key)||!/^[A-Za-z0-9_-]{8,256}$/u.test(secret)||number.length>25||!/^\d{8,12}$/u.test(number.replace(/[ -]/gu,''))){setError('현재 비밀번호, SOLAPI API Key·Secret와 등록된 발신번호를 확인해주세요.');return;}
  const controller=begin();if(!controller)return;clearSecrets();
  void (async()=>{
   try{
    const body=await responseBody(await fetch('/api/admin/sms-settings',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:ownerId,currentPassword,apiKey:key,apiSecret:secret,sender:number})}),ownerId);
    if(!active(controller))return;if(body.ok!==true||typeof body.configured!=='boolean'||(body.sender!==null&&typeof body.sender!=='string')||(body.apiKeyHint!==null&&typeof body.apiKeyHint!=='string'))throw Error();
    setMessage('문자 인증 설정을 저장했습니다. 내 휴대전화 인증에서 실제 문자 수신을 확인해주세요.');setSettings({configured:body.configured,sender:body.sender as string|null,apiKeyHint:body.apiKeyHint as string|null});onSaved?.();
   }catch(cause){if(active(controller)){if(!(cause instanceof SecurityFailure)||cause.uncertain){blocked.current=true;setUncertain(true);}setError(cause instanceof SecurityFailure?cause.message:'저장 결과를 확인하지 못했습니다. 설정을 새로고침해주세요.');}}
   finally{finish(controller);}
  })();
 }
 const disabled=busy||uncertain||!settings;
 return <section className="account-security-divider account-sms-settings" aria-label="관리자 문자 인증 설정" aria-busy={busy}>
  <div className="membership-header"><h3>관리자 문자 인증 설정</h3><button type="button" className="btn ghost" disabled={busy} onClick={reload}>문자 설정 새로고침</button></div>
  <p>SOLAPI에서 발신번호를 등록하고 API Key와 Secret를 발급한 뒤 입력해주세요. 문자 발송에는 SOLAPI 이용료가 적용됩니다. <a href="https://console.solapi.com" target="_blank" rel="noreferrer">SOLAPI 콘솔 열기 ↗</a></p>
  {settings&&<p>현재 상태: <strong>{settings.configured?'설정됨':'미설정'}</strong>{settings.sender&&<> · 발신번호 {settings.sender}</>}{settings.apiKeyHint&&<> · API Key {settings.apiKeyHint}</>}</p>}
  {busy&&<p role="status">문자 설정을 확인하고 있습니다.</p>}{error&&<p className="account-security-error" role="alert">{error}</p>}{message&&<p className="account-security-success" role="status">{message}</p>}{uncertain&&<p>저장 결과를 먼저 새로고침으로 확인해주세요.</p>}
  {settings&&<form className="account-security-form account-sms-form" aria-label="SOLAPI 설정 저장" autoComplete="off" onSubmit={save}>
   <label>현재 비밀번호<input name="smsCurrentPassword" ref={bindPassword} type="password" required minLength={10} maxLength={128} autoComplete="current-password" disabled={disabled}/></label>
   <label>SOLAPI API Key<input name="smsApiKey" ref={bindApiKey} type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={disabled}/></label>
   <label>SOLAPI API Secret<input name="smsApiSecret" ref={bindApiSecret} type="password" required minLength={8} maxLength={256} autoComplete="new-password" disabled={disabled}/></label>
   <label>등록된 발신번호<input name="smsSender" type="tel" inputMode="tel" required maxLength={25} value={sender} placeholder="SOLAPI에 등록한 번호" disabled={disabled} onChange={event=>{if(!request.current&&!blocked.current)setSender(event.target.value);}}/></label>
   <button type="submit" className="btn primary" disabled={disabled}>문자 인증 설정 저장</button>
   <small>보안 키는 저장 후 다시 표시하지 않습니다. 설정을 변경하려면 API Key와 Secret를 다시 입력해주세요.</small>
  </form>}
 </section>;
}
