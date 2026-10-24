import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
const native=createRequire(import.meta.url);
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,fetch,AbortController,require(name){if(name.endsWith('.css'))return{};if(name in overrides)return overrides[name];if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;}
const boardFields=[...['title','mainImage','additionalImages','detailImages','labelImages'].map(id=>({id,section:id==='title'?'start':'image',visibility:'common',type:id==='title'?'text':'images',required:false})),...['supplyPrice','salePrice','msrp'].map(id=>({id,section:'product',visibility:'common',type:'number',required:false}))];
function quotation(contentRevision=undefined,imageKeys=['owner/red.png','owner/shared.png','owner/source.png','owner/size.png'],content={},options=data){const assets=content.assets??{},keys=role=>assets[role]?.value??[];return {productVersion:options.productVersion,optionRevision:options.options.revision,contentRevision,imageKeys,resolved:{schema:{categoryId:'80719',categoryPath:['바스켓'],fields:boardFields},rows:options.options.rows.map(row=>({optionId:row.id,fields:{supplyPrice:{value:'4100'},salePrice:{value:'6200'},title:{value:content.seo?.title.value??''},mainImage:{value:(row.imageKey?[row.imageKey]:keys('main')).join('\n')},additionalImages:{value:keys('additional').join('\n')},detailImages:{value:[...keys('detailTop'),...keys('detail'),...keys('detailBottom')].join('\n')},labelImages:{value:keys('label').join('\n')}}}))}};}
const model=load('app/components/product-option-board.tsx');
const data={productVersion:'v1',options:{schemaVersion:1,productId:'p1',revision:1,rows:[{id:'red',originalName:'Red',translatedName:'빨강',supplierSku:'sku-red',unitCostCny:4.5,unitsPerPack:2,stock:0,included:true,imageKey:'owner/red.png',provenance:{}},{id:'blue',originalName:'Blue',translatedName:'',supplierSku:'sku-blue',unitCostCny:null,unitsPerPack:1,stock:null,included:false,imageKey:'other/private.png',provenance:{translatedName:'manual'}}]},pricing:{rows:[{optionId:'red',calculation:{supplyPrice:4000,salePrice:6000},error:null}]}};
test('option board identifies each failed read without displaying platform HTML, private bodies or parser messages',async()=>{
 const paths=['options','content','quotation-fields'],content={productId:'p1',schemaVersion:1,assets:{main:{value:[]}}},before=JSON.stringify(data);
 for(const stage of paths)for(const [status,type,body,reason]of [[503,'text/html','<!DOCTYPE html>PRIVATE_PLATFORM_EXCEEDED_CPU','HTML 응답'],[200,'text/html','<!DOCTYPE html>PRIVATE_LOGIN_PAGE','HTML 응답'],[403,'text/plain','PRIVATE_FORBIDDEN','JSON이 아닌 응답'],[200,'application/json','<!DOCTYPE html>PRIVATE_BAD_JSON','JSON 형식 오류']]){
  const requests=[],signal=new AbortController().signal;
  await assert.rejects(model.readOptionBoard('p1',signal,async(url,init)=>{
   requests.push(url);assert.equal(init.signal,signal);assert.equal(init.cache,'no-store');
   return url.endsWith('/'+stage)?new Response(body,{status,headers:{'content-type':type}}):Response.json(url.endsWith('/options')?data:url.endsWith('/content')?{content}:quotation());
  }),error=>{
   assert.ok(error.message.includes('GET /api/products/:id/'+stage));assert.ok(error.message.includes('HTTP '+status));assert.ok(error.message.includes(reason));assert.ok(error.message.length<300);
   assert.doesNotMatch(error.message,/PRIVATE_|DOCTYPE|Unexpected|p1|owner\//);if(status===503)assert.doesNotMatch(error.message,/로그인/);return true;
  });
  assert.deepEqual(requests,paths.slice(0,paths.indexOf(stage)+1).map(path=>'/api/products/p1/'+path));
 }
 assert.equal(JSON.stringify(data),before);
 const recovered=await model.readOptionBoard('p1',new AbortController().signal,async url=>Response.json(url.endsWith('/options')?data:url.endsWith('/content')?{content}:quotation()));
 assert.equal(recovered.options.productId,'p1');assert.equal(recovered.quotationPrices.red.supplyPrice,'4100');
});
test('option board propagates an interrupted JSON body without replacing it with a login diagnosis',async()=>{
 const controller=new AbortController(),abort=new DOMException('Stopped','AbortError');let requests=0;
 await assert.rejects(model.readOptionBoard('p1',controller.signal,async()=>{requests++;return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>{controller.abort();throw abort;}};}),error=>error===abort);
 assert.equal(requests,1);
});
test('option board fetch checks product identity and propagates abort signal',async()=>{
 const signal=new AbortController().signal;const requests=[];
 const received=await model.readOptionBoard('p1',signal,async(url,init)=>{requests.push({url,...init});return {headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/quotation-fields')?quotation():{content:{productId:'p1',schemaVersion:1,assets:{main:{value:['owner/shared.png']}}}}};});assert.equal(received.options,data.options);assert.deepEqual(Array.from(received.commonImageKeys),['owner/shared.png']);const request=requests[0];assert.equal(requests[1].signal,signal);assert.equal(requests[1].url,'/api/products/p1/content');
 assert.equal(request.url,'/api/products/p1/options');assert.equal(request.signal,signal);assert.equal(request.cache,'no-store');
 for(const bad of [null,{}, {...data,options:{...data.options,productId:'p2'}}])await assert.rejects(model.readOptionBoard('p1',signal,async()=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>bad})),/응답/);
 await assert.rejects(model.readOptionBoard('p1',signal,async()=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:false,json:async()=>({error:'인증 필요'})})),/인증 필요/);
});
function tree(query='',sourceUrl='https://detail.1688.com/offer/813724060928.html',boardData=data,owned=['owner/red.png'],loadedIdentity={productId:'p1',attempt:0},attempt=0,features={},snapshotKeys=boardData.imageKeys??owned){
 let slot=0;const selected=[];const edited=[];const images=[];const contentSteps=[];const stages=[];const managed=[];const states=[{...loadedIdentity,data:{...boardData,imageKeys:snapshotKeys},error:''},attempt,query];
 const hooks={useState(initial){const i=slot++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect(){}};
 const {ProductOptionBoard}=load('app/components/product-option-board.tsx',{react:hooks});
 const render=()=>{slot=0;return ProductOptionBoard({productId:'p1',productRegistrationNumber:features.registrationNumber,sourceUrl,imageKeys:JSON.stringify(owned),onQuotation:id=>selected.push(id),onContent:step=>contentSteps.push(step),onImage:id=>images.push(id),onEdit:id=>edited.push(id),...(features.stage?{onStage:(id,step)=>stages.push([id,step])}:{}),...(features.manage?{onManage:id=>managed.push(id)}:{})});};
 return {selected,edited,images,contentSteps,stages,managed,render,tree:render()};
}
function nodes(value){if(!value||typeof value!=='object')return[];if(Array.isArray(value))return value.flatMap(nodes);return[value,...nodes(value.props?.children)];}
const byLabel=(result,label)=>nodes(result).find(node=>node.props?.['aria-label']===label);
function text(value){if(Array.isArray(value))return value.map(text).join('');if(value&&typeof value==='object')return text(value.props?.children);return typeof value==='boolean'?'':String(value??'');}
test('option list opens the clicked option and preserves zero, unknown and deliberately blank names',()=>{
 const result=tree();const html=renderToStaticMarkup(result.tree);
 assert.match(html,/재고 0개/);assert.match(html,/재고 미확인/);assert.match(html,/옵션명 공란/);assert.match(html,/4,000원/);assert.match(html,/6,000원/);
 assert.match(html,/813724060928/);assert.ok(!html.includes('/api/files/other/private.png'));
 const buttons=nodes(result.tree).filter(n=>n.type==='button'&&n.props['aria-label']?.endsWith('견적서 편집'));buttons[1].props.onClick();assert.deepEqual(result.selected,['blue']);
 const filtered=tree('sku-red');assert.equal(nodes(filtered.tree).filter(n=>n.type==='button'&&n.props['aria-label']?.endsWith('견적서 편집')).length,1);
 const unsafe=renderToStaticMarkup(tree('','javascript:alert(1)').tree);assert.ok(!unsafe.includes('href="javascript:'));
});

test('option board describes calculation units without claiming one physical piece or doubling the stored cost',()=>{
 const pair={...data,options:{...data.options,rows:[{...data.options.rows[0],unitsPerPack:1,unitCostCny:0.28}]}},before=JSON.stringify(pair),html=renderToStaticMarkup(tree('',undefined,pair).tree);
 assert.match(html,/구성 1단위 \(원가 기준\)/);assert.match(html,/¥0\.28 \/ 원가 단위/);assert.match(html,/실물 판매 단위/);assert.doesNotMatch(html,/구성 1개|¥0\.28 \/ 개/);assert.equal(JSON.stringify(pair),before);
});

test('persisted option registration display survives search, reorder and deletion while actions retain exact IDs',()=>{
 const numbered={...data,optionRegistrationNumbers:{red:'261015007001',blue:'261015007002'}},before=JSON.stringify(numbered),features={registrationNumber:'261015007001',stage:true,manage:true};
 const result=tree('sku-blue',undefined,numbered,[],undefined,0,features),row=nodes(result.tree).find(node=>node.type==='tr'&&node.props['data-option-id']==='blue'),cell=nodes(row).find(node=>node.type==='td'&&node.props['data-column']==='id');
 assert.equal(text(cell),'261015007002sku-blue');assert.equal(nodes(result.tree).filter(node=>node.type==='tr'&&node.props['data-option-id']).length,1);
 for(const query of ['261015007002','blue','sku-blue']){byLabel(result.render(),'상품 옵션 검색').props.onChange({target:{value:query}});assert.equal(text(nodes(result.render()).find(node=>node.type==='td'&&node.props['data-column']==='id')),'261015007002sku-blue');}
 byLabel(result.render(),'옵션 blue 선택').props.onChange({target:{checked:true}});assert.equal(byLabel(result.render(),'옵션 blue 선택').props.checked,true);
 byLabel(result.render(),'옵션 blue 견적서 편집').props.onClick();byLabel(result.render(),'옵션 blue 삭제 검토').props.onClick();assert.deepEqual(result.stages,[['blue','견적서']]);assert.deepEqual(result.managed,['blue']);
 byLabel(result.render(),'상품 옵션 검색').props.onChange({target:{value:''}});assert.deepEqual(nodes(result.render()).filter(node=>node.type==='td'&&node.props['data-column']==='id').map(text),['261015007001sku-red','261015007002sku-blue']);
 assert.equal(JSON.stringify(numbered),before);
 const reordered={...numbered,options:{...numbered.options,rows:[...numbered.options.rows].reverse()}};
 assert.deepEqual(nodes(tree('',undefined,reordered,[],undefined,0,features).tree).filter(node=>node.type==='td'&&node.props['data-column']==='id').map(text),['261015007002sku-blue','261015007001sku-red']);
 const remaining={...reordered,optionRegistrationNumbers:{blue:numbered.optionRegistrationNumbers.blue},options:{...reordered.options,rows:reordered.options.rows.slice(0,1)}};
 assert.equal(text(nodes(tree('',undefined,remaining,[],undefined,0,features).tree).find(node=>node.type==='td'&&node.props['data-column']==='id')),'261015007002sku-blue');
 for(const options of [data,{...data,optionRegistrationNumbers:{red:'261015007001'}}])assert.equal(text(nodes(tree('sku-blue',undefined,options,[],undefined,0,features).tree).find(node=>node.type==='td'&&node.props['data-column']==='id')),'bluesku-blue');
});

test('option response validates persisted number maps and parent prefix before loading any content snapshot',async()=>{
 const signal=new AbortController().signal,parent='261015007001',content={productId:'p1',schemaVersion:1,assets:{main:{value:[]}}};
 const read=async(body,parentNumber=parent)=>{const requests=[];const fetcher=async url=>{requests.push(url);return Response.json(url.endsWith('/options')?body:url.endsWith('/content')?{content}:quotation(undefined,undefined,content,body));};return{requests,result:await model.readOptionBoard('p1',signal,fetcher,parentNumber)};};
 const sparse={...data,optionRegistrationNumbers:{blue:'261015007002'}},received=await read(sparse);assert.equal(received.result.optionRegistrationNumbers.blue,'261015007002');assert.equal(Object.hasOwn(received.result.optionRegistrationNumbers,'red'),false);
 assert.equal(Object.hasOwn((await read(data)).result,'optionRegistrationNumbers'),false);
 for(const optionRegistrationNumbers of [null,[],1,{blue:261015007002},{blue:'26101500700'},{blue:'261015007002\n'},{blue:'261015007000'},{foreign:'261015007003'},{red:'261015007001',blue:'261015007001'},{blue:'261015008002'},{red:'261015007001',blue:'261014007002'}]){
  const requests=[];await assert.rejects(model.readOptionBoard('p1',signal,async url=>{requests.push(url);return Response.json({...data,optionRegistrationNumbers});},parent),/옵션 등록번호/);assert.deepEqual(requests,['/api/products/p1/options']);
 }
 await assert.rejects(read(sparse,'bad-parent'),/옵션 등록번호/);
});

test('price buttons retain the chosen option ID and general editing does not pass a click event',()=>{
 const result=tree();const buttons=nodes(result.tree).filter(n=>n.type==='button');
 buttons.filter(n=>n.props['aria-label']?.endsWith('가격설정 편집'))[1].props.onClick();
 buttons.find(n=>n.props.children==='옵션·번들·가격 수정').props.onClick({type:'click'});
 assert.deepEqual(result.edited,['blue',undefined]);
});

test('image editing passes the clicked option identity even when it has no individual image',()=>{
 const result=tree();const buttons=nodes(result.tree).filter(n=>n.type==='button'&&n.props['aria-label']?.endsWith('대표이미지 편집'));
 assert.equal(buttons.length,2);buttons[1].props.onClick();assert.deepEqual(result.images,['blue']);assert.deepEqual(result.edited,[]);assert.deepEqual(result.selected,[]);
});

test('option list uses the common main image only for null individual selection',()=>{
 const shared={...data,commonImageKeys:['owner/shared.png'],options:{...data.options,rows:data.options.rows.map(row=>({...row,imageKey:null}))}};
 const html=renderToStaticMarkup(tree('',undefined,shared,['owner/shared.png']).tree);assert.match(html,/공통 대표 이미지/);assert.match(html,/src="\/api\/files\/owner\/shared.png"/);
 shared.options.rows[0].imageKey='missing.png';const html2=renderToStaticMarkup(tree('sku-red',undefined,shared,['owner/shared.png']).tree);assert.match(html2,/이미지 연결 확인 필요/);assert.ok(!html2.includes('src='));
 assert.ok(!renderToStaticMarkup(tree('',undefined,shared,[]).tree).includes('src='));
});
test('common content fetch rejects mismatched product or failed response',async()=>{
 const signal=new AbortController().signal;
 for(const content of [null,{productId:'other',schemaVersion:1,assets:{main:{value:[]}}},{productId:'p1',schemaVersion:1,assets:{main:{value:[1]}}}]){
  await assert.rejects(model.readOptionBoard('p1',signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/quotation-fields')?quotation():{content}})),/이미지 응답/);
 }
 await assert.rejects(model.readOptionBoard('p1',signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:url.endsWith('/options'),json:async()=>url.endsWith('/options')?data:{error:'조회 실패'}})),/조회 실패/);
});

test('shared content columns count only saved product images and open their matching stages',()=>{
 const shared={...data,commonAssets:{additional:['owner/a.png','other/x.png'],detail:['owner/top.png','owner/detail.png','owner/bottom.png'],label:[]}};
 const result=tree('sku-red',undefined,shared,['owner/a.png','owner/top.png','owner/detail.png','owner/bottom.png']);const html=renderToStaticMarkup(result.tree);
 assert.match(html,/1장.*연결 확인 필요/);assert.match(html,/3장/);assert.match(html,/0장/);
 for(const label of ['추가이미지','상세이미지','한글표시사항'])byLabel(result.tree,`옵션 red ${label} 편집`).props.onClick();
 assert.deepEqual(result.contentSteps,['추가 이미지','상세 이미지','표시사항']);assert.deepEqual(result.images,[]);
});

 test('shared image roles preserve detail ordering and reject malformed references',async()=>{
 const signal=new AbortController().signal;
 const content={productId:'p1',schemaVersion:1,assets:{main:{value:[]},additional:{value:['a']},detailTop:{value:['top']},detail:{value:['body']},detailBottom:{value:['bottom']},label:{value:['label']}}};
 const fetcher=async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/quotation-fields')?quotation():{content}});
 const result=await model.readOptionBoard('p1',signal,fetcher);
 assert.deepEqual(Array.from(result.commonAssets.detail),['top','body','bottom']);
 assert.deepEqual(Array.from(result.commonAssets.additional),['a']);
 assert.deepEqual(Array.from(result.commonAssets.label),['label']);
 content.assets.label.value=[42];
 await assert.rejects(model.readOptionBoard('p1',signal,fetcher),/이미지 응답/);
 });

test('option board renders the observed twelve data headers with matching row cells',()=>{
 const result=tree(),headers=nodes(result.tree).filter(node=>node.type==='th').slice(1).map(text);
 assert.deepEqual(headers,['옵션번호','옵션명','SEO설정','가격설정','대표이미지','추가이미지','상세이미지','사이즈표','한글표시사항','견적서','재고/가격','관리']);
 for(const row of nodes(result.tree).filter(node=>node.type==='tr'&&node.props['data-option-id']))assert.equal(nodes(row).filter(node=>node.type==='td').length,13);
 assert.equal(nodes(nodes(result.tree).find(node=>node.type==='table')).filter(node=>node.type==='input'&&node.props.type==='checkbox').length,3);
});

test('typed stage callbacks preserve the clicked option across every stage and take precedence over legacy callbacks',()=>{
 const result=tree('',undefined,data,['owner/red.png'],undefined,0,{stage:true});
 const expected=[['SEO설정','SEO'],['가격설정','가격'],['대표이미지','대표 이미지'],['추가이미지','추가 이미지'],['상세이미지','상세 이미지'],['사이즈표','사이즈표'],['한글표시사항','표시사항'],['견적서','견적서']];
 for(const [label] of expected)byLabel(result.tree,`옵션 blue ${label} 편집`).props.onClick({type:'click'});
 assert.deepEqual(result.stages,expected.map(([,step])=>['blue',step]));assert.deepEqual(result.edited,[]);assert.deepEqual(result.images,[]);assert.deepEqual(result.contentSteps,[]);assert.deepEqual(result.selected,[]);
 const legacy=tree();assert.equal(byLabel(legacy.tree,'옵션 red SEO설정 편집'),undefined);assert.equal(byLabel(legacy.tree,'옵션 red 사이즈표 편집'),undefined);
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`unused and assigned size charts both open their exact option size editor (${company.companyCode})`,async()=>{
 const {mobileIntakeHarness}=await import('./helpers/mobile-intake.mjs'),h=mobileIntakeHarness(company),json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,keys=JSON.parse(product.image_keys);
  const read=()=>model.readOptionBoard(product.id,new AbortController().signal,(url,init)=>h.route(url,{method:init?.method??'GET'})),initial=await read(),optionId=initial.options.rows[0].id;
  const before=h.sqlite.prepare('SELECT payload FROM product_options').get().payload,shown=tree('',h.sourceUrl,initial,initial.imageKeys,undefined,0,{stage:true});
  const unused=byLabel(shown.tree,`옵션 ${optionId} 사이즈표 편집`);assert.equal(text(unused),'미사용');unused.props.onClick();assert.deepEqual(shown.stages,[[optionId,'사이즈표']]);
  const content=(await json(await h.route(base+'/content'))).content;await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{size:[keys[0]]}}}}));
  const assigned=await read(),saved=tree('',h.sourceUrl,assigned,assigned.imageKeys,undefined,0,{stage:true}),active=byLabel(saved.tree,`옵션 ${optionId} 사이즈표 편집`);
  assert.equal(text(active),'1장');active.props.onClick();assert.deepEqual(saved.stages,[[optionId,'사이즈표']]);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,before);
  assert.deepEqual(plain(assigned.quotationContent),plain(initial.quotationContent));assert.deepEqual(plain(assigned.quotationPrices),plain(initial.quotationPrices));assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

