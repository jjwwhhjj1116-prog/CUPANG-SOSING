'use client';

import {useEffect,type RefObject} from 'react';

const selector='details[data-dismissable-menu][open]';
const owners=new WeakMap<Document,{count:number;remove:()=>void}>();
const contains=(root:Node|null|undefined,target:EventTarget|null)=>Boolean(root&&target&&root.contains(target as Node));
const inside=(event:Event,root:Node|null|undefined)=>Boolean(root&&(event.composedPath?.().includes(root)||contains(root,event.target)));

/** Explicit popup markers keep ordinary content disclosures open. Multiple
 * mounted owners share one document listener set, including their cleanup. */
export function installMenuDismissal(doc:Document):()=>void{
 let owner=owners.get(doc);
 if(!owner){
  const menus=()=>Array.from(doc.querySelectorAll<HTMLDetailsElement>(selector));
  const outside=(event:Event)=>{for(const menu of menus())if(!inside(event,menu))menu.open=false;};
  const leave=(event:FocusEvent)=>{if(!event.relatedTarget)return;for(const menu of menus())if(inside(event,menu)&&!contains(menu,event.relatedTarget))menu.open=false;};
  const blur=(event:FocusEvent)=>{if(event.target===doc.defaultView)for(const menu of menus())menu.open=false;};
  const escape=(event:KeyboardEvent)=>{
   if(event.key!=='Escape')return;
   const open=menus();if(!open.length)return;
   const focused=open.find(menu=>contains(menu,doc.activeElement));
   for(const menu of open)menu.open=false;
   event.preventDefault();event.stopPropagation();focused?.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});
  };
  doc.addEventListener('pointerdown',outside,true);doc.addEventListener('mousedown',outside,true);doc.addEventListener('focusin',outside,true);
  doc.addEventListener('focusout',leave,true);doc.addEventListener('keydown',escape,true);
  doc.defaultView?.addEventListener('blur',blur,true);
  owner={count:0,remove:()=>{
   doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('mousedown',outside,true);doc.removeEventListener('focusin',outside,true);
   doc.removeEventListener('focusout',leave,true);doc.removeEventListener('keydown',escape,true);
   doc.defaultView?.removeEventListener('blur',blur,true);
  }};owners.set(doc,owner);
 }
 const entry=owner;entry.count++;let released=false;
 return()=>{if(released)return;released=true;entry.count--;if(!entry.count){entry.remove();owners.delete(doc);}};
}

export function useMenuDismissal(){useEffect(()=>installMenuDismissal(document),[]);}

/** Controlled popovers use the same inside/outside rules, including a separate
 * trigger when the content is rendered in a portal. Dismissal changes UI only. */
export function listenForPopupDismissal(doc:Document,root:()=>HTMLElement|null,trigger:()=>HTMLElement|null|undefined,onDismiss:()=>void):()=>void{
 let dismissed=false;
 const dismiss=(restoreFocus=false)=>{if(dismissed)return;dismissed=true;onDismiss();if(restoreFocus)trigger()?.focus?.({preventScroll:true});};
 const within=(event:Event)=>inside(event,root())||inside(event,trigger());
 const outside=(event:Event)=>{if(!within(event))dismiss();};
 const leave=(event:FocusEvent)=>{if(event.relatedTarget&&within(event)&&!contains(root(),event.relatedTarget)&&!contains(trigger(),event.relatedTarget))dismiss();};
 const blur=(event:FocusEvent)=>{if(event.target===doc.defaultView)dismiss();};
 const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss(true);}};
 doc.addEventListener('pointerdown',outside,true);doc.addEventListener('mousedown',outside,true);doc.addEventListener('focusin',outside,true);
 doc.addEventListener('focusout',leave,true);doc.addEventListener('keydown',escape,true);
 doc.defaultView?.addEventListener('blur',blur,true);
 return()=>{
  dismissed=true;
  doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('mousedown',outside,true);doc.removeEventListener('focusin',outside,true);
  doc.removeEventListener('focusout',leave,true);doc.removeEventListener('keydown',escape,true);
  doc.defaultView?.removeEventListener('blur',blur,true);
 };
}

export function usePopupDismissal(root:RefObject<HTMLElement|null>,onDismiss:()=>void,active=true,trigger?:HTMLElement|null){
 useEffect(()=>{if(!active)return;return listenForPopupDismissal(document,()=>root.current,()=>trigger,onDismiss);},[root,onDismiss,active,trigger]);
}
