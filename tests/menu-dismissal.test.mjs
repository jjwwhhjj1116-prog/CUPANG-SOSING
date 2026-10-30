import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(){
 const listeners=new Map(),effects=[],menus=[];let added=0,removed=0;
 class Element{
  constructor(parent=null){this.parent=parent;this.focuses=0;}
  contains(target){for(let node=target;node;node=node.parent)if(node===this)return true;return false;}
  focus(){this.focuses++;doc.activeElement=this;}
 }
 const window={addEventListener(type,handler,capture){assert.equal(capture,true);added++;listeners.set('window:'+type,new Set([handler]));},removeEventListener(type,handler,capture){assert.equal(capture,true);removed++;listeners.get('window:'+type)?.delete(handler);}};
 const doc={defaultView:window,activeElement:null,querySelectorAll(selector){assert.equal(selector,'details[data-dismissable-menu][open]');return menus.filter(menu=>menu.marked&&menu.open);},
  addEventListener(type,handler,capture){assert.equal(capture,true);added++;if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(handler);},
  removeEventListener(type,handler,capture){assert.equal(capture,true);removed++;listeners.get(type)?.delete(handler);}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/use-menu-dismissal.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,document:doc,require(name){assert.equal(name,'react');return{useEffect:callback=>effects.push(callback)};}});
 const emit=(type,target,extra={})=>{const event={target,relatedTarget:null,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};for(const handler of [...listeners.get(type)??[]])handler(event);return event;};
 const menu=(marked=true)=>{const value=new Element();value.marked=marked;value.open=true;value.summary=new Element(value);value.querySelector=selector=>{assert.equal(selector,'summary');return value.summary;};menus.push(value);return value;};
 return{api:exports,doc,window,menu,Element,emit,effects,listeners,get added(){return added;},get removed(){return removed;}};
}

test('inside checkboxes and focus changes retain their menu; an outside pointer closes only marked menus',()=>{
 const h=fixture(),menu=h.menu(),ordinary=h.menu(false),checkbox=new h.Element(menu),second=new h.Element(menu),outside=new h.Element(),release=h.api.installMenuDismissal(h.doc);
 checkbox.checked=true;h.emit('pointerdown',checkbox);h.emit('mousedown',checkbox);h.emit('focusout',checkbox,{relatedTarget:second});h.emit('focusin',second);
 assert.equal(menu.open,true);assert.equal(checkbox.checked,true);assert.equal(ordinary.open,true);
 h.emit('pointerdown',outside);assert.equal(menu.open,false);assert.equal(ordinary.open,true,'content accordions are not popup menus');assert.equal(outside.focuses,0,'outside dismissal does not steal focus');release();
});

test('clicking another menu closes the first while preserving the second and all checkbox values',()=>{
 const h=fixture(),first=h.menu(),second=h.menu(),checkbox=new h.Element(second),release=h.api.installMenuDismissal(h.doc);checkbox.checked=true;
 h.emit('pointerdown',checkbox);assert.equal(first.open,false);assert.equal(second.open,true);assert.equal(checkbox.checked,true);
 first.open=true;h.emit('focusin',first.summary);assert.equal(first.open,true);assert.equal(second.open,false);release();
});

test('Escape closes open menus, restores the focused trigger and consumes the popup key before a parent dialog',()=>{
 const h=fixture(),first=h.menu(),second=h.menu(),ordinary=h.menu(false),inside=new h.Element(second),release=h.api.installMenuDismissal(h.doc);h.doc.activeElement=inside;
 const escape=h.emit('keydown',inside,{key:'Escape'});assert.equal(first.open,false);assert.equal(second.open,false);assert.equal(ordinary.open,true);assert.equal(second.summary.focuses,1);assert.equal(first.summary.focuses,0);assert.equal(escape.prevented,true);assert.equal(escape.stopped,true);
 const ignored=h.emit('keydown',ordinary,{key:'Escape'});assert.equal(ignored.prevented,false);assert.equal(ignored.stopped,false);release();
});

