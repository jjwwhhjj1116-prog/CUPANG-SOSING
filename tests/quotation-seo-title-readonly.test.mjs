import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationTitleLoader,quotationTitleUI,titleNodes,titleText} from './helpers/quotation-seo-title-ui.mjs';
import {hubSchemaSnapshot} from './helpers/hub-schema.mjs';

const load=quotationTitleLoader(),model=load('app/quotation-schema.ts'),policy=load('app/quotation-seo-title.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture({native=false,alias=false,overrides=model.emptyQuotationOverrides()}={}){
 const content=load('app/product-content.ts').emptyProductContent('p1');content.seo.title.value='저장한 SEO 상품명';
 const options=load('app/product-options.ts'),snapshot=native?hubSchemaSnapshot():null;
 const source={categoryId:snapshot?.categoryId??'80719',...(snapshot?{categoryPath:snapshot.categoryPath,hubSchema:snapshot}:{}),
  product:{id:'p1',title:'원문 상품명',supply_price:2000,sale_price:3000,msrp:4000,exchange_rate:200,supply_margin:0,coupang_margin:0,image_keys:'[]'},
  content,settings:load('app/workspace-settings.ts').defaultSettings,
  options:options.applyOptionRows(options.emptyProductOptions('p1'),['red','blue'].map(id=>({...options.emptyOptionInput(id),originalName:id,unitCostCny:4.5,included:true})),'2026-10-21T00:00:00.000Z')};
 const view=plain({revision:1,inputFingerprint:'a'.repeat(64),overrides,resolved:model.resolveQuotationFields({...source,overrides}),automatic:model.resolveQuotationFields(source),imageKeys:[],submissionReady:false,
  categoryContext:{source:'collection',profileId:null,categoryId:source.categoryId,categoryPath:source.categoryPath??[]},productVersion:'2026-10-21T00:00:00.000Z',contentRevision:0,optionRevision:1,updatedAt:null});
 if(alias)for(const data of [view.resolved,view.automatic]){
  const field={...data.schema.fields.find(field=>field.id==='title'),id:'primary-title-wire',hubInput:'title',hubWire:{path:['startPage','productName']}};data.schema.fields.push(field);
  for(const row of data.rows){const automatic=view.automatic.rows.find(item=>item.optionId===row.optionId).fields.title;
   const option=data===view.resolved&&row.optionId!==null?overrides.options[row.optionId]?.[field.id]:undefined,common=data===view.resolved?overrides.common[field.id]:undefined;
   row.fields[field.id]={...automatic,...(option!==undefined?{value:option,source:'manual-option'}:common!==undefined?{value:common,source:'manual-common'}:{})};
  }
 }
 return view;
}
const wireTitle=view=>view.resolved.schema.fields.find(field=>field.id!=='title'&&policy.isQuotationSeoTitleField(field));
const child=(ui,exportName)=>ui.nodes().find(node=>typeof node.type==='function'&&node.type.name===exportName);

for(const native of [false,true])test(`quotation ${native?'native Hub and canonical':'base'} product names are read-only and SEO navigation never writes`,async()=>{
 const view=fixture({native}),before=JSON.stringify(view),navigated=[];
 const ui=quotationTitleUI({view,props:{onEditSeo:()=>navigated.push('seo')}});
 try{
  await ui.idle();const titles=view.resolved.schema.fields.filter(policy.isQuotationSeoTitleField);assert.equal(titles.length,1);assert.equal(Boolean(titles[0].hubWire),native);
  for(const field of titles){const input=ui.field(field.id);assert.equal(input.props.readOnly,true);assert.equal(input.props.value,view.resolved.rows[0].fields[field.id].value);input.props.onChange({target:{value:'우회 수정'}});}
  assert.equal(ui.changes.length,0);assert.match(titleText(ui.render()),/상품명은 SEO 설정에서 수정해주세요\./);
  assert.doesNotMatch(titleText(ui.render()),/수정값은 견적서에만 적용됩니다/);
  ui.button('SEO 설정에서 상품명 수정').props.onClick();assert.deepEqual(navigated,['seo']);
  assert.equal(ui.calls.some(call=>call.init?.method),false);assert.equal(JSON.stringify(view),before);
  assert.equal(ui.field('brand')?.props.readOnly??child(ui,'QuotationBrandInput')?.props.disabled,false);
  assert.equal(ui.nodes().filter(node=>node.props?.className==='quotation-field-select-copy'&&titleNodes(node).some(item=>item.props?.checked!==undefined)).length>0,true);
 }finally{ui.close();}
});

