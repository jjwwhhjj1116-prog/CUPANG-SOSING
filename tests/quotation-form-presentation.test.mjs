import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {quotationTitleLoader,quotationTitleUI,titleNodes,titleText,quotationPresentationFixture,visibleNodes,visibleText,fieldContainer,plain} from './helpers/quotation-form-presentation.mjs';
const load=quotationTitleLoader(),policy=load('app/quotation-field-notes.ts');
const reminder='실제 상품·증빙과 일치하는지 확인해주세요.';
const mutations=ui=>ui.calls.filter(call=>call.init?.method&&call.init.method!=='GET');

test('quotation shows all five ordered sections together and keeps the normal form free of admin tools',async()=>{
 const view=quotationPresentationFixture(),ui=quotationTitleUI({view});
 try{await ui.idle();
  const stages=ui.nodes().filter(node=>node.type==='fieldset'&&node.props['data-section']);
  assert.deepEqual(stages.map(node=>node.props['data-section']),['start','product','image','legal','logistics']);
  assert.ok(stages.every(node=>!node.props.hidden&&!node.props.disabled));
  assert.equal(ui.nodes().some(node=>node.type==='nav'&&node.props['aria-label']==='견적서 단계'),false);
  const actions=ui.nodes().find(node=>node.props?.className==='quotation-fields-actions');
  assert.deepEqual(titleNodes(actions).filter(node=>node.type==='button').map(titleText),['저장']);
  assert.doesNotMatch(visibleText(ui.render()),/입력 정보|저장본 불러오기|추가 견적 작업|견적 양식 확인 정보|견적 검토·전송|제안 상품명/);
  ui.field('model').props.onChange({target:{value:'작성 중 모델'}});ui.render();
  assert.equal(ui.field('model').props.value,'작성 중 모델');assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('quotation panel exposes one initially closed admin mode only to the authorized role',()=>{
 const slots=[];let cursor=0;
 const react={
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  useRef:value=>({current:value}),useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){},useLayoutEffect(){},
 };
 const Panel=quotationTitleLoader({react})('app/components/quotation-panel.tsx').QuotationPanel;
 const render=canAdminTools=>{cursor=0;const panel=Panel({productId:'p1',canAdminTools,adminExtras:'관리자 전용 이전 자료',onManageCategories(){}});return panel.type(panel.props);};
 const adminButton=tree=>titleNodes(tree).find(node=>node.props?.className?.includes('quotation-admin-toggle'));
 const extras=tree=>titleNodes(tree).find(node=>node.props?.className==='quotation-admin-panel-tools');
 assert.equal(adminButton(render(false)),undefined);assert.equal(extras(render(false)),undefined);
 let authorized=render(true);assert.equal(adminButton(authorized).props['aria-expanded'],false);assert.equal(extras(authorized),undefined);
 adminButton(authorized).props.onClick();authorized=render(true);
 assert.equal(adminButton(authorized).props['aria-expanded'],true);assert.match(titleText(extras(authorized)),/Excel 견적서·첨부 자료.*관리자 전용 이전 자료/s);
 adminButton(authorized).props.onClick();assert.equal(extras(render(true)).props.hidden,true);
 assert.equal(extras(render(false)),undefined,'revoking the role removes mounted admin tools');
});

test('a normal save with an unreadable acknowledgement offers readback before another write and keeps the draft',async()=>{
 const view=quotationPresentationFixture();
 const ui=quotationTitleUI({view,request:(_url,init)=>init?.method==='PUT'?new Response('<html>잠시 후</html>',{status:503}):Response.json(view)});
 try{
  await ui.idle();assert.equal(ui.button('저장 상태 확인'),undefined);
  ui.field('model').props.onChange({target:{value:'작성 중 모델'}});ui.render();
  ui.button('견적 입력 저장').props.onClick();await ui.idle();
  assert.equal(ui.button('견적 입력 저장').props.disabled,true);
  assert.equal(ui.field('model').props.value,'작성 중 모델');
  const calls=ui.calls.length;ui.button('저장 상태 확인').props.onClick();await ui.idle();
  assert.equal(ui.calls.length,calls+1);assert.equal(ui.calls.at(-1).init?.method,undefined);
  assert.equal(mutations(ui).length,1);assert.equal(ui.field('model').props.value,'작성 중 모델');
  assert.equal(ui.button('저장 상태 확인'),undefined);assert.equal(ui.button('견적 입력 저장').props.disabled,false);
 }finally{ui.close();}
});

test('only exact repeated reminders collapse; unknown reviews, conditional applicability, source mismatches and real errors stay visible',async()=>{
 const view=quotationPresentationFixture(),unknown='검증 기관의 실제 증빙을 확인해야 합니다.',chinese='수집 원문의 중국어 상품명이 남아 있습니다. 1단계에서 상품명을 확인하고 번역·수정해주세요.',mismatch='자동 계산 가격은 2단계 옵션의 판매 구성 수량 2개입 기준입니다. 견적 수량을 3로 직접 수정했습니다. 구성 수량과 가격을 함께 확인해주세요.',error='시험 필드의 실제 검증 오류입니다.';
 for(const data of [view.resolved,view.automatic])for(const row of data.rows){row.fields.brand.reviewMessages=[reminder,unknown,chinese,mismatch];row.fields.brand.validationIssues=[error];row.fields.brand.issues=[reminder,unknown,chinese,mismatch,error];}
 for(const data of [view.resolved,view.automatic]){const field=data.schema.fields.find(item=>item.id==='brand');field.workbookWire={sha256:'a'.repeat(64),sheetName:'견적',column:3,requirement:'conditional'};field.help='설치 대상일 때의 조건을 확인합니다.';}
 const ui=quotationTitleUI({view,props:{adminTools:'visible'}});try{await ui.idle();const field=fieldContainer(ui,'brand'),text=visibleText(field),diagnostic=titleNodes(field).find(node=>node.type==='details');
  assert.doesNotMatch(text,/실제 상품·증빙과 일치하는지/);for(const message of [unknown,chinese,mismatch,error,'해당 상품에 조건이 적용되는지'])assert.ok(text.includes(message),message);
  assert.equal(diagnostic.props.open,undefined);assert.ok(visibleText(field,new Set([diagnostic])).includes(reminder));assert.equal(mutations(ui).length,0);
  const partition=policy.quotationFieldIssueNotes([reminder,unknown],[reminder]);assert.deepEqual(plain(partition),{visible:[reminder,unknown],diagnostic:[]},'even a reminder-shaped validation error remains visible');
  assert.deepEqual(plain(policy.quotationFieldIssueNotes([reminder+' 추가 확인'])),{visible:[reminder+' 추가 확인'],diagnostic:[]},'similar unknown warnings are not classified by substring');
 }finally{ui.close();}
});

test('native title and model descriptions remain visible with SEO/model helpers, multiline text and escaped schema markup',async()=>{
 const view=quotationPresentationFixture({native:true}),description='원본 설명 첫 줄\n<script>실행하지 않는 문자열</script> 둘째 줄';
 for(const data of [view.resolved,view.automatic])for(const id of ['title','model'])data.schema.fields.find(field=>field.id===id).help=description;
 const ui=quotationTitleUI({view,props:{adminTools:'visible',onEditSeo(){}}});try{await ui.idle();
  for(const id of ['title','model']){const field=fieldContainer(ui,id),notes=visibleNodes(field).filter(node=>node.props?.className==='quotation-field-help quotation-schema-description');assert.equal(notes.length,1,id);assert.equal(titleText(notes[0]),description);assert.match(renderToStaticMarkup(notes[0]),/&lt;script&gt;/);assert.equal(titleNodes(notes[0]).some(node=>node.type==='script'),false);}
  assert.equal(ui.field('title').props.readOnly,true);assert.match(visibleText(fieldContainer(ui,'title')),/상품명은 SEO 설정에서 수정해주세요\./);
  assert.ok(ui.nodes().some(node=>node.type==='summary'&&titleText(node)==='모델명 제안 확인'),'model-specific helper does not replace the actual description');assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

function addField(view,field,value='기존 값'){
 for(const data of [view.resolved,view.automatic]){data.schema.fields.push(plain(field));for(const row of data.rows)row.fields[field.id]={value,source:'content',needsReview:false,issues:[],validationIssues:[],reviewMessages:[]};}
}
test('interleaved production Product Page fields form one ordered group each while retaining every visible ID, value and edit target',async()=>{
 const view=quotationPresentationFixture(),grouping=load('app/quotation-field-groups.ts'),prices=load('app/quotation-price-edits.ts');
 for(const [id,wire,role,value] of [['native-supply','purchasePrice','supplyPrice','2500'],['native-sale','coupangSalePrice','salePrice','4000'],['native-msrp','msrp','msrp','5200'],['native-osrp','osrp','msrp',''],['native-barcode','productBarcode','barcode','ABC123']])addField(view,
  {id,section:'product',label:id,type:role==='barcode'?'text':'number',required:true,visibility:'common',hubInput:role,hubWire:{path:['productPage','commonAttributes',wire]}},value);
 for(const id of ['description','bullets'])addField(view,{id,section:'product',label:id,type:'textarea',required:false,visibility:'common'},id+' 수동 설명');
 for(const data of [view.resolved,view.automatic]){
  const product=data.schema.fields.filter(field=>field.section==='product'),byId=new Map(product.map(field=>[field.id,field]));
  const first=['model','brand','manufacturer','tradeType','taxType','importType','barcodeMode','barcode','native-barcode','color','quantity','size','native-supply','native-sale','native-msrp','searchTags','description','bullets'];
  const interleaved=[...first.map(id=>byId.get(id)),...product.filter(field=>!first.includes(field.id))];
  data.schema.categoryId='103689';
  data.schema.fields=[...data.schema.fields.filter(field=>field.section!=='product'),...interleaved];
 }
 const before=JSON.stringify(view),original=prices.quotationPriceVisibleFields(view.resolved.schema.fields).filter(field=>field.section==='product');
 const ui=quotationTitleUI({view});try{
  await ui.idle();const product=visibleNodes(ui.render()).find(node=>node.type==='fieldset'&&node.props['data-section']==='product'),visible=visibleNodes(product);
  assert.deepEqual(visible.filter(node=>node.type==='h5').map(titleText),['기본 정보','가격 정보','노출 속성','비노출 속성']);
  const prefix='seo-title-test-',ids=new Set(original.map(field=>prefix+field.id));
  const controls=visible.filter(node=>ids.has(node.props?.id));
  assert.equal(controls.length,original.length);assert.deepEqual(controls.map(node=>node.props.id).sort(),[...ids].sort(),'every previously visible field remains visible exactly once');
  for(const control of controls){const id=control.props.id.slice(prefix.length),cell=view.resolved.rows.find(row=>row.optionId===null).fields[id];assert.equal(control.props.value??control.props.cell?.value,cell.value,id);}
  const shown=controls.map(node=>node.props.id.slice(prefix.length)),priceIds=shown.filter(id=>grouping.quotationFieldGroup(original.find(field=>field.id===id),view.resolved.schema.fields)==='가격 정보');
  assert.deepEqual(priceIds,['native-supply','native-sale','barcodeMode','barcode','native-barcode','native-msrp','native-osrp']);
  assert.deepEqual(shown.filter(id=>['brand','manufacturer','tradeType','taxType','importType','searchTags','model'].includes(id)),['brand','manufacturer','tradeType','taxType','importType','searchTags','model']);
  assert.equal(grouping.quotationSectionDisplayFields(view.resolved.schema.fields,'product','64455')[0].id,'model');
  assert.ok(shown.indexOf('searchTags')<shown.indexOf('description'));assert.ok(shown.indexOf('bullets')<shown.indexOf('native-supply'),'optional existing descriptions remain at the end of basic information');
  ui.field('native-osrp').props.onChange({target:{value:'6100'}});ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:'native-osrp',optionId:null,value:'6100'}]);assert.equal(ui.field('native-msrp').props.value,'5200','independent OSRP edits do not change MSRP');
  ui.field('description').props.onChange({target:{value:'그룹 정리 후 작성한 설명'}});ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:'native-osrp',optionId:null,value:'6100'},{fieldKey:'description',optionId:null,value:'그룹 정리 후 작성한 설명'}]);
  assert.equal(JSON.stringify(view),before,'presentation leaves the original schema, cells and saved values untouched');assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('cleaning brush quotation follows the observed retail price and packaged weight order without changing schema',()=>{
 const grouping=load('app/quotation-field-groups.ts'),view=quotationPresentationFixture();
 const fields=view.resolved.schema.fields;
 addField(view,{id:'native-box-weight',section:'logistics',label:'한 개 단품 포장 무게',type:'text',numericText:true,required:true,visibility:'common',
  hubInput:'packagedWeightG',hubWire:{path:['logisticsPage','skuUnitBoxWeight']}},'150');
 const dimensions=fields.findIndex(field=>field.id==='packagedDimensionsMm'),[dimensionField]=fields.splice(dimensions,1);
 fields.unshift(dimensionField);
 const before=JSON.stringify(fields),order=(section,ids,category='64455')=>grouping.quotationSectionDisplayFields(fields,section,category).filter(field=>ids.includes(field.id)).map(field=>field.id);
 const prices=['supplyPrice','salePrice','msrp','barcodeMode','barcode'];
 assert.deepEqual(order('product',prices),prices);
 const packaging=['packagedWeightG','native-box-weight','packagedDimensionsMm'];
 assert.deepEqual(order('logistics',packaging),packaging);
 assert.equal(order('logistics',packaging,'103689')[0],'packagedDimensionsMm');
 assert.equal(JSON.stringify(fields),before);
});

test('OSRP-only native price stays after barcode with its explicit blank and original linked save targets',async()=>{
 const view=quotationPresentationFixture();addField(view,{id:'native-osrp',section:'product',label:'공식 판매처 가격',type:'number',required:false,visibility:'common',hubInput:'msrp',hubWire:{path:['productPage','commonAttributes','osrp']}},'');
 const before=JSON.stringify(view),ui=quotationTitleUI({view});try{await ui.idle();
  assert.equal(ui.field('msrp'),undefined);assert.equal(ui.field('native-osrp').props.value,'');
  const product=visibleNodes(ui.render()).find(node=>node.type==='fieldset'&&node.props['data-section']==='product'),controls=visibleNodes(product).filter(node=>['input','textarea'].includes(node.type)).map(node=>node.props.id);
  assert.deepEqual(controls.filter(id=>['seo-title-test-barcode','seo-title-test-native-osrp'].includes(id)),['seo-title-test-barcode','seo-title-test-native-osrp']);
  ui.field('native-osrp').props.onChange({target:{value:'6300'}});ui.render();assert.deepEqual(plain(ui.changes).sort((a,b)=>a.fieldKey.localeCompare(b.fieldKey)),[{fieldKey:'msrp',optionId:null,value:'6300'},{fieldKey:'native-osrp',optionId:null,value:'6300'}]);assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('late native size-chart and label fields stay in their Couplus image groups with unchanged values and exact edit targets',async()=>{
 const view=quotationPresentationFixture();
 for(const [id,wire,name] of [['native-size','sizeChartImage'],['native-label-two','labelImages','다른 제품 표시사항']])addField(view,
  {id,section:'image',label:id,type:'images',required:false,visibility:'common',...(wire==='sizeChartImage'?{hubInput:'sizeImages'}:{}),hubWire:{path:['imagePage','images',wire],...(name?{name,nameKey:'labelImageType',valueKey:'labelImageFiles'}:{})}},'owner/'+id+'.png');
 addField(view,{id:'unknown-image','section':'image',label:'사이즈표 이미지처럼 보이는 추가 필드',type:'images',required:false,visibility:'common',hubWire:{path:['imagePage','images','unknown']}},'owner/unknown.png');
 addField(view,{id:'workbook-image',section:'image',label:'원본 Excel 추가 이미지',type:'images',required:false,visibility:'common',workbookWire:{sha256:'a'.repeat(64),sheetName:'견적',column:20,requirement:'optional'}},'owner/workbook.png');
 const before=JSON.stringify(view),original=view.resolved.schema.fields.filter(field=>field.section==='image'),ui=quotationTitleUI({view});
 try{await ui.idle();const section=visibleNodes(ui.render()).find(node=>node.type==='fieldset'&&node.props['data-section']==='image'),visible=visibleNodes(section);
  assert.deepEqual(visible.filter(node=>node.type==='h5').map(titleText),['기본 이미지','라벨 이미지','상세 정보','원본 Excel 추가 항목']);
  const shown=visible.filter(node=>node.props?.className?.split?.(' ').includes('quotation-field')).map(node=>original.find(field=>titleNodes(node).some(child=>child.props?.id==='seo-title-test-'+field.id))?.id);
  assert.deepEqual(shown,['mainImage','additionalImages','native-size','labelImages','native-label-two','detailImages','detailHtml','altText','unknown-image','workbook-image']);
  assert.deepEqual([...shown].sort(),original.map(field=>field.id).sort(),'no field is lost, duplicated or fabricated');
  for(const field of original)assert.equal(ui.field(field.id).props.value,view.resolved.rows[0].fields[field.id].value,field.id);
  ui.field('native-size').props.onChange({target:{value:'owner/replacement-size.png'}});ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:'native-size',optionId:null,value:'owner/replacement-size.png'}]);
  assert.equal(ui.field('detailHtml').props.value,view.resolved.rows[0].fields.detailHtml.value);assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('unbound native image names cannot masquerade as known size charts or label rows, and unknown fields remain stable',()=>{
 const grouping=load('app/quotation-field-groups.ts'),base={section:'image',type:'images',required:false,visibility:'common'};
 const fields=[
  {...base,id:'unknown-one',label:'사이즈표 이미지',hubInput:'sizeImages',hubWire:{path:['imagePage','images','otherSizeChartImage']}},
  {...base,id:'unknown-two',label:'라벨 이미지',hubWire:{path:['imagePage','images','labelImages','extra']}},
  {...base,id:'size',label:'정확한 크기 이미지',hubInput:'sizeImages',hubWire:{path:['imagePage','images','sizeChartImage']}},
  {...base,id:'native-label',label:'다른 라벨',hubWire:{path:['imagePage','images','labelImages'],name:'다른 라벨',nameKey:'labelImageType',valueKey:'labelImageFiles'}},
 ];
 const before=JSON.stringify(fields),display=grouping.quotationSectionDisplayFields(fields,'image');
 assert.deepEqual(plain(display.map(field=>field.id)),['size','native-label','unknown-one','unknown-two']);
 assert.equal(grouping.quotationFieldGroup(fields[0]),'상세 정보');assert.equal(grouping.quotationFieldGroup(fields[1]),'상세 정보');assert.equal(grouping.quotationFieldGroup(fields[3]),'라벨 이미지');
 assert.equal(JSON.stringify(fields),before);for(const field of display)assert.equal(field,fields.find(source=>source.id===field.id),'presentation returns the existing field objects');
});

test('named original attribute, notice and certificate rows pair readonly names with unchanged editable values and optional native examples',async()=>{
 const view=quotationPresentationFixture();
 const fields=[
  {id:'named-exposed',section:'product',label:'색상',visibility:'exposed',hubWire:{path:['productPage','commonAttributes','exposedAttributes'],name:'색상',nameKey:'attributeName',valueKey:'attributeValue'}},
  {id:'named-hidden',section:'product',label:'소재',visibility:'hidden',hubWire:{path:['productPage','unexposedAttributes'],name:'소재',nameKey:'attributeName',valueKey:'attributeValue'}},
  {id:'named-notice',section:'legal',label:'사용 방법',visibility:'common',hubWire:{path:['legalPage','notices'],name:'사용 방법',nameKey:'noticeItemName',valueKey:'noticeItemValue'}},
  {id:'named-cert',section:'legal',label:'인증 명칭',visibility:'common',hubWire:{path:['legalPage','certificates'],name:'인증 명칭',nameKey:'certificateName',valueKey:'certificateValue'}},
 ].map(field=>({...field,type:'text',required:true,example:'예시 <문자열>\n둘째 줄',help:'이 항목의 실제 입력 안내'}));
 for(const field of fields)addField(view,field);
 const ui=quotationTitleUI({view});try{await ui.idle();for(const field of fields){const container=fieldContainer(ui,field.id),pair=titleNodes(container).find(node=>node.props?.className==='quotation-named-pair');assert.ok(pair,field.id);
   const name=titleNodes(pair).find(node=>node.props?.['aria-label']===field.label+' 항목명');assert.equal(name.props.readOnly,true);assert.equal(name.props.value,field.hubWire.name);assert.equal(name.props.onChange,undefined);
   assert.equal(ui.field(field.id).props.readOnly,false);assert.equal(ui.field(field.id).props.value,'기존 값');assert.equal(ui.field(field.id).props.placeholder,'확인한 내용을 입력하세요.');
   const icon=titleNodes(pair).find(node=>node.props?.className==='quotation-field-example');assert.equal(icon.props.tabIndex,0);assert.equal(icon.props.title,'예시: '+field.example);assert.equal(icon.props['aria-label'],icon.props.title);assert.equal(icon.props.onClick,undefined);assert.match(visibleText(container),/이 항목의 실제 입력 안내/);
  }
  ui.field(fields[0].id).props.onChange({target:{value:'검토한 새 색상'}});ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:fields[0].id,optionId:null,value:'검토한 새 색상'}]);assert.equal(mutations(ui).length,0);assert.equal(view.resolved.rows[0].fields[fields[0].id].value,'기존 값');
 }finally{ui.close();}
});

test('named selects keep their original nullable choice control and unrelated named arrays are never given paired-row semantics',async()=>{
 const view=quotationPresentationFixture(),field={id:'named-choice',section:'product',label:'소재',visibility:'hidden',hubWire:{path:['productPage','unexposedAttributes'],name:'소재',nameKey:'attributeName',valueKey:'attributeValue'},type:'select',required:false,choices:[{value:'',label:'해당사항없음'},{value:'PC',label:'PC'}]};addField(view,field,'PC');
 for(const changed of [{hubWire:{...field.hubWire,path:['productPage','customAttributes']}},{hubWire:{...field.hubWire,path:['imagePage','labelImages']}},{type:'images'},{hubWire:{...field.hubWire,valueKey:'differentValue'}}])assert.equal(policy.quotationUsesNamedPair({...field,...changed}),false);
 const ui=quotationTitleUI({view});try{await ui.idle();const container=fieldContainer(ui,field.id),control=titleNodes(container).find(node=>typeof node.type==='function'&&node.type.name==='QuotationChoiceInput');assert.ok(control);assert.equal(control.props.cell.value,'PC');assert.equal(control.props.id,'seo-title-test-'+field.id);control.props.onChange('');ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:field.id,optionId:null,value:''}]);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('expanded field diagnostics retain manual reset and selected-field copy as unsaved drafts with the same guards',async()=>{
 const view=quotationPresentationFixture({overrides:{common:{},options:{red:{model:'기존 수동 모델'}}}}),before=JSON.stringify(view),ui=quotationTitleUI({view,props:{adminTools:'visible'}});
 try{await ui.idle();ui.select('red');let field=fieldContainer(ui,'model'),diagnostic=titleNodes(field).find(node=>node.type==='details'&&titleText(node.props.children).startsWith('자동값·입력 출처'));
  assert.ok(diagnostic);assert.doesNotMatch(visibleText(field),/수정 해제 · 자동값 복원/);const reset=visibleNodes(field,new Set([diagnostic])).find(node=>node.type==='button'&&titleText(node)==='수정 해제 · 자동값 복원');assert.ok(reset);reset.props.onClick();ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:'model',optionId:'red',value:null}]);
  ui.field('model').props.onChange({target:{value:'복사할 모델'}});ui.render();field=fieldContainer(ui,'model');diagnostic=titleNodes(field).find(node=>node.type==='details'&&titleText(node.props.children).startsWith('자동값·입력 출처'));
  const copy=visibleNodes(field,new Set([diagnostic])).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.ok(copy);copy.props.onChange({target:{checked:true}});ui.render();ui.button('적용 범위 미리보기').props.onClick();ui.render();ui.button('확인한 범위에 적용').props.onClick();ui.render();
  assert.ok(ui.changes.some(change=>change.fieldKey==='model'&&change.optionId==='blue'&&change.value==='복사할 모델'));assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);assert.ok(ui.button('견적 입력 저장'));
 }finally{ui.close();}
});

