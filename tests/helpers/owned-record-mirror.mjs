import vm from 'node:vm';
import {singleRecordMirrorPage} from '../../extensions/supplier-hub/single-record-mirror-page.mjs';

export function ownedRecordMirrorRuntime(document,location){
 const storage=new Map(),control={failRead:false,failWrite:false},observers=new Set();let context;
 const original=document.documentElement.dataset;
 document.documentElement.dataset=new Proxy(original,{set(target,key,value){target[key]=value;if(key==='yoofamSingleDocumentRecords')queueMicrotask(()=>{for(const item of observers)item.callback([]);});return true;},deleteProperty(target,key){delete target[key];if(key==='yoofamSingleDocumentRecords')queueMicrotask(()=>{for(const item of observers)item.callback([]);});return true;}});
 const reset=()=>{
  observers.clear();
  class Observer{constructor(callback){this.callback=callback;}observe(){observers.add(this);}disconnect(){observers.delete(this);}}
  context=vm.createContext({document,location,MutationObserver:Observer,sessionStorage:{getItem:key=>{if(control.failRead)throw Error('synthetic blocked storage');return storage.get(key)??null;},setItem:(key,value)=>{if(control.failWrite)throw Error('synthetic quota failure');storage.set(key,value);}}});
 };
 reset();
 return{storage,control,reset,run:input=>{context.input=JSON.stringify(input);return JSON.parse(JSON.stringify(vm.runInContext('('+singleRecordMirrorPage.toString()+')(input)',context)));},flush:async()=>{await Promise.resolve();await Promise.resolve();},close:()=>observers.clear()};
}
