import test from 'node:test';
import assert from 'node:assert/strict';
import {createSingleDocumentStore} from '../extensions/supplier-hub/single-document.mjs';

const copy=value=>value===undefined?undefined:structuredClone(value);
const scope={origin:'https://sourceflow.jjwwhhjj1116.workers.dev',ownerId:'owner-1',company:{code:'A01526306',name:'유앤채'},
  productId:'e2f8037c-294e-45a8-b06d-58cc5909683c',requestId:'f29491bd-1882-456a-8a63-eec8586db6c6',docId:2347603};
const key=index=>'product-document:'+index.toString(16).padStart(64,'0');
const laneKey='product-document-lane:'+'e'.repeat(64);
function checkpoint(changes={}){
  return {requestId:scope.requestId,docId:scope.docId,laneKey,state:'validated',sequence:12,validatedSteps:[2,3,4,5],
    identity:{origin:scope.origin,ownerId:scope.ownerId,company:copy(scope.company),productId:scope.productId},...changes};
}

// Model IDB's queued requests and transaction completion separately. A cursor
// result may be followed by a lane read in the same readonly transaction.
function fixture(entries=[],options={}){
  const rows=new Map(entries),stats={opens:[],transactions:[],gets:[],cursorRanges:[],seeks:[],writes:0,upgrades:0,upgradeAborts:0,closes:0,cursorResults:0};
  const db={objectStoreNames:{contains:name=>name==='operations'&&options.store!==false},close(){stats.closes++;},
    createObjectStore(){stats.writes++;assert.fail('Inspection must not initialize a store.');},
    transaction(name,mode){
      stats.transactions.push({name,mode});assert.equal(mode,'readonly');
      const tasks=[];let done=false;
      const transaction={error:null,abort(){if(done)return;done=true;transaction.error=Error('aborted inspection');transaction.onabort?.();},objectStore(storeName){
        assert.equal(storeName,'operations');
        const forbidden=()=>{stats.writes++;assert.fail('Inspection must not write records.');};
        return {put:forbidden,add:forbidden,delete:forbidden,clear:forbidden,
          get(recordKey){stats.gets.push(recordKey);const request={};tasks.push(()=>{request.result=copy(rows.get(recordKey));request.onsuccess?.();});return request;},
          openCursor(range){
            stats.cursorRanges.push(range);const request={},entries=[...rows].sort(([left],[right])=>left.localeCompare(right,'en',{usage:'sort'}))
              .filter(([recordKey])=>!range||recordKey>=range.lower&&recordKey<=range.upper);let index=0;
            // IndexedDB strings use code-unit ordering, not locale ordering.
            entries.sort(([left],[right])=>left<right?-1:left>right?1:0);
            const advance=target=>{if(target!==undefined)stats.seeks.push(target);tasks.push(()=>{
              while(target!==undefined&&index<entries.length&&entries[index][0]<target)index++;
              const row=entries[index++];request.result=row?{key:row[0],value:copy(row[1]),continue:advance}:null;
              if(row)stats.cursorResults++;request.onsuccess?.();
              if(row&&options.abortAfterCursor===stats.cursorResults)transaction.abort();
            });};advance();return request;
          },
        };
      }};
      setImmediate(()=>{while(tasks.length&&!done)tasks.shift()();if(!done){done=true;transaction.oncomplete?.();}});
      return transaction;
    },
  };
  const api={open(...args){
    stats.opens.push(args);const request={};queueMicrotask(()=>{
      if(options.openError){request.error=Error('open failed');request.onerror?.();return;}
      request.result=db;
      if(options.exists===false){
        let aborted=false;request.transaction={abort(){stats.upgradeAborts++;aborted=true;}};stats.upgrades++;request.onupgradeneeded?.();
        if(aborted){request.error=Error('creation aborted');request.onerror?.();return;}
      }
      request.onsuccess?.();
    });return request;
  }};
  if(options.enumerate!==false)api.databases=async()=>options.exists===false?[]:[{name:'yoofam-single-document-handoff',version:1}];
  return {rows,stats,store:createSingleDocumentStore(api)};
}

test('UUID inspection returns an independent lane snapshot from one readonly transaction without upgrades or writes',async()=>{
  const record=checkpoint(),lane={key:key(1)},f=fixture([[key(1),record],[laneKey,lane]]);
  const result=await f.store.inspectProductRequest(scope);
  assert.deepEqual(result,{matches:[{key:key(1),checkpoint:record,lane}],scanned:1,complete:true,available:true});
  assert.deepEqual(f.stats.transactions,[{name:'operations',mode:'readonly'}]);
  assert.deepEqual(f.stats.opens,[['yoofam-single-document-handoff']]);
  assert.deepEqual(f.stats.gets,[laneKey]);assert.equal(f.stats.writes,0);assert.equal(f.stats.upgrades,0);assert.equal(f.stats.closes,1);
  lane.key=key(9);record.docId=999;assert.equal(result.matches[0].lane.key,key(1));assert.equal(result.matches[0].checkpoint.docId,2347603);
});

