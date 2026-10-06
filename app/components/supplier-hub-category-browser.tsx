'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {hubCategoryChoice,loadSupplierHubCategoryBranch,type HubCategoryBranch,type HubCategoryNode} from '@/app/supplier-hub-catalog';
import type {CategoryChoice} from '@/app/category-catalog';

export function SupplierHubCategoryBrowser({disabled,onChoice,onNavigating}:{disabled:boolean;onChoice:(choice:CategoryChoice)=>void;onNavigating:()=>void}){
  const [branches,setBranches]=useState<HubCategoryBranch[]>([]),[trail,setTrail]=useState<HubCategoryNode[]>([]);
  const [selected,setSelected]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const active=useRef<AbortController|null>(null),callbacks=useRef({onChoice,onNavigating});
  const identity=useRef<{ownerId:string;code:string;name:string}|null>(null);
  const retryTrail=useRef<HubCategoryNode[]>([]);
  useEffect(()=>{callbacks.current={onChoice,onNavigating};},[onChoice,onNavigating]);
  const load=useCallback(async(next:HubCategoryNode[])=>{
    active.current?.abort();const controller=new AbortController();active.current=controller;
    retryTrail.current=next;
    setLoading(true);setError('');setSelected('');callbacks.current.onNavigating();
    try{
      const branch=await loadSupplierHubCategoryBranch(next,controller.signal);
      if(controller.signal.aborted)return;
      if(next.length&&(!identity.current||identity.current.ownerId!==branch.ownerId||identity.current.code!==branch.company.code||identity.current.name!==branch.company.name)){
        setBranches([]);setTrail([]);identity.current=null;retryTrail.current=[];throw new Error('회원 또는 회사가 변경되었습니다. 카테고리 목록을 다시 불러와주세요.');
      }
      identity.current={ownerId:branch.ownerId,code:branch.company.code,name:branch.company.name};
      setBranches(previous=>[...previous.slice(0,next.length),branch]);setTrail(next);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'카테고리 목록을 읽지 못했습니다.');}
    finally{if(active.current===controller)active.current=null;if(!controller.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{let mounted=true;void Promise.resolve().then(()=>{if(mounted)void load([]);});return()=>{mounted=false;active.current?.abort();};},[load]);
  function select(branch:HubCategoryBranch,node:HubCategoryNode){
    if(disabled||loading)return;
    if(node.isLeaf){setSelected(node.categoryId);setTrail(branch.trail);setBranches(previous=>previous.slice(0,branch.trail.length+1));callbacks.current.onChoice(hubCategoryChoice(branch,node));}
    else void load([...branch.trail,node]);
  }
  return <div className="hub-category-browser" aria-busy={loading}>
    <div className="workspace-actions"><button className="btn ghost" type="button" disabled={disabled||loading} onClick={()=>void load([])}>카테고리 목록 새로고침</button></div>
    {loading&&<p role="status">하위 카테고리를 불러오는 중입니다.</p>}
    {error&&<div role="alert"><p>{error}</p><button type="button" className="btn ghost" disabled={disabled||loading} onClick={()=>void load(retryTrail.current)}>다시 불러오기</button><a href="/downloads/yoofam-plus-supplier-hub-extension-0.2.55.zip" download>상품 수집·전송 확장 0.2.55</a></div>}
    <div className="category-tree">{branches.map((branch,depth)=><section key={JSON.stringify(branch.trail)}><h3>{depth+1}단계 카테고리</h3><div className="category-tree-options">{branch.children.map(node=><button key={node.categoryId} type="button" disabled={disabled||loading} className={trail[depth]?.categoryId===node.categoryId||selected===node.categoryId?'selected':''} onClick={()=>select(branch,node)}><span>{node.name}</span><small className={node.isLeaf?'ready':'unconfirmed'}>{node.isLeaf?node.categoryId:'›'}</small></button>)}</div></section>)}</div>
  </div>;
}
