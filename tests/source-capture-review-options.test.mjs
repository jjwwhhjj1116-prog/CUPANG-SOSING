import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceReviewModule,reviewSourceFixture,sourceReviewNodes as nodes,sourceReviewText as text} from './helpers/source-review-intake.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));
const sourceModel=sourceReviewModule('app/source-inbox.ts');
const transition=sourceReviewModule('app/source-review-intake.ts');

function fixture(item,{initial=false}={}){
 const slots=[],effects=[],cleanups=[],calls=[],acks=[],added=[];let cursor=0,first=true,current=structuredClone(item);
 const hooks={
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];},
  useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},
  useMemo(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))slots[index]={deps,value:fn()};return slots[index].value;},
  useLayoutEffect(fn){effects.push(fn);},useEffect(fn){if(first)effects.push(fn);},
 };
 const window={addEventListener(){},removeEventListener(){}};
 const {SourceInboxPanel}=sourceReviewModule('app/components/source-inbox-panel.tsx',{hooks,window,location:{origin:'https://app.test'},fetch:async(path,init)=>{
  calls.push({path,init});assert.equal(path,'/api/source-inbox');
  if(!init?.method)return Response.json({ownerId:item.ownerId,items:[current]});
  assert.equal(init.method,'PUT');const body=JSON.parse(init.body);
  assert.equal(body.expectedOwnerId,current.ownerId);assert.equal(body.id,current.id);assert.equal(body.expectedRevision,current.revision);
  try{const reviewed=sourceModel.reviewPageSource(current.snapshot,body.review),saved={...current,revision:current.revision+1,reviewed,issues:sourceModel.sourceInboxStatus(current.snapshot,reviewed)};
   assert.equal(transition.validateReviewedSourceTransition(current,saved,current.ownerId),true);current=saved;return Response.json({ownerId:item.ownerId,item:saved});
  }catch(error){return Response.json({error:error.message},{status:422});}
 }});
 function render(){cursor=0;const tree=SourceInboxPanel({ownerId:item.ownerId,disabled:false,initialItem:initial?item:undefined,onAdd:value=>added.push(value),onReviewed:(saved,before)=>acks.push({saved,before})});effects.splice(0).forEach(fn=>cleanups.push(fn()));first=false;return tree;}
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 const control=label=>{const result=nodes(render()).find(node=>node.props?.['aria-label']===label);assert.ok(result,label);return result;};
 return {render,button,control,calls,acks,added,current:()=>current,open:()=>render().props.onToggle({currentTarget:{open:true}}),close:()=>cleanups.forEach(fn=>fn?.())};
}

function capture(company){
 const {before}=reviewSourceFixture('owner',company);
 before.snapshot.options=['black','gray','blue'].map((key,index)=>({key,name:['黑色','灰色','蓝色'][index],supplierSku:'observed-'+key,unitPriceCny:index+3,currency:'CNY',minimumOrder:index+1,stock:index+10,imageUrl:`https://cbu01.alicdn.com/synthetic-${key}.png`,axisValues:[{label:'颜色',value:key}]}));
 before.snapshot.images=before.snapshot.options.map((option,index)=>({url:option.imageUrl,role:index?'additional':'main'}));before.issues=[];
 return before;
}

