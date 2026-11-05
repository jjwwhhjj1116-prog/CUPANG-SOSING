import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {quotationTitleLoader,quotationTitleUI,titleNodes,titleText,quotationPresentationFixture,visibleNodes,visibleText,fieldContainer,plain} from './helpers/quotation-form-presentation.mjs';
const load=quotationTitleLoader(),policy=load('app/quotation-field-notes.ts');
const reminder='실제 상품·증빙과 일치하는지 확인해주세요.';
const mutations=ui=>ui.calls.filter(call=>call.init?.method&&call.init.method!=='GET');

test('quotation opens as five continuous input sections with advanced context collapsed, without unmounting inputs or drafts',async()=>{
 const view=quotationPresentationFixture(),ui=quotationTitleUI({view});
 try{await ui.idle();const tree=ui.render(),visible=visibleNodes(tree),context=ui.nodes().find(node=>node.type==='details'&&node.props.className==='quotation-fields-context');
  assert.ok(context);assert.ok(!context.props.open);assert.equal(visible.some(node=>node.type==='nav'),false);assert.equal(titleNodes(context).some(node=>node.type==='nav'),true);
  assert.deepEqual(visible.filter(node=>node.type==='fieldset').map(node=>node.props['data-section']),['start','product','image','legal','logistics']);
  assert.match(visibleText(tree),/쿠팡 등록 정보/);assert.doesNotMatch(visibleText(tree),/현재 옵션 필수 미입력|미저장 수정|공통 수정은 별도로/);
  assert.equal(visible.some(node=>node.type==='select'&&titleText(node).includes('상품 공통값')),false);assert.ok(titleNodes(context).some(node=>node.type==='select'&&titleText(node).includes('상품 공통값')));
  ui.field('model').props.onChange({target:{value:'작성 중 모델'}});ui.render();
  const drafted=plain(ui.changes),expandedContext=ui.nodes().find(node=>node.type==='details'&&node.props.className==='quotation-fields-context');
  assert.match(visibleText(expandedContext,new Set([expandedContext])),/미저장 수정/);assert.deepEqual(plain(ui.changes),drafted);assert.equal(ui.field('model').props.value,'작성 중 모델');assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('only exact repeated reminders collapse; unknown reviews, conditional applicability, source mismatches and real errors stay visible',async()=>{
 const view=quotationPresentationFixture(),unknown='검증 기관의 실제 증빙을 확인해야 합니다.',chinese='수집 원문의 중국어 상품명이 남아 있습니다. 1단계에서 상품명을 확인하고 번역·수정해주세요.',mismatch='자동 계산 가격은 2단계 옵션의 판매 구성 수량 2개입 기준입니다. 견적 수량을 3로 직접 수정했습니다. 구성 수량과 가격을 함께 확인해주세요.',error='시험 필드의 실제 검증 오류입니다.';
 for(const data of [view.resolved,view.automatic])for(const row of data.rows){row.fields.brand.reviewMessages=[reminder,unknown,chinese,mismatch];row.fields.brand.validationIssues=[error];row.fields.brand.issues=[reminder,unknown,chinese,mismatch,error];}
 for(const data of [view.resolved,view.automatic]){const field=data.schema.fields.find(item=>item.id==='brand');field.workbookWire={sha256:'a'.repeat(64),sheetName:'견적',column:3,requirement:'conditional'};field.help='설치 대상일 때의 조건을 확인합니다.';}
 const ui=quotationTitleUI({view});try{await ui.idle();const field=fieldContainer(ui,'brand'),text=visibleText(field),diagnostic=titleNodes(field).find(node=>node.type==='details');
  assert.doesNotMatch(text,/실제 상품·증빙과 일치하는지/);for(const message of [unknown,chinese,mismatch,error,'해당 상품에 조건이 적용되는지'])assert.ok(text.includes(message),message);
  assert.equal(diagnostic.props.open,undefined);assert.ok(visibleText(field,new Set([diagnostic])).includes(reminder));assert.equal(mutations(ui).length,0);
  const partition=policy.quotationFieldIssueNotes([reminder,unknown],[reminder]);assert.deepEqual(plain(partition),{visible:[reminder,unknown],diagnostic:[]},'even a reminder-shaped validation error remains visible');
  assert.deepEqual(plain(policy.quotationFieldIssueNotes([reminder+' 추가 확인'])),{visible:[reminder+' 추가 확인'],diagnostic:[]},'similar unknown warnings are not classified by substring');
 }finally{ui.close();}
});

test('native title and model descriptions remain visible with SEO/model helpers, multiline text and escaped schema markup',async()=>{
 const view=quotationPresentationFixture({native:true}),description='원본 설명 첫 줄\n<script>실행하지 않는 문자열</script> 둘째 줄';
 for(const data of [view.resolved,view.automatic])for(const id of ['title','model'])data.schema.fields.find(field=>field.id===id).help=description;
 const ui=quotationTitleUI({view,props:{onEditSeo(){}}});try{await ui.idle();
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
  assert.ok(shown.indexOf('searchTags')<shown.indexOf('description'));assert.ok(shown.indexOf('bullets')<shown.indexOf('native-supply'),'optional existing descriptions remain at the end of basic information');
  ui.field('native-osrp').props.onChange({target:{value:'6100'}});ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:'native-osrp',optionId:null,value:'6100'}]);assert.equal(ui.field('native-msrp').props.value,'5200','independent OSRP edits do not change MSRP');
  ui.field('description').props.onChange({target:{value:'그룹 정리 후 작성한 설명'}});ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:'native-osrp',optionId:null,value:'6100'},{fieldKey:'description',optionId:null,value:'그룹 정리 후 작성한 설명'}]);
  assert.equal(JSON.stringify(view),before,'presentation leaves the original schema, cells and saved values untouched');assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
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
 const view=quotationPresentationFixture({overrides:{common:{},options:{red:{model:'기존 수동 모델'}}}}),before=JSON.stringify(view),ui=quotationTitleUI({view});
 try{await ui.idle();ui.select('red');let field=fieldContainer(ui,'model'),diagnostic=titleNodes(field).find(node=>node.type==='details'&&titleText(node.props.children).startsWith('자동값·입력 출처'));
  assert.ok(diagnostic);assert.doesNotMatch(visibleText(field),/수정 해제 · 자동값 복원/);const reset=visibleNodes(field,new Set([diagnostic])).find(node=>node.type==='button'&&titleText(node)==='수정 해제 · 자동값 복원');assert.ok(reset);reset.props.onClick();ui.render();assert.deepEqual(plain(ui.changes),[{fieldKey:'model',optionId:'red',value:null}]);
  ui.field('model').props.onChange({target:{value:'복사할 모델'}});ui.render();field=fieldContainer(ui,'model');diagnostic=titleNodes(field).find(node=>node.type==='details'&&titleText(node.props.children).startsWith('자동값·입력 출처'));
  const copy=visibleNodes(field,new Set([diagnostic])).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.ok(copy);copy.props.onChange({target:{checked:true}});ui.render();ui.button('적용 범위 미리보기').props.onClick();ui.render();ui.button('확인한 범위에 적용').props.onClick();ui.render();
  assert.ok(ui.changes.some(change=>change.fieldKey==='model'&&change.optionId==='blue'&&change.value==='복사할 모델'));assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);assert.ok(ui.button('견적 입력 저장'));
 }finally{ui.close();}
});

