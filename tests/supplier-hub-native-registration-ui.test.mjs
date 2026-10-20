import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const source=fs.readFileSync(new URL('../app/components/supplier-hub-native-registration.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const receipt=(company=companies[0])=>({recordType:'product-document',productId:'synthetic-752',requestId:'f0abeef0-0752-4abe-8eee-000000000752',docId:'752',
  identity:{ownerId:'owner-'+company.code,company},company,receipt:{qvtRequestId:752,sourceStatus:'FINISHED'},categoryId:'69617',members:[{optionId:'black'},{optionId:'blue'},{optionId:'gray'}]});
const observation=row=>({source:'supplier-hub-native-registration-v1',ownerId:row.identity.ownerId,company:plain(row.company),productId:row.productId,requestId:row.requestId,
  docId:row.docId,qvtRequestId:row.receipt.qvtRequestId,categoryId:row.categoryId,membersCount:row.members.length,identityDigest:'a'.repeat(64),preparedBodySha256:'b'.repeat(64),
  observedAt:1792454400000,rows:[{quotationId:'001752',skuId:null,productName:'검수 대기 상품',status:'INSPECTION'},
    {quotationId:'002752',skuId:'000456',productName:'검수한 상품',status:'INSPECTION_COMPLETE'},{quotationId:'003752',skuId:null,productName:'반려 상품',status:'REJECTION'}],
  total:3,pagesRead:2,registered:false,mutated:false,optionMapping:'unverified'});

function fixture(company=companies[0]){
  const slots=[],calls=[];let cursor=0,closed=false,late=0,scopeKey,props={receipt:receipt(company),disabled:false},reader=async row=>observation(row);
  const react={
    useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{if(closed)late++;slots[index]=typeof value==='function'?value(slots[index]):value;}];},
    useRef(value){const index=cursor++;if(!(index in slots))slots[index]={current:value};return slots[index];},
    useLayoutEffect(effect,deps){const index=cursor++,old=slots[index];if(!old||!deps||deps.some((dep,i)=>!Object.is(dep,old.deps[i]))){old?.cleanup?.();slots[index]={deps,cleanup:effect()};}}
  };
  const exports={};
  vm.runInNewContext(compiled,{exports,AbortController,Error,require(name){
    if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;
    if(name==='@/app/supplier-hub-product-receipt')return {productReceiptCanonical:JSON.stringify};
    if(name==='@/app/supplier-hub-native-registration')return {readSupplierHubNativeRegistration(row,signal){calls.push({row:plain(row),signal});return reader(row,signal);}};
    throw Error('Unexpected dependency: '+name);
  }});
  const render=()=>{
    const boundary=exports.SupplierHubNativeRegistration(props);
    if(scopeKey!==boundary.key){for(const slot of slots)slot?.cleanup?.();slots.splice(0);scopeKey=boundary.key;}
    cursor=0;return boundary.type(boundary.props);
  };
  const h={calls,render,text:()=>text(render()),get late(){return late;},props:()=>props,
    setReader(value){reader=value;},setProps(value){props={...props,...value};render();},
    button(label){return nodes(render()).find(node=>node.type==='button'&&node.props.children===label);},
    click(label){const button=h.button(label);assert.ok(button,label);assert.equal(Boolean(button.props.disabled),false,label);button.props.onClick();render();},
    async settle(){for(let i=0;i<4;i++){await turn();render();}},
    close(){for(const slot of slots)slot?.cleanup?.();closed=true;}
  };render();return h;
}
const read='상품별 접수 상태 조회',cancel='조회 취소';

for(const company of companies)test(company.name+': read is explicit, renders exact native identifiers and nullable pending SKU without an option/completion claim',async()=>{
  const h=fixture(company);try{
    await h.settle();assert.equal(h.calls.length,0);h.setProps({receipt:plain(h.props().receipt)});await h.settle();assert.equal(h.calls.length,0);
    h.click(read);await h.settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].row.company.code,company.code);
    const value=h.text();for(const expected of ['001752','002752','000456','검수 중','검수 완료','반려','미발급','원래 옵션과의 개별 연결은 확인 전'])assert.ok(value.includes(expected),expected);
    assert.match(value,/상품\s*3\s*건/);assert.match(value,/페이지\s*2\s*개/);assert.equal(value.includes('등록 완료'),false);
    assert.equal(nodes(h.render()).some(node=>node.type==='select'||node.type==='input'),false);
    assert.equal(h.calls[0].signal.aborted,false);assert.equal(h.button(cancel),undefined);
  }finally{h.close();}
});

test('busy locks synchronously against repeated stale callbacks; cancellation aborts and discards late rows',async()=>{
  const h=fixture(),held=deferred();h.setReader(()=>held.promise);try{
    const callback=h.button(read).props.onClick;callback();callback();h.render();assert.equal(h.calls.length,1);assert.equal(h.button(read).props.disabled,true);
    h.click(cancel);assert.equal(h.calls[0].signal.aborted,true);held.resolve(observation(h.props().receipt));await h.settle();assert.equal(h.text().includes('001752'),false);
    assert.equal(h.button(read).props.disabled,false);h.setReader(async row=>observation(row));h.click(read);await h.settle();assert.equal(h.calls.length,2);assert.ok(h.text().includes('001752'));
  }finally{held.resolve();h.close();}
});

