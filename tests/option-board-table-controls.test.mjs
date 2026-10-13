import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {boardControlsUI,focusControlsUI,optionBoardControlsFixture,workspaceRefreshUI,companies,byLabel,optionRows,nodes,text} from './helpers/option-board-controls.mjs';

const element=(tree,label)=>{const node=byLabel(tree,label);assert.ok(node,label);return node;};
const change=(h,label,value)=>element(h.render(),label).props.onChange({target:{value}});
const check=(h,label,checked)=>element(h.render(),label).props.onChange({target:{checked}});
const click=(h,label)=>element(h.render(),label).props.onClick();
const ids=tree=>optionRows(tree).map(row=>row.props['data-option-id']);
const columns=tree=>nodes(tree).filter(node=>node.type==='th'&&node.props['data-column']);

test('option table defaults to 50 with recorded page choices and visits every saved row once',()=>{
 const h=boardControlsUI(),before=JSON.stringify(h.data);let tree=h.render();
 assert.equal(element(tree,'페이지당 옵션 수').props.value,50);
 assert.deepEqual(nodes(element(tree,'페이지당 옵션 수')).filter(node=>node.type==='option').map(node=>node.props.value),[10,25,50,100]);
 assert.equal(element(tree,'옵션 높이 고정 Y').props.checked,true);assert.equal(columns(tree).length,12);
 assert.equal(element(tree,'상품 옵션 이전 페이지').props.disabled,true);
 const seen=[];
 for(let page=0;page<3;page++){tree=h.render();seen.push(...ids(tree));assert.equal(optionRows(tree).length,page===2?23:50);if(page<2)click(h,'상품 옵션 다음 페이지');}
 assert.deepEqual(seen,h.data.options.rows.map(row=>row.id));assert.equal(new Set(seen).size,123);assert.equal(element(h.render(),'상품 옵션 다음 페이지').props.disabled,true);
 click(h,'상품 옵션 이전 페이지');assert.deepEqual(ids(h.render()),h.data.options.rows.slice(50,100).map(row=>row.id));assert.equal(JSON.stringify(h.data),before);
});

test('header selection affects only the current page and survives page, search and size changes',()=>{
 const h=boardControlsUI(),before=JSON.stringify(h.data);
 check(h,'현재 옵션 전체 선택',true);assert.match(text(h.render()),/선택 50개/);
 click(h,'상품 옵션 다음 페이지');assert.equal(element(h.render(),'현재 옵션 전체 선택').props.checked,false);check(h,'옵션 option-050 선택',true);assert.match(text(h.render()),/선택 51개/);
 check(h,'현재 옵션 전체 선택',true);assert.match(text(h.render()),/선택 100개/);check(h,'현재 옵션 전체 선택',false);assert.match(text(h.render()),/선택 50개/);
 change(h,'상품 옵션 검색','SKU-122');assert.deepEqual(ids(h.render()),['option-122']);check(h,'현재 옵션 전체 선택',true);assert.match(text(h.render()),/선택 51개/);
 change(h,'상품 옵션 검색','');assert.equal(ids(h.render())[0],'option-000');assert.equal(element(h.render(),'현재 옵션 전체 선택').props.checked,true);
 click(h,'상품 옵션 다음 페이지');change(h,'페이지당 옵션 수','25');assert.equal(ids(h.render())[0],'option-000');assert.equal(optionRows(h.render()).length,25);assert.match(text(h.render()),/선택 51개/);
 change(h,'페이지당 옵션 수','100');click(h,'상품 옵션 다음 페이지');assert.equal(element(h.render(),'옵션 option-122 선택').props.checked,true);assert.equal(JSON.stringify(h.data),before);
});