test('prominent AI action requests the mounted tool once and reveals review; stale draft/busy and retired actions stay blocked',async()=>{
 const view=quotationPresentationFixture(),ui=quotationTitleUI({view});
 try{await ui.idle();const tools=ui.nodes().find(node=>node.type==='details'&&node.props.className==='quotation-supplemental-tools'),anchor=ui.nodes().find(node=>node.props?.className==='quotation-ai-tools');let scrolls=0;const nativeDetails={open:false};tools.props.ref.current=nativeDetails;anchor.props.ref.current={scrollIntoView(){scrolls++;}};
  const ai=ui.nodes().find(node=>typeof node.type==='function'&&node.type.name==='QuotationAiPanel');let requests=0;assert.equal(ui.button('AI 처리').props.disabled,true);
  const sourceKey=JSON.stringify([ai.props.productId,ai.props.profileId??null,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint,ai.props.optionId]);
  const first={requestDraft(){requests++;ai.props.onBusyChange(true);},disabled:false,applyToAllOptions:false,sourceKey};ai.props.onRequestActionChange(first);ui.render();
  const originalCalls=ui.calls.length,open=ui.button('AI 처리').props.onClick;assert.equal(ui.button('AI 처리').props.disabled,false);open();open();assert.equal(requests,1);assert.equal(nativeDetails.open,true);assert.equal(scrolls,1);assert.equal(ui.calls.length,originalCalls);assert.equal(ui.changes.length,0);assert.equal(mutations(ui).length,0);
  ai.props.onBusyChange(false);ui.render();const next={requestDraft(){requests++;},disabled:false,applyToAllOptions:false,sourceKey};ai.props.onRequestActionChange(next);ai.props.onRequestActionChange(null,first);ui.render();assert.equal(ui.button('AI 처리').props.disabled,false);
  nativeDetails.open=false;const retained=ui.button('AI 처리').props.onClick;ui.field('model').props.onChange({target:{value:'먼저 저장할 입력'}});retained();assert.equal(nativeDetails.open,false,'already captured action cannot request against a new same-tick draft');assert.equal(requests,1);ui.render();assert.equal(ui.button('AI 처리').props.disabled,true);
  assert.equal(ui.nodes().filter(node=>typeof node.type==='function'&&node.type.name==='QuotationAiPanel').length,1,'native details does not unmount the tool');
 }finally{ui.close();}
 const busyUI=quotationTitleUI({view});try{await busyUI.idle();const tools=busyUI.nodes().find(node=>node.type==='details'&&node.props.className==='quotation-supplemental-tools'),nativeDetails={open:false};tools.props.ref.current=nativeDetails;
  const action=busyUI.button('AI 처리').props.onClick,ai=busyUI.nodes().find(node=>typeof node.type==='function'&&node.type.name==='QuotationAiPanel');ai.props.onBusyChange(true);action();assert.equal(nativeDetails.open,false);busyUI.render();assert.equal(busyUI.button('AI 처리').props.disabled,true);assert.equal(mutations(busyUI).length,0);
 }finally{busyUI.close();}
});