test('size-chart entry never redirects to SEO for absent, cleared, saved or unavailable chart files',()=>{
 for(const size of [undefined,[],['owner/size.png'],['foreign/size.png']]){
  const source={...data,commonAssets:size===undefined?undefined:{size}},before=JSON.stringify(source);
  const shown=tree('',undefined,source,['owner/size.png'],undefined,0,{stage:true});
  for(const optionId of ['red','blue'])byLabel(shown.tree,`옵션 ${optionId} 사이즈표 편집`).props.onClick();
  assert.deepEqual(shown.stages,[['red','사이즈표'],['blue','사이즈표']]);
  assert.deepEqual(shown.edited,[]);assert.deepEqual(shown.contentSteps,[]);assert.deepEqual(shown.selected,[]);
  assert.equal(JSON.stringify(source),before,'opening a size editor must not change references or repair a missing chart implicitly');
 }
});

test('management trash opens the connected deletion review without mutating the option or invoking a stage',()=>{
 const before=JSON.stringify(data),result=tree('',undefined,data,['owner/red.png'],undefined,0,{stage:true,manage:true});
 const row=nodes(result.tree).find(node=>node.type==='tr'&&node.props['data-option-id']==='blue'),cells=nodes(row).filter(node=>node.type==='td'),management=cells.at(-1);
 const buttons=nodes(management).filter(node=>node.type==='button');assert.equal(buttons.length,1);assert.equal(buttons[0].props['aria-label'],'옵션 blue 삭제 검토');assert.equal(buttons[0].props.className,'registration-delete');buttons[0].props.onClick();
 assert.deepEqual(result.managed,['blue']);assert.deepEqual(result.stages,[]);assert.deepEqual(result.edited,[]);assert.equal(JSON.stringify(data),before);
 const legacy=tree();const fallback=byLabel(legacy.tree,'옵션 blue 수정');assert.equal(text(fallback),'수정');fallback.props.onClick();assert.deepEqual(legacy.edited,['blue']);assert.equal(nodes(legacy.tree).some(node=>node.props?.className==='registration-delete'),false);
});

