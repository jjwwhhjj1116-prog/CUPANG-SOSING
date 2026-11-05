export function amendmentIndexedDB(entries=[]){
 const rows=new Map(entries.map(([key,value])=>[key,structuredClone(value)])),transactions=[];let running=false;const queue=[];
 const start=()=>{if(running||!queue.length)return;running=true;setImmediate(()=>{queue.shift()();running=false;start();});};
 const db={objectStoreNames:{contains:name=>name==='operations'},close(){},transaction(name,mode){
  const tasks=[];let values,aborted=false;
  const tx={error:null,abort(){if(aborted)return;aborted=true;tx.error=Error('aborted');tx.onabort?.();},objectStore(){return{
   get(key){const request={};tasks.push(()=>{request.result=structuredClone(values.get(key));request.onsuccess?.();});return request;},
   put(value,key){tasks.push(()=>{if(mode!=='readwrite')throw Error('readonly write');values.set(key,structuredClone(value));});},
   add(value,key){tasks.push(()=>{if(mode!=='readwrite'||values.has(key))throw Error('duplicate');values.set(key,structuredClone(value));});},
  };}};
  transactions.push({name,mode});queue.push(()=>{values=new Map([...rows].map(([key,value])=>[key,structuredClone(value)]));try{while(tasks.length&&!aborted)tasks.shift()();if(!aborted){if(mode==='readwrite'){rows.clear();for(const row of values)rows.set(...row);}tx.oncomplete?.();}}catch(error){tx.error=error;tx.abort();}});start();return tx;
 }};
 return{rows,transactions,api:{databases:async()=>[{name:'yoofam-single-document-handoff'}],open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}}};
}
