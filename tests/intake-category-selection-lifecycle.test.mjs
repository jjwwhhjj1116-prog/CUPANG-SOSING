import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeOwnerScopeHarness,intakeScopeCompanies} from './helpers/intake-owner-scope.mjs';
import {categoryPickerUI} from './helpers/category-picker.mjs';
import {hubSchemaSnapshot,schemaPath} from './helpers/hub-schema.mjs';

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const plain=value=>JSON.parse(JSON.stringify(value));
const picker=(h,options)=>nodes(h.render(options)).find(node=>node.type?.name==='CategoryPicker');
const cancelButton=h=>nodes(h.render()).find(node=>node.type==='button'&&node.props['aria-label']==='카테고리 선택 취소');
const rowCategory=(h,index=0)=>nodes(h.render()).filter(node=>node.type==='button'&&node.props.className==='intake-category-button')[index];
const snapshot=h=>JSON.stringify({rows:h.rows,profiles:h.profilesPublished,consumed:h.consumed,posts:h.posts.length,focused:h.focused,scrolled:h.scrolled});
function selectedProfile(company,h){
 const schema=hubSchemaSnapshot({code:company.code,name:company.name});
 schema.metadata.scopeType='Retail_Categorized_Single';
 return {...h.profile,id:'selected-'+company.code,name:company.name+' 직접 연결',revision:4,categoryId:schema.categoryId,categoryPath:[...schemaPath],hubSchema:schema,
  template:{name:company.code+'-manual.csv',format:'csv',sheetName:'',headerRow:1,headers:['상품명','수동 검토'],sha256:'b'.repeat(64),storageKey:company.owner+'/manual.csv'},
  mappings:[{column:0,field:'title',required:false},{column:1,field:'constant',constant:'직접 검토',required:false}]};
}
function assertNoCollection(h){assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);assert.equal(h.jobsPublished.length,0);assert.equal(h.opened.length,0);}

