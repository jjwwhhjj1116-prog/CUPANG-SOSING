import test from 'node:test';
import assert from 'node:assert/strict';
import {module,plain} from './helpers/supplier-hub-single-size-chart.mjs';
import {request,selection,source} from './helpers/size-chart-extraction.mjs';
const model=module('app/size-chart-extraction.ts'),plan=()=>model.buildSizeChartExtractionPlan(request());
test('source-bound token spans reconstruct only exact OCR text, preserving decimals, blank cells and input',async()=>{
 const input=request(),before=JSON.stringify(input),p=model.buildSizeChartExtractionPlan(input);for(const token of p.tokens)assert.equal(token.text,input.lines.find(line=>line.id===token.lineId).text.slice(token.start,token.end));
 const raw=selection(p.tokens),resolved=model.resolveSizeChartExtraction(p,raw);assert.deepEqual(plain(resolved.chart),{sizeType:'이미지 추출 사이즈표',sizeUnits:'cm',sizes:['S','M'],measurements:[{name:'胸围',values:['40.5','44']},{name:'衣长',values:['60','']}]});
 let calls=0;const result=await model.executeSizeChartExtraction(p,{run:async(name,input)=>{calls++;assert.equal(name,model.SIZE_CHART_EXTRACTION_MODEL);const prompt=JSON.parse(input.messages[1].content);assert.equal(prompt.task,'EXTRACT_SIZE_CHART_FROM_OCR');assert.deepEqual(prompt.display,{width:800,height:600});return{response:JSON.stringify(raw)};}});
 assert.equal(calls,1);assert.equal(JSON.stringify(input),before);assert.deepEqual(plain(model.verifySizeChartExtractionResult(result,input.source,input.lines).chart),plain(resolved.chart));
});
test('references cannot invent cells, span different lines, skip tokens, overlap or duplicate a used source cell',()=>{
 const p=plan(),valid=selection(p.tokens);for(const edit of [x=>{x.measurements[0].values[0]=['40.5'];},x=>{x.measurements[0].values[0]=[p.tokens[0].id,p.tokens.at(-1).id];},x=>{x.sizes[1]=x.sizes[0];},x=>{x.measurements[1].values[1]=x.measurements[0].values[0];},x=>{x.measurements[0].values.pop();},x=>{x.guess=1;},x=>{x.measurements[0].value='42';}]){const value=structuredClone(valid);edit(value);assert.throws(()=>model.resolveSizeChartExtraction(p,value));}
 const grouped=model.buildSizeChartExtractionPlan(request(['单位 cm','尺码 S M','胸围 40 / 44','衣长 60'])),ref=text=>grouped.tokens.find(token=>token.text===text).id;
 const value={hasSizeChart:true,unit:[ref('cm')],sizes:[[ref('S')],[ref('M')]],measurements:[{name:[ref('胸围')],values:[[ref('40'),ref('/'),ref('44')],null]}]};
 assert.equal(model.resolveSizeChartExtraction(grouped,value).chart.measurements[0].values[0],'40 / 44');value.measurements[0].values[0]=[ref('40'),ref('44')];assert.throws(()=>model.resolveSizeChartExtraction(grouped,value));
});
test('unit evidence cannot hide unselected mixed headers or attached units; unknown physical units stay null',()=>{
 for(const header of ['单位 cm / inch','单位 cm 鞋码','单位 cm 斤','单位 cm 40mm']){
  const p=model.buildSizeChartExtractionPlan(request([header,'尺码 S M','胸围 40.5 44','衣长 60'])),result=model.resolveSizeChartExtraction(p,selection(p.tokens));assert.equal(result.chart.sizeUnits,null);assert.ok(result.warnings.some(value=>value.includes('단위')));
 }
 const p=plan(),raw=selection(p.tokens);raw.unit=null;assert.equal(model.resolveSizeChartExtraction(p,raw).chart.sizeUnits,null);
 for(const[lexeme,unit]of [['厘米','cm'],['毫米','mm'],['英寸','inch'],['㎡','㎡']]){const input=request(['单位 '+lexeme,'尺码 S M','胸围 40.5 44','衣长 60']),p=model.buildSizeChartExtractionPlan(input),raw=selection(p.tokens.map(token=>token.text===lexeme?{...token,text:'cm'}:token));assert.equal(model.resolveSizeChartExtraction(p,raw).chart.sizeUnits,unit);}
});
test('no-table response has no proposed chart; other nonempty no-table fields are rejected',async()=>{
 const p=plan(),none={hasSizeChart:false,unit:null,sizes:[],measurements:[]},result=await model.executeSizeChartExtraction(p,{run:async()=>({response:JSON.stringify(none)})});assert.equal(result.chart,null);assert.ok(result.warnings.length);model.verifySizeChartExtractionResult(result,p.source,p.lines);
 for(const raw of [{...none,sizes:[['t0']]},{...none,unit:['t0']},{...none,measurements:[{}]}])assert.throws(()=>model.resolveSizeChartExtraction(p,raw));
});
test('OCR validates identity, confidence, bounds, scalar text, token/prompt limits and does not accept unrelated source contexts',()=>{
 for(const edit of [x=>{x.lines[0].box.x=-1;},x=>{x.lines[0].box.height=700;},x=>{x.lines[0].confidence=101;},x=>{x.lines[1].id=x.lines[0].id;},x=>{x.lines[0].text='\u0000';},x=>{x.lines=[];},x=>{x.source.role='main';},x=>{x.display={width:799,height:600};},x=>{x.source.purpose='extra';},x=>{x.language='ko';}]){const input=request();edit(input);assert.throws(()=>model.buildSizeChartExtractionPlan(input));}
 const many=request();many.lines=Array.from({length:100},(_,i)=>({id:'l'+i,text:'x '.repeat(20),box:{x:0,y:0,width:1,height:1},confidence:0}));assert.throws(()=>model.buildSizeChartExtractionPlan(many),/1,200/);
});
test('EXIF-swapped display coordinates retain raw image identity and reject scaling or out-of-display boxes',()=>{
 const input=request();input.source={...source,width:1200,height:800};input.display={width:800,height:1200};input.lines=[{id:'bottom',text:'尺寸',box:{x:1,y:1000,width:100,height:20},confidence:90}];const p=model.buildSizeChartExtractionPlan(input);assert.equal(p.lines[0].box.y,1000);assert.equal(p.source.width,1200);
 for(const display of [{width:800,height:800},{width:1600,height:2400}])assert.throws(()=>model.buildSizeChartExtractionPlan({...input,display}));
 assert.throws(()=>model.buildSizeChartExtractionPlan({...input,display:{width:1200,height:800}}));
});
test('provider output remains strict JSON with one bounded request and no retry on malformed, duplicate or failed response',async()=>{
 const p=plan();for(const response of ['{"hasSizeChart":false,"hasSizeChart":true,"unit":null,"sizes":[],"measurements":[]}','prefix '+JSON.stringify(selection(p.tokens)),JSON.stringify({...selection(p.tokens),price:123})]){let calls=0;await assert.rejects(model.executeSizeChartExtraction(p,{run:async()=>{calls++;return{response};}}));assert.equal(calls,1);}
 let calls=0;await assert.rejects(model.executeSizeChartExtraction(p,{run:async()=>{calls++;throw Error('fixture refusal');}}),/무료/);assert.equal(calls,1);
});
test('client result verification rejects changed numbers, tokens, source and display while allowing only original-bound row-name translation',async()=>{
 const p=plan(),result=await model.executeSizeChartExtraction(p,{run:async()=>({response:JSON.stringify(selection(p.tokens))})});
 for(const edit of [x=>{x.chart.measurements[0].values[0]='41';},x=>{x.chart.sizes.reverse();},x=>{x.source.sourceSha256='b'.repeat(64);},x=>{x.evidence.tokens[0].start=3;},x=>{x.evidence.display.width=600;}]){const changed=structuredClone(result);edit(changed);assert.throws(()=>model.verifySizeChartExtractionResult(changed,p.source,p.lines));}
 const translated=structuredClone(result);translated.evidence.translations=translated.chart.measurements.map((row,index)=>({id:'row-'+index,original:row.name,translated:index?'옷길이':'가슴둘레',issue:null}));translated.chart.measurements[0].name='가슴둘레';translated.chart.measurements[1].name='옷길이';model.verifySizeChartExtractionResult(translated,p.source,p.lines);
 assert.ok(model.sizeChartRowNameTranslationIssue('建议体重(斤)','권장체중 kg'));assert.ok(model.sizeChartRowNameTranslationIssue('胸围(cm)','가슴둘레 mm'));assert.ok(model.sizeChartRowNameTranslationIssue('胸围','가슴둘레 999'));assert.equal(model.sizeChartRowNameTranslationIssue('胸围(厘米)','가슴둘레 cm'),null);
});