test('selection changes only visible row identities and preserves saved option data',()=>{
 const before=JSON.stringify(data),result=tree();byLabel(result.tree,'옵션 blue 선택').props.onChange({target:{checked:true}});
 let rendered=result.render();assert.equal(byLabel(rendered,'옵션 blue 선택').props.checked,true);assert.equal(byLabel(rendered,'옵션 red 선택').props.checked,false);assert.match(text(rendered),/선택 1개/);
 byLabel(rendered,'상품 옵션 검색').props.onChange({target:{value:'sku-red'}});rendered=result.render();byLabel(rendered,'현재 옵션 전체 선택').props.onChange({target:{checked:true}});
 rendered=result.render();assert.equal(byLabel(rendered,'옵션 red 선택').props.checked,true);assert.equal(byLabel(rendered,'옵션 blue 선택'),undefined);assert.match(text(rendered),/선택 2개/);
 byLabel(rendered,'현재 옵션 전체 선택').props.onChange({target:{checked:false}});rendered=result.render();assert.match(text(rendered),/선택 1개/);assert.equal(JSON.stringify(data),before);
});

test('saved SEO title and separate size-image role load without substituting a deliberately blank title',async()=>{
 const content={productId:'p1',schemaVersion:1,revision:2,seo:{title:{value:'저장한 SEO 제목',provenance:'manual'}},assets:{main:{value:[]},size:{value:['owner/size.png']}}},signal=new AbortController().signal;
 const fetcher=async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/quotation-fields')?quotation(2,undefined,content):{content}});
 const loaded=await model.readOptionBoard('p1',signal,fetcher);assert.equal(loaded.seoTitle,'저장한 SEO 제목');assert.deepEqual(Array.from(loaded.commonAssets.size),['owner/size.png']);
 content.seo.title.value='';const cleared=await model.readOptionBoard('p1',signal,fetcher);assert.equal(cleared.seoTitle,'');
 const result=tree('sku-red',undefined,cleared,['owner/size.png'],undefined,0,{stage:true});assert.equal(text(byLabel(result.tree,'옵션 red SEO설정 편집')),'미입력');assert.equal(text(byLabel(result.tree,'옵션 red 사이즈표 편집')),'1장');
 const changed={...cleared,commonAssets:{...cleared.commonAssets,size:[]},options:{...cleared.options,rows:cleared.options.rows.map(row=>({...row,size:'XL'}))}};
 assert.equal(text(byLabel(tree('sku-red',undefined,changed,[],undefined,0,{stage:true}).tree,'옵션 red 사이즈표 편집')),'미사용');
});