test('only canonical or exact unnamed title source identity is protected; matching labels and workbook/custom wires stay editable',async()=>{
 const view=fixture({alias:true}),title=view.resolved.schema.fields.find(field=>field.id==='title');
 const extra=[
  {...title,id:'same-label',help:'일반 항목'},
  {...title,id:'workbook-title',hubInput:'title',workbookWire:{sha256:'b'.repeat(64),sheetName:'견적',column:4,requirement:'optional'}},
  {...title,id:'custom-title',hubInput:'title',hubWire:{path:['productPage','customName']}},
  {...title,id:'named-title',hubInput:'title',hubWire:{path:['startPage','productName'],name:'별도 이름'}},
  {...title,id:'wrong-input',hubInput:'brand',hubWire:{path:['startPage','productName']}},
 ];
 for(const data of [view.resolved,view.automatic]){data.schema.fields.push(...plain(extra));for(const row of data.rows)for(const field of extra)row.fields[field.id]={...row.fields.title};}
 const ui=quotationTitleUI({view});try{await ui.idle();
  assert.equal(ui.field('primary-title-wire').props.readOnly,true);ui.field('primary-title-wire').props.onChange({target:{value:'와이어 우회 수정'}});assert.equal(ui.changes.length,0);
  for(const field of extra){assert.equal(policy.isQuotationSeoTitleField(field),false);const control=ui.nodes().find(node=>node.props?.id==='seo-title-test-'+field.id);assert.ok(control,field.id);assert.equal(control.props.readOnly??control.props.disabled,false);control.props.onChange(control.type==='input'?{target:{value:field.id+' 수정'}}:field.id+' 수정');ui.render();}
  assert.deepEqual(plain(ui.changes).map(change=>change.fieldKey),extra.map(field=>field.id));
  assert.equal(ui.button('SEO 설정에서 상품명 수정'),undefined,'the optional callback is absent');
 }finally{ui.close();}
});

test('historical manual values and manual blank stay visible until an explicit current-scope reset is saved',async()=>{
 let view=fixture({native:true,alias:true});const wire=wireTitle(view);
 view=fixture({native:true,alias:true,overrides:{common:{title:'예전 공통 제목',[wire.id]:'예전 공식 제목'},options:{red:{title:'',[wire.id]:'옵션 공식 제목'},blue:{title:'다른 옵션 제목'}}}});
 const before=JSON.stringify(view),puts=[];
 const ui=quotationTitleUI({view,request:async(_url,init)=>{
  if(init?.method==='PUT'){
   const body=JSON.parse(init.body);puts.push(body);const next=plain(view);next.revision++;next.overrides=model.applyQuotationChanges(view.overrides,body.changes);next.inputFingerprint='b'.repeat(64);next.productVersion='2026-10-21T00:00:00.001Z';next.updatedAt=next.productVersion;
   const editor=load('app/components/quotation-fields-editor.tsx');for(const row of next.resolved.rows)for(const key of Object.keys(row.fields))row.fields[key]=editor.resolveQuotationEditorCell(next,[],row.optionId,key);
   view=next;return Response.json(next);
  }return Response.json(view);
 }});
 try{await ui.idle();assert.equal(puts.length,0);assert.equal(ui.field('title').props.value,'예전 공통 제목');
  ui.select('red');assert.equal(ui.field('title').props.value,'');assert.equal(ui.field(wire.id).props.value,'옵션 공식 제목');
  const reset=ui.nodes().find(node=>node.type==='button'&&titleText(node.props.children)==='상품명 수정 해제 · 공통값 사용');reset.props.onClick();ui.render();
  assert.deepEqual(plain(ui.changes),[{fieldKey:'title',optionId:'red',value:null}]);assert.equal(ui.field('title').props.value,'예전 공통 제목');assert.equal(ui.field(wire.id).props.value,'옵션 공식 제목');assert.equal(puts.length,0);
  assert.equal(JSON.stringify(view),before,'staging a reset does not mutate the saved view');
  ui.button('견적 입력 저장').props.onClick();await ui.idle();assert.equal(puts.length,1);assert.deepEqual(puts[0].changes,[{fieldKey:'title',optionId:'red',value:null}]);
  assert.equal(view.overrides.common.title,'예전 공통 제목');assert.equal(view.overrides.common[wire.id],'예전 공식 제목');assert.equal(view.overrides.options.red[wire.id],'옵션 공식 제목');assert.equal(view.overrides.options.blue.title,'다른 옵션 제목');assert.equal(Object.hasOwn(view.overrides.options.red,'title'),false);
  ui.select(null);ui.button('상품명 수정 해제 · SEO 자동값 사용').props.onClick();ui.render();
  assert.equal(ui.field('title').props.value,'저장한 SEO 상품명');assert.equal(puts.length,1,'restoring the automatic value still requires Save');
  ui.button('견적 입력 저장').props.onClick();await ui.idle();assert.equal(puts.length,2);assert.deepEqual(puts[1].changes,[{fieldKey:'title',optionId:null,value:null}]);
  assert.equal(Object.hasOwn(view.overrides.common,'title'),false);assert.equal(view.overrides.options.blue.title,'다른 옵션 제목');assert.equal(view.overrides.common[wire.id],'예전 공식 제목');
 }finally{ui.close();}
});

