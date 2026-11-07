import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryPickerUI} from './helpers/category-picker.mjs';

const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const tabs=ui=>nodes(ui.render()).filter(node=>node.props?.role==='tab');
const panel=(ui,name)=>nodes(ui.render()).find(node=>node.props?.role==='tabpanel'&&node.props['aria-label']===name);
const click=(ui,name)=>{const button=tabs(ui).find(node=>node.props.children===name);assert.ok(button,name);button.props.onClick();return ui.render();};
const searchInput=ui=>nodes(panel(ui,'직접 선택')).find(node=>node.type==='input'&&node.props['aria-label']==='카테고리 이름');
const searchButton=ui=>nodes(panel(ui,'직접 선택')).find(node=>node.type==='button'&&node.props.children==='검색');
const request=()=>assert.fail('Changing category tools must not write or request a category');

for(const sourceTitle of [undefined,'수집한 상품'])test(`two category tabs always start on recommendations (${sourceTitle??'no source title'})`,()=>{
 const ui=categoryPickerUI(request,{sourceTitle,workspaceOwnerId:'owner'});
 try{
  assert.deepEqual(tabs(ui).map(tab=>tab.props.children),['추천 선택','직접 선택']);
  assert.equal(tabs(ui)[0].props['aria-selected'],true);assert.equal(tabs(ui)[0].props.tabIndex,0);assert.equal(tabs(ui)[1].props.tabIndex,-1);
  assert.equal(panel(ui,'추천 선택').props.hidden,false);assert.equal(panel(ui,'직접 선택').props.hidden,true);
  const recommendation=nodes(panel(ui,'추천 선택')).find(node=>node.type?.name==='CategoryRecommendationsPanel');
  assert.equal(recommendation.props.initialTitle,sourceTitle??'');assert.equal(recommendation.props.disabled,false);
  assert.equal(nodes(ui.render()).some(node=>node.type?.name==='SupplierHubCategoryBrowser'),false);
  assert.deepEqual(ui.calls,[]);
 }finally{ui.close();}
});

test('direct selection groups official search, cascader and saved disclosure without a third tab',()=>{
 const profile={id:'saved',name:'저장한 분류',categoryId:'80719',categoryPath:['주방용품','보관'],revision:1,template:null,mappings:[]};
 const ui=categoryPickerUI(request,{workspaceOwnerId:'owner',profiles:[profile,{...profile,id:'second-saved',name:'다른 저장 설정'}],selectedId:profile.id});
 try{
  click(ui,'직접 선택');assert.equal(tabs(ui)[1].props['aria-selected'],true);assert.equal(panel(ui,'직접 선택').props.hidden,false);
  const direct=panel(ui,'직접 선택'),search=searchInput(ui);
  assert.equal(nodes(direct).some(node=>node.type?.name==='CategoryRecommendationsPanel'),false);
  assert.equal(search.props.value,'');assert.equal(search.props.disabled,false);assert.equal(searchButton(ui).props.disabled,true);
  assert.ok(nodes(direct).some(node=>node.type?.name==='SupplierHubCategoryBrowser'));
  const saved=nodes(direct).find(node=>node.type==='details'&&nodes(node).some(child=>child.type==='select'&&child.props.value===profile.id));assert.ok(saved);
  assert.ok(nodes(saved).some(node=>node.props?.className==='category-connections'),'several saved profiles at the same path stay inside the direct disclosure');
  assert.equal(nodes(panel(ui,'추천 선택')).find(node=>node.type?.name==='CategoryRecommendationsPanel').props.disabled,true);
  search.props.onChange({target:{value:'보관'}});let prevented=0;
  searchInput(ui).props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){prevented++;}});
  assert.equal(prevented,1);
  const results=nodes(panel(ui,'직접 선택')).find(node=>node.props?.['aria-label']==='카테고리 검색 결과');
  assert.equal(nodes(results).filter(node=>node.type==='button').length,1,'duplicate saved profiles appear as one leaf');
  assert.ok(nodes(results).some(node=>node.type==='strong'&&node.props.children==='보관'));
  assert.ok(nodes(results).some(node=>node.type==='small'&&node.props.children==='최종'));
  click(ui,'추천 선택');assert.equal(searchInput(ui).props.value,'보관','visited tools stay mounted to preserve edited query and branch state');
  assert.equal(nodes(panel(ui,'직접 선택')).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.disabled,true);
  assert.equal(ui.selected.length,0);assert.deepEqual(ui.calls,[]);
 }finally{ui.close();}
});

test('category tabs support arrow/home/end keyboard selection and restore recommendation default for another owner',()=>{
 const ui=categoryPickerUI(request,{workspaceOwnerId:'first',sourceTitle:'상품'});let prevented=0,focused;
 try{
  const event=key=>({key,preventDefault(){prevented++;},currentTarget:{parentElement:{querySelector:selector=>({focus(){focused=selector;}})}}});
  tabs(ui)[0].props.onKeyDown(event('ArrowRight'));assert.equal(tabs(ui)[1].props['aria-selected'],true);assert.ok(focused);
  tabs(ui)[1].props.onKeyDown(event('Home'));assert.equal(tabs(ui)[0].props['aria-selected'],true);
  tabs(ui)[0].props.onKeyDown(event('End'));assert.equal(tabs(ui)[1].props['aria-selected'],true);assert.equal(prevented,3);
  ui.setProps({workspaceOwnerId:'second'});assert.equal(tabs(ui)[0].props['aria-selected'],true);assert.equal(nodes(ui.render()).some(node=>node.type?.name==='SupplierHubCategoryBrowser'),false);
 }finally{ui.close();}
});

test('pending category resolution locks both tabs and retired mode callbacks cannot apply after a tab ABA',async()=>{
 let reject,lookups=0;const ui=categoryPickerUI(request,{workspaceOwnerId:'owner',sourceTitle:'상품',recommendationResolver:()=>{lookups++;return new Promise((_resolve,no)=>{reject=no;});}});
 try{
  const original=nodes(panel(ui,'추천 선택')).find(node=>node.type?.name==='CategoryRecommendationsPanel').props.onChoose;
  click(ui,'직접 선택');searchInput(ui).props.onChange({target:{value:'양말'}});const oldDirect=searchButton(ui).props.onClick;
  click(ui,'추천 선택');await original({},{});await oldDirect();assert.equal(lookups,0);
  assert.equal(nodes(panel(ui,'직접 선택')).some(node=>node.props?.['aria-label']==='카테고리 검색 결과'),false);
  const current=nodes(panel(ui,'추천 선택')).find(node=>node.type?.name==='CategoryRecommendationsPanel').props.onChoose;
  const running=current({},{}).catch(error=>error);assert.equal(lookups,1);assert.ok(tabs(ui).every(tab=>tab.props.disabled));
  click(ui,'직접 선택');assert.equal(tabs(ui)[0].props['aria-selected'],true);
  reject(Error('synthetic category lookup failed'));assert.match((await running).message,/synthetic/);assert.equal(ui.selected.length,0);assert.deepEqual(ui.calls,[]);
 }finally{ui.close();}
});