test('image badges count only assigned product members and source previews never complete the representative stage',()=>{
 const shown={...data,seoTitle:'',commonImageKeys:[],commonAssets:{additional:['owner/a.png','foreign/x.png'],detail:['owner/detail.png'],size:['foreign/size.png'],label:[]},sourceImageKeys:{red:'owner/source.png'},options:{...data.options,rows:data.options.rows.map(row=>({...row,imageKey:null}))}};
 const before=JSON.stringify(shown),result=tree('sku-red',undefined,shown,['owner/source.png','owner/a.png','owner/detail.png'],undefined,0,{stage:true}),html=renderToStaticMarkup(result.tree);
 assert.match(html,/src="\/api\/files\/owner\/source.png"/);assert.equal(text(byLabel(result.tree,'옵션 red 대표이미지 편집')),'0장');assert.equal(text(byLabel(result.tree,'옵션 red 추가이미지 편집')),'1장');assert.equal(text(byLabel(result.tree,'옵션 red 상세이미지 편집')),'1장');assert.equal(text(byLabel(result.tree,'옵션 red 사이즈표 편집')),'연결 확인 필요');assert.equal(text(byLabel(result.tree,'옵션 red 한글표시사항 편집')),'0장');
 assert.doesNotMatch(html,/완료|\/api\/files\/foreign/);assert.equal(JSON.stringify(shown),before);
 shown.sourceImageKeys.red='foreign/source.png';assert.doesNotMatch(renderToStaticMarkup(tree('sku-red',undefined,shown,[],undefined,0,{stage:true}).tree),/src=/);
});

test('malformed SEO, size references and response metadata are rejected without a partial board snapshot',async()=>{
 const signal=new AbortController().signal,validContent={productId:'p1',schemaVersion:1,revision:2,seo:{title:{value:''}},assets:{main:{value:[]},size:{value:[]}}};
 const read=(options=data,content=validContent,quote=quotation(2))=>model.readOptionBoard('p1',signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?options:url.endsWith('/quotation-fields')?quote:{content}}));
 for(const seo of [null,[],{}, {title:null},{title:{value:1}}])await assert.rejects(read(data,{...validContent,seo}),/SEO 응답/);
 for(const size of [null,[],{}, {value:'owner/size.png'}, {value:[1]}])await assert.rejects(read(data,{...validContent,assets:{main:{value:[]},size}}),/이미지 응답/);
 for(const options of [{...data,productVersion:null},{...data,options:{...data.options,revision:-1}},{...data,options:{...data.options,rows:[null]}},{...data,options:{...data.options,rows:[data.options.rows[0],data.options.rows[0]]}},{...data,pricing:{rows:[null]}},{...data,pricing:{rows:[{optionId:'foreign',calculation:null}]}},{...data,pricing:{rows:[{optionId:'red',calculation:{supplyPrice:'123',salePrice:1}}]}}])await assert.rejects(read(options),/옵션 응답/);
 await assert.rejects(read(data,validContent,{...quotation(2),resolved:{...quotation(2).resolved,rows:[null]}}),/견적 가격 응답/);
 await assert.rejects(read(data,validContent,{...quotation(2),resolved:{...quotation(2).resolved,rows:[...quotation(2).resolved.rows,quotation(2).resolved.rows[0]]}}),/견적 가격 응답/);
 for(const imageKeys of [undefined,null,{},[1],['']])await assert.rejects(read(data,validContent,{...quotation(2),imageKeys}),/이미지 목록 응답/);
});

test('a refreshed board displays newly attached images using its quotation snapshot despite stale parent image keys',async()=>{
 const content={productId:'p1',schemaVersion:1,revision:2,seo:{title:{value:'저장한 상품'}},assets:{main:{value:[]},additional:{value:['owner/new-additional.png']},size:{value:['owner/new-size.png']}}};
 const options={...data,sourceImageKeys:{red:'owner/new-source.png',blue:'owner/new-source.png'},options:{...data.options,rows:data.options.rows.map(row=>({...row,imageKey:row.id==='red'?'owner/new-main.png':null}))}};
 const keys=['owner/new-main.png','owner/new-source.png','owner/new-additional.png','owner/new-size.png'];
 const refreshed=await model.readOptionBoard('p1',new AbortController().signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?options:url.endsWith('/content')?{content}:quotation(2,keys,content,options)}));
 assert.deepEqual(Array.from(refreshed.imageKeys),keys);
 const result=tree('',undefined,refreshed,['owner/old-parent.png'],{productId:'p1',attempt:1},1,{stage:true});
 assert.match(renderToStaticMarkup(result.tree),/src="\/api\/files\/owner\/new-main.png"/);assert.equal(text(byLabel(result.tree,'옵션 red 대표이미지 편집')),'1장');assert.equal(text(byLabel(result.tree,'옵션 red 추가이미지 편집')),'1장');assert.equal(text(byLabel(result.tree,'옵션 red 사이즈표 편집')),'1장');
 assert.match(renderToStaticMarkup(result.tree),/src="\/api\/files\/owner\/new-source.png"/);assert.equal(text(byLabel(result.tree,'옵션 blue 대표이미지 편집')),'0장');
});