for(const company of intakeScopeCompanies){
 const other=intakeScopeCompanies.find(value=>value.owner!==company.owner);
 test(`normal cancel rejects its retained parent selection callback (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company);try{
   h.button('＋ 상품 추가').props.onClick();const old=picker(h).props.onSelected;
   h.button('취소 · 상품 대기열로 돌아가기').props.onClick();const before=snapshot(h),writes=h.rowsPublished.length;
   old(selectedProfile(other,h));assert.equal(snapshot(h),before);assert.equal(h.rowsPublished.length,writes);assert.equal(picker(h),undefined);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`cancel and reopen for an existing row cannot be closed or appended by the old new-row callback (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company,{rowCount:2});try{
   h.button('＋ 상품 추가').props.onClick();const stale=picker(h).props;
   cancelButton(h).props.onClick();rowCategory(h,1).props.onClick();const fresh=picker(h).props,oldRows=JSON.stringify(h.rows),writes=h.rowsPublished.length;
   stale.onSelected(selectedProfile(other,h));stale.onAdvanced();assert.equal(JSON.stringify(h.rows),oldRows);assert.equal(h.rowsPublished.length,writes);
   assert.equal(picker(h).props.selectedId,fresh.selectedId);assert.equal(h.profilesPublished.length,0);
   fresh.onSelected(selectedProfile(company,h));assert.equal(h.rows.length,2);assert.equal(h.rows[1].profile.id,'selected-'+company.code);assert.equal(h.rows[0].profile.id,h.profile.id);
   assert.equal(picker(h),undefined);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`a current ordinary category completes once, preserves existing inputs and focuses the new URL (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company);try{
   const before=plain(h.rows);h.button('＋ 상품 추가').props.onClick();const selected=picker(h).props.onSelected,profile=selectedProfile(company,h);
   selected(profile);selected(selectedProfile(other,h));h.render();h.render();
   assert.equal(h.rows.length,2);assert.deepEqual(plain(h.rows.slice(0,1)),before);assert.deepEqual(plain(h.rows[1].profile),profile);
   assert.equal(h.rows[1].url,'');assert.equal(h.rows[1].features,'');assert.equal(h.rows[1].keywords,'');assert.equal(h.rows[1].status,'draft');assert.equal(h.rows[1].productId,undefined);
   assert.equal(h.profilesPublished.length,1);assert.equal(h.profilesPublished[0].owner,company.owner);assert.deepEqual(plain(h.profilesPublished[0].profile),profile);
   assert.deepEqual(h.focused,['2번째 1688 링크']);assert.equal(h.scrolled.length,1);assert.deepEqual(plain(h.scrolled[0]),{name:'2번째 1688 링크',options:{block:'nearest',inline:'nearest'}});assertNoCollection(h);
  }finally{h.close();}
 });
 test(`real saved picker confirmation keeps profile version, company form and manual workbook in one seeded URL row (${company.code})`,async()=>{
  const seed={id:'history-'+company.code,sourceUrl:'https://detail.1688.com/offer/664000000001.html?offerId=664000000001'},h=intakeOwnerScopeHarness(company,{sourceSeed:seed});
  let child;try{
   const profile=selectedProfile(company,h),before=plain(h.rows),callback=picker(h).props.onSelected;
   child=categoryPickerUI((path,init)=>{assert.equal(init?.method??'GET','GET');if(path==='/api/settings')return Response.json({scope:{ownerId:company.owner,company:{code:company.code,name:company.name}}});if(path==='/api/category-profiles')return Response.json({profiles:[profile]});throw Error('Unexpected synthetic category lookup '+path);},{profiles:[profile],selectedId:profile.id,workspaceOwnerId:company.owner});
   await child.confirm();assert.equal(child.selected.length,1,JSON.stringify(child.alerts()));callback(child.selected[0]);callback(child.selected[0]);h.render();
   assert.equal(h.rows.length,2);assert.deepEqual(plain(h.rows.slice(0,1)),before);assert.deepEqual(plain(h.rows[1].profile),profile);
   assert.equal(h.rows[1].url,'https://detail.1688.com/offer/664000000001.html');assert.deepEqual(h.consumed,[seed.id]);assert.equal(h.profilesPublished.length,1);
   assert.deepEqual(h.focused,['2번째 1688 링크']);assertNoCollection(h);assert.ok(child.calls.every(call=>call.method==='GET'));
  }finally{child?.close();h.close();}
 });
 test(`a changed pending source URL rejects the older selection without consuming it (${company.code})`,()=>{
  const seed={id:'same-seed',sourceUrl:'https://detail.1688.com/offer/664000000002.html'},h=intakeOwnerScopeHarness(company,{sourceSeed:seed});try{
   const old=picker(h).props.onSelected;h.setSeed({...seed,sourceUrl:'https://detail.1688.com/offer/664000000003.html'});const before=snapshot(h);
   old(selectedProfile(company,h));picker(h).props.onSelected(selectedProfile(company,h));assert.equal(snapshot(h),before);assert.ok(picker(h));assertNoCollection(h);
  }finally{h.close();}
 });
 test(`cancel consumes one historical seed and a fresh ordinary category starts with a blank URL (${company.code})`,()=>{
  const seed={id:'cancelled-seed',sourceUrl:'https://detail.1688.com/offer/664000000004.html'},h=intakeOwnerScopeHarness(company,{sourceSeed:seed});try{
   const old=picker(h).props.onSelected,cancel=cancelButton(h).props.onClick;cancel();cancel();old(selectedProfile(company,h));assert.equal(h.rows.length,1);assert.deepEqual(h.consumed,[seed.id]);
   h.button('＋ 상품 추가').props.onClick();picker(h).props.onSelected(selectedProfile(company,h));assert.equal(h.rows.length,2);assert.equal(h.rows[1].url,'');assert.deepEqual(h.consumed,[seed.id]);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`blank URL rows remain visible and become selected start targets only after input while exclusions survive (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company);try{
   h.button('＋ 상품 추가').props.onClick();picker(h).props.onSelected(selectedProfile(company,h));let tree=h.render();
   const input=label=>nodes(h.render()).find(node=>node.props['aria-label']===label);
   assert.equal(h.rows.length,2);assert.equal(input('2번째 상품 선택').props.disabled,true);assert.equal(input('2번째 상품 선택').props.checked,false);assert.ok(h.button('시작 (1건)'));
   assert.match(JSON.stringify(tree),/URL을 입력하지 않은.*시작 대상에서 제외/);
   input('2번째 1688 링크').props.onChange({target:{value:'https://detail.1688.com/offer/664000000005.html'}});tree=h.render();
   assert.equal(input('2번째 상품 선택').props.disabled,false);assert.equal(input('2번째 상품 선택').props.checked,true);assert.ok(h.button('시작 (2건)'));
   input('2번째 상품 선택').props.onChange({target:{checked:false}});assert.ok(h.button('시작 (1건)'));
   input('2번째 1688 링크').props.onChange({target:{value:' '}});input('2번째 1688 링크').props.onChange({target:{value:'https://detail.1688.com/offer/664000000005.html'}});
   assert.equal(input('2번째 상품 선택').props.checked,false);assert.ok(h.button('시작 (1건)'));assertNoCollection(h);
  }finally{h.close();}
 });
 for(const passive of [false,true])test(`account ${passive?'passive':'layout'} switch rejects retained selection, cancel and advanced callbacks (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company);try{
   h.button('＋ 상품 추가').props.onClick();const old=picker(h).props,cancel=cancelButton(h).props.onClick;
   h.switchOwner(other.owner,{passive});const before=snapshot(h),writes=h.rowsPublished.length;
   old.onSelected(selectedProfile(company,h));old.onAdvanced();cancel();assert.equal(snapshot(h),before);assert.equal(h.rowsPublished.length,writes);
   h.flushPassive();assert.equal(snapshot(h),before);assert.equal(picker(h),undefined);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`owner A/B/A cannot reactivate the old category generation or dismiss a fresh picker (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company);try{
   h.button('＋ 상품 추가').props.onClick();const old=picker(h).props.onSelected;
   h.switchOwner(other.owner);h.switchOwner(company.owner);h.button('＋ 상품 추가').props.onClick();const before=snapshot(h),fresh=picker(h).props.onSelected;
   old(selectedProfile(company,h));assert.equal(snapshot(h),before);assert.ok(picker(h));fresh(selectedProfile(company,h));assert.equal(h.rows.length,2);assert.equal(h.profilesPublished.length,1);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`unmount rejects retained category actions without late state writes (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company);h.button('＋ 상품 추가').props.onClick();const old=picker(h).props,cancel=cancelButton(h).props.onClick;
  h.close();const before=snapshot(h),writes=h.rowsPublished.length;old.onSelected(selectedProfile(company,h));old.onAdvanced();cancel();
  assert.equal(snapshot(h),before);assert.equal(h.rowsPublished.length,writes);assert.equal(h.lateStateWrites,0);assertNoCollection(h);
 });
 test(`a completed current category ticket applies one deferred row after its dialog closes (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company,{deferRows:true});try{
   h.button('＋ 상품 추가').props.onClick();const selected=picker(h).props.onSelected;selected(selectedProfile(company,h));selected(selectedProfile(other,h));
   assert.equal(picker(h),undefined);assert.equal(h.queuedRows.length,1);assert.equal(h.rows.length,1);h.flushRows();h.render();
   assert.equal(h.rows.length,2);assert.equal(h.rows[1].profile.id,'selected-'+company.code);assert.equal(h.profilesPublished.length,1);assert.deepEqual(h.focused,['2번째 1688 링크']);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`a deferred completed selection cannot append into a new owner even before passive cleanup (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company,{deferRows:true});try{
   h.button('＋ 상품 추가').props.onClick();picker(h).props.onSelected(selectedProfile(company,h));assert.equal(h.queuedRows.length,1);
   h.switchOwner(other.owner,{passive:false});const before=plain(h.rows),profiles=plain(h.profilesPublished);h.flushRows();h.flushPassive();
   assert.deepEqual(plain(h.rows),before);assert.deepEqual(plain(h.profilesPublished),profiles);assert.deepEqual(h.focused,[]);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`a deferred completed selection cannot append after the queue unmounts (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company,{deferRows:true});h.button('＋ 상품 추가').props.onClick();picker(h).props.onSelected(selectedProfile(company,h));assert.equal(h.queuedRows.length,1);
  h.close();const before=snapshot(h);h.flushRows();assert.equal(snapshot(h),before);assert.equal(h.lateStateWrites,0);assertNoCollection(h);
 });
 test(`reopen and cancel invalidate a prior deferred new-row ticket (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company,{deferRows:true});try{
   h.button('＋ 상품 추가').props.onClick();const first=picker(h).props.onSelected;first(selectedProfile(company,h));assert.equal(h.queuedRows.length,1);
   h.button('＋ 상품 추가').props.onClick();const fresh=picker(h).props.onSelected;cancelButton(h).props.onClick();const before=plain(h.rows),profiles=plain(h.profilesPublished);
   first(selectedProfile(other,h));fresh(selectedProfile(other,h));h.flushRows();assert.deepEqual(plain(h.rows),before);assert.deepEqual(plain(h.profilesPublished),profiles);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`existing-row category replacement preserves other rows, URL and manual fields and clears only its stale draft receipt (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company,{rowCount:2});try{
   const rows=plain(h.rows);rows[0]={...rows[0],status:'error',productId:'partial-old',forkJobId:'fork-old',pendingJobId:'pending-old',pendingSourceMode:'pending-source-urls-v1',pendingSourceHash:'hash-old'};
   h.setRows(rows);rowCategory(h).props.onClick();const selected=picker(h).props.onSelected,profile=selectedProfile(company,h);selected(profile);selected(selectedProfile(other,h));h.render();
   assert.equal(h.rows.length,2);assert.deepEqual(plain(h.rows[1]),rows[1]);for(const field of ['id','url','features','keywords'])assert.equal(h.rows[0][field],rows[0][field]);
   assert.deepEqual(plain(h.rows[0].profile),profile);assert.equal(h.rows[0].status,'draft');assert.equal(h.rows[0].message,'');for(const field of ['productId','forkJobId','pendingJobId','pendingSourceMode','pendingSourceHash'])assert.equal(h.rows[0][field],undefined);
   assert.equal(h.profilesPublished.length,1);assert.deepEqual(h.focused,['1번째 1688 링크']);assertNoCollection(h);
  }finally{h.close();}
 });
 test(`a new existing-row target invalidates the older deferred replacement and updates only its own row (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company,{deferRows:true,rowCount:2});try{
   rowCategory(h).props.onClick();const old=picker(h).props.onSelected;old(selectedProfile(company,h));rowCategory(h,1).props.onClick();const fresh=picker(h).props.onSelected;
   const before=plain(h.rows);h.flushRows();assert.deepEqual(plain(h.rows),before);assert.ok(picker(h));old(selectedProfile(other,h));assert.ok(picker(h));
   fresh(selectedProfile(company,h));h.flushRows();assert.deepEqual(plain(h.rows[0]),before[0]);assert.equal(h.rows[1].profile.id,'selected-'+company.code);assert.equal(h.rows.length,2);assertNoCollection(h);
  }finally{h.close();}
 });
 for(const retirement of ['removed','saved'])test(`deferred existing-row category cannot rewrite a ${retirement} target (${company.code})`,()=>{
  const h=intakeOwnerScopeHarness(company,{deferRows:true,rowCount:2});try{
   rowCategory(h).props.onClick();picker(h).props.onSelected(selectedProfile(company,h));assert.equal(h.queuedRows.length,1);
   const current=plain(h.rows);h.setRows(retirement==='removed'?current.slice(1):current.map((row,index)=>index?row:{...row,status:'saved',productId:'working-product'}));
   const before=plain(h.rows);h.flushRows();assert.deepEqual(plain(h.rows),before);assertNoCollection(h);
  }finally{h.close();}
 });
}
