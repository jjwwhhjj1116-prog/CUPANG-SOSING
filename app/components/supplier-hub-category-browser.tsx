'use client';
import {useCallback,useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {hubCategoryChoice,loadSupplierHubCategoryBranch,type HubCategoryBranch,type HubCategoryNode} from '@/app/supplier-hub-catalog';
import type {CategoryChoice} from '@/app/category-catalog';

export function SupplierHubCategoryBrowser({disabled,onChoice,onNavigating}:{disabled:boolean;onChoice:(choice:CategoryChoice)=>void;onNavigating:()=>void}){
  const [branches,setBranches]=useState<HubCategoryBranch[]>([]),[trail,setTrail]=useState<HubCategoryNode[]>([]);
  const [selected,setSelected]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const active=useRef<AbortController|null>(null),callbacks=useRef({onChoice,onNavigating});
  const identity=useRef<{ownerId:string;code:string;name:string}|null>(null);
  const retryTrail=useRef<HubCategoryNode[]>([]);
  const columns=useRef(new Map<string,HTMLElement>()),buttons=useRef(new Map<string,HTMLButtonElement>());
  const focusAfterLoad=useRef<string|null>(null);
  const mounted=useRef(true),currentBranches=useRef<HubCategoryBranch[]>([]);
  useEffect(()=>{callbacks.current={onChoice,onNavigating};},[onChoice,onNavigating]);
  const load=useCallback(async(next:HubCategoryNode[],focusChild=false)=>{
    if(!mounted.current)return;
    active.current?.abort();const controller=new AbortController();active.current=controller;
    retryTrail.current=next;focusAfterLoad.current=focusChild?JSON.stringify(next):null;
    setLoading(true);setError('');setSelected('');callbacks.current.onNavigating();
    try{
      const branch=await loadSupplierHubCategoryBranch(next,controller.signal);
      if(controller.signal.aborted)return;
      if(next.length&&(!identity.current||identity.current.ownerId!==branch.ownerId||identity.current.code!==branch.company.code||identity.current.name!==branch.company.name)){
        currentBranches.current=[];setBranches([]);setTrail([]);identity.current=null;retryTrail.current=[];focusAfterLoad.current=null;throw new Error('회원 또는 회사가 변경되었습니다. 카테고리 목록을 다시 불러와주세요.');
      }
      identity.current={ownerId:branch.ownerId,code:branch.company.code,name:branch.company.name};
      const visible=[...currentBranches.current.slice(0,next.length),branch];currentBranches.current=visible;setBranches(visible);setTrail(next);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'카테고리 목록을 읽지 못했습니다.');}
    finally{if(active.current===controller)active.current=null;if(!controller.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{
    let activeMount=true;mounted.current=true;const columnNodes=columns.current,buttonNodes=buttons.current;
    void Promise.resolve().then(()=>{if(activeMount)void load([]);});
    return()=>{activeMount=false;mounted.current=false;active.current?.abort();focusAfterLoad.current=null;currentBranches.current=[];columnNodes.clear();buttonNodes.clear();};
  },[load]);
  useEffect(()=>{
    const branch=branches.at(-1);if(!branch)return;
    const key=JSON.stringify(branch.trail);
    columns.current.get(key)?.scrollIntoView({block:'nearest',inline:'nearest'});
    if(focusAfterLoad.current===key){focusAfterLoad.current=null;buttons.current.get(JSON.stringify([key,branch.children[0]?.categoryId]))?.focus({preventScroll:true});}
  },[branches]);
  function currentBranch(branch:HubCategoryBranch){
    const account=identity.current;
    return Boolean(mounted.current&&currentBranches.current.includes(branch)&&account&&account.ownerId===branch.ownerId&&account.code===branch.company.code&&account.name===branch.company.name);
  }
  function select(branch:HubCategoryBranch,node:HubCategoryNode){
    if(disabled||loading||active.current||!currentBranch(branch))return;
    if(node.isLeaf){const visible=currentBranches.current.slice(0,branch.trail.length+1);currentBranches.current=visible;setSelected(node.categoryId);setTrail(branch.trail);setBranches(visible);callbacks.current.onChoice(hubCategoryChoice(branch,node));}
    else void load([...branch.trail,node]);
  }
  function focusNode(branch:HubCategoryBranch,index:number){
    const node=branch.children[index];if(!node)return;
    const key=JSON.stringify(branch.trail);columns.current.get(key)?.scrollIntoView({block:'nearest',inline:'nearest'});
    buttons.current.get(JSON.stringify([key,node.categoryId]))?.focus({preventScroll:true});
  }
  function keyboard(event:KeyboardEvent<HTMLButtonElement>,branch:HubCategoryBranch,node:HubCategoryNode,index:number,depth:number){
    if(disabled||loading||active.current||!currentBranch(branch)||event.altKey||event.ctrlKey||event.metaKey)return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?branch.children.length-1:
        event.key==='ArrowDown'?Math.min(index+1,branch.children.length-1):Math.max(index-1,0);
      focusNode(branch,target);
    }else if(event.key==='ArrowLeft'&&depth>0){
      event.preventDefault();const parent=branches[depth-1];focusNode(parent,Math.max(0,parent.children.findIndex(value=>value.categoryId===trail[depth-1]?.categoryId)));
    }else if(event.key==='ArrowRight'&&!node.isLeaf){
      event.preventDefault();const next=[...branch.trail,node],child=branches[depth+1];
      if(child&&JSON.stringify(child.trail)===JSON.stringify(next))focusNode(child,Math.max(0,child.children.findIndex(value=>value.categoryId===trail[depth+1]?.categoryId||value.categoryId===selected)));
      else void load(next,true);
    }
  }
  return <div className="hub-category-browser" aria-busy={loading}>
    <div className="workspace-actions"><button className="btn ghost" type="button" disabled={disabled||loading} onClick={()=>void load([])}>카테고리 목록 새로고침</button></div>
    {loading&&<p role="status">하위 카테고리를 불러오는 중입니다.</p>}
    {error&&<div role="alert"><p>{error}</p><button type="button" className="btn ghost" disabled={disabled||loading} onClick={()=>void load(retryTrail.current)}>다시 불러오기</button><a href="/downloads/yoofam-plus-supplier-hub-extension-2.1.14.zip" download>상품 수집·전송 확장 2.1.14</a></div>}
    <div className="category-tree" role="group" aria-label="단계별 Supplier Hub 카테고리">{branches.map((branch,depth)=>{
      const key=JSON.stringify(branch.trail),chosen=branch.children.findIndex(node=>trail[depth]?.categoryId===node.categoryId||selected===node.categoryId);
      return <section key={key} aria-label={`${depth+1}단계 카테고리`} ref={element=>{if(element)columns.current.set(key,element);else columns.current.delete(key);}}><h3>{depth+1}단계 카테고리</h3><div className="category-tree-options">{branch.children.map((node,index)=>{
        const pressed=trail[depth]?.categoryId===node.categoryId||selected===node.categoryId,buttonKey=JSON.stringify([key,node.categoryId]);
        return <button key={node.categoryId} type="button" disabled={disabled||loading} className={pressed?'selected':''} aria-pressed={pressed} tabIndex={index===(chosen<0?0:chosen)?0:-1}
          ref={element=>{if(element)buttons.current.set(buttonKey,element);else buttons.current.delete(buttonKey);}}
          onKeyDown={event=>keyboard(event,branch,node,index,depth)} onClick={()=>select(branch,node)}><span>{node.name}</span><small className={node.isLeaf?'ready':'unconfirmed'}>{node.isLeaf?node.categoryId:'›'}</small></button>;
      })}</div></section>;
    })}</div>
  </div>;
}
