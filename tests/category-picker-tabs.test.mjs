import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryPickerUI} from './helpers/category-picker.mjs';

const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const tabs=ui=>nodes(ui.render()).filter(node=>node.props?.role==='tab');
const panel=(ui,name)=>nodes(ui.render()).find(node=>node.props?.role==='tabpanel'&&node.props['aria-label']===name);
const click=(ui,name)=>{const button=tabs(ui).find(node=>node.props.children===name);assert.ok(button,name);button.props.onClick();return ui.render();};
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
  const direct=panel(ui,'직접 선택'),search=nodes(direct).find(node=>node.type?.name==='CategoryRecommendationsPanel');
  assert.equal(search.props.purpose,'search');assert.equal(search.props.initialTitle,'');assert.equal(search.props.disabled,false);
  assert.ok(nodes(direct).some(node=>node.type?.name==='SupplierHubCategoryBrowser'));
  const saved=nodes(direct).find(node=>node.type==='details'&&nodes(node).some(child=>child.type==='select'&&child.props.value===profile.id));assert.ok(saved);
  assert.ok(nodes(saved).some(node=>node.props?.className==='category-connections'),'several saved profiles at the same path stay inside the direct disclosure');
  assert.equal(nodes(panel(ui,'추천 선택')).find(node=>node.type?.name==='CategoryRecommendationsPanel').props.disabled,true);
  click(ui,'추천 선택');assert.equal(search.type,nodes(panel(ui,'직접 선택')).find(node=>node.type?.name==='CategoryRecommendationsPanel').type,'visited tools stay mounted to preserve edited query and branch state');
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
  click(ui,'직접 선택');const oldDirect=nodes(panel(ui,'직접 선택')).find(node=>node.type?.name==='CategoryRecommendationsPanel').props.onChoose;
  click(ui,'추천 선택');await original({},{});await oldDirect({},{});assert.equal(lookups,0);
  const current=nodes(panel(ui,'추천 선택')).find(node=>node.type?.name==='CategoryRecommendationsPanel').props.onChoose;
  const running=current({},{}).catch(error=>error);assert.equal(lookups,1);assert.ok(tabs(ui).every(tab=>tab.props.disabled));
  click(ui,'직접 선택');assert.equal(tabs(ui)[0].props['aria-selected'],true);
  reject(Error('synthetic category lookup failed'));assert.match((await running).message,/synthetic/);assert.equal(ui.selected.length,0);assert.deepEqual(ui.calls,[]);
 }finally{ui.close();}
});
