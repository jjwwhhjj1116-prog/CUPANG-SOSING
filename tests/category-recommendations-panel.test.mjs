import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),turn=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const option=(id='hat')=>({id,code:`code-${id}`,path:['패션의류잡화','모자',id],label:id});
const response=(name='수집한 모자',ownerId='owner',items=[option()])=>({source:'supplier-hub-category-predict-api',ownerId,company:{code:'A01464742',name:'와이홉'},productName:name,observedAt:1000,items});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture(loader=async name=>response(name)){
 const states=[],effects=[],requests=[],choices=[],timers=new Map();let cursor=0,dirty=false,closed=false,clock=0,nextTimer=1,tree;
 let props={initialTitle:'수집한 모자',workspaceOwnerId:'owner',disabled:false,onChoose:async(candidate,result)=>{choices.push({candidate,result});}};
 const hooks={
  useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>{const next=typeof value==='function'?value(states[index]):value;if(!Object.is(next,states[index])){states[index]=next;dirty=true;}}];},
  useRef(initial){const index=cursor++;return states[index]??(states[index]={current:initial});},
  useId(){const index=cursor++;return states[index]??(states[index]=`fixture-${index}`);},
  useEffect(fn,deps){const index=cursor++,old=states[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps};states[index]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}},
 };
 hooks.useLayoutEffect=(fn,deps)=>{const index=cursor++,old=states[index];if(!deps||!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps};states[index]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/category-recommendations-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,AbortController,Error,Set,
  setTimeout(fn,delay){const id=nextTimer++;timers.set(id,{at:clock+delay,fn});return id;},clearTimeout:id=>timers.delete(id),
  fetch:()=>assert.fail('The recommendation UI must use the category loader, never write products or fetch a source page'),
  require(name){if(name==='react')return hooks;if(name.endsWith('.css'))return{};if(name==='@/app/supplier-hub-category-recommendations')return{loadSupplierHubCategoryRecommendations:async(name,options)=>{requests.push({name,options});return loader(name,options);}};return require(name);},
 });
 function render(){assert.equal(closed,false);for(let pass=0;pass<20;pass++){dirty=false;cursor=0;tree=exports.CategoryRecommendationsPanel(props);effects.splice(0).forEach(fn=>fn());if(!dirty)return tree;}assert.fail('Unstable render loop');}
 render();
 return{requests,choices,render,
  set(patch){props={...props,...patch};return render();},
  input(){return nodes(render()).find(node=>node.type==='input'&&node.props.type!=='radio');},
  type(value){const input=this.input();assert.equal(input.props.disabled,false);input.props.onChange({target:{value}});render();},
  radios(){return nodes(render()).filter(node=>node.type==='input'&&node.props.type==='radio');},
  button(label){return nodes(render()).find(node=>node.type==='button'&&text(node)===label);},
  click(label){const button=this.button(label);assert.ok(button,label);assert.equal(button.props.disabled,false,label);button.props.onClick();render();},
  select(id){const radio=this.radios().find(node=>node.props.value===id);assert.ok(radio,id);radio.props.onChange();render();},
  async advance(milliseconds){const end=clock+milliseconds;for(;;){const ready=[...timers].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!ready)break;clock=ready[1].at;timers.delete(ready[0]);ready[1].fn();render();await turn();render();}clock=end;await turn();return render();},
  async settle(){await turn();return render();},
  close(){states.forEach(state=>state?.cleanup?.());closed=true;},
 };
}

test('initial title waits 600ms, displays at most three real paths, and only an explicit radio choice applies',async()=>{
 const h=fixture(async name=>response(name,'owner',[option('남성'),option('공용'),option('여성'),option('기타')]));try{
  await h.advance(599);assert.equal(h.requests.length,0);await h.advance(1);assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.force,false);
  assert.equal(h.radios().length,3);assert.ok(h.radios().every(radio=>radio.props.checked===false));assert.match(text(h.render()),/패션의류잡화 > 모자 > 남성/);
  assert.equal(h.button('선택한 카테고리 적용'),undefined);assert.equal(h.choices.length,0);
  h.select('공용');await h.settle();assert.equal(h.choices.length,1);assert.equal(h.choices[0].candidate.id,'공용');assert.equal(h.choices[0].result.productName,'수집한 모자');
 }finally{h.close();}
});

test('typing debounces to the latest name, aborts an old lookup and ignores its late result',async()=>{
 const pending=deferred();const h=fixture(name=>name==='수집한 모자'?pending.promise:Promise.resolve(response(name,'owner',[option('새경로')])));try{
  await h.advance(600);assert.equal(h.requests.length,1);h.type('새');assert.equal(h.requests[0].options.signal.aborted,true);
  await h.advance(300);h.type('새 상품');await h.advance(599);assert.equal(h.requests.length,1);await h.advance(1);assert.equal(h.requests.length,2);assert.equal(h.requests[1].name,'새 상품');
  pending.resolve(response());await h.settle();assert.equal(h.radios()[0].props.value,'새경로');assert.equal(h.input().props.value,'새 상품');assert.equal(h.choices.length,0);
 }finally{h.close();}
});