test('prominent AI action requests the mounted tool once and reveals review; stale draft/busy and retired actions stay blocked',async()=>{
 const view=quotationPresentationFixture(),ui=quotationTitleUI({view});
 try{await ui.idle();const tools=()=>ui.nodes().find(node=>node.props?.className==='quotation-ai-tools');let scrolls=0;assert.equal(tools().props.hidden,true);tools().props.ref.current={scrollIntoView(){scrolls++;}};
  const ai=ui.nodes().find(node=>typeof node.type==='function'&&node.type.name==='QuotationAiPanel');let requests=0;assert.equal(ui.button('AI 처리').props.disabled,false);
  const sourceKey=JSON.stringify([ai.props.productId,ai.props.profileId??null,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint,ai.props.optionId]);
  const first={requestDraft(){requests++;ai.props.onBusyChange(true);},disabled:false,applyToAllOptions:false,sourceKey};ai.props.onRequestActionChange(first);ui.render();
  const originalCalls=ui.calls.length,open=ui.button('AI 처리').props.onClick;assert.equal(ui.button('AI 처리').props.disabled,false);open();open();ui.render();assert.equal(requests,1);assert.equal(tools().props.hidden,false);assert.equal(scrolls,1);assert.equal(ui.calls.length,originalCalls);assert.equal(ui.changes.length,0);assert.equal(mutations(ui).length,0);
  ai.props.onBusyChange(false);ui.render();const next={requestDraft(){requests++;},disabled:false,applyToAllOptions:false,sourceKey};ai.props.onRequestActionChange(next);ai.props.onRequestActionChange(null,first);ui.render();assert.equal(ui.button('AI 처리').props.disabled,false);
  ui.button('AI 작성 접기').props.onClick();ui.render();const retained=ui.button('AI 처리').props.onClick;ui.field('model').props.onChange({target:{value:'먼저 저장할 입력'}});retained();assert.equal(tools().props.hidden,true,'already captured action cannot request against a new same-tick draft');assert.equal(requests,1);ui.render();assert.equal(ui.button('AI 처리').props.disabled,true);
  assert.equal(ui.nodes().filter(node=>typeof node.type==='function'&&node.type.name==='QuotationAiPanel').length,1,'closing does not unmount the tool');
 }finally{ui.close();}
 const busyUI=quotationTitleUI({view});try{await busyUI.idle();
  const action=busyUI.button('AI 처리').props.onClick,ai=busyUI.nodes().find(node=>typeof node.type==='function'&&node.type.name==='QuotationAiPanel');ai.props.onBusyChange(true);action();assert.equal(busyUI.nodes().find(node=>node.props?.className==='quotation-ai-tools').props.hidden,true);busyUI.render();assert.equal(busyUI.button('AI 처리').props.disabled,true);assert.equal(mutations(busyUI).length,0);
 }finally{busyUI.close();}
});

