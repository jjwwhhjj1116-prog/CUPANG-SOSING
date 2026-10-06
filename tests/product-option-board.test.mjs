import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
const native=createRequire(import.meta.url);
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,fetch,AbortController,require(name){if(name in overrides)return overrides[name];if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;}
function quotation(contentRevision=undefined,imageKeys=['owner/red.png','owner/shared.png','owner/source.png','owner/size.png']){return {productVersion:data.productVersion,optionRevision:1,contentRevision,imageKeys,resolved:{rows:data.options.rows.map(row=>({optionId:row.id,fields:{supplyPrice:{value:'4100'},salePrice:{value:'6200'}}}))}};}
const model=load('app/components/product-option-board.tsx');
const data={productVersion:'v1',options:{schemaVersion:1,productId:'p1',revision:1,rows:[{id:'red',originalName:'Red',translatedName:'빨강',supplierSku:'sku-red',unitCostCny:4.5,unitsPerPack:2,stock:0,included:true,imageKey:'owner/red.png',provenance:{}},{id:'blue',originalName:'Blue',translatedName:'',supplierSku:'sku-blue',unitCostCny:null,unitsPerPack:1,stock:null,included:false,imageKey:'other/private.png',provenance:{translatedName:'manual'}}]},pricing:{rows:[{optionId:'red',calculation:{supplyPrice:4000,salePrice:6000},error:null}]}};
test('option board fetch checks product identity and propagates abort signal',async()=>{
 const signal=new AbortController().signal;const requests=[];
 const received=await model.readOptionBoard('p1',signal,async(url,init)=>{requests.push({url,...init});return {ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/quotation-fields')?quotation():{content:{productId:'p1',schemaVersion:1,assets:{main:{value:['owner/shared.png']}}}}};});assert.equal(received.options,data.options);assert.deepEqual(Array.from(received.commonImageKeys),['owner/shared.png']);const request=requests[0];assert.equal(requests[1].signal,signal);assert.equal(requests[1].url,'/api/products/p1/content');
 assert.equal(request.url,'/api/products/p1/options');assert.equal(request.signal,signal);assert.equal(request.cache,'no-store');
 for(const bad of [null,{}, {...data,options:{...data.options,productId:'p2'}}])await assert.rejects(model.readOptionBoard('p1',signal,async()=>({ok:true,json:async()=>bad})),/응답/);
 await assert.rejects(model.readOptionBoard('p1',signal,async()=>({ok:false,json:async()=>({error:'인증 필요'})})),/인증 필요/);
});
function tree(query='',sourceUrl='https://detail.1688.com/offer/813724060928.html',boardData=data,owned=['owner/red.png'],loadedIdentity={productId:'p1',attempt:0},attempt=0,features={},snapshotKeys=boardData.imageKeys??owned){
 let slot=0;const selected=[];const edited=[];const images=[];const contentSteps=[];const stages=[];const managed=[];const states=[{...loadedIdentity,data:{...boardData,imageKeys:snapshotKeys},error:''},attempt,query];
 const hooks={useState(initial){const i=slot++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect(){}};
 const {ProductOptionBoard}=load('app/components/product-option-board.tsx',{react:hooks});
 const render=()=>{slot=0;return ProductOptionBoard({productId:'p1',sourceUrl,imageKeys:JSON.stringify(owned),onQuotation:id=>selected.push(id),onContent:step=>contentSteps.push(step),onImage:id=>images.push(id),onEdit:id=>edited.push(id),...(features.stage?{onStage:(id,step)=>stages.push([id,step])}:{}),...(features.manage?{onManage:id=>managed.push(id)}:{})});};
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
  await assert.rejects(model.readOptionBoard('p1',signal,async url=>({ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/quotation-fields')?quotation():{content}})),/이미지 응답/);
 }
 await assert.rejects(model.readOptionBoard('p1',signal,async url=>({ok:url.endsWith('/options'),json:async()=>url.endsWith('/options')?data:{error:'조회 실패'}})),/조회 실패/);
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
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/quotation-fields')?quotation():{content}});
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
 assert.equal(nodes(result.tree).filter(node=>node.type==='input'&&node.props.type==='checkbox').length,3);
});

test('typed stage callbacks preserve the clicked option across every stage and take precedence over legacy callbacks',()=>{
 const result=tree('',undefined,data,['owner/red.png'],undefined,0,{stage:true});
 const expected=[['SEO설정','SEO'],['가격설정','가격'],['대표이미지','대표 이미지'],['추가이미지','추가 이미지'],['상세이미지','상세 이미지'],['사이즈표','옵션'],['한글표시사항','표시사항'],['견적서','견적서']];
 for(const [label] of expected)byLabel(result.tree,`옵션 blue ${label} 편집`).props.onClick({type:'click'});
 assert.deepEqual(result.stages,expected.map(([,step])=>['blue',step]));assert.deepEqual(result.edited,[]);assert.deepEqual(result.images,[]);assert.deepEqual(result.contentSteps,[]);assert.deepEqual(result.selected,[]);
 const legacy=tree();assert.equal(byLabel(legacy.tree,'옵션 red SEO설정 편집'),undefined);assert.equal(byLabel(legacy.tree,'옵션 red 사이즈표 편집'),undefined);
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
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/quotation-fields')?quotation(2):{content}});
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
 const read=(options=data,content=validContent,quote=quotation(2))=>model.readOptionBoard('p1',signal,async url=>({ok:true,json:async()=>url.endsWith('/options')?options:url.endsWith('/quotation-fields')?quote:{content}}));
 for(const seo of [null,[],{}, {title:null},{title:{value:1}}])await assert.rejects(read(data,{...validContent,seo}),/SEO 응답/);
 for(const size of [null,[],{}, {value:'owner/size.png'}, {value:[1]}])await assert.rejects(read(data,{...validContent,assets:{main:{value:[]},size}}),/이미지 응답/);
 for(const options of [{...data,productVersion:null},{...data,options:{...data.options,revision:-1}},{...data,options:{...data.options,rows:[null]}},{...data,options:{...data.options,rows:[data.options.rows[0],data.options.rows[0]]}},{...data,pricing:{rows:[null]}},{...data,pricing:{rows:[{optionId:'foreign',calculation:null}]}},{...data,pricing:{rows:[{optionId:'red',calculation:{supplyPrice:'123',salePrice:1}}]}}])await assert.rejects(read(options),/옵션 응답/);
 await assert.rejects(read(data,validContent,{...quotation(2),resolved:{rows:[null]}}),/견적 가격 응답/);
 await assert.rejects(read(data,validContent,{...quotation(2),resolved:{rows:[...quotation(2).resolved.rows,quotation(2).resolved.rows[0]]}}),/견적 가격 응답/);
 for(const imageKeys of [undefined,null,{},[1],['']])await assert.rejects(read(data,validContent,{...quotation(2),imageKeys}),/이미지 목록 응답/);
});

test('a refreshed board displays newly attached images using its quotation snapshot despite stale parent image keys',async()=>{
 const content={productId:'p1',schemaVersion:1,revision:2,seo:{title:{value:'저장한 상품'}},assets:{main:{value:[]},additional:{value:['owner/new-additional.png']},size:{value:['owner/new-size.png']}}};
 const options={...data,sourceImageKeys:{red:'owner/new-source.png',blue:'owner/new-source.png'},options:{...data.options,rows:data.options.rows.map(row=>({...row,imageKey:row.id==='red'?'owner/new-main.png':null}))}};
 const keys=['owner/new-main.png','owner/new-source.png','owner/new-additional.png','owner/new-size.png'];
 const refreshed=await model.readOptionBoard('p1',new AbortController().signal,async url=>({ok:true,json:async()=>url.endsWith('/options')?options:url.endsWith('/content')?{content}:quotation(2,keys)}));
 assert.deepEqual(Array.from(refreshed.imageKeys),keys);
 const result=tree('',undefined,refreshed,['owner/old-parent.png'],{productId:'p1',attempt:1},1,{stage:true});
 assert.match(renderToStaticMarkup(result.tree),/src="\/api\/files\/owner\/new-main.png"/);assert.equal(text(byLabel(result.tree,'옵션 red 대표이미지 편집')),'1장');assert.equal(text(byLabel(result.tree,'옵션 red 추가이미지 편집')),'1장');assert.equal(text(byLabel(result.tree,'옵션 red 사이즈표 편집')),'1장');
 assert.match(renderToStaticMarkup(result.tree),/src="\/api\/files\/owner\/new-source.png"/);assert.equal(text(byLabel(result.tree,'옵션 blue 대표이미지 편집')),'0장');
});

test('a refreshed board excludes removed assignments and source previews even when the parent still lists those keys',async()=>{
 const content={productId:'p1',schemaVersion:1,revision:2,assets:{main:{value:[]},additional:{value:['owner/removed.png','owner/retained.png']},size:{value:['owner/removed.png']}}};
 const options={...data,sourceImageKeys:{red:'owner/removed.png',blue:'owner/removed.png'},options:{...data.options,rows:data.options.rows.map(row=>({...row,imageKey:row.id==='red'?'owner/removed.png':null}))}};
 const refreshed=await model.readOptionBoard('p1',new AbortController().signal,async url=>({ok:true,json:async()=>url.endsWith('/options')?options:url.endsWith('/content')?{content}:quotation(2,['owner/retained.png'])}));
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
 for(const quote of [{...quotation(2),productVersion:'stale'},{...quotation(2),optionRevision:7},quotation(1),{...quotation(2),resolved:{rows:[]}}]){
  await assert.rejects(model.readOptionBoard('p1',signal,async url=>({ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/content')?{content}:quote})),/変更|변경|응답/);
 }
 let quoteSignal;
 const result=await model.readOptionBoard('p1',signal,async(url,init)=>{if(url.endsWith('/quotation-fields'))quoteSignal=init.signal;return {ok:true,json:async()=>url.endsWith('/options')?data:url.endsWith('/content')?{content}:quotation(2)};});
 assert.equal(quoteSignal,signal);assert.equal(result.quotationPrices.red.supplyPrice,'4100');
 await assert.rejects(model.readOptionBoard('p1',signal,async url=>({ok:!url.endsWith('/quotation-fields'),json:async()=>url.endsWith('/options')?data:url.endsWith('/content')?{content}:{error:'견적 조회 실패'}})),/견적 조회 실패/);
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
 for(const bad of [null,[],{red:1},{red:''},{foreign:'owner/source.png'}])await assert.rejects(model.readOptionBoard('p1',signal,async url=>({ok:true,json:async()=>url.endsWith('/options')?{...data,sourceImageKeys:bad}:url.endsWith('/quotation-fields')?quotation():{content}})),/원본 이미지 응답/);
 const result=await model.readOptionBoard('p1',signal,async url=>({ok:true,json:async()=>url.endsWith('/options')?{...data,sourceImageKeys:{red:'owner/source.png'}}:url.endsWith('/quotation-fields')?quotation():{content}}));
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