test('a refreshed board excludes removed assignments and source previews even when the parent still lists those keys',async()=>{
 const content={productId:'p1',schemaVersion:1,revision:2,assets:{main:{value:[]},additional:{value:['owner/removed.png','owner/retained.png']},size:{value:['owner/removed.png']}}};
 const options={...data,sourceImageKeys:{red:'owner/removed.png',blue:'owner/removed.png'},options:{...data.options,rows:data.options.rows.map(row=>({...row,imageKey:row.id==='red'?'owner/removed.png':null}))}};
 const refreshed=await model.readOptionBoard('p1',new AbortController().signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?options:url.endsWith('/content')?{content}:quotation(2,['owner/retained.png'],content,options)}));
 const result=tree('',undefined,refreshed,['owner/removed.png','owner/retained.png'],{productId:'p1',attempt:1},1,{stage:true}),html=renderToStaticMarkup(result.tree);
 assert.doesNotMatch(html,/src=/);assert.equal(text(byLabel(result.tree,'옵션 red 대표이미지 편집')),'연결 확인 필요');assert.equal(text(byLabel(result.tree,'옵션 blue 대표이미지 편집')),'0장');assert.equal(text(byLabel(result.tree,'옵션 red 추가이미지 편집')),'1장');assert.equal(text(byLabel(result.tree,'옵션 red 사이즈표 편집')),'연결 확인 필요');
});

test('option board shows saved quotation overrides and preserves intentional blank instead of calculated price',()=>{
 const updated={...data,quotationPrices:{red:{supplyPrice:'5120',salePrice:''},blue:{supplyPrice:'',salePrice:''}}};
 const html=renderToStaticMarkup(tree('sku-red',undefined,updated).tree);
 assert.match(html,/5,120원 \(견적 공급가\)/);assert.match(html,/미입력 \(견적 판매가\)/);assert.doesNotMatch(html,/4,000원|6,000원/);
});

test('option board verifies quotation snapshot revisions and propagates errors instead of presenting stale calculated prices',async()=>{
 const signal=new AbortController().signal;
 const content={productId:'p1',schemaVersion:1,revision:2,assets:{main:{value:[]}}};
 for(const quote of [{...quotation(2),productVersion:'stale'},{...quotation(2),optionRevision:7},quotation(1),{...quotation(2),resolved:{...quotation(2).resolved,rows:[]}}]){
  await assert.rejects(model.readOptionBoard('p1',signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/content')?{content}:quote})),/変更|변경|응답/);
 }
 let quoteSignal;
 const result=await model.readOptionBoard('p1',signal,async(url,init)=>{if(url.endsWith('/quotation-fields'))quoteSignal=init.signal;return {headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/content')?{content}:quotation(2)};});
 assert.equal(quoteSignal,signal);assert.equal(result.quotationPrices.red.supplyPrice,'4100');
 await assert.rejects(model.readOptionBoard('p1',signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:!url.endsWith('/quotation-fields'),json:async()=>url.endsWith('/options')?data:url.endsWith('/content')?{content}:{error:'견적 조회 실패'}})),/견적 조회 실패/);
});

test('unchosen option previews show their source image without turning it into a quotation main image',()=>{
 const unchosen={...data,commonImageKeys:[],sourceImageKeys:{red:'owner/source-red.png',blue:'owner/source-blue.png'},options:{...data.options,rows:data.options.rows.map(row=>({...row,imageKey:null}))}};
 const before=JSON.stringify(unchosen);
 const html=renderToStaticMarkup(tree('sku-red',undefined,unchosen,['owner/source-red.png','owner/shared.png','owner/chosen.png']).tree);
 assert.match(html,/src="\/api\/files\/owner\/source-red.png"/);assert.match(html,/수집 원본 · 대표 이미지 미설정/);assert.equal(JSON.stringify(unchosen),before);
 unchosen.commonImageKeys=['owner/shared.png'];const common=renderToStaticMarkup(tree('sku-red',undefined,unchosen,['owner/source-red.png','owner/shared.png']).tree);
 assert.match(common,/src="\/api\/files\/owner\/shared.png"/);assert.doesNotMatch(common,/수집 원본/);
 unchosen.options.rows[0].imageKey='owner/chosen.png';const individual=renderToStaticMarkup(tree('sku-red',undefined,unchosen,['owner/source-red.png','owner/shared.png','owner/chosen.png']).tree);
 assert.match(individual,/src="\/api\/files\/owner\/chosen.png"/);assert.match(individual,/개별 이미지/);
 unchosen.options.rows[0].imageKey='missing.png';const disconnected=renderToStaticMarkup(tree('sku-red',undefined,unchosen,['owner/source-red.png','owner/shared.png']).tree);
 assert.match(disconnected,/이미지 연결 확인 필요/);assert.doesNotMatch(disconnected,/src=/);
 unchosen.options.rows[0].imageKey=null;unchosen.commonImageKeys=[];
 assert.doesNotMatch(renderToStaticMarkup(tree('sku-red',undefined,unchosen,[]).tree),/src=/);
});

test('option fetch validates source preview shape and ties every preview to a returned option',async()=>{
 const content={productId:'p1',schemaVersion:1,assets:{main:{value:[]}}};
 const signal=new AbortController().signal;
 for(const bad of [null,[],{red:1},{red:''},{foreign:'owner/source.png'}])await assert.rejects(model.readOptionBoard('p1',signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?{...data,sourceImageKeys:bad}:url.endsWith('/quotation-fields')?quotation():{content}})),/원본 이미지 응답/);
 const result=await model.readOptionBoard('p1',signal,async url=>({headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?{...data,sourceImageKeys:{red:'owner/source.png'}}:url.endsWith('/quotation-fields')?quotation():{content}}));
 assert.equal(result.sourceImageKeys.red,'owner/source.png');assert.equal(result.options.rows[0].imageKey,'owner/red.png');
});

test('product changes and refresh attempts hide a stale option snapshot immediately',()=>{
 for(const [identity,attempt] of [[{productId:'other',attempt:0},0],[{productId:'p1',attempt:0},1]]){
  const html=renderToStaticMarkup(tree('',undefined,data,['owner/red.png'],identity,attempt).tree);
  assert.match(html,/불러오는 중/);assert.doesNotMatch(html,/src=|sku-red|4,000원/);
 }
 assert.match(renderToStaticMarkup(tree().tree),/sku-red/);
});

test('recorded six SKU draft renders source previews through the real options, content and quotation APIs',async()=>{
 const {mobileIntakeHarness}=await import('./helpers/mobile-intake.mjs');const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get();
  const before=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  const view=await model.readOptionBoard(product.id,new AbortController().signal,(path,init)=>h.route(path,{method:init?.method??'GET'}));
  const html=renderToStaticMarkup(tree('',h.sourceUrl,view,JSON.parse(product.image_keys)).tree);
  assert.equal((html.match(/<img /g)||[]).length,6);
  assert.equal((html.match(/수집 원본 · 대표 이미지 미설정/g)||[]).length,6);
  for(const key of Object.values(view.sourceImageKeys))assert.ok(html.includes(`/api/files/${key}`));
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,before);
  assert.ok(view.options.rows.every(option=>option.imageKey===null));assert.deepEqual(Array.from(view.commonImageKeys),[]);
 }finally{h.close();}
});