for(const [index,company] of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}].entries())test(company.code+': saving a subset and reopening restores excluded options, preserves reviewed edits and accepts explicit reinclusion',async()=>{
 const original=capture(company),raw=JSON.stringify(original),h=fixture(original,{initial:index===0});
 try{
  h.render();if(index!==0){h.open();await turn();h.button('상품정보 확인').props.onClick();}
  h.control('1번째 옵션명').props.onChange({target:{value:'직접 수정한 검정'}});
  h.control('1번째 위안 원가').props.onChange({target:{value:'6.75'}});
  h.control('1번째 공급자 SKU').props.onChange({target:{value:'reviewed-black'}});
  h.control('3번째 옵션명').props.onChange({target:{value:'직접 수정한 파랑'}});
  h.control('3번째 위안 원가').props.onChange({target:{value:'8.25'}});
  h.control('3번째 최소 주문 수량').props.onChange({target:{value:'7'}});
  h.control('2번째 수집 옵션 사용').props.onChange({target:{checked:false}});
  h.button('검토한 상품정보 저장').props.onClick();await turn();assert.equal(h.acks.length,1);
  const subset=h.current();assert.deepEqual(plain(subset.reviewed.options.map(option=>option.key)),['black','blue']);
  h.button('상품정보 확인').props.onClick();
  assert.deepEqual([1,2,3].map(row=>h.control(`${row}번째 옵션명`).props.value),['직접 수정한 검정','灰色','직접 수정한 파랑']);
  assert.deepEqual([1,2,3].map(row=>h.control(`${row}번째 수집 옵션 사용`).props.checked),[true,false,true]);
  assert.equal(h.control('1번째 위안 원가').props.value,6.75);assert.equal(h.control('3번째 위안 원가').props.value,8.25);
  assert.equal(h.control('1번째 공급자 SKU').props.value,'reviewed-black');assert.equal(h.control('3번째 최소 주문 수량').props.value,7);
  assert.equal(h.control('2번째 위안 원가').props.value,4);assert.equal(h.control('2번째 공급자 SKU').props.value,'observed-gray');
  h.control('2번째 수집 옵션 사용').props.onChange({target:{checked:true}});
  h.button('검토한 상품정보 저장').props.onClick();await turn();assert.equal(h.acks.length,2);
  const saved=h.current();assert.deepEqual(plain(saved.reviewed.options.map(option=>option.key)),['black','gray','blue']);
  assert.deepEqual(plain(saved.reviewed.options.map(option=>[option.name,option.unitPriceCny])),[['직접 수정한 검정',6.75],['灰色',4],['직접 수정한 파랑',8.25]]);
  assert.deepEqual(plain(saved.reviewed.options.map(option=>[option.imageUrl,option.stock,option.axisValues])),original.snapshot.options.map(option=>[option.imageUrl,option.stock,option.axisValues]));
  assert.equal(JSON.stringify(saved.snapshot),JSON.stringify(original.snapshot));assert.equal(JSON.stringify(original),raw);
  h.button('카테고리 선택·초안 작성').props.onClick();assert.deepEqual(h.added[0],saved);
  assert.deepEqual(h.calls.map(call=>call.init?.method??'GET'),index===0?['PUT','PUT']:['GET','PUT','PUT']);
 }finally{h.close();}
});

test('initial reviewed subset uses immutable source order and keys, and never fills excluded unknown facts from a different reviewed option',async()=>{
 const original=capture({code:'A01464742',name:'와이홉'});
 Object.assign(original.snapshot.options[1],{supplierSku:null,unitPriceCny:null,currency:null,minimumOrder:null});
 const reviewed=sourceModel.reviewPageSource(original.snapshot,{title:'검토한 제목',options:[original.snapshot.options[2],original.snapshot.options[0]].map(option=>({...Object.fromEntries(['key','name','supplierSku','unitPriceCny','currency','minimumOrder'].map(key=>[key,option[key]])),name:'검토 '+option.key,unitPriceCny:option.key==='black'?12.5:19.5}))});
 const item={...original,revision:2,reviewed,issues:[]},raw=JSON.stringify(item),h=fixture(item,{initial:true});
 try{
  assert.deepEqual([1,2,3].map(row=>h.control(`${row}번째 옵션명`).props.value),['검토 black','灰色','검토 blue']);
  assert.deepEqual([1,2,3].map(row=>h.control(`${row}번째 수집 옵션 사용`).props.checked),[true,false,true]);
  assert.equal(h.control('1번째 위안 원가').props.value,12.5);assert.equal(h.control('3번째 위안 원가').props.value,19.5);
  for(const label of ['공급자 SKU','위안 원가','통화','최소 주문 수량'])assert.equal(h.control(`2번째 ${label}`).props.value,'');
  h.control('2번째 수집 옵션 사용').props.onChange({target:{checked:true}});h.button('검토한 상품정보 저장').props.onClick();await turn();
  assert.equal(h.acks.length,0);assert.match(text(h.render()),/확인해주세요/);assert.equal(h.control('2번째 수집 옵션 사용').props.checked,true);
  assert.equal(h.control('1번째 위안 원가').props.value,12.5);assert.equal(JSON.stringify(item),raw);assert.equal(h.current().revision,2);
 }finally{h.close();}
});
