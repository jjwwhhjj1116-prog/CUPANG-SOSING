'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {RegistrationColumnFilter,RegistrationFilterChoice,RegistrationFilterCondition} from '@/app/registration-column-filter';

type Props={label:string;choices:RegistrationFilterChoice[];allValues:string[];filter?:RegistrationColumnFilter;position:{left:number;top:number};trigger?:HTMLElement;
 onApply:(filter:RegistrationColumnFilter|undefined)=>void;onSort:(direction:'ascending'|'descending')=>void;onClose:()=>void};
export function RegistrationFilterPopover({label,choices,allValues,filter,position,trigger,onApply,onSort,onClose}:Props){
 const [mode,setMode]=useState<'values'|'conditions'>(filter?.mode??'values'),[query,setQuery]=useState('');
 const [selected,setSelected]=useState(()=>filter?.mode==='values'?filter.values:allValues);
 const [conditions,setConditions]=useState<RegistrationFilterCondition[]>(()=>filter?.mode==='conditions'?filter.conditions:[{operator:'',value:''},{operator:'',value:''}]);
 const [error,setError]=useState(''),root=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{
  const outside=(event:MouseEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target)&&!trigger?.contains(event.target))onClose();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose();}};
  const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!root.current?.contains(event.target))onClose();};
  document.addEventListener('mousedown',outside);document.addEventListener('keydown',escape);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',onClose);
  return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',escape);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',onClose);};
 },[onClose,trigger]);
 const shown=choices.filter(choice=>choice.value.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR'))),all=shown.length>0&&shown.every(choice=>selected.includes(choice.value));
 const total=shown.reduce((sum,choice)=>sum+choice.count,0);
 function changeCondition(index:number,patch:Partial<RegistrationFilterCondition>){setError('');setConditions(current=>current.map((condition,at)=>at===index?{...condition,...patch}:condition));}
 function apply(){
  if(mode==='values'){onApply(allValues.every(value=>selected.includes(value))?undefined:{mode,values:selected});return;}
  const active=conditions.filter(condition=>!!condition.operator);
  if(active.some(condition=>['gte','lte'].includes(condition.operator)&&!condition.value.trim())){setError('이상·이하 조건의 값을 입력해주세요.');return;}
  onApply(active.length?{mode,conditions:conditions.map(condition=>({...condition,value:condition.value.trim()}))}:undefined);
 }
 return createPortal(<div ref={root} className="registration-filter-popover" role="dialog" aria-label={`${label} 열 필터`} style={{left:position.left,top:position.top}}>
  <header><strong>{label}</strong><button type="button" className="icon-close" aria-label={`${label} 열 필터 닫기`} onClick={onClose}>×</button></header>
  <div className="registration-filter-sort"><button type="button" onClick={()=>onSort('ascending')}>↑ 오름차순</button><button type="button" onClick={()=>onSort('descending')}>↓ 내림차순</button></div>
  <div role="tablist" aria-label={`${label} 필터 방식`}><button type="button" role="tab" aria-selected={mode==='values'} onClick={()=>{setMode('values');setError('');}}>값 목록</button><button type="button" role="tab" aria-selected={mode==='conditions'} onClick={()=>{setMode('conditions');setError('');}}>조건</button></div>
  {mode==='values'?<div role="tabpanel" aria-label="값 목록"><input type="search" aria-label="값 검색" placeholder="값 검색" value={query} onChange={event=>setQuery(event.target.value)}/>
   <label className="registration-filter-choice"><input type="checkbox" aria-label={`전체 ${total}`} checked={all} onChange={event=>setSelected(current=>event.target.checked?[...new Set([...current,...shown.map(choice=>choice.value)])]:current.filter(value=>!shown.some(choice=>choice.value===value)))}/><span>전체</span><small>{total}</small></label>
   <div className="registration-filter-values">{shown.map(choice=><label className="registration-filter-choice" key={choice.value}><input type="checkbox" aria-label={`${choice.value||'(공란)'} ${choice.count}`} checked={selected.includes(choice.value)} onChange={event=>setSelected(current=>event.target.checked?[...current,choice.value]:current.filter(value=>value!==choice.value))}/><span title={choice.value}>{choice.value||'(공란)'}</span><small>{choice.count}</small></label>)}{!shown.length&&<p>일치하는 값이 없습니다.</p>}</div>
  </div>:<div role="tabpanel" aria-label="조건">{conditions.map((condition,index)=><div className="registration-filter-condition" key={index}><select aria-label={`조건 ${index+1}`} value={condition.operator} onChange={event=>changeCondition(index,{operator:event.target.value as RegistrationFilterCondition['operator']})}><option value="">조건</option><option value="gte">이상</option><option value="lte">이하</option><option value="eq">같음</option><option value="ne">같지 않음</option></select><input aria-label={`조건 ${index+1} 값`} placeholder="값" value={condition.value} onChange={event=>changeCondition(index,{value:event.target.value})}/></div>)}<small>두 조건은 AND로 묶입니다</small></div>}
  {error&&<p role="alert">{error}</p>}<footer><button type="button" className="btn ghost" onClick={()=>onApply(undefined)}>해제</button><button type="button" className="btn primary" onClick={apply}>적용</button></footer>
 </div>,document.body);
}
