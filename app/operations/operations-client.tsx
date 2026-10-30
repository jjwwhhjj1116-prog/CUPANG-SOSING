'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {SourcingView} from './components/sourcing';
import {LogisticsView} from './components/logistics';
import {SalesView} from './components/sales';
import {FinanceView} from './components/finance';
import {ActionButton,RecordPanel} from './components/shared';
import {OperationsNavigation,operationsLocation} from './components/navigation';
import {collectorRows,requestCollector,supportsCollection} from './collector';
import {str,type Dataset,type OperationsCommand,type OperationsContext,type OperationsSnapshot,type Values} from './types';

const initialYear=()=>Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()));
const accessChanged=(status:number,code?:string)=>status===401||status===403||status===409&&code==='OPERATIONS_SCOPE_CHANGED';
type OperationsResponse=OperationsSnapshot&{error?:string;code?:string};
async function responseData(response:Response):Promise<OperationsResponse>{
 const value:unknown=await response.json().catch(()=>null);
 return value&&typeof value==='object'&&!Array.isArray(value)?value as OperationsResponse:{} as OperationsResponse;
}
export default function OperationsClient(){
 const [view,setView]=useState('discovery'),[year,setYear]=useState(initialYear),[month,setMonth]=useState(''),[search,setSearch]=useState(''),[snapshot,setSnapshot]=useState<OperationsSnapshot|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[saved,setSaved]=useState(''),[jobPanel,setJobPanel]=useState(false),[connection,setConnection]=useState('미확인'),[mobileNav,setMobileNav]=useState(false);
 const [collecting,setCollecting]=useState(false);
 const [navigationGroup,setNavigationGroup]=useState<{view:string;group:string|null}>({view:'discovery',group:'상품소싱'});
 const ref=useRef<OperationsSnapshot|null>(null),writing=useRef(false),collectingRef=useRef(false),mounted=useRef(true),yearRef=useRef(year),requestSeq=useRef(0);
 yearRef.current=year;
 const adopt=useCallback((data:OperationsSnapshot)=>{
  if(!data?.document?.records||!Number.isSafeInteger(data.revision)||data.revision<0||!data.accountContext||!data.scope)throw Error('서버 자료 형식을 확인할 수 없습니다.');
  ref.current=data;setSnapshot(data);
  setSaved(typeof data.updatedAt==='string'&&Number.isFinite(Date.parse(data.updatedAt))
   ?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(data.updatedAt)):'');
 },[]);
 const clearScope=useCallback(()=>{
  requestSeq.current++;ref.current=null;setSnapshot(null);setSaved('');setConflict(false);setLoading(false);setNotice('');setSearch('');setMonth('');setJobPanel(false);setConnection('미확인');
 },[]);
 const load=useCallback(async(targetYear:number)=>{
  if(writing.current||targetYear!==yearRef.current)return;
  const seq=++requestSeq.current;setLoading(true);setError('');
  const current=()=>mounted.current&&seq===requestSeq.current&&targetYear===yearRef.current&&!writing.current;
  try{
   const response=await fetch('/api/operations?year='+targetYear,{cache:'no-store',credentials:'same-origin'});
   const data=await responseData(response);
   if(!response.ok){
    const message=data.error??(accessChanged(response.status,data.code)?'현재 회원의 승인 회사정보를 다시 확인해주세요.':'운영 자료를 불러오지 못했습니다.');
    if(current()&&accessChanged(response.status,data.code)){clearScope();setError(message);return;}
    throw Error(message);
   }
   if(current()){
    if(ref.current?.accountContext===data.accountContext&&data.revision<ref.current.revision)throw Error('현재 화면보다 이전 버전의 조회 결과입니다. 저장한 자료를 유지했습니다. 최신 자료를 다시 확인해 주세요.');
    adopt(data);setConflict(false);
   }
  }catch(e){if(current())setError(e instanceof Error?e.message:'운영 자료를 불러오지 못했습니다.');}
  finally{if(mounted.current&&seq===requestSeq.current)setLoading(false);}
 },[adopt,clearScope]);
 useEffect(()=>{mounted.current=true;const change=()=>{const key=new URLSearchParams(location.search).get('view');setView(operationsLocation(key).id);setSearch('');setMobileNav(false);};change();window.addEventListener('popstate',change);return()=>{mounted.current=false;window.removeEventListener('popstate',change);};},[]);
 useEffect(()=>{void load(year);},[year,load]);
 async function command(command:OperationsCommand):Promise<boolean>{
  if(writing.current||!ref.current){setNotice('저장이 끝난 뒤 다시 시도해 주세요.');return false;}
  if(!mounted.current||snapshot?.accountContext!==ref.current.accountContext||year!==yearRef.current)return false;
  const base=ref.current,targetYear=yearRef.current;let reloadYear:number|undefined;
  // A read started before this write cannot replace its acknowledgement later.
  requestSeq.current++;setLoading(false);writing.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/operations?year='+targetYear,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:base.revision,accountContext:base.accountContext,command})});
   const data=await responseData(response);
   if(!mounted.current)return false;
   if(!response.ok){if(accessChanged(response.status,data.code))clearScope();else if(response.status===409)setConflict(true);throw Error(data.error??(accessChanged(response.status,data.code)?'현재 회원의 승인 회사정보를 다시 확인해주세요.':'저장하지 못했습니다. 입력을 유지합니다.'));}
   if(ref.current?.accountContext!==base.accountContext||data.accountContext!==base.accountContext
    ||data.scope?.ownerId!==base.scope.ownerId||data.scope?.companyCode!==base.scope.companyCode)throw Error('저장 도중 계정 범위가 바뀌었습니다. 최신 자료를 다시 확인해 주세요.');
   requestSeq.current++;
   if(yearRef.current!==targetYear){
    reloadYear=yearRef.current;setNotice('서버 저장을 확인했습니다. 선택한 연도의 자료를 다시 조회합니다.');return true;
   }
   adopt(data);setConflict(false);setNotice('서버에 저장했습니다. 연결된 판매·원가·손익을 다시 계산했습니다.');return true;
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'저장하지 못했습니다. 입력을 유지합니다.');return false;}
  finally{writing.current=false;if(mounted.current){setBusy(false);if(reloadYear!==undefined)void load(reloadYear);}}
 }
 async function collect(kind:string,values:Values,dataset?:Dataset){
  if(writing.current||collectingRef.current||!ref.current)return;
  const base=ref.current,scope=base.accountContext;
  const requestValues={...values};let jobId:string|undefined,jobValues:Values={},terminal=false,failureStatus='failed',receipts:Values[]=[];
  collectingRef.current=true;setCollecting(true);setError('');
  try{
   if(['inbound','rocketSales','adMetrics','statements'].includes(kind)&&!requestValues.startDate&&!requestValues.from&&!requestValues.date){
    if(!month)throw Error('자동수집할 월을 상단에서 선택해 주세요. 연간 자료는 월별로 나누어 가져올 수 있습니다.');
    requestValues.startDate=month+'-01';requestValues.endDate=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
   }
   if(kind==='adMetrics'&&!requestValues.campaignIds){const selected=requestValues.campaignId?base.document.records.campaigns.find(c=>c.id===requestValues.campaignId):undefined;if(requestValues.campaignId&&!str(selected?.values.externalId))throw Error('선택한 캠페인의 광고센터 캠페인 ID를 먼저 입력해 주세요.');requestValues.campaignIds=selected?[str(selected.values.externalId)]:base.document.records.campaigns.map(c=>str(c.values.externalId)).filter(Boolean);}
   const hello=await requestCollector('ping',base.scope.companyCode,{},2000);if(!hello.ok)throw Error(hello.error??'수집 연결을 확인해 주세요.');setConnection('연결됨 '+str(hello.version));
   if(!supportsCollection(hello,kind))throw Error('이 연결 확장은 아직 해당 수집을 지원하지 않습니다. 파일·표 가져오기를 사용해 주세요.');
   if(!await command({type:'queue-job',kind,values:{...requestValues,dataset,scope}}))return;
   const job=[...(ref.current?.document.records.jobs??[])].reverse().find(r=>r.values.kind===kind&&r.values.status==='queued');
   if(!job)throw Error('수집 작업의 저장을 확인하지 못했습니다.');
   jobId=job.id;jobValues=job.values;
   if(!await command({type:'upsert',dataset:'jobs',id:job.id,values:{...job.values,status:'running'}}))throw Error('수집 작업 상태를 저장하지 못했습니다. 원본 조회를 시작하지 않았습니다.');
   failureStatus=kind==='statementConfirm'?'unknown':'failed';
   const result=await requestCollector(kind,base.scope.companyCode,requestValues,kind==='statementConfirm'?450000:300000);
   if(kind==='statementConfirm'){receipts=(result.rows??[]).slice(0,10);if(result.status==='failed')failureStatus='failed';}
   if(ref.current?.accountContext!==scope)throw Error('수집 중 계정·회사가 바뀌어 결과를 반영하지 않았습니다.');
   if(result.companyCode&&result.companyCode!==base.scope.companyCode)throw Error('수집 원본의 사업자가 현재 회사와 다릅니다. 반영하지 않았습니다.');
   if(!result.ok&&result.status!=='partial')throw Error(result.error??'수집하지 못했습니다.');
   const prepared=collectorRows(kind,result,ref.current!,requestValues),count=Object.values(prepared.datasets).reduce((n,rows)=>n+(rows?.length??0),0);
   if(!await command({type:'ingest-collection',values:{kind,jobId:job.id,resultStatus:prepared.warnings.length||result.status==='partial'?'partial':'succeeded',datasets:prepared.datasets,warnings:prepared.warnings,rejectedRows:prepared.rejectedRows}}))throw Error('수집 자료를 서버에 반영하지 못했습니다. 성공으로 처리하지 않았습니다. 수집 기록에서 다시 확인하세요.');
   terminal=true;
   setNotice(`수집 결과 ${count.toLocaleString()}행을 서버에 저장했습니다.${prepared.warnings.length?' '+prepared.warnings.join(' '):count===0?' 조회 범위 안의 결과가 없습니다.':''}`);
  }catch(e){const message=e instanceof Error?e.message:'수집 중 오류가 발생했습니다.';if(jobId&&!terminal&&ref.current?.accountContext===scope)await command({type:'upsert',dataset:'jobs',id:jobId,values:{...jobValues,status:failureStatus,error:message,...(receipts.length?{receipts}:{})}});setError(message);}finally{collectingRef.current=false;if(mounted.current)setCollecting(false);}
 }
 function navigate(id:string){const target=operationsLocation(id);setView(target.id);setSearch('');setMobileNav(false);history.pushState(null,'','/operations?view='+encodeURIComponent(target.id));window.scrollTo({top:0,behavior:'smooth'});}
 const current=operationsLocation(view),settings=current.id==='settings';
 const expandedGroup=navigationGroup.view===current.id?navigationGroup.group:settings?null:current.group;
 if(navigationGroup.view!==current.id)setNavigationGroup({view:current.id,group:expandedGroup});
 const ctx:OperationsContext|null=snapshot?{snapshot,year,month,search,busy:loading||busy||collecting,error,command,notify:setNotice,collect}:null;
 return <div className="ops-root"><OperationsNavigation view={current.id} open={mobileNav} expandedGroup={expandedGroup} onToggleGroup={group=>setNavigationGroup({view:current.id,group:expandedGroup===group?null:group})} onNavigate={navigate} onClose={()=>setMobileNav(false)}/><div className="ops-main"><header className="ops-topbar"><div><button type="button" className="ops-mobile-menu" aria-label="운영 메뉴 열기" aria-expanded={mobileNav} aria-controls="operations-navigation" onClick={()=>setMobileNav(v=>!v)}>☰</button><nav className="ops-breadcrumb" aria-label="현재 위치"><span>운영관리</span><b aria-hidden="true">/</b><span>{current.group}</span><b aria-hidden="true">/</b><span aria-current="page">{current.name}</span></nav></div><div className="ops-topbar-right"><span className="ops-business">{snapshot?.scope.companyName??'회사 확인 중'}</span><span className={'ops-save-state '+(conflict||error?'warning':'')}>{collecting?'수집·확인 중…':busy?'저장 중…':conflict?'다른 창 변경 확인':loading?'조회 중…':saved?`저장 시각 ${saved}`:snapshot?'조회 완료 · 저장 이력 없음':'연결 중'}</span><button className="ops-icon-button" onClick={()=>setJobPanel(v=>!v)}>수집 기록 {snapshot?.document.records.jobs.filter(j=>['running','queued'].includes(str(j.values.status))).length||''}</button></div></header><main className="ops-content"><div className="ops-page-title"><div><p>YOOFAM OPERATIONS</p><h1>{current.name}</h1><span>소싱의 근거부터 판매 성과, 실제 남는 이익까지 한 흐름으로 확인합니다.</span></div><div className="ops-page-actions"><ActionButton disabled={loading||busy||collecting} onClick={()=>load(year)}>새로고침</ActionButton><Link className="ops-button" href="/">AI 상품등록</Link></div></div><div className="ops-filters"><label>연도<select aria-label="운영 연도" value={year} disabled={busy||collecting} onChange={e=>{setYear(Number(e.target.value));setMonth('');}}>{Array.from({length:9},(_,i)=>initialYear()-5+i).map(y=><option key={y}>{y}</option>)}</select></label><label>월<select aria-label="운영 월" disabled={busy||collecting} value={month} onChange={e=>setMonth(e.target.value)}><option value="">연간 전체</option>{Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`).map(m=><option value={m} key={m}>{Number(m.slice(5))}월</option>)}</select></label><label className="ops-search">검색<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="상품명 · SKU · 키워드 · 거래처"/></label></div>{error&&<div className="ops-error" role="alert">{error}{conflict&&<button onClick={()=>load(year)}>최신 자료 확인</button>}</div>}{notice&&<div className="ops-notice" role="status">{notice}<button aria-label="알림 닫기" onClick={()=>setNotice('')}>×</button></div>}{loading&&!snapshot?<div className="ops-loading">승인된 회사의 운영 자료를 불러오고 있습니다…</div>:ctx?<>{settings?<><section className="ops-panel"><h2>기존 YOOFAM 상품 연결</h2><p>상품관리의 SKU·바코드·옵션ID·공급가를 현재 회원과 회사 범위에서 읽어 연결합니다. 기존 상품등록 작업은 수정하지 않습니다.</p><div className="ops-toolbar"><ActionButton variant="primary" disabled={busy} onClick={()=>command({type:'sync-products'})}>상품관리 SKU 동기화</ActionButton><ActionButton onClick={async()=>{try{const h=await requestCollector('ping',ctx.snapshot.scope.companyCode,{},2000);setConnection(h.ok?'연결됨 '+h.version:h.error??'미연결');}catch{setConnection('미연결');}}}>수집 연결 확인</ActionButton><span>{connection}</span><Link href="/downloads/yoofam-operations-connector.zip" className="ops-button" download>운영관리 연결 확장 다운로드</Link></div><p className="ops-note">외부 자동수집은 별도 연결 확장과 대상 사이트 로그인이 필요합니다. 설치 전에도 Excel·CSV·붙여넣기와 모든 원장·분석 기능을 사용할 수 있습니다. 수집 실패는 기존 자료를 지우지 않습니다.</p></section><RecordPanel ctx={ctx} dataset="skus" title="공통 SKU" description="바코드·SKU ID·옵션ID는 서로 다른 식별자입니다. 모든 매입·재고·매출이 이 상품을 참조합니다." fields={[{key:'name',label:'상품명',required:true},{key:'supplierSkuId',label:'쿠팡 SKU ID'},{key:'optionId',label:'옵션ID'},{key:'barcode',label:'바코드'},{key:'supplyPrice',label:'공급단가(부가세 제외)',type:'number'},{key:'salePrice',label:'소비자 판매가',type:'number'},{key:'costPrice',label:'초기 원가',type:'number'},{key:'sourceProductId',label:'기존 상품등록 ID'}]}/></>:current.group==='상품소싱'?<SourcingView view={view} ctx={ctx}/>:current.group==='판매관리'?<SalesView view={view} ctx={ctx}/>:current.group==='손익계산'?<FinanceView view={view} ctx={ctx}/>:<LogisticsView view={view} ctx={ctx}/>}</>:<section className="ops-panel"><h2>자료 연결을 확인해 주세요</h2><p>로그인과 승인된 회사정보를 확인한 뒤 다시 불러오세요.</p><Link href="/account">계정 정보 확인</Link></section>}{ctx&&jobPanel&&<section className="ops-panel"><h2>수집 작업 기록</h2><p>수집 완료와 서버 저장 완료를 구분합니다. 결과 확인이 필요한 승인 작업은 원본 상태를 대조한 뒤 처리하세요.</p><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>유형</th><th>상태</th><th>건수</th><th>메시지</th><th>시각</th></tr></thead><tbody>{[...ctx.snapshot.document.records.jobs].reverse().map(j=><tr key={j.id}><td>{str(j.values.kind)}</td><td>{str(j.values.status)}</td><td>{str(j.values.resultCount)}</td><td>{str(j.values.error??j.values.warnings)}{(j.values.receipts||j.values.rejectedRows)?<details><summary>원본 결과·미연결 자료</summary><pre style={{maxWidth:520,maxHeight:240,overflow:"auto",whiteSpace:"pre-wrap"}}>{JSON.stringify(j.values.receipts??j.values.rejectedRows,null,2)}</pre></details>:null}</td><td>{j.updatedAt}</td></tr>)}</tbody></table></div></section>}<footer className="ops-footer">YOOFAM 스튜디오 · 회사별 서버 저장 · 입력한 원천과 계산 근거를 함께 보관합니다.</footer></main></div></div>;
}