test('focus leaving for another control or the browser closes a menu without changing content accordions',()=>{
 const h=fixture(),menu=h.menu(),ordinary=h.menu(false),inside=new h.Element(menu),outside=new h.Element(),release=h.api.installMenuDismissal(h.doc);
 h.emit('focusout',inside,{relatedTarget:outside});assert.equal(menu.open,false);assert.equal(ordinary.open,true);
 menu.open=true;h.emit('focusout',inside,{relatedTarget:null});assert.equal(menu.open,true,'an inside whitespace click may blur a control without leaving the popup');h.emit('window:blur',h.window);assert.equal(menu.open,false);
 menu.open=true;h.emit('focusin',outside);assert.equal(menu.open,false);release();
});

test('shadow DOM composed paths count as inside and listener ownership is shared until final unmount',()=>{
 const h=fixture(),menu=h.menu(),retargeted=new h.Element(),first=h.api.installMenuDismissal(h.doc),second=h.api.installMenuDismissal(h.doc);
 assert.equal(h.added,6);h.emit('pointerdown',retargeted,{composedPath:()=>[retargeted,menu]});assert.equal(menu.open,true);
 first();first();assert.equal(h.removed,0);h.emit('pointerdown',retargeted);assert.equal(menu.open,false);
 menu.open=true;second();assert.equal(h.removed,6);h.emit('pointerdown',retargeted);assert.equal(menu.open,true,'unmounted owners leave no active callbacks');
 const next=h.api.installMenuDismissal(h.doc);assert.equal(h.added,12);h.emit('pointerdown',retargeted);assert.equal(menu.open,false);next();
});

test('controlled portal popovers retain inside and trigger interactions; outside closes once without applying draft values',()=>{
 const h=fixture(),root=new h.Element(),trigger=new h.Element(),inside=new h.Element(root),icon=new h.Element(trigger),draft={values:['one','two']},before=JSON.stringify(draft);let dismissed=0;
 const release=h.api.listenForPopupDismissal(h.doc,()=>root,()=>trigger,()=>dismissed++);
 h.emit('pointerdown',inside);h.emit('mousedown',icon);h.emit('focusout',inside,{relatedTarget:trigger});h.emit('focusin',trigger);assert.equal(dismissed,0);
 h.emit('pointerdown',new h.Element());h.emit('mousedown',new h.Element());assert.equal(dismissed,1);assert.equal(JSON.stringify(draft),before);assert.equal(trigger.focuses,0);release();
});

test('controlled popup Escape returns focus; focusleave and cleanup dismiss no more than the current mounted popup',()=>{
 const h=fixture(),root=new h.Element(),trigger=new h.Element(),inside=new h.Element(root);let closed=0;
 let release=h.api.listenForPopupDismissal(h.doc,()=>root,()=>trigger,()=>closed++);
 const escape=h.emit('keydown',inside,{key:'Escape'});assert.equal(closed,1);assert.equal(trigger.focuses,1);assert.equal(escape.prevented,true);release();
 release=h.api.listenForPopupDismissal(h.doc,()=>root,()=>trigger,()=>closed++);h.emit('focusout',inside,{relatedTarget:new h.Element()});assert.equal(closed,2);release();
 release=h.api.listenForPopupDismissal(h.doc,()=>root,()=>trigger,()=>closed++);release();h.emit('pointerdown',new h.Element());h.emit('keydown',inside,{key:'Escape'});assert.equal(closed,2);
});

test('React hooks attach only active popovers and release native listeners on unmount',()=>{
 const h=fixture(),root=new h.Element(),trigger=new h.Element();let closed=0;
 h.api.useMenuDismissal();const release=h.effects.shift()();assert.equal(h.added,6);release();assert.equal(h.removed,6);
 h.api.usePopupDismissal({current:root},()=>closed++,false,trigger);assert.equal(h.effects.shift()(),undefined);assert.equal(h.added,6);
 h.api.usePopupDismissal({current:root},()=>closed++,true,trigger);const cleanup=h.effects.shift()();assert.equal(h.added,12);cleanup();h.emit('focusin',new h.Element());assert.equal(closed,0);
});