test('all twelve column controls preserve exact cells and actions while hide, pin, restore and height are local',()=>{
 const h=boardControlsUI(2),before=JSON.stringify(h.data),labels=['옵션번호','옵션명','SEO설정','가격설정','대표이미지','추가이미지','상세이미지','사이즈표','한글표시사항','견적서','재고/가격','관리'];
 assert.deepEqual(columns(h.render()).map(text),labels);
 change(h,'옵션 고정할 열 선택','name');let tree=h.render();assert.equal(columns(tree).find(node=>node.props['data-column']==='name').props.className,' option-board-pinned');
 assert.ok(nodes(optionRows(tree)[0]).find(node=>node.type==='td'&&node.props['data-column']==='name').props.className.includes('option-board-pinned'));
 check(h,'옵션 옵션명 컬럼 표시',false);tree=h.render();assert.equal(columns(tree).length,11);assert.equal(element(tree,'옵션 고정할 열 선택').props.value,'');assert.equal(nodes(tree).some(node=>node.props?.['data-column']==='name'),false);
 check(h,'옵션 관리 컬럼 표시',false);assert.equal(byLabel(h.render(),'옵션 option-001 삭제 검토'),undefined);
 const restore=nodes(h.render()).find(node=>node.type==='button'&&text(node)==='전체 표시');assert.ok(restore);restore.props.onClick();tree=h.render();assert.deepEqual(columns(tree).map(text),labels);
 for(const [label,step]of [['SEO설정','SEO'],['가격설정','가격'],['대표이미지','대표 이미지'],['추가이미지','추가 이미지'],['상세이미지','상세 이미지'],['한글표시사항','표시사항'],['견적서','견적서']]){element(tree,'옵션 option-001 '+label+' 편집').props.onClick();assert.deepEqual(Array.from(h.stages.at(-1)),['option-001',step]);}
 element(tree,'옵션 option-001 삭제 검토').props.onClick();assert.deepEqual(Array.from(h.managed),['option-001']);assert.deepEqual(Array.from(h.edited),[]);
 element(tree,'옵션 높이 고정 N').props.onChange();assert.equal(element(h.render(),'상품 옵션 작업 표').props.className.includes('option-board-height-fixed'),false);
 element(h.render(),'옵션 높이 고정 Y').props.onChange();assert.equal(element(h.render(),'상품 옵션 작업 표').props.className.includes('option-board-height-fixed'),true);
 change(h,'옵션 고정할 열 선택','stock');change(h,'옵션 고정할 열 선택','');assert.ok(columns(h.render()).every(node=>!node.props.className.includes('option-board-pinned')));assert.equal(JSON.stringify(h.data),before);
});

test('empty searches have one empty page and no select-all side effects',()=>{
 const h=boardControlsUI();check(h,'옵션 option-000 선택',true);click(h,'상품 옵션 다음 페이지');change(h,'상품 옵션 검색','no-matching-saved-option');
 const tree=h.render();assert.deepEqual(ids(tree),[]);assert.equal(element(tree,'현재 옵션 전체 선택').props.checked,false);assert.equal(element(tree,'상품 옵션 이전 페이지').props.disabled,true);assert.equal(element(tree,'상품 옵션 다음 페이지').props.disabled,true);assert.match(text(tree),/1 \/ 1/);
 check(h,'현재 옵션 전체 선택',true);assert.match(text(h.render()),/선택 1개/);change(h,'상품 옵션 검색','');assert.equal(element(h.render(),'옵션 option-000 선택').props.checked,true);
 assert.match(renderToStaticMarkup(h.render()),/aria-label="상품 옵션 페이지 이동"/);
});

