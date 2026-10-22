'use client';
import {useEffect,useRef,useState} from 'react';
import {CLI_RELEASE_VERSION,cliInstallCommands} from '@/app/cli-installation';
import './cli-install-guide.css';

function CopyCommand({label,command}:{label:string;command:string}){
 const [notice,setNotice]=useState(''),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function copy(){try{await navigator.clipboard.writeText(command);if(mounted.current)setNotice('복사됨');}catch{if(mounted.current)setNotice('명령어를 선택해 복사해주세요.');}}
 return <div className="cli-command"><code>{command}</code><button type="button" aria-label={`${label} 명령 복사`} onClick={()=>void copy()}>복사</button><span role="status">{notice}</span></div>;
}
export function CliInstallGuide(){
 const [platform,setPlatform]=useState<'windows'|'mac'>('windows'),commands=cliInstallCommands(platform);
 return <section className="cli-install-guide" aria-label="YOOFAM CLI 설치 안내">
  <div className="cli-release"><strong>YOOFAM 스튜디오 CLI {CLI_RELEASE_VERSION}</strong><span>배포 버전 · 설치된 버전은 아래 명령으로 확인하세요.</span></div>
  <p>CLI 설치 후 출력되는 연결 주소를 로그인한 YOOFAM 스튜디오에서 열어 사용합니다. 1688 페이지의 확장 수집 버튼은 별도 기능입니다.</p>
  <div className="cli-platform" role="group" aria-label="운영체제 선택"><button type="button" aria-pressed={platform==='windows'} onClick={()=>setPlatform('windows')}>Windows · PowerShell</button><button type="button" aria-pressed={platform==='mac'} onClick={()=>setPlatform('mac')}>Mac · 터미널</button></div>
  <h3>신규 설치</h3><ol className="cli-steps">
   <li><strong>Node.js 설치</strong><p>Node.js 22.13 이상이 필요합니다. 이미 설치했다면 다음 단계로 진행하세요.</p><a className="btn primary" href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">Node.js 공식 다운로드</a></li>
   <li><strong>CLI 설치</strong><p>{platform==='windows'?'시작 메뉴에서 PowerShell을 열고 아래 명령을 붙여넣은 뒤 Enter를 누르세요.':'터미널을 열고 아래 명령을 붙여넣은 뒤 Enter를 누르세요.'}</p><CopyCommand key={platform+'install'} label="설치" command={commands.install}/><p>설치는 CLI 파일만 추가합니다. 설치 중 브라우저 계정 연결이나 상품조회는 실행하지 않습니다.</p></li>
   <li><strong>설치 버전 확인</strong><CopyCommand key={platform+'status'} label="설치 확인" command={commands.status}/><p>버전 {CLI_RELEASE_VERSION}이 표시되면 설치 확인 완료입니다. 이 명령은 웹 로그인 연결 여부를 확인하지 않습니다.</p></li>
   <li><strong>실행하고 스튜디오에 연결</strong><CopyCommand key={platform+'start'} label="실행" command={commands.start}/><p>출력된 연결 주소를 현재 로그인한 Chrome에서 여세요. 회사 정보를 확인한 뒤 연결 버튼을 누릅니다. 실행한 창은 사용 중에 열어두세요.</p><a className="btn ghost" href="/cli">로그인 회사로 CLI 연결</a></li>
  </ol>
  <h3>종료·업데이트</h3><p>실행한 터미널에서 <kbd>Ctrl</kbd> + <kbd>C</kbd>로 CLI를 종료하세요. 업데이트할 때는 종료 후 설치 명령을 다시 실행하고 새로 시작합니다. 다른 프로그램을 함께 종료하지 않습니다.</p>
  <details><summary>설치가 안 될 때</summary><p>Node.js 설치 후 터미널을 새로 열고 다시 확인하세요. ‘조직에서 차단함’이나 설치 제한이 표시되면 관리자에게 이 CLI 배포본의 허용을 요청하세요. 보안 정책·인증서 검사·실행 정책을 끄는 명령은 사용하지 않습니다.</p><p>사이트 로그인이 필요한 주소를 설치 명령에 넣거나 비밀번호·로그인 쿠키를 터미널에 붙여넣지 마세요.</p></details>
 </section>;
}
export function CliInstallDialog({onClose}:{onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=dialog.current,previous=document.activeElement;if(node&&!node.open)node.showModal();return()=>{node?.close();if(previous instanceof HTMLElement)previous.focus();};},[]);
 return <dialog ref={dialog} className="cli-install-dialog" aria-labelledby="cli-install-title" onCancel={event=>{event.preventDefault();onClose();}}><header><h2 id="cli-install-title">YOOFAM CLI 설치·사용 안내</h2><button type="button" className="btn ghost" aria-label="CLI 설치 안내 닫기" onClick={onClose}>×</button></header><CliInstallGuide/></dialog>;
}