test('captured title/navigation/reset handlers cannot bypass draft, busy, option or changed-schema guards',async()=>{
 const view=fixture({overrides:{common:{title:'기존 제목'},options:{red:{title:'옵션 기존 제목'}}}}),opened=[];
 const ui=quotationTitleUI({view,props:{onEditSeo:()=>opened.push('seo')}});
 try{await ui.idle();
  const navigate=ui.button('SEO 설정에서 상품명 수정').props.onClick;
  const reset=ui.button('상품명 수정 해제').props.onClick;
  const modelInput=ui.field('model');modelInput.props.onChange({target:{value:'작성 중 모델'}});navigate();reset();assert.deepEqual(opened,[],'draft staging locks the already captured navigation before rerender');assert.deepEqual(plain(ui.changes),[{fieldKey:'model',optionId:null,value:'작성 중 모델'}],'a captured title reset cannot discard a different field staged in the same tick');ui.render();
  assert.equal(ui.button('SEO 설정에서 상품명 수정').props.disabled,true);
  ui.select('red');reset();assert.equal(ui.changes.some(change=>change.fieldKey==='title'),false,'old common reset cannot affect the selected option');
  const freshReset=ui.button('상품명 수정 해제').props.onClick;
  const ai=child(ui,'QuotationAiPanel');ai.props.onBusyChange(true);freshReset();assert.equal(ui.changes.some(change=>change.fieldKey==='title'),false);
  ai.props.onBusyChange(false);ui.render();
  const previous=ui.field('model').props.onChange,next=plain(view);next.resolved.schema.fields.find(field=>field.id==='model').hubInput='title';next.resolved.schema.fields.find(field=>field.id==='model').hubWire={path:['startPage','productName']};
  ui.replaceView(next);previous({target:{value:'오래된 우회 제목'}});assert.equal(ui.changes.some(change=>change.value==='오래된 우회 제목'),false);assert.equal(ui.field('model').props.readOnly,true);
  assert.equal(ui.calls.some(call=>call.init?.method),false);
 }finally{ui.close();}
});

test('quotation UI rejects new title drafts from secondary tools while the manual title API stays compatible',async()=>{
 const view=fixture(),ui=quotationTitleUI({view});
 try{await ui.idle();const draft=[{optionId:null,fieldKey:'title',value:'직접 API 제목'}];
  assert.deepEqual(plain(model.validateQuotationChanges(draft,{schema:view.resolved.schema,optionIds:['red','blue'],overrides:view.overrides})),draft);
  assert.equal(model.applyQuotationChanges(view.overrides,draft).common.title,'직접 API 제목');
  assert.throws(()=>policy.assertQuotationSeoTitleDraft(view.resolved.schema.fields,draft),/SEO 설정/);
  assert.doesNotThrow(()=>policy.assertQuotationSeoTitleDraft(view.resolved.schema.fields,[{...draft[0],value:null}]));
  assert.throws(()=>child(ui,'QuotationAiPanel').props.onApply(draft),/SEO 설정/);assert.equal(ui.changes.length,0);assert.equal(ui.calls.some(call=>call.init?.method),false);
 }finally{ui.close();}
});

test('quotation panel forwards the optional SEO navigation callback without fetching or editing a quotation',()=>{
 const view=fixture(),profile={id:'saved',name:'저장 양식',categoryId:'80719',categoryPath:[],template:null};let opened=0,calls=0,index=0;
 const callback=()=>{opened++;},Editor=()=>null;
 const states=[[profile],'saved',2,true,null,false,null,'','',false,'saved',true,'','',0,'80719',null,[],false,'',0,'',''];
 const hooks={useState(initial){const i=index++;return[i<states.length?states[i]:initial,()=>{}];},useRef:initial=>({current:initial}),useEffect(){},useLayoutEffect(){}};
 const panel=quotationTitleLoader({react:hooks,fetch(){calls++;throw Error('Unexpected request');},
  '@/app/components/quotation-fields-editor':{QuotationFieldsEditor:Editor},
  '@/app/components/quotation-preview-review':{QuotationPreviewReview:()=>null},
  '@/app/components/quotation-mapping-review':{QuotationMappingReview:()=>null},
  '@/app/category-profiles':{quotationStartRow:()=>2},
  '@/app/supplier-hub-catalog':{prepareOfficialHubProfileTemplate(){throw Error('Unexpected preparation');}},
 })('app/components/quotation-panel.tsx');
 const before=JSON.stringify(view),outer=panel.QuotationPanel({productId:'p1',onManageCategories(){},onEditSeo:callback});
 const editor=titleNodes(outer.type(outer.props)).find(node=>node.type===Editor);assert.ok(editor);assert.equal(editor.props.onEditSeo,callback);editor.props.onEditSeo();assert.equal(opened,1);assert.equal(calls,0);assert.equal(JSON.stringify(view),before);
});
