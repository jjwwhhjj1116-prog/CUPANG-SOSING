'use client';
import { useEffect, useRef, useState } from 'react';
import type { AutomationWorkflow, AutomationStatus } from '@/app/automation/model';

const statuses:Record<AutomationStatus,string>={ready:'실행 가능',running:'실행 중',blocked:'연결·자료 필요',failed:'실패',complete:'산출물 생성됨',draft:'저장 초안 · 검토 필요'};
type View={workflow:AutomationWorkflow|null;stale?:boolean;history?:{revision:number;action:string;created_at:string}[]};
export function AutomationPanel({productId,version}:{productId:string;version:string}) {
  const [view,setView]=useState<View>({workflow:null});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const pending=useRef<{action:string;version:string;key:string}|null>(null);
  useEffect(()=>{let active=true;fetch('/api/products/'+productId+'/automation').then(async response=>{const result=await response.json() as View & {error?:string};if(!response.ok)throw Error(result.error??'작업을 불러오지 못했습니다.');if(active)setView(result);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[productId,version]);
  async function execute(action:'plan'|'run'|'retry') {
    if(busy)return;setBusy(true);setError('');
    try {
      if(!pending.current||pending.current.action!==action||pending.current.version!==version)pending.current={action,version,key:crypto.randomUUID()};
      const response=await fetch('/api/products/'+productId+'/automation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,expectedVersion:version,idempotencyKey:pending.current.key})});
      const result=await response.json() as View & {error?:string};if(!response.ok)throw Error(result.error??'작업 요청에 실패했습니다.');setView(result);pending.current=null;
    }catch(e){setError(e instanceof Error?e.message:'작업 실패');}finally{setBusy(false);}
  }
  return <div className="panel-stack">
    <p>단계별 입력과 산출물을 보관합니다. 현재 실행 가능한 무료 작업은 가격 계산이며, 상품 가격 적용은 가격 탭에서 저장합니다.</p>
    <div className="workspace-actions"><button className="btn ghost" disabled={busy||loading} onClick={()=>void execute('plan')}>작업 구성 확인</button><button className="btn primary" disabled={busy||loading||view.stale} onClick={()=>void execute('run')}>{busy?'처리 중…':'실행 가능한 단계 처리'}</button><button className="btn ghost" disabled={busy||!view.workflow?.stages.some(stage=>stage.status==='failed'&&stage.retryable)} onClick={()=>void execute('retry')}>실패 단계 재시도</button></div>
    {loading&&<p role="status">작업 상태를 읽고 있습니다.</p>}{error&&<p role="alert" className="collection-error">{error}</p>}{view.stale&&<p role="alert">상품이 변경되어 이전 산출물이 오래되었습니다. 작업 구성을 다시 확인하세요.</p>}
    {view.workflow&&<><p>작업 버전 {view.workflow.revision} · {statuses[view.workflow.status]}</p><ol className="automation-list">{view.workflow.stages.map(stage=><li key={stage.id}><div><strong>{stage.label}</strong><span className={'status '+(stage.status==='complete'?'success':'warning')}>{statuses[stage.status]}</span></div>{stage.reason&&<p>{stage.reason.message}</p>}{stage.artifacts.map(artifact=><details key={artifact.id}><summary>{artifact.label}</summary><pre>{JSON.stringify(artifact.data??{storageKey:artifact.storageKey},null,2)}</pre></details>)}<small>시도 {stage.attempts}회 · 근거 {stage.evidence.length}개</small></li>)}</ol></>}
    {!!view.history?.length&&<details><summary>저장된 작업 이력 ({view.history.length})</summary><ul>{view.history.map(item=><li key={item.revision}>버전 {item.revision} · {item.action} · {new Date(item.created_at).toLocaleString('ko-KR')}</li>)}</ul></details>}
  </div>;
}
