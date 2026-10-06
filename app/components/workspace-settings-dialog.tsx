'use client';
import { useEffect, useState } from 'react';
import { savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { WorkspaceSettingsEditor } from '@/app/components/workspace-settings-editor';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';

/** Never offer an editable fallback when the saved settings could not be read. */
export function WorkspaceSettingsDialog({ workspaceOwnerId, onSave, onClose, onBusy }: { workspaceOwnerId?:string; onSave:(value:WorkspaceSettings,scope?:WorkspaceSettingsScope)=>Promise<void>; onClose:()=>void; onBusy?:(busy:boolean)=>void }) {
  const [attempt,setAttempt]=useState(0);
  const [snapshot,setSnapshot]=useState<{attempt:number;ownerId?:string;scope?:WorkspaceSettingsScope;value?:WorkspaceSettings;error?:string}|null>(null);
  const current=snapshot?.attempt===attempt&&snapshot.ownerId===workspaceOwnerId?snapshot:null;
  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try {
        const response=await fetch('/api/settings',{cache:'no-store',signal:controller.signal});
        if(controller.signal.aborted)return;
        const body=await response.json() as {settings?:unknown;scope?:unknown;error?:string};
        if(controller.signal.aborted)return;
        if(!response.ok)throw Error(body.error||'기본설정을 불러오지 못했습니다.');
        if(!body||!Object.hasOwn(body,'settings'))throw Error('기본설정 응답을 확인하지 못했습니다.');
        const scope=parseWorkspaceSettingsScope(body.scope);
        if(workspaceOwnerId&&scope?.ownerId!==workspaceOwnerId)throw Error('로그인 계정이 변경되었습니다. 페이지를 새로고침한 뒤 기본설정을 열어주세요.');
        if(Object.hasOwn(body,'scope')&&!scope)throw Error('기본설정의 계정 정보를 확인하지 못했습니다.');
        const value=savedRegistrationSettings(body.settings);
        setSnapshot({attempt,ownerId:workspaceOwnerId,scope:scope??undefined,value});
      }catch(cause){if(!controller.signal.aborted)setSnapshot({attempt,ownerId:workspaceOwnerId,error:cause instanceof Error?cause.message:'기본설정을 불러오지 못했습니다.'});}
    })();
    return()=>controller.abort();
  },[attempt,workspaceOwnerId]);
  if(current?.value)return <>
    {current.scope?.company&&<p className="panel-note"><strong>{current.scope.company.name} 기본설정</strong> · {current.scope.company.code}</p>}
    <WorkspaceSettingsEditor key={current.scope?.ownerId??'legacy'} value={current.value} onSave={value=>onSave(value,current.scope)} onClose={onClose} onBusy={onBusy}/>
  </>;
  return <section aria-busy={!current}>
    {current?.error?<><p role="alert">{current.error} 기존 설정을 확인한 뒤 편집할 수 있습니다.</p><button type="button" className="btn primary" onClick={()=>setAttempt(value=>value+1)}>기본설정 다시 불러오기</button></>:<p role="status">저장된 기본설정을 불러오는 중…</p>}
    <button type="button" className="btn ghost" onClick={onClose}>닫기</button>
  </section>;
}
