'use client';

import {useEffect,useRef,useState} from 'react';
import {readCliBrowserEnvironment,type CliBrowserEnvironmentReport} from '@/app/cli-browser-environment';

const permissionLabels:Record<CliBrowserEnvironmentReport['loopbackPermission'],string>={
 granted:'허용됨',prompt:'연결할 때 확인 필요',denied:'차단됨',unsupported:'이 브라우저에서 상태 조회 미지원',unavailable:'상태를 확인하지 못함',timeout:'상태 조회 시간 초과',
};

/** Reading current permission state never requests a grant or contacts the CLI. */
export function CliBrowserStatus(){
 const [environment,setEnvironment]=useState<CliBrowserEnvironmentReport|null>(null),[checking,setChecking]=useState(false);
 const alive=useRef(false),generation=useRef(0);
 useEffect(()=>{
  alive.current=true;const epoch=++generation.current;
  void readCliBrowserEnvironment().then(value=>{if(alive.current&&epoch===generation.current)setEnvironment(value);});
  return()=>{alive.current=false;};
 },[]);
 async function refresh(){
  if(checking)return;const epoch=++generation.current;setChecking(true);
  try{const value=await readCliBrowserEnvironment();if(alive.current&&epoch===generation.current)setEnvironment(value);}
  finally{if(alive.current&&epoch===generation.current)setChecking(false);}
 }
 return <section aria-label="브라우저 PC 연결 확인" style={{borderTop:'1px solid #e7eaf0',marginTop:20,paddingTop:16,fontSize:14,lineHeight:1.7}}>
  <h3 style={{fontSize:15,margin:'0 0 8px'}}>브라우저 PC 연결 확인</h3>
  <p role="status">PC 연결 권한: <strong>{environment?permissionLabels[environment.loopbackPermission]:'확인 중'}</strong></p>
  {environment&&!environment.secureContext&&<p>이 페이지가 안전한 연결로 열리지 않았습니다. YOOFAM 스튜디오의 HTTPS 주소에서 연결해주세요.</p>}
  {environment?.loopbackPermission==='denied'&&<p>브라우저가 이 사이트의 PC 연결을 차단한 상태입니다. 연결 버튼을 반복해서 눌러도 허용 창이 다시 나타나지 않을 수 있습니다. Chrome의 이 사이트 설정에서 ‘루프백 네트워크’ 상태를 확인해주세요. 조직에서 관리하는 설정이라면 관리자 확인이 필요합니다.</p>}
  {environment?.loopbackPermission==='granted'&&<p>브라우저 권한은 허용돼 있습니다. CLI 연결 성공 여부는 위 연결 결과로 따로 확인합니다.</p>}
  {environment?.loopbackPermission==='prompt'&&<p>아래 확인은 권한을 변경하지 않습니다. 위 연결 버튼을 누를 때 브라우저가 확인을 요청할 수 있습니다.</p>}
  {environment&&['unsupported','unavailable','timeout'].includes(environment.loopbackPermission)&&<p>권한 상태만으로 차단 여부를 판단할 수 없습니다. 이 결과를 CLI 실행 오류나 권한 거부로 표시하지 않습니다.</p>}
  {environment?.visibility==='hidden'&&<p>이 연결 탭이 배경에 있습니다. 연결 안내를 확인할 때 이 탭을 열어두세요.</p>}
  <button type="button" className="btn ghost" disabled={checking} onClick={()=>void refresh()}>{checking?'확인 중…':'브라우저 상태 다시 확인'}</button>
 </section>;
}