test('return focus follows exact reordered option within preserved filters and waits for an explicitly hidden column',async()=>{
 const h=await focusControlsUI();try{
  click(h,'상품 옵션 다음 페이지');await h.settle();assert.equal(ids(h.render())[0],'option-050');
  const label='옵션 option-050 SEO설정 편집';h.setHidden(true);h.setReturnFocus(label);
  const moved=[h.rows[50],...h.rows.filter(row=>row.id!=='option-050')];h.refresh(moved);await h.settle();assert.equal(h.handled,0);assert.deepEqual(h.focused,[]);
  // The real parent supplies a fresh return callback when it reveals the
  // retained table. A changed saved order must then locate the exact new page.
  h.setHidden(false);await h.settle();assert.equal(ids(h.render())[0],'option-050');assert.deepEqual(h.focused,[label]);assert.equal(h.handled,1);assert.equal(element(h.render(),'상품 옵션 이전 페이지').props.disabled,true);
  check(h,'옵션 SEO설정 컬럼 표시',false);h.setReturnFocus(label);await h.settle();assert.equal(h.handled,1);assert.equal(byLabel(h.render(),label),undefined);
  check(h,'옵션 SEO설정 컬럼 표시',true);await h.settle();assert.deepEqual(h.focused,[label,label]);assert.equal(h.handled,2);
  change(h,'상품 옵션 검색','SKU-72');h.setReturnFocus(label);await h.settle();assert.deepEqual(ids(h.render()),['option-072']);assert.equal(h.handled,2);assert.equal(element(h.render(),'상품 옵션 검색').props.value,'SKU-72');
  change(h,'상품 옵션 검색','SKU-50');await h.settle();assert.equal(h.handled,3);assert.deepEqual(h.focused,[label,label,label]);assert.equal(element(h.render(),'상품 옵션 검색').props.value,'SKU-50');assert.ok(h.calls.every(call=>call.method==='GET'));
 }finally{h.close();}
});

for(const company of companies)test(`all seven exact stages return to the same page, columns, pin, height and selection (${company.code})`,async()=>{
 const f=await optionBoardControlsFixture(company);let ui;try{
  const before=f.retained(),files=await f.fileSnapshot();ui=await workspaceRefreshUI(f,{realOptionBoard:true});await ui.settle();ui.component('registration-board').onOptions(await f.current());await ui.settle();
  assert.equal(optionRows(ui.render()).length,50);check(ui,'옵션 control-000 선택',true);change(ui,'페이지당 옵션 수','25');click(ui,'상품 옵션 다음 페이지');click(ui,'상품 옵션 다음 페이지');
  check(ui,'옵션 control-050 선택',true);check(ui,'옵션 재고/가격 컬럼 표시',false);change(ui,'옵션 고정할 열 선택','name');element(ui.render(),'옵션 높이 고정 N').props.onChange();await ui.settle();
  const mount=ui.componentMount('product-option-board'),shown=ids(ui.render());assert.deepEqual(shown,f.controlRows.slice(50).map(row=>row.id));
  const stages=[['SEO설정','SEO'],['가격설정','가격'],['대표이미지','대표 이미지'],['추가이미지','추가 이미지'],['상세이미지','상세 이미지'],['한글표시사항','표시사항'],['견적서','견적서']];
  for(const [label]of stages){
   click(ui,'옵션 control-050 '+label+' 편집');await ui.settle();assert.equal(ui.componentVisible('product-option-board'),false);assert.equal(ui.component('product-options-editor').focusedOptionId,'control-050');
   await ui.click('×');assert.equal(ui.componentVisible('product-option-board'),true);assert.equal(ui.componentMount('product-option-board'),mount);assert.deepEqual(ids(ui.render()),shown);
   assert.equal(element(ui.render(),'페이지당 옵션 수').props.value,25);assert.equal(element(ui.render(),'옵션 고정할 열 선택').props.value,'name');assert.equal(element(ui.render(),'옵션 높이 고정 N').props.checked,true);
   assert.equal(element(ui.render(),'옵션 재고/가격 컬럼 표시').props.checked,false);assert.equal(element(ui.render(),'옵션 control-050 선택').props.checked,true);
  }
  click(ui,'상품 옵션 이전 페이지');click(ui,'상품 옵션 이전 페이지');assert.equal(element(ui.render(),'옵션 control-000 선택').props.checked,true);assert.match(text(ui.render()),/선택 2개/);
  assert.ok(ui.requests.every(request=>request.method==='GET'));assert.equal(f.retained(),before);assert.equal(await f.fileSnapshot(),files);assert.deepEqual(f.network,[]);
 }finally{ui?.close();f.close();}
});