const plain=value=>JSON.parse(JSON.stringify(value));
function finalContentFixture(){
 const keys=['owner/red.png','owner/shared.png','owner/source.png','owner/size.png','owner/common-add.png','owner/common-detail.png','owner/common-label.png',
  'owner/final-main.png','owner/final-add.png','owner/detail-1.png','owner/detail-2.png','owner/final-label.png'];
 const content={productId:'p1',schemaVersion:1,revision:2,seo:{title:{value:'공통 SEO 제목',provenance:'manual'}},assets:{
  main:{value:['owner/shared.png']},additional:{value:['owner/common-add.png']},detail:{value:['owner/common-detail.png']},label:{value:['owner/common-label.png']},size:{value:['owner/size.png']},
 }};
 const quote=quotation(2,keys,content),red=quote.resolved.rows.find(row=>row.optionId==='red'),blue=quote.resolved.rows.find(row=>row.optionId==='blue');
 Object.assign(red.fields,{title:{value:''},mainImage:{value:''},additionalImages:{value:'owner/final-add.png'},detailImages:{value:'owner/detail-2.png\r\nowner/detail-1.png'},labelImages:{value:'owner/final-label.png'}});
 Object.assign(blue.fields,{title:{value:'옵션별 최종 SEO 제목'},mainImage:{value:'owner/final-main.png'},additionalImages:{value:''},detailImages:{value:''},labelImages:{value:''}});
 for(const row of quote.resolved.rows)for(const id of ['mainImage','additionalImages','detailImages','labelImages'])Object.assign(row.fields[id],{
  validationIssues:[],issues:['실제 상품·증빙과 일치하는지 확인해주세요.','견적서에는 연결한 첨부 이미지 파일명이 기록됩니다.'],
 });
 const fetcher=async(url,init)=>{assert.equal(init.cache,'no-store');return {headers:new Headers({'content-type':'application/json'}),status:200,ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/content')?{content}:quote};};
 return {keys,content,quote,red,blue,fetcher};
}

test('final per-SKU titles/images and deliberate blanks replace shared columns without changing saved common content',async()=>{
 const f=finalContentFixture(),before=JSON.stringify({data,content:f.content,quote:f.quote});
 const board=await model.readOptionBoard('p1',new AbortController().signal,f.fetcher);
 assert.equal(board.seoTitle,'공통 SEO 제목');
 assert.deepEqual(plain(board.quotationContent.red),{title:'',main:[],additional:['owner/final-add.png'],detail:['owner/detail-2.png','owner/detail-1.png'],label:['owner/final-label.png'],imageIssues:{}});
 assert.deepEqual(plain(board.quotationContent.blue),{title:'옵션별 최종 SEO 제목',main:['owner/final-main.png'],additional:[],detail:[],label:[],imageIssues:{}});
 const result=tree('',undefined,board,f.keys,undefined,0,{stage:true}),html=renderToStaticMarkup(result.tree);
 assert.equal(text(byLabel(result.tree,'옵션 red SEO설정 편집')),'미입력');assert.equal(text(byLabel(result.tree,'옵션 blue SEO설정 편집')),'입력됨');
 assert.equal(text(byLabel(result.tree,'옵션 red 대표이미지 편집')),'0장');assert.equal(text(byLabel(result.tree,'옵션 blue 대표이미지 편집')),'1장');
 for(const [id,expected]of [['red',['1장','2장','1장']],['blue',['0장','0장','0장']]])for(const [index,label]of ['추가이미지','상세이미지','한글표시사항'].entries())assert.equal(text(byLabel(result.tree,`옵션 ${id} ${label} 편집`)),expected[index]);
 for(const id of ['red','blue'])assert.equal(text(byLabel(result.tree,`옵션 ${id} 사이즈표 편집`)),'1장','size stays a separate shared stage');
 assert.match(html,/src="\/api\/files\/owner\/final-main.png"/);assert.doesNotMatch(html,/src="\/api\/files\/owner\/(?:red|shared).png"|연결 확인 필요/);
 assert.equal(nodes(tree('최종 SEO',undefined,board,f.keys,undefined,0,{stage:true}).tree).filter(node=>node.props['data-option-id']).length,1,'search uses the final saved per-option title');
 assert.equal(JSON.stringify({data,content:f.content,quote:f.quote}),before);
});

test('exact live title/image wires drive board cells instead of same-named legacy cells',async()=>{
 const f=finalContentFixture(),paths={title:['startPage','productName'],mainImage:['imagePage','images','mainImage'],additionalImages:['imagePage','images','additionalImage'],detailImages:['imagePage','details','detailedImage']};
 const aliases=Object.entries(paths).map(([id,path])=>({...boardFields.find(field=>field.id===id),id:'live_80719_'+id,hubInput:id,hubWire:{path}}));
 f.quote.resolved.schema.fields=[...boardFields,...aliases];
 for(const row of f.quote.resolved.rows)for(const field of aliases){
  row.fields[field.id]=row.fields[field.hubInput];row.fields[field.hubInput]={value:field.hubInput==='title'?'이전 공통 제목':'owner/shared.png',validationIssues:[],issues:[]};
 }
 const board=await model.readOptionBoard('p1',new AbortController().signal,f.fetcher);
 assert.equal(board.quotationContent.red.title,'');assert.deepEqual(plain(board.quotationContent.red.main),[]);
 assert.deepEqual(plain(board.quotationContent.red.additional),['owner/final-add.png']);assert.deepEqual(plain(board.quotationContent.red.detail),['owner/detail-2.png','owner/detail-1.png']);
 const result=tree('',undefined,board,f.keys,undefined,0,{stage:true});
 assert.equal(text(byLabel(result.tree,'옵션 red SEO설정 편집')),'미입력');assert.equal(text(byLabel(result.tree,'옵션 red 대표이미지 편집')),'0장');
 assert.equal(text(byLabel(result.tree,'옵션 blue 대표이미지 편집')),'1장');assert.doesNotMatch(renderToStaticMarkup(result.tree),/src="\/api\/files\/owner\/shared.png"/);
});

const priceAliases=['supplyPrice','salePrice'].map((input,index)=>({id:'live_80719_price_'+input,label:'공식 가격',type:'text',numericText:true,required:false,
 hubInput:input,hubWire:{path:['productPage','commonAttributes',['purchasePrice','coupangSalePrice'][index]]}}));
test('exact primary Hub prices and manual blanks drive badges and amounts without reconciling retained summaries',async()=>{
 const f=finalContentFixture();f.quote.resolved.schema.fields=[...boardFields,...priceAliases];
 Object.assign(f.red.fields,{[priceAliases[0].id]:{value:''},[priceAliases[1].id]:{value:'7654'}});
 Object.assign(f.blue.fields,{[priceAliases[0].id]:{value:'1234'},[priceAliases[1].id]:{value:''}});
 const before=JSON.stringify(f.quote),board=await model.readOptionBoard('p1',new AbortController().signal,f.fetcher);
 assert.deepEqual(plain(board.quotationPrices),{red:{supplyPrice:'',salePrice:'7654'},blue:{supplyPrice:'1234',salePrice:''}});
 const result=tree('',undefined,board,f.keys,undefined,0,{stage:true}),html=renderToStaticMarkup(result.tree);
 for(const id of ['red','blue'])assert.equal(text(byLabel(result.tree,`옵션 ${id} 가격설정 편집`)),'미입력');
 assert.match(html,/미입력 \(견적 공급가\)/);assert.match(html,/7,654원 \(견적 판매가\)/);assert.match(html,/1,234원 \(견적 공급가\)/);assert.match(html,/미입력 \(견적 판매가\)/);
 assert.doesNotMatch(html,/4,100원|6,200원/);assert.equal(JSON.stringify(f.quote),before);
});

test('missing, ambiguous or invalid primary price bindings fail instead of falling back to populated summaries',async()=>{
 const variants=[
  fields=>[...fields,{...priceAliases[0],id:'duplicate-price'}],
  fields=>fields.map(field=>field.id===priceAliases[0].id?{...field,hubInput:undefined}:field),
  fields=>fields.map(field=>field.id===priceAliases[1].id?{...field,readOnly:true}:field),
  fields=>fields.map(field=>field.id===priceAliases[0].id?{...field,numericText:false}:field),
 ];
 for(const change of variants){const f=finalContentFixture();f.quote.resolved.schema.fields=change([...boardFields,...priceAliases]);
  for(const row of f.quote.resolved.rows)for(const field of priceAliases)row.fields[field.id]={value:'3210'};
  const before=JSON.stringify(f.quote);await assert.rejects(model.readOptionBoard('p1',new AbortController().signal,f.fetcher),/가격 항목.*연결|가격 항목.*입력 규칙/);assert.equal(JSON.stringify(f.quote),before);
 }
 for(const input of ['supplyPrice','salePrice'])for(const cell of [undefined,null,{value:null},{value:1200}]){
  const f=finalContentFixture();f.quote.resolved.schema.fields=[...boardFields,...priceAliases];
  for(const row of f.quote.resolved.rows)for(const field of priceAliases)row.fields[field.id]={value:'3210'};
  f.red.fields[priceAliases.find(field=>field.hubInput===input).id]=cell;
  await assert.rejects(model.readOptionBoard('p1',new AbortController().signal,f.fetcher),/옵션별 견적 가격 응답/);
 }
});

test('real validation failures and missing/foreign final keys remain visible without using another assigned image',async()=>{
 const f=finalContentFixture();f.red.fields.mainImage={value:'foreign/private.png',validationIssues:[],issues:[]};
 f.red.fields.additionalImages={value:'owner/final-add.png\nowner/missing.png',validationIssues:[],issues:[]};
 f.red.fields.labelImages={value:'',validationIssues:['필수 라벨을 연결해주세요.'],issues:['검토 안내']};
 f.blue.fields.mainImage={value:'owner/missing.png',issues:['이미지 연결 실패']};
 const board=await model.readOptionBoard('p1',new AbortController().signal,f.fetcher),result=tree('',undefined,board,f.keys,undefined,0,{stage:true}),html=renderToStaticMarkup(result.tree);
 assert.equal(board.quotationContent.red.imageIssues.label,true);assert.equal(board.quotationContent.blue.imageIssues.main,true,'legacy undivided issues remain conservative');
 assert.equal(text(byLabel(result.tree,'옵션 red 대표이미지 편집')),'연결 확인 필요');assert.equal(text(byLabel(result.tree,'옵션 blue 대표이미지 편집')),'연결 확인 필요');
 assert.equal(text(byLabel(result.tree,'옵션 red 추가이미지 편집')),'1장');assert.equal(text(byLabel(result.tree,'옵션 red 한글표시사항 편집')),'연결 확인 필요');
 assert.match(html,/1장 · 연결 확인 필요/);assert.doesNotMatch(html,/src=|\/api\/files\/foreign|\/api\/files\/owner\/shared.png|\/api\/files\/owner\/red.png/);
 assert.deepEqual(plain(board.quotationContent.red.main),['foreign/private.png'],'a broken selection is retained for editing, not silently replaced');
 assert.deepEqual(plain(board.quotationContent.red.additional),['owner/final-add.png','owner/missing.png']);
});

test('malformed final title/image cells and error lists cannot produce a partially valid board',async()=>{
 for(const title of [undefined,null,{value:null},{value:12}]){
  const f=finalContentFixture();f.red.fields.title=title;
  await assert.rejects(model.readOptionBoard('p1',new AbortController().signal,f.fetcher),/견적 상품명 응답/);
 }
 for(const id of ['mainImage','additionalImages','detailImages','labelImages'])for(const field of [undefined,null,[],{value:12},{value:'' ,issues:null},{value:'',issues:['좋은 안내',12]},{value:'',validationIssues:{}},{value:'',validationIssues:[null]}]){
  const f=finalContentFixture();f.red.fields[id]=field;
  await assert.rejects(model.readOptionBoard('p1',new AbortController().signal,f.fetcher),/견적 이미지 응답/);
 }
 const f=finalContentFixture();f.red.fields.mainImage={value:'',validationIssues:[],issues:[]};
 const board=await model.readOptionBoard('p1',new AbortController().signal,f.fetcher);
 assert.deepEqual(plain(board.quotationContent.red.imageIssues),{},'an intentionally empty image with no validation error is not a connection failure');
});

test('missing or ambiguous schema bindings fail instead of guessing a title or image source by label',async()=>{
 const invalid=[undefined,null,{fields:null},{fields:[null]},{fields:[{id:'title',type:'text'}]},
  {fields:[...boardFields,boardFields[0]]},
  {fields:[...boardFields,{id:'live_title',type:'text',hubWire:{path:['startPage','productName']}}]},
  {fields:[...boardFields,{id:'live_main_a',type:'images',hubInput:'mainImage',hubWire:{path:['imagePage','images','mainImage']}},
    {id:'live_main_b',type:'images',hubInput:'mainImage',hubWire:{path:['imagePage','images','mainImage']}}]},
 ];
 for(const schema of invalid){const f=finalContentFixture();f.quote.resolved.schema=schema;
  await assert.rejects(model.readOptionBoard('p1',new AbortController().signal,f.fetcher),/항목.*연결|연결을 하나로|원천 연결/);
 }
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`real intake and saved per-SKU quotation overrides reach the option board without mutating other rows/common assets (${company.companyCode})`,async()=>{
 const {mobileIntakeHarness}=await import('./helpers/mobile-intake.mjs'),h=mobileIntakeHarness(company);
 const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,keys=JSON.parse(product.image_keys);
  const content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'검토한 공통 SEO 제목'},assets:{
   main:[keys[0]],additional:[keys[1]],detail:[keys[2],keys[3]],size:[keys[4]],label:[keys[5]],
  }}}}));
  const before=await json(await h.route(base+'/quotation-fields')),rows=before.resolved.rows.filter(row=>row.optionId),[first,second,unchanged]=rows;
  const storedContent=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,storedOptions=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  const final=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes:[
   {fieldKey:'title',optionId:first.optionId,value:''},{fieldKey:'mainImage',optionId:first.optionId,value:keys[6]},
   {fieldKey:'additionalImages',optionId:first.optionId,value:''},{fieldKey:'detailImages',optionId:first.optionId,value:keys[8]},
   {fieldKey:'labelImages',optionId:first.optionId,value:keys[9]},
   {fieldKey:'title',optionId:second.optionId,value:'검토한 두 번째 SKU 제목'},{fieldKey:'mainImage',optionId:second.optionId,value:''},
   {fieldKey:'additionalImages',optionId:second.optionId,value:keys[7]},{fieldKey:'detailImages',optionId:second.optionId,value:keys[10]},
   {fieldKey:'labelImages',optionId:second.optionId,value:''},
  ]}}));
  const board=await model.readOptionBoard(product.id,new AbortController().signal,(url,init)=>h.route(url,{method:init?.method??'GET'}));
  for(const row of final.resolved.rows.filter(row=>row.optionId)){
   const expected=Object.fromEntries([['main','mainImage'],['additional','additionalImages'],['detail','detailImages'],['label','labelImages']].map(([role,id])=>[role,row.fields[id].value.split('\n').filter(Boolean)]));
   assert.deepEqual(plain(board.quotationContent[row.optionId]),{title:row.fields.title.value,...expected,imageIssues:{}});
  }
  assert.equal(board.quotationContent[first.optionId].title,'');assert.deepEqual(plain(board.quotationContent[second.optionId].main),[]);
  assert.deepEqual(plain(final.resolved.rows.find(row=>row.optionId===unchanged.optionId).fields),plain(unchanged.fields));
  assert.deepEqual(plain(final.resolved.rows.find(row=>row.optionId===null).fields),plain(before.resolved.rows.find(row=>row.optionId===null).fields));
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,storedContent);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,storedOptions);
  const shown=tree('',h.sourceUrl,board,keys,undefined,0,{stage:true}),html=renderToStaticMarkup(shown.tree);
  assert.equal(text(byLabel(shown.tree,`옵션 ${first.optionId} SEO설정 편집`)),'미입력');assert.equal(text(byLabel(shown.tree,`옵션 ${first.optionId} 대표이미지 편집`)),'1장');
  assert.equal(text(byLabel(shown.tree,`옵션 ${second.optionId} 대표이미지 편집`)),'0장');assert.equal(text(byLabel(shown.tree,`옵션 ${second.optionId} 한글표시사항 편집`)),'0장');
  assert.match(html,new RegExp('src="/api/files/'+keys[6].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"'));
  assert.ok(!html.includes('연결 확인 필요'),'ordinary final image review messages never mark valid saved attachments broken');
  assert.equal(h.network.filter(host=>host==='supplier.coupang.com').length,0);assert.equal(product.supplier_hub_status,'미전송');
 }finally{h.close();}
});