test('a clean reopened AI review can be revealed while its original execution is locked',async()=>{
 const view=quotationPresentationFixture(),ui=quotationTitleUI({view,props:{initialOptionId:'red'}});
 try{
  await ui.idle();
  const ai=ui.nodes().find(node=>node.type?.name==='QuotationAiPanel');
  const sourceKey=JSON.stringify([ai.props.productId,ai.props.profileId??null,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint,ai.props.optionId]);
  ai.props.onRequestActionChange({disabled:true,scopeLocked:true,applyToAllOptions:false,sourceKey,requestDraft(){assert.fail('must not repeat AI request');}});
  ui.render();
  assert.equal(ui.button('AI 처리').props.disabled,false);
  ui.button('AI 처리').props.onClick();ui.render();
  assert.equal(ui.nodes().find(node=>node.props?.className==='quotation-ai-tools').props.hidden,false);
  assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('focused option needs only the save and apply-all actions; submission details are admin-only',async()=>{
 const view=quotationPresentationFixture(),ui=quotationTitleUI({view,props:{initialOptionId:'red'}});
 try{await ui.idle();const actions=ui.nodes().find(node=>node.props?.className==='quotation-fields-actions');
  assert.equal(ui.nodes().some(node=>node.props?.className?.includes('quotation-option-picker')),false);
  assert.ok(titleNodes(actions).some(node=>node.props?.role==='switch'));
  assert.equal(ui.button('견적 입력 저장').props['aria-label'],'견적 입력 저장');
  assert.equal(ui.button('견적 검토·전송'),undefined);
  ui.render({adminTools:'visible'});
  assert.ok(ui.button('견적 검토·전송'));
  assert.equal(ui.nodes().filter(node=>node.type?.name==='SupplierHubSingleReview').length,1);
  assert.doesNotMatch(visibleText(ui.render({adminTools:'hidden'})),/견적 검토·전송/);
  assert.equal(ui.nodes().filter(node=>node.type?.name==='SupplierHubSingleReview').length,1,'closing keeps in-flight admin operations mounted');
  assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('retained header AI requests cannot bypass split, submission, refresh or unmount guards',async()=>{
 for(const blocker of ['split','split-draft','submission','refresh','unmount']) {
  const view=quotationPresentationFixture(),ui=quotationTitleUI({view,props:{adminTools:'visible'}});try{await ui.idle();const ai=ui.nodes().find(node=>node.type?.name==='QuotationAiPanel');let requested=0;
   const sourceKey=JSON.stringify([ai.props.productId,ai.props.profileId??null,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint,ai.props.optionId]);
   ai.props.onRequestActionChange({disabled:false,applyToAllOptions:true,sourceKey,requestDraft(){requested++;}});ui.render();const retained=ui.button('AI 처리').props.onClick;
   if(blocker==='split'||blocker==='split-draft'){const split=ui.nodes().find(node=>node.type?.name==='ProductOptionSplitPanel');split.props[blocker==='split'?'onBusyChange':'onDraftChange'](true);}
   if(blocker==='submission')ui.nodes().find(node=>node.type?.name==='SupplierHubSingleReview').props.onLockChange(true,true);
   if(blocker==='refresh')ui.render({refreshToken:'changed-source'});if(blocker==='unmount')ui.close();
   retained();assert.equal(requested,0,blocker);assert.equal(mutations(ui).length,0,blocker);
  }finally{ui.close();}
 }
});

test('parent layout readiness accepts the child passive request publication after effect cleanup and replay',async()=>{
 const view=quotationPresentationFixture(),ui=quotationTitleUI({view});try{await ui.idle();const ai=ui.nodes().find(node=>node.type?.name==='QuotationAiPanel');let requests=0;
  const sourceKey=JSON.stringify([ai.props.productId,ai.props.profileId??null,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint,ai.props.optionId]);
  const old={disabled:false,applyToAllOptions:false,sourceKey,requestDraft(){requests++;}},fresh={...old};ai.props.onRequestActionChange(old);ui.render();
  ui.replayEffects(()=>{ai.props.onRequestActionChange(null,old);ai.props.onRequestActionChange(fresh);});await ui.idle();assert.equal(ui.button('AI 처리').props.disabled,false);ui.button('AI 처리').props.onClick();assert.equal(requests,1);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('image raw keys and candidate editing are collapsed while final selected thumbnails stay visible without changing drafts',async()=>{
 const view=quotationPresentationFixture(),field=view.resolved.schema.fields.find(item=>item.type==='images');assert.ok(field);view.imageKeys=['owner/first.png','owner/second.png'];
 for(const data of [view.resolved,view.automatic])for(const row of data.rows)row.fields[field.id].value=view.imageKeys.join('\n');
 const before=JSON.stringify(view),ui=quotationTitleUI({view});try{await ui.idle();const container=fieldContainer(ui,field.id),details=titleNodes(container).find(node=>node.props?.className==='quotation-image-tools'),visible=visibleNodes(container);
  assert.ok(details);assert.ok(!details.props.open);assert.ok(titleNodes(details).some(node=>node.props?.id==='seo-title-test-'+field.id));assert.equal(visible.some(node=>node.type==='textarea'),false);
  assert.equal(visible.filter(node=>node.type==='img').length,2);assert.equal(ui.render().props['data-field-tools'],false);
  assert.equal(ui.render({adminTools:'visible'}).props['data-field-tools'],true);
  const reorder=titleNodes(details).find(node=>node.props?.['aria-label']==='2번 이미지 앞으로');reorder.props.onClick();ui.render();assert.equal(ui.changes[0].value,'owner/second.png\nowner/first.png');assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('the official label attachment pairs a fixed name with the option-scoped image picker',async()=>{
 const view=quotationPresentationFixture(),id='labelImages',name='제품 한글 표시사항 라벨 또는 도안 이미지';
 const wire={path:['imagePage','images','labelImages'],name,nameKey:'labelImageType',valueKey:'labelImageFiles'};
 const fileFields=[['mainImage',['images','mainImage'],'대표이미지 파일명','대표 이미지'],['additionalImages',['images','additionalImage'],'추가이미지 파일명','추가 이미지'],['detailImages',['details','detailedImage'],'상세이미지 파일명','상세 이미지']];
 const detailFields=[['detailHtml',['details','htmlProductDetailContent'],'HTML 상품 상세 컨텐츠','HTML 상세 내용'],['altText',['details','altText'],'이미지 대체 텍스트','대체 텍스트']];
 const [first,second]=view.imageKeys=['owner/label.png','owner/revised-label.png'];
 for(const data of [view.resolved,view.automatic]){
  const field=data.schema.fields.find(item=>item.id===id);field.hubWire=wire;
  for(const [fieldId,path,rawCaption] of [...fileFields,...detailFields]){
   const bound=data.schema.fields.find(item=>item.id===fieldId);bound.hubWire={path:['imagePage',...path]};bound.label=rawCaption;
  }
  for(const row of data.rows)row.fields[id].value=row.optionId==='red'?first:'';
 }
 const field=view.resolved.schema.fields.find(item=>item.id===id),custom={...field,id:'custom-label',hubWire:{...wire,path:['imagePage','images','customLabelImages']}};
 addField(view,custom,'');
 const ui=quotationTitleUI({view});try{
  await ui.idle();ui.select('red');
  const container=fieldContainer(ui,id),pair=titleNodes(container).find(node=>node.props?.className==='quotation-named-pair');
  assert.ok(pair);
  const section=ui.nodes().find(node=>node.type==='fieldset'&&node.props['data-section']==='image');
  const imageFields=titleNodes(section).filter(node=>node.props?.['data-quotation-field']).map(node=>node.props['data-quotation-field']);
  assert.deepEqual(imageFields.filter(fieldId=>['mainImage','additionalImages','labelImages','detailImages','detailHtml','altText'].includes(fieldId)),['mainImage','additionalImages','labelImages','detailImages','detailHtml','altText']);
  assert.equal(visibleNodes(section).some(node=>node.type==='button'||node.type==='input'&&node.props.type==='file'),false);
  assert.equal(ui.field('detailHtml').props.rows,1);assert.equal(ui.field('detailHtml').props.placeholder,undefined);
  assert.equal(ui.field('altText').props.placeholder,undefined);
  for(const [fieldId,,,caption] of [...fileFields,...detailFields]){
   const heading=visibleNodes(fieldContainer(ui,fieldId)).find(node=>node.type==='label');
   assert.equal(heading.props.children[0],caption,fieldId);
   const control=visibleNodes(fieldContainer(ui,fieldId)).find(node=>node.props?.id===heading.props.htmlFor);
   assert.ok(control,`${fieldId} associates its caption with the visible control`);
  }
  for(const [fileId,,,caption] of fileFields){
   const input=visibleNodes(fieldContainer(ui,fileId)).find(node=>node.type==='input');
   assert.equal(input?.props.type,'text',fileId);assert.equal(input.props.placeholder,undefined,fileId);
   assert.equal(ui.field(fileId).props['aria-label'],`${caption} 파일 선택 순서`);
  }
  const [fixed,attachment]=pair.props.children;
  const fixedName=titleNodes(fixed).find(node=>node.type==='input');
  assert.equal(fixedName.props.value,name);assert.equal(fixedName.props.readOnly,true);assert.equal(fixedName.props.placeholder,'라벨 타입');
  const attachmentFile=visibleNodes(attachment).find(node=>node.type==='input');
  assert.equal(attachmentFile?.props.value,'label.png');assert.equal(attachmentFile.props.placeholder,'이미지 파일');
  assert.equal(attachmentFile.props.readOnly,true);
  const picker=titleNodes(attachment).find(node=>node.props?.className==='quotation-image-tools');
  const currentPicker=()=>titleNodes(fieldContainer(ui,id)).find(node=>node.props?.className==='quotation-image-tools');
  const candidates=()=>titleNodes(currentPicker()).filter(node=>node.props?.className==='quotation-fields-image-choice');
  assert.ok(picker);assert.equal(visibleNodes(attachment).filter(node=>node.type==='img').length,0);
  assert.equal(candidates().length,0,'a closed picker does not mount candidate cards');
  const selected=visibleNodes(attachment,new Set([picker])).find(node=>node.props?.className==='quotation-fields-image-final');
  assert.equal(titleNodes(selected).filter(node=>node.type==='img').length,1);
  assert.equal(titleNodes(fieldContainer(ui,custom.id)).some(node=>node.props?.className==='quotation-named-pair'),false);
  const main=view.resolved.schema.fields.find(item=>item.id==='mainImage');
  assert.equal(policy.quotationImageFieldCaption({...main,hubWire:{path:['imagePage','images','customMainImage']}}),main.label);
  assert.equal(policy.quotationUsesNamedPair({...field,hubWire:{...wire,valueKey:'otherFiles'}}),false);
  picker.props.onToggle({currentTarget:{open:true}});
  assert.equal(candidates().length,view.imageKeys.length);
  candidates().find(node=>node.props?.['aria-label']==='이미지 2 연결').props.onClick();ui.render();
  assert.deepEqual(plain(ui.changes),[{fieldKey:id,optionId:'red',value:`${first}\n${second}`}]);
  currentPicker().props.onToggle({currentTarget:{open:false}});
  assert.equal(candidates().length,0);
  currentPicker().props.onToggle({currentTarget:{open:true}});
  assert.equal(candidates().find(node=>node.props?.['aria-label']==='이미지 2 연결 해제').props['aria-pressed'],true);
  assert.equal(visibleNodes(fieldContainer(ui,id)).find(node=>node.props?.id===`seo-title-test-${id}-file`).props.value,'label.png, revised-label.png');
  ui.field(id).props.onChange({target:{value:'https://example.invalid/foreign-label.png'}});ui.render();
  assert.equal(ui.button('견적 입력 저장').props.disabled,true);
  assert.equal(visibleNodes(fieldContainer(ui,id)).find(node=>node.props?.id===`seo-title-test-${id}-file`).props.value,'');
  assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});