test('lookup selects exact original scope and UUID but exposes a conflicting document ID',async()=>{
  const variants=[{origin:'http://localhost:3000'},{ownerId:'other-owner'},{company:{code:'A01464742',name:'와이홉'}},
    {company:{...scope.company,name:'other-name'}},{productId:'other-product'}];
  const rows=variants.map((change,index)=>[key(index+1),checkpoint({identity:{...checkpoint().identity,...change}})]);
  rows.push([key(10),checkpoint({requestId:'00000000-0000-4000-8000-000000000001'})],['single-document:'+'a'.repeat(64),checkpoint()],
    [key(11),checkpoint({docId:999})]);
  const f=fixture(rows),result=await f.store.inspectProductRequest(scope);
  assert.equal(result.complete,true);assert.equal(result.scanned,7);assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].checkpoint.docId,999);assert.equal(result.matches[0].lane,null);
});

test('two exact matches remain diagnosable; more matches cannot produce a complete result',async()=>{
  const first=checkpoint(),second=checkpoint({docId:'2347603'}),third=checkpoint({docId:999});
  const two=await fixture([[key(1),first],[key(2),second]]).store.inspectProductRequest(scope);
  assert.equal(two.matches.length,2);assert.equal(two.complete,true);assert.equal(two.scanned,2);
  const three=await fixture([[key(1),first],[key(2),second],[key(3),third]]).store.inspectProductRequest(scope);
  assert.equal(three.matches.length,2);assert.equal(three.complete,false);assert.equal(three.scanned,3);
});

test('scan inspects at most 500 product records and never reports absence as complete beyond the bound',async()=>{
  const rows=Array.from({length:500},(_,index)=>[key(index+1),checkpoint({requestId:'00000000-0000-4000-8000-000000000001'})]);
  const exact=await fixture(rows).store.inspectProductRequest(scope);
  assert.deepEqual(exact,{matches:[],scanned:500,complete:true,available:true});
  const over=await fixture([...rows,[key(501),checkpoint()]]).store.inspectProductRequest(scope);
  assert.deepEqual(over,{matches:[],scanned:500,complete:false,available:true});
});

test('cursor uses a product prefix key range when supported',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'IDBKeyRange'),calls=[];
  Object.defineProperty(globalThis,'IDBKeyRange',{configurable:true,value:{bound(lower,upper){calls.push({lower,upper});return {lower,upper};}}});
  try{
    const f=fixture([[laneKey,{key:key(1)}],[key(1),checkpoint()],['single-document:'+'f'.repeat(64),checkpoint()]]);
    const result=await f.store.inspectProductRequest(scope);
    assert.deepEqual(calls,[{lower:'product-document:',upper:'product-document:\uffff'}]);
    assert.deepEqual(f.stats.cursorRanges,calls);assert.equal(result.scanned,1);assert.equal(result.complete,true);
  }finally{if(original)Object.defineProperty(globalThis,'IDBKeyRange',original);else delete globalThis.IDBKeyRange;}
});

test('without key ranges the cursor seeks past unrelated earlier keys and stops after the product prefix',async()=>{
  const f=fixture([['a',{}],[laneKey,{key:key(1)}],[key(1),checkpoint()],['single-document:'+'f'.repeat(64),checkpoint()]]);
  const result=await f.store.inspectProductRequest(scope);
  assert.deepEqual(f.stats.seeks,['product-document:']);assert.equal(result.scanned,1);assert.equal(result.complete,true);assert.equal(f.stats.writes,0);
});

test('missing database or store is unavailable, without initializing either',async()=>{
  for(const options of [{exists:false},{store:false},{exists:false,enumerate:false}]){
    const f=fixture([],options),result=await f.store.inspectProductRequest(scope);
    assert.deepEqual(result,{matches:[],scanned:0,complete:true,available:false});assert.equal(f.stats.writes,0);assert.equal(f.stats.transactions.length,0);
    if(options.exists===false&&options.enumerate!==false)assert.equal(f.stats.opens.length,0);
    if(options.enumerate===false)assert.equal(f.stats.upgradeAborts,1);
  }
});

test('aborted or failed transactions reject rather than returning a partial checkpoint match',async()=>{
  const f=fixture([[key(1),checkpoint()],[laneKey,{key:key(1)}]],{abortAfterCursor:1});
  await assert.rejects(f.store.inspectProductRequest(scope),/aborted inspection/);
  assert.equal(f.stats.writes,0);assert.equal(f.stats.closes,1);
  await assert.rejects(fixture([],{openError:true}).store.inspectProductRequest(scope),/open failed/);
});

test('invalid or broadened scopes fail before any database access',async()=>{
  for(const change of [{requestId:'not-a-uuid'},{productId:''},{docId:null},{company:{...scope.company,extra:true}},
    {company:{code:'A01526306',name:'other-name'}},{origin:'https://untrusted.example'},{extra:true}]){
    const f=fixture();await assert.rejects(f.store.inspectProductRequest({...scope,...change}),error=>error.code==='CHECKPOINT_SCOPE');assert.equal(f.stats.opens.length,0);
  }
  const f=fixture(),missing={...scope};delete missing.docId;
  await assert.rejects(f.store.inspectProductRequest(missing),error=>error.code==='CHECKPOINT_SCOPE');assert.equal(f.stats.opens.length,0);
});