// Synthetic exact Hub price paths and XLSX bytes, real owner-scoped API handlers
// and ephemeral SQLite/R2. A direct primary edit deliberately retains the old
// summary, as a legacy saved draft can; reading the board must never repair it.
for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`saved primary prices agree across the option board, preview and packaged XLSX without rewriting divergent drafts (${company.code})`,async()=>{
 const {mobileIntakeHarness}=await import('./helpers/mobile-intake.mjs'),{hubSchemaSnapshot,schemaPath}=await import('./helpers/hub-schema.mjs'),{quotationWorkbook}=await import('./helpers/quotation-workbook.mjs');
 const {readPackageZip,prepareAttachments}=await import('../extensions/supplier-hub/package.mjs'),h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 try{
  const snapshot={...hubSchemaSnapshot(company),inputBindings:'couplus-paths-v1'},raw=JSON.parse(snapshot.schemaString);
  delete raw.properties.productPage.properties.price;
  Object.assign(raw.properties.productPage.properties.commonAttributes.properties,{purchasePrice:{type:'string',title:'공급가'},coupangSalePrice:{type:'string',title:'판매가'},msrp:{type:['string','null'],title:'권장소비자가격'}});
  snapshot.schemaString=JSON.stringify(raw);
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,schemaPath,snapshot),inputs=['supplyPrice','salePrice','msrp'],fields=schema.fields.filter(field=>!inputs.includes(field.id));
  const bytes=new Uint8Array(quotationWorkbook(fields.map(field=>field.id))),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.xlsx`;
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'옵션 보드 primary 가격 연결 시험',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,
   template:{name:'synthetic-board-primary.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields.map(field=>field.id)},mappings:fields.map((field,column)=>({field:field.id,column,required:field.required}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,qurl=base+'/quotation-fields';let view=await json(await h.route(qurl));
  const targets=h.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields),options=view.resolved.rows.filter(row=>row.optionId),[first,second]=options;
  assert.notEqual(targets.supplyPrice.primary,'supplyPrice');assert.notEqual(targets.salePrice.primary,'salePrice');
  const save=async changes=>view=await json(await h.route(qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  await save([{fieldKey:'supplyPrice',optionId:null,value:'1000'},{fieldKey:'salePrice',optionId:null,value:'2000'},
   {fieldKey:targets.supplyPrice.primary,optionId:first.optionId,value:'12345'},{fieldKey:targets.salePrice.primary,optionId:first.optionId,value:'23456'},
   {fieldKey:targets.supplyPrice.primary,optionId:second.optionId,value:''},{fieldKey:targets.salePrice.primary,optionId:second.optionId,value:'34567'}]);
  const firstSaved=view.resolved.rows.find(row=>row.optionId===first.optionId);assert.equal(firstSaved.fields.supplyPrice.value,'1000');assert.equal(firstSaved.fields[targets.supplyPrice.primary].value,'12345');
  const stored=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','collection_context','category_profiles'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all())),before=stored();
  const board=await model.readOptionBoard(product.id,new AbortController().signal,(url,init)=>h.route(url,{method:init?.method??'GET'}));
  for(const row of view.resolved.rows.filter(row=>row.optionId))assert.deepEqual(plain(board.quotationPrices[row.optionId]),{supplyPrice:row.fields[targets.supplyPrice.primary].value,salePrice:row.fields[targets.salePrice.primary].value});
  assert.deepEqual(plain(board.quotationPrices[first.optionId]),{supplyPrice:'12345',salePrice:'23456'});assert.deepEqual(plain(board.quotationPrices[second.optionId]),{supplyPrice:'',salePrice:'34567'});
  const shown=tree('',h.sourceUrl,board,board.imageKeys,undefined,0,{stage:true}),html=renderToStaticMarkup(shown.tree);
  assert.equal(text(byLabel(shown.tree,`옵션 ${first.optionId} 가격설정 편집`)),'입력됨');assert.equal(text(byLabel(shown.tree,`옵션 ${second.optionId} 가격설정 편집`)),'미입력');assert.match(html,/12,345원 \(견적 공급가\)/);assert.match(html,/34,567원 \(견적 판매가\)/);
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
  assert.ok(preview.report.mappingCoverage.some(field=>field.fieldId==='supplyPrice'),'reading does not silently reconcile a divergent manual summary or declare it ready');
  assert.ok(preview.submissionReview.issues.some(issue=>issue.code==='EXCEL_FIELD_UNMAPPED'&&issue.fieldId==='supplyPrice'));assert.equal(preview.report.submissionReady,false);
  const supplyColumn=fields.findIndex(field=>field.id===targets.supplyPrice.primary),saleColumn=fields.findIndex(field=>field.id===targets.salePrice.primary);
  assert.deepEqual(plain(preview.rows.slice(0,2).map(row=>[row[supplyColumn],row[saleColumn]])),[['12345','23456'],['','34567']]);
  const exported=await h.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
  const packageBytes=new Uint8Array(await exported.arrayBuffer()),zip=readPackageZip(packageBytes),reader=h.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(zip.get(preview.filename).slice().buffer));
  for(const [index,option]of [first,second].entries()){const row=reader.xlsxHeaders(inspection,'견적서',index+2);assert.equal(row[supplyColumn]??'',board.quotationPrices[option.optionId].supplyPrice);assert.equal(row[saleColumn]??'',board.quotationPrices[option.optionId].salePrice);}
  await assert.rejects(prepareAttachments(packageBytes),/수정이 필요한 오류/);assert.equal(stored(),before);assert.deepEqual(h.objects.get(storageKey),bytes);
  const untouched=plain(view.resolved.rows.filter(row=>row.optionId!==first.optionId)),common=plain(view.overrides.common),sourceOptions=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  await save(h.load('app/quotation-price-edits.ts').quotationPriceEditChanges(view.resolved.schema.fields,[{fieldKey:targets.supplyPrice.primary,optionId:first.optionId,value:'12345'},{fieldKey:targets.salePrice.primary,optionId:first.optionId,value:'23456'}]));
  const repaired=await model.readOptionBoard(product.id,new AbortController().signal,(url,init)=>h.route(url,{method:init?.method??'GET'}));assert.deepEqual(plain(repaired.quotationPrices[first.optionId]),plain(board.quotationPrices[first.optionId]));
  assert.equal(view.resolved.rows.find(row=>row.optionId===first.optionId).fields.supplyPrice.value,'12345');assert.deepEqual(plain(view.resolved.rows.filter(row=>row.optionId!==first.optionId)),untouched);assert.deepEqual(plain(view.overrides.common),common);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,sourceOptions);
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(product.id).supplier_hub_status,'미전송');assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