test('quotation primary actions show only apply-all and accessible Save; option selector and submission entry remain mounted supplementary tools',async()=>{
 const ui=quotationTitleUI({view:quotationPresentationFixture()});try{await ui.idle();const tree=ui.render(),heading=ui.nodes().find(node=>node.props?.className==='quotation-fields-heading'),context=ui.nodes().find(node=>node.props?.className==='quotation-fields-context');
  assert.equal(titleNodes(heading).some(node=>node.type==='select'),false);assert.equal(titleNodes(context).filter(node=>node.type==='select').length,1);
  const actions=ui.nodes().find(node=>node.props?.className==='quotation-fields-actions'),buttons=titleNodes(actions).filter(node=>node.type==='button');assert.equal(buttons.length,1);assert.equal(titleText(buttons[0]),'저장');assert.equal(buttons[0].props['aria-label'],'견적 입력 저장');
  const review=ui.button('견적 검토·전송'),submission=ui.nodes().find(node=>node.props?.className==='quotation-submission-tools');assert.ok(review);assert.ok(submission);assert.equal(titleNodes(actions).includes(review),false);assert.equal(ui.nodes().filter(node=>node.type?.name==='SupplierHubSingleReview').length,1);assert.equal(mutations(ui).length,0);
  assert.ok(visibleNodes(tree).some(node=>node===review));
 }finally{ui.close();}
});

test('retained header AI requests cannot bypass split, submission, refresh or unmount guards',async()=>{
 for(const blocker of ['split','split-draft','submission','refresh','unmount']) {
  const view=quotationPresentationFixture(),ui=quotationTitleUI({view});try{await ui.idle();const ai=ui.nodes().find(node=>node.type?.name==='QuotationAiPanel');let requested=0;
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
  const toggle=ui.nodes().find(node=>node.props?.className==='quotation-field-tools-toggle');titleNodes(toggle).find(node=>node.type==='input').props.onChange({target:{checked:true}});assert.equal(ui.render().props['data-field-tools'],true);
  const reorder=titleNodes(details).find(node=>node.props?.['aria-label']==='2번 이미지 앞으로');reorder.props.onClick();ui.render();assert.equal(ui.changes[0].value,'owner/second.png\nowner/first.png');assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});
