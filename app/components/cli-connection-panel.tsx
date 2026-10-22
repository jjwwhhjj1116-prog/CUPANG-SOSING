'use client';

import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {CliInstallGuide} from '@/app/components/cli-install-guide';
import {CliBrowserStatus} from '@/app/components/cli-browser-status';
import type {CliBrowserEnvironmentReport} from '@/app/cli-browser-environment';
import {CliBridgeError,createCliBridge,parseCliLink,readCliScope,sameCliScope,type CliBridgeState,type CliBridgeDiagnostic,type CliLink,type CliScope} from '@/app/cli-bridge-client';

export function CliConnectionPanel({initialScope,displayName}:{initialScope:CliScope;displayName:string}){
 const [link,setLink]=useState<CliLink|null>(null),[queryApproved,setQueryApproved]=useState(false),[state,setState]=useState<CliBridgeState>({phase:'idle',message:'CLI에서 출력한 연결 주소를 이 로그인 창에서 열어주세요.'});
 const [browserEnvironment,setBrowserEnvironment]=useState<CliBrowserEnvironmentReport|null>(null);
 const approval=useRef(false),bridge=useRef<ReturnType<typeof createCliBridge>|null>(null),mounted=useRef(false),generation=useRef(0),replacing=useRef(false);
 const pending=useRef<{epoch:number;link:CliLink|null;ready:boolean;message:string}|null>(null);
 const revoking=useRef<Promise<void>>(Promise.resolve());
 const diagnosticEnabled=useRef(false);
 useEffect(()=>{
  mounted.current=true;
  diagnosticEnabled.current=new URLSearchParams(window.location.search).get('diagnostics')==='1';
  const publish=()=>queueMicrotask(()=>{
   const next=pending.current;if(!mounted.current||!next?.ready||next.epoch!==generation.current)return;
   pending.current=null;replacing.current=false;setLink(next.link);setQueryApproved(false);setState({phase:next.link?'idle':'stopped',message:next.message});
  });
  const receive=()=>{
   const hash=window.location.hash;if(!hash)return;
   // A same-document # navigation is a new one-time link too. Scrub first,
   // revoke the previous session, and never pair the replacement automatically.
   window.history.replaceState(null,'',window.location.pathname+window.location.search);
   const epoch=++generation.current,previous=bridge.current;bridge.current=null;approval.current=false;replacing.current=true;
   let parsed:CliLink|null=null;try{parsed=parseCliLink(hash);}catch{}
   pending.current={epoch,link:parsed,ready:false,message:parsed?'일회용 연결 주소를 확인했습니다. 회사와 로컬 CLI를 확인한 뒤 연결하세요.':'CLI 연결 주소를 확인하지 못했습니다. CLI에서 새 연결 주소를 만들어주세요.'};
   queueMicrotask(()=>{if(mounted.current&&epoch===generation.current){setLink(null);setQueryApproved(false);setState({phase:'connecting',message:previous?'기존 CLI 연결을 해제하고 새 연결 주소를 준비하고 있습니다.':'새 CLI 연결 주소를 확인하고 있습니다.'});}});
   // Rapid successive links must also wait for an earlier revocation, even
   // when the prior client reference was already cleared by the first link.
   const release=Promise.all([revoking.current,(previous?.disconnect()??Promise.resolve()).catch(()=>{})]).then(()=>{});revoking.current=release;
   void release.then(()=>{const next=pending.current;if(next?.epoch!==epoch)return;next.ready=true;publish();});
  };
  const leave=()=>bridge.current?.stop('이 페이지를 닫아 CLI 연결을 종료했습니다.');
  window.addEventListener('hashchange',receive);window.addEventListener('pagehide',leave);
  receive();publish();
  return()=>{mounted.current=false;window.removeEventListener('hashchange',receive);window.removeEventListener('pagehide',leave);bridge.current?.stop();};
 },[]);
 const busy=state.phase==='connecting'||state.phase==='connected';
 const browserBlocked=browserEnvironment?.loopbackPermission==='denied'||browserEnvironment?.loopbackPolicy==='blocked'||browserEnvironment?.secureContext===false;
 async function connect(){
  if(!link||busy||replacing.current||browserBlocked)return;const epoch=generation.current;let clientStarted=false;
  setState({phase:'connecting',message:'현재 로그인 회사와 로컬 CLI를 확인하고 있습니다.'});
  try{
   const onDiagnostic=(event:CliBridgeDiagnostic)=>{if(diagnosticEnabled.current)console.info('[YOOFAM CLI]',JSON.stringify(event));};
   const actual=await readCliScope(undefined,undefined,{onDiagnostic});if(!mounted.current||epoch!==generation.current)return;
   if(!sameCliScope(actual,initialScope))throw new CliBridgeError('SCOPE_CHANGED','페이지를 연 뒤 계정 또는 회사가 바뀌었습니다. 로그인 상태를 확인하고 새 연결 주소를 열어주세요.');
   const client=createCliBridge({link,scope:actual,queryApproved:()=>approval.current,onDiagnostic,onState:value=>{if(mounted.current&&epoch===generation.current)setState(value);}});bridge.current=client;clientStarted=true;await client.start();
  }catch(error){if(!clientStarted&&mounted.current&&epoch===generation.current)setState({phase:'stopped',message:error instanceof CliBridgeError?error.message:'CLI 연결을 확인하지 못했습니다. 로컬 CLI 실행 상태와 브라우저의 로컬 네트워크 권한을 확인해주세요.'});}
 }
 function disconnect(){generation.current++;const previous=bridge.current;bridge.current=null;approval.current=false;setQueryApproved(false);setState({phase:'stopped',message:'CLI 연결을 해제했습니다. 새 연결 주소로 다시 연결해주세요.'});void previous?.disconnect();}
 return <main style={{maxWidth:880,margin:'6vh auto',padding:24}}>
  <header className="topbar"><div><p className="eyebrow">YOOFAM STUDIO</p><h1>상품조회 CLI 연결</h1><p>{displayName} · {initialScope.company.name} · {initialScope.company.code}</p></div><Link href="/" className="btn ghost">AI상품등록으로 돌아가기</Link></header>
  <section className="workspace" aria-label="로컬 CLI 연결" style={{padding:24}}>
   <h2 style={{marginTop:0,fontSize:18}}>로그인된 스튜디오와 내 컴퓨터 연결</h2>
   <p style={{fontSize:14,lineHeight:1.7}}>컴퓨터에서 YOOFAM CLI를 실행하고 출력된 연결 주소를 현재 로그인한 Chrome에서 여세요. 브라우저의 로컬 네트워크 접근 안내가 표시되면 대상이 아래 로컬 CLI인지 확인하세요.</p>
   <dl className="connection-list"><div><dt>연결 대상</dt><dd>{link?`내 컴퓨터 ${link.host??'127.0.0.1'}:${link.port}`:'CLI 연결 주소 필요'}</dd></div><div><dt>연결 회사</dt><dd>{initialScope.company.name} ({initialScope.company.code})</dd></div><div><dt>유효 시간</dt><dd>일회용 연결당 최대 15분</dd></div></dl>
   {link&&<details style={{fontSize:13,lineHeight:1.7,margin:'12px 0'}}><summary>CLI 주소 호환성 확인</summary><p>두 주소 모두 현재 컴퓨터의 같은 CLI를 가리킵니다. 연결하기 전에 주소 표기를 선택할 수 있습니다. 회사·토큰·유효 시간과 브라우저 권한 확인은 동일하게 적용됩니다.</p><button type="button" className="btn ghost" disabled={busy||state.phase==='stopped'} onClick={()=>{setLink({...link,host:link.host==='localhost'?'127.0.0.1':'localhost'});}}>{link.host==='localhost'?'127.0.0.1 주소 사용':'localhost 주소 사용'}</button></details>}
   <p style={{fontSize:13,lineHeight:1.7}}>앱 로그인 쿠키와 비밀번호는 CLI에 전달하지 않습니다. 이 연결은 상품조회와 저장된 카테고리·수집 요청 상태 조회를 지원합니다. 조회만으로 상품을 만들거나 서플라이허브로 전송하지 않습니다.</p>
   <label style={{display:'flex',gap:10,alignItems:'flex-start',fontSize:14,lineHeight:1.7,marginTop:20}}><input type="checkbox" checked={queryApproved} disabled={state.phase==='connecting'} onChange={event=>{approval.current=event.target.checked;setQueryApproved(event.target.checked);if(!event.target.checked)bridge.current?.cancelProductQuery();}}/><span><strong>상품조회 허용</strong><br/>CLI에 입력한 1688 상품 URL을 YOOFAM 상품조회 서버로 보내 원문 정보를 조회합니다. 이 선택을 해제하면 새 조회를 차단하고 진행 중인 조회도 취소합니다.</span></label>
   <div className="modal-actions"><button type="button" className="btn ghost" disabled={!busy} onClick={disconnect}>연결 해제</button><button type="button" className="btn primary" disabled={!link||busy||state.phase==='stopped'||browserBlocked} onClick={()=>{void connect();}}>{state.phase==='connected'?'연결됨':browserBlocked?'브라우저 PC 연결 설정 확인':'현재 회사로 CLI 연결'}</button></div>
   <p role="status" aria-live="polite" style={{fontSize:14,lineHeight:1.7}}>{state.message}</p>
   {state.lastResult&&<section aria-label="최근 CLI 처리 결과" style={{borderTop:'1px solid #e7eaf0',paddingTop:14}}><h3 style={{fontSize:14}}>최근 조회 결과</h3>{state.lastResult.title&&<p>{state.lastResult.title}</p>}{state.lastResult.optionCount!==undefined&&<p>원문 옵션 {state.lastResult.optionCount}개</p>}{state.lastResult.provider&&<p>조회 서버: {state.lastResult.provider} · {state.lastResult.configured?'구성됨':'설정 필요'} · 실상품 수집 검증 전</p>}<p>수집함 미저장 · 상품 초안 미생성</p></section>}
  </section>
  <CliBrowserStatus onChange={setBrowserEnvironment}/>
  <CliInstallGuide/>
 </main>;
}