test('editable recommendation name is labelled as a query and does not promise to replace the SEO title',async()=>{
 const h=fixture();try{
  assert.match(text(h.render()),/추천 검색용 상품명/);assert.match(text(h.render()),/카테고리 추천에만 사용합니다/);assert.match(text(h.render()),/판매 상품명은 초안 작성 후 SEO 설정에서 수정/);
  const described=h.input().props['aria-describedby'];assert.ok(described);assert.ok(nodes(h.render()).some(node=>node.props?.id===described&&text(node).includes('카테고리 추천에만 사용')));
  h.type('모자 카테고리 검색어');await h.advance(600);h.select('hat');await h.settle();
  assert.equal(h.requests.at(-1).name,'모자 카테고리 검색어');assert.equal(h.choices.length,1);assert.equal(h.choices[0].result.productName,'모자 카테고리 검색어');
  assert.deepEqual(Object.keys(h.choices[0]).sort(),['candidate','result']);
 }finally{h.close();}
});

test('manual refresh runs once immediately, cancels debounce, clears a selection and forces a fresh recommendation',async()=>{
 const h=fixture();try{
  h.click('↻ 추천 새로고침');assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.force,true);await h.settle();await h.advance(600);assert.equal(h.requests.length,1);
  h.select('hat');await h.settle();assert.equal(h.choices.length,1);h.click('↻ 추천 새로고침');await h.settle();assert.equal(h.requests.length,2);assert.equal(h.requests[1].options.force,true);assert.equal(h.radios()[0].props.checked,false);assert.equal(h.choices.length,1);
 }finally{h.close();}
});

test('owner changes and disabled views abort pending work and never expose another member response',async()=>{
 const first=deferred(),second=deferred();const h=fixture((_name,options)=>options.workspaceOwnerId==='owner'?first.promise:second.promise);try{
  await h.advance(600);h.set({workspaceOwnerId:'second'});assert.equal(h.requests[0].options.signal.aborted,true);first.resolve(response());await h.settle();assert.equal(h.radios().length,0);
  await h.advance(600);assert.equal(h.requests[1].options.workspaceOwnerId,'second');h.set({disabled:true});assert.equal(h.requests[1].options.signal.aborted,true);second.resolve(response('수集한 모자','second'));await h.settle();assert.equal(h.radios().length,0);assert.equal(h.choices.length,0);
 }finally{h.close();}
});

test('a source title change resets its query and selection and a translated query never replaces the input',async()=>{
 const h=fixture(async name=>({...response(name),queryProductName:'남성 방한 귀달이 모자'}));try{
  await h.advance(600);h.select('hat');await h.settle();assert.match(text(h.render()),/추천에 사용한 상품명: 남성 방한 귀달이 모자/);assert.equal(h.input().props.value,'수집한 모자');
  h.set({initialTitle:'중국어 원문 新商品'});assert.equal(h.input().props.value,'중국어 원문 新商品');assert.equal(h.radios().length,0);assert.equal(h.button('선택한 카테고리 적용'),undefined);await h.advance(600);assert.equal(h.requests.at(-1).name,'중국어 원문 新商品');assert.equal(h.radios()[0].props.checked,false);
 }finally{h.close();}
});

test('empty, malformed identity and live errors remain visible without invented categories',async()=>{
 for(const answer of [()=>response('수집한 모자','owner',[]),()=>response('수집한 모자','another'),()=>Promise.reject(Error('Supplier Hub에 로그인해주세요.'))]){
  const h=fixture(answer);try{await h.advance(600);assert.equal(h.radios().length,0);assert.equal(h.button('선택한 카테고리 적용'),undefined);assert.equal(h.choices.length,0);
   const content=text(h.render());assert.match(content,/추천 카테고리가 없습니다|현재 회원과 상품명|Supplier Hub에 로그인해주세요/);
  }finally{h.close();}
 }
});

test('radio selection is single-flight, preserves a failed choice and offers an explicit retry only on failure',async()=>{
 const application=deferred(),h=fixture();let calls=0;try{
  h.set({onChoose:()=>{calls++;return application.promise;}});await h.advance(600);const radio=h.radios()[0];radio.props.onChange();radio.props.onChange();h.render();assert.equal(calls,1);assert.equal(h.input().props.disabled,true);assert.match(text(h.render()),/선택한 카테고리를 확인하고 있습니다/);assert.equal(h.button('선택한 카테고리 다시 적용'),undefined);
  application.reject(Error('선택한 경로의 공식 카테고리를 찾지 못했습니다.'));await h.settle();assert.match(text(h.render()),/공식 카테고리를 찾지 못했습니다/);assert.equal(h.radios()[0].props.checked,true);assert.equal(h.button('선택한 카테고리 다시 적용').props.disabled,false);assert.equal(calls,1);
  h.set({onChoose:()=>{calls++;}});h.click('선택한 카테고리 다시 적용');await h.settle();assert.equal(calls,2);assert.equal(h.button('선택한 카테고리 다시 적용'),undefined);
 }finally{h.close();}
});

test('unmount aborts a lookup and a late answer cannot apply or trigger another recommendation',async()=>{
 const pending=deferred(),h=fixture(()=>pending.promise);await h.advance(600);h.close();assert.equal(h.requests[0].options.signal.aborted,true);pending.resolve(response());await turn();assert.equal(h.choices.length,0);assert.equal(h.requests.length,1);
});

test('the parent busy state caused by a radio choice preserves its selection without a second prediction',async()=>{
 const application=deferred(),h=fixture();let calls=0;try{
  h.set({onChoose:()=>{calls++;return application.promise;}});await h.advance(600);h.select('hat');assert.equal(calls,1);
  h.set({disabled:true});application.resolve();await h.settle();h.set({disabled:false});await h.advance(1200);
  assert.equal(h.requests.length,1);assert.equal(h.radios().length,1);assert.equal(h.radios()[0].props.checked,true);assert.equal(calls,1);
 }finally{h.close();}
});