test('a cancelled request settling after a new read cannot replace its rows or release its busy lock',async()=>{
  const h=fixture(),first=deferred(),second=deferred();let count=0;h.setReader(()=>++count===1?first.promise:second.promise);
  try{
    h.click(read);h.click(cancel);h.click(read);assert.equal(h.calls.length,2);first.resolve(observation(h.props().receipt));await h.settle();
    assert.equal(h.button(read).props.disabled,true);assert.equal(h.text().includes('001752'),false);
    second.resolve({...observation(h.props().receipt),rows:[],total:0,pagesRead:1});await h.settle();
    assert.equal(h.button(read).props.disabled,false);assert.ok(h.text().includes('접수 결과가 아직 없습니다'));assert.equal(h.text().includes('001752'),false);
  }finally{first.resolve();second.resolve();h.close();}
});

test('receipt scope changes abort pending reads and suppress stale callbacks and results',async()=>{
  const changes=[row=>{row.identity.ownerId='different-owner';},row=>{row.company=plain(companies[1]);row.identity.company=plain(companies[1]);},
    row=>{row.requestId='different-request';},row=>{row.docId=753;},row=>{row.receipt.qvtRequestId='752';},row=>{row.categoryId='69618';},row=>{row.members.reverse();}];
  for(const change of changes){const h=fixture(),held=deferred(),original=plain(h.props().receipt);h.setReader(()=>held.promise);try{
    const callback=h.button(read).props.onClick;callback();h.render();const changed=plain(original);change(changed);h.setProps({receipt:changed});
    assert.equal(h.calls[0].signal.aborted,true);callback();assert.equal(h.calls.length,1);held.resolve(observation(original));await h.settle();
    assert.equal(h.text().includes('001752'),false);assert.equal(h.button(read).props.disabled,false);
  }finally{held.resolve();h.close();}}
});

test('a changed receipt clears earlier successful rows immediately and requires a fresh explicit query',async()=>{
  const h=fixture();try{
    h.click(read);await h.settle();assert.ok(h.text().includes('001752'));
    h.setProps({receipt:{...h.props().receipt,requestId:'other-request'}});assert.equal(h.text().includes('001752'),false);await h.settle();assert.equal(h.calls.length,1);
  }finally{h.close();}
});

test('disabled props prevent dispatch, cancel an active query, clear old rows and never replay when re-enabled',async()=>{
  const h=fixture(),held=deferred();h.setReader(()=>held.promise);try{
    const callback=h.button(read).props.onClick;h.setProps({disabled:true});callback();await h.settle();assert.equal(h.calls.length,0);assert.equal(h.button(read).props.disabled,true);
    h.setProps({disabled:false});await h.settle();assert.equal(h.calls.length,0);h.click(read);h.setProps({disabled:true});
    assert.equal(h.calls[0].signal.aborted,true);held.resolve(observation(h.props().receipt));await h.settle();assert.equal(h.text().includes('001752'),false);
    h.setProps({disabled:false});await h.settle();assert.equal(h.calls.length,1);
    h.setReader(async row=>observation(row));h.click(read);await h.settle();assert.ok(h.text().includes('001752'));h.setProps({disabled:true});assert.equal(h.text().includes('001752'),false);
  }finally{held.resolve();h.close();}
});

test('owner or Hub errors clear previous success and offer an explicit retry without automatic fallback',async()=>{
  for(const reason of ['현재 회원 회사가 변경되었습니다.','Supplier Hub 조회에 실패했습니다.']){const h=fixture();try{
    h.click(read);await h.settle();assert.ok(h.text().includes('001752'));h.setReader(async()=>{throw Error(reason);});h.click(read);await h.settle();
    assert.equal(h.text().includes('001752'),false);assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'&&text(node)===reason));
    await h.settle();assert.equal(h.calls.length,2);assert.equal(h.button(read).props.disabled,false);
  }finally{h.close();}}
});

test('zero rows remain pending and a late success after unmount cannot update state',async()=>{
  const empty=fixture();try{empty.setReader(async row=>({...observation(row),rows:[],total:0,pagesRead:1}));empty.click(read);await empty.settle();
    assert.ok(empty.text().includes('연결된 상품 접수 결과가 아직 없습니다'));assert.equal(empty.text().includes('등록 완료'),false);assert.equal(nodes(empty.render()).some(node=>node.type==='table'),false);
  }finally{empty.close();}
  const h=fixture(),held=deferred();h.setReader(()=>held.promise);h.click(read);h.close();assert.equal(h.calls[0].signal.aborted,true);
  held.resolve(observation(h.props().receipt));await turn();await turn();assert.equal(h.late,0);
});

test('native lookup is mounted only for stored whole-product receipt history',()=>{
  const transport=fs.readFileSync(new URL('../app/components/supplier-hub-product-transport.tsx',import.meta.url),'utf8');
  assert.match(transport,/'recordType' in row&&row\.recordType==='product-document'&&<SupplierHubNativeRegistration receipt=\{row\} disabled=\{disabled\|\|busy\}/);
  assert.equal((transport.match(/<SupplierHubNativeRegistration/g)||[]).length,1);
});
