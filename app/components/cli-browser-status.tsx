'use client';

import {useEffect,useRef,useState} from 'react';
import {readCliBrowserEnvironment,type CliBrowserEnvironmentReport} from '@/app/cli-browser-environment';

const permissionLabels:Record<CliBrowserEnvironmentReport['loopbackPermission'],string>={
 granted:'허용됨',prompt:'연결할 때 확인 필요',denied:'차단됨',unsupported:'이 브라우저에서 상태 조회 미지원',unavailable:'상태를 확인하지 못함',timeout:'상태 조회 시간 초과',
};

/** Reading current permission state never requests a grant or contacts the CLI. */
export function CliBrowserStatus({onChange}:{onChange?:(value:CliBrowserEnvironmentReport)=>void}={}){
 const [environment,setEnvironment]=useState<CliBrowserEnvironmentReport|null>(null),[checking,setChecking]=useState(false);
 const alive=useRef(false),generation=useRef(0);
 useEffect(()=>{
  alive.current=true;const epoch=++generation.current;
  void readCliBrowserEnvironment().then(value=>{if(alive.current&&epoch===generation.current){setEnvironment(value);onChange?.(value);}});
  return()=>{alive.current=false;};
 },[onChange]);
 async function refresh(){
  if(checking)return;const epoch=++generation.current;setChecking(true);
  try{const value=await readCliBrowserEnvironment();if(alive.current&&epoch===generation.current){setEnvironment(value);onChange?.(value);}}
  finally{if(alive.current&&epoch===generation.current)setChecking(false);}
 }
 return <section aria-label="브라우저 PC 연결 확인" style={{borderTop:'1px solid #e7eaf0',marginTop:20,paddingTop:16,fontSize:14,lineHeight:1.7}}>
  <h3 style={{fontSize:15,margin:'0 0 8px'}}>브라우저 PC 연결 확인</h3>
  <p role="status">PC 연결 권한: <strong>{environment?permissionLabels[environment.loopbackPermission]:'확인 중'}</strong></p>
  {environment&&!environment.secureContext&&<p>이 페이지가 안전한 연결로 열리지 않았습니다. YOOFAM 스튜디오의 HTTPS 주소에서 연결해주세요.</p>}
  {environment?.loopbackPolicy==='blocked'&&<p>현재 페이지의 문서 정책이 PC 연결을 허용하지 않습니다. 이는 Chrome 사이트 설정의 사용자 권한과 별개이므로, 설정을 반복해서 바꾸는 것으로 해결되지 않을 수 있습니다.</p>}
  {environment?.loopbackPermission==='denied'&&environment.loopbackPolicy!=='blocked'&&<p>브라우저가 이 페이지의 PC 연결 권한을 ‘차단됨’으로 반환했습니다. 이 결과만으로 사용자가 차단했는지, 브라우저 정책이 적용됐는지는 알 수 없습니다. Chrome에서는 이 권한이 ‘이 기기의 앱·서비스 접근’처럼 표시될 수 있습니다. 해당 항목이 없으면 같은 설정 변경을 반복하지 말고 아래 연결 진단 정보를 확인하세요.</p>}
  {environment?.loopbackPermission==='granted'&&environment.loopbackPolicy!=='blocked'&&<p>브라우저 권한은 허용돼 있습니다. CLI 연결 성공 여부는 위 연결 결과로 따로 확인합니다.</p>}
  {environment?.loopbackPermission==='prompt'&&<p>아래 확인은 권한을 변경하지 않습니다. 위 연결 버튼을 누를 때 브라우저가 확인을 요청할 수 있습니다.</p>}
  {environment&&['unsupported','unavailable','timeout'].includes(environment.loopbackPermission)&&<p>권한 상태만으로 차단 여부를 판단할 수 없습니다. 이 결과를 CLI 실행 오류나 권한 거부로 표시하지 않습니다.</p>}
  {environment?.visibility==='hidden'&&<p>이 연결 탭이 배경에 있습니다. 연결 안내를 확인할 때 이 탭을 열어두세요.</p>}
  {environment&&<details style={{fontSize:12}}><summary>연결 진단 정보</summary><dl><div><dt>안전한 문서</dt><dd>{environment.secureContext?'예':'아니요'}</dd></div><div><dt>문서 위치</dt><dd>{environment.documentContext==='top-level'?'독립 페이지':environment.documentContext==='embedded'?'다른 페이지 안에 포함됨':'확인하지 못함'}</dd></div><div><dt>문서의 PC 연결 정책</dt><dd>{environment.loopbackPolicy==='allowed'?'허용':environment.loopbackPolicy==='blocked'?'차단':environment.loopbackPolicy==='unsupported'?'조회 미지원':'확인하지 못함'}</dd></div></dl></details>}
  <button type="button" className="btn ghost" disabled={checking} onClick={()=>void refresh()}>{checking?'확인 중…':'브라우저 상태 다시 확인'}</button>
 </section>;
}
