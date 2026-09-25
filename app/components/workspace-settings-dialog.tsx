'use client';
import { useEffect, useState } from 'react';
import { savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { WorkspaceSettingsEditor } from '@/app/components/workspace-settings-editor';

/** Never offer an editable fallback when the saved settings could not be read. */
export function WorkspaceSettingsDialog({ onSave, onClose }: { onSave:(value:WorkspaceSettings)=>Promise<void>; onClose:()=>void }) {
  const [attempt,setAttempt]=useState(0);
  const [snapshot,setSnapshot]=useState<{attempt:number;value?:WorkspaceSettings;error?:string}|null>(null);
  const current=snapshot?.attempt===attempt?snapshot:null;
  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try {
        const response=await fetch('/api/settings',{cache:'no-store',signal:controller.signal});
        if(controller.signal.aborted)return;
        const body=await response.json() as {settings?:unknown;error?:string};
        if(controller.signal.aborted)return;
        if(!response.ok)throw Error(body.error||'기본설정을 불러오지 못했습니다.');
        if(!body||!Object.hasOwn(body,'settings'))throw Error('기본설정 응답을 확인하지 못했습니다.');
        const value=savedRegistrationSettings(body.settings);
        setSnapshot({attempt,value});
      }catch(cause){if(!controller.signal.aborted)setSnapshot({attempt,error:cause instanceof Error?cause.message:'기본설정을 불러오지 못했습니다.'});}
    })();
    return()=>controller.abort();
  },[attempt]);
  if(current?.value)return <WorkspaceSettingsEditor value={current.value} onSave={onSave} onClose={onClose}/>;
  return <section aria-busy={!current}>
    {current?.error?<><p role="alert">{current.error} 기존 설정을 확인한 뒤 편집할 수 있습니다.</p><button type="button" className="btn primary" onClick={()=>setAttempt(value=>value+1)}>기본설정 다시 불러오기</button></>:<p role="status">저장된 기본설정을 불러오는 중…</p>}
    <button type="button" className="btn ghost" onClick={onClose}>닫기</button>
  </section>;
}
