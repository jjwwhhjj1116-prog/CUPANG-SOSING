import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeChartSaveFixture,sizeChartSaveUi,json,nodes,text,chart} from './helpers/size-chart-save.mjs';

const action='Free Size · 상세페이지 참조로 작성';
const reference={sizeType:'사이즈 정보',sizeUnits:'none',sizes:['Free Size'],measurements:[
 {name:'사이즈',values:['Free Size (옵션명 또는 상세페이지 참조)']},
 {name:'상세 규격',values:['상세페이지 참조']},
]};
async function emptyWorkspace(){
 const f=await sizeChartSaveFixture(),content=(await json(await f.route(f.base+'/content'))).content;
 await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{size:[]}}}}));
 return f;
}

test('explicit Free Size creates a local editable draft and only existing atomic Save persists its table and PNG',async()=>{
 const f=await emptyWorkspace(),ui=sizeChartSaveUi(f);try{
  await ui.idle();const before=await json(await f.get()),options=f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload;
  await ui.click(action);
  assert.equal(ui.input('사이즈 유형').props.value,'사이즈 정보');assert.equal(ui.input('사이즈표 단위').props.value,'none');assert.equal(ui.input('사이즈 목록').props.value,'Free Size');
  assert.equal(ui.input('측정 항목 1 이름').props.value,'사이즈');assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value,'Free Size (옵션명 또는 상세페이지 참조)');
  assert.equal(ui.input('측정 항목 2 이름').props.value,'상세 규격');assert.equal(ui.input('측정 항목 2 사이즈 1 값').props.value,'상세페이지 참조');
  assert.equal(ui.render().props['data-workspace-dirty'],true);assert.equal(ui.saves,0);assert.equal(ui.calls.filter(call=>call.method!=='GET').length,0);
  assert.deepEqual((await json(await f.get())).content,before.content);
  ui.edit('측정 항목 2 사이즈 1 값','공급자 상세페이지의 규격 참조');
  const preview=nodes(ui.render()).find(node=>node.props?.['aria-label']==='사이즈표 미리보기');assert.match(text(preview),/공급자 상세페이지의 규격 참조/);assert.doesNotMatch(text(preview),/\bcm\b|\bkg\b/);
  ui.edit('측정 항목 2 사이즈 1 값','상세페이지 참조');
  await ui.click('사이즈표 저장');assert.deepEqual(ui.alerts(),[]);assert.equal(ui.saves,1);assert.deepEqual(ui.calls.filter(call=>call.method!=='GET').map(call=>call.method),['POST']);
  const saved=await json(await f.get());assert.deepEqual(saved.content.manualSizeChart,reference);
  assert.equal(saved.content.assets.size.value.length,1);assert.equal(saved.content.assets.size.provenance,'generated');assert(nodes(ui.render()).some(node=>node.props?.['data-saved-size-chart']));
  assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,options);assert.deepEqual(f.h.network,[]);
 }finally{ui.close();f.close();}
});

test('a saved result keeps download and rewrite, and explicit rewrite exposes Free Size only when no manual chart exists',async()=>{
 const f=await sizeChartSaveFixture(),ui=sizeChartSaveUi(f);try{
  await ui.idle();assert.equal(ui.button(action),undefined);assert(nodes(ui.render()).some(node=>node.type==='a'&&node.props.download==='size_chart.png'));
  await ui.click('재작성');await ui.click(action);assert.equal(ui.input('측정 항목 2 사이즈 1 값').props.value,'상세페이지 참조');assert.equal(ui.calls.filter(call=>call.method!=='GET').length,0);
 }finally{ui.close();f.close();}
 const manual=await emptyWorkspace();let editor;try{
  const content=(await json(await manual.route(manual.base+'/content'))).content;
  await json(await manual.route(manual.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{manualSizeChart:chart}}}));
  editor=sizeChartSaveUi(manual);await editor.idle();assert.equal(editor.button(action),undefined);assert.equal(editor.input('사이즈 유형').props.value,chart.sizeType);assert.equal(editor.input('측정 항목 1 사이즈 1 값').props.value,'61');
  assert.equal(editor.calls.filter(call=>call.method!=='GET').length,0);
 }finally{editor?.close();manual.close();}
});

test('a retained Free Size action cannot replace a manual draft or an unresolved atomic save attempt',async()=>{
 const f=await emptyWorkspace(),ui=sizeChartSaveUi(f);try{
  await ui.idle();const retained=ui.button(action).props.onClick;
  ui.button('사이즈표 직접 작성').props.onClick();retained();
  assert.equal(ui.input('사이즈 유형').props.value,'일반 사이즈');assert.equal(ui.input('측정 항목 1 이름').props.value,'');
  ui.edit('측정 항목 1 이름','확인한 총장');ui.edit('측정 항목 1 사이즈 1 값','63');retained();
  assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value,'63');assert.equal(ui.button(action),undefined);
  f.fault(1);await ui.click('사이즈표 저장');const calls=ui.calls.length;retained();
  assert.equal(ui.input('측정 항목 1 사이즈 1 값').props.value,'63');assert(ui.button('저장 결과 확인'));assert.equal(ui.calls.length,calls);assert.equal(ui.saves,0);
 }finally{ui.close();f.close();}
});

for(const guard of ['inactive','disabled','stale version','profile ABA','unmounted'])test(`a retained Free Size action cannot seed after ${guard}`,async()=>{
 const f=await emptyWorkspace(),ui=sizeChartSaveUi(f);let closed=false;try{
  await ui.idle();const retained=ui.button(action).props.onClick;
  if(guard==='inactive')ui.setProps({active:false});
  else if(guard==='disabled')ui.setProps({disabled:true});
  else if(guard==='stale version')ui.setVersion('2020-01-01T00:00:00.000Z');
  else if(guard==='profile ABA'){ui.setProps({profileId:null});await ui.idle();ui.setProps({profileId:f.profile.id});await ui.idle();}
  else{ui.close();closed=true;}
  retained();assert.equal(ui.input('사이즈 유형'),undefined);assert.equal(ui.calls.filter(call=>call.method!=='GET').length,0);assert.equal(ui.saves,0);
 }finally{if(!closed)ui.close();f.close();}
});
