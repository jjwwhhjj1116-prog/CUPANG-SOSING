'use client';
/* eslint-disable @next/next/no-img-element -- Display the already selected authenticated image URL unchanged. */
import {useLayoutEffect,useRef} from 'react';

type Props={src:string;alt:string;onClose:()=>void};

/** Viewing an image changes only the caller's preview state. */
export function ImageFullscreenPreview({src,alt,onClose}:Props){
 const root=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{
  if(typeof document==='undefined')return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  closeButton.current?.focus();
  return()=>{if(previous?.isConnected)previous.focus();};
 },[]);
 return <div ref={root} role="dialog" aria-modal="true" aria-label="최종 대표이미지 전체 화면 미리보기" tabIndex={-1}
  onClick={()=>onClose()} onKeyDown={event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
   if(event.key==='Tab'){
    const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('button, [tabindex]')??[]).filter(control=>!control.hasAttribute('disabled')&&control.tabIndex>=0);
    const first=controls[0],last=controls.at(-1);
    if(!first){event.preventDefault();root.current?.focus();}
    else if(event.shiftKey&&(!controls.includes(document.activeElement as HTMLElement)||document.activeElement===first)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(!controls.includes(document.activeElement as HTMLElement)||document.activeElement===last)){event.preventDefault();first.focus();}
   }
  }} style={{position:'fixed',inset:0,zIndex:1600,display:'flex',alignItems:'center',justifyContent:'center',padding:32,background:'rgba(0,0,0,.9)',overflow:'hidden',overscrollBehavior:'contain',cursor:'zoom-out'}}>
  <button ref={closeButton} type="button" aria-label="최종 대표이미지 전체 화면 닫기" onClick={event=>{event.stopPropagation();onClose();}}
   style={{position:'absolute',right:20,top:16,width:44,height:44,border:0,borderRadius:22,background:'rgba(255,255,255,.18)',color:'white',fontSize:30,cursor:'pointer'}}>×</button>
  <img src={src} alt={alt} style={{maxWidth:'100%',maxHeight:'calc(100dvh - 64px)',objectFit:'contain'}}/>
 </div>;
}
