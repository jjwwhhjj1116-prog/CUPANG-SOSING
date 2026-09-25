import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture() {
  const slots=[], pending=[], timers=new Map(), requests=[];
  let cursor=0, changed=true, timerId=0, value;
  const same=(a,b)=>a && b && a.length===b.length && a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;slots[i]??={value:initial};return[slots[i].value,v=>{const next=typeof v==='function'?v(slots[i].value):v;if(!Object.is(next,slots[i].value)){slots[i].value=next;changed=true;}}];},
    useRef(initial){const i=cursor++;slots[i]??={current:initial};return slots[i];},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const previous=slots[i];slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}},
  };
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/use-intake-draft.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,AbortController,Error,Date,Promise,
    require(name){if(name==='react')return react;return{intakeDraftBody:(rows,goal,expectedRevision)=>({rows,goal,expectedRevision})};},
    window:{setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},addEventListener(){},removeEventListener(){}},
    fetch(url,options={}){return new Promise(resolve=>requests.push({options,resolve}));},
  });
  function render(){while(changed){changed=false;cursor=0;value=exports.useIntakeDraft();while(pending.length)pending.shift()();}}
  async function settle(){for(let i=0;i<8;i++){await Promise.resolve();render();}}
  function respond(index,status=200,revision=1){requests[index].resolve({ok:status===200,json:async()=>status===200?{draft:{revision,rows:[],goal:'price',updatedAt:null}}:{error:'revision conflict'}});}
  return{requests,timers,get value(){return value;},render,settle,respond,
    async start(){render();await settle();respond(0,200,0);await settle();},
    async tick(){const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());await settle();},
    stop(){slots.forEach(s=>s?.cleanup?.());},
  };
}

test('autosave coalesces edits and serializes edits made during a pending write using the returned revision',async()=>{
  const f=fixture();await f.start();assert.equal(f.timers.size,0);
  f.value.setGoal('collect');f.render();f.value.setGoal('work');f.render();assert.equal(f.timers.size,1);
  await f.tick();assert.equal(f.requests.length,2);assert.equal(JSON.parse(f.requests[1].options.body).goal,'work');
  assert.equal(f.value.loading,false);assert.equal(f.value.saving,true);
  f.value.setGoal('transmit');f.render();assert.equal(f.timers.size,0);
  f.respond(1,200,1);await f.settle();assert.equal(f.value.dirty,true);assert.equal(f.value.goal,'transmit');
  await f.tick();assert.equal(f.requests.length,3);assert.equal(JSON.parse(f.requests[2].options.body).expectedRevision,1);
  assert.equal(JSON.parse(f.requests[2].options.body).goal,'transmit');
  f.respond(2,200,2);await f.settle();assert.equal(f.value.dirty,false);assert.equal(f.timers.size,0);f.stop();
});

test('conflict preserves inputs and pauses automatic retries until a manual save succeeds',async()=>{
  const f=fixture();await f.start();f.value.setGoal('work');f.render();await f.tick();
  f.respond(1,409);await f.settle();assert.equal(f.value.autoPaused,true);assert.equal(f.value.dirty,true);
  f.value.setGoal('collect');f.render();await f.tick();assert.equal(f.requests.length,2);
  const saved=f.value.save();f.render();f.respond(2,200,1);await saved;await f.settle();
  assert.equal(f.value.autoPaused,false);assert.equal(f.value.goal,'collect');assert.equal(f.value.dirty,false);f.stop();
});

test('unmount cancels debounce and aborts pending saves without accepting a late response',async()=>{
  const f=fixture();await f.start();f.value.setGoal('work');f.render();f.stop();assert.equal(f.timers.size,0);
  const g=fixture();await g.start();g.value.setGoal('work');g.render();await g.tick();g.stop();
  assert.equal(g.requests[1].options.signal.aborted,true);g.respond(1);await g.settle();assert.equal(g.value.dirty,true);
});
