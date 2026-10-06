import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const captions=['제품명','제조원','수입 및 판매원','제조국','내용량','원료명 및 성분명(재질)','상품 유형','사용 시 주의사항','사용 기준'];
const plan=()=>({format:'product-label',title:'',subtitle:'',headers:[],footer:'',width:800,columnWidths:[240,480],rows:captions.map((caption,index)=>[caption,index===0?'저장한 상품명':index===4?'':`저장값 ${index}`])});
function fixture({blob=null}={}){
 const draw=[],canvases=[],fontLoads=[];let encoded=0;
 const context={font:'',measureText:value=>({width:[...value].length*12}),fillRect(...args){draw.push({kind:'fill',args});},strokeRect(){throw Error('The product label must not draw table borders');},fillText(text,x,y){draw.push({kind:'text',text,x,y,font:this.font});}};
 const globals={Blob,document:{fonts:{load:async font=>{fontLoads.push(font);},ready:Promise.resolve()},createElement(name){assert.equal(name,'canvas');const canvas={width:300,height:150,getContext:()=>context,toBlob(callback,type){assert.equal(type,'image/png');encoded++;callback(blob??new Blob(['rendered-png'],{type}));}};canvases.push(canvas);return canvas;}}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,...globals,require(name){if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});return exports;}
 return{render:load('app/document-image-render.ts').renderDocument,draw,canvases,fontLoads,get encoded(){return encoded;}};
}
test('nine product-label rows draw bold captions and plain values without table or invented missing-value text',async()=>{
 const h=fixture(),input=plan(),before=JSON.stringify(input),result=await h.render(input);
 assert.equal(result.width,800);assert.equal(result.height,612);assert.equal(result.blob.type,'image/png');assert.equal(h.encoded,1);assert.equal(JSON.stringify(input),before);
 const text=h.draw.filter(row=>row.kind==='text');assert.deepEqual(text.filter(row=>row.font.startsWith('bold')).map(row=>row.text),captions.map(caption=>caption+': '));
 assert.equal(text.length,18);assert.ok(text.filter(row=>!row.font.startsWith('bold')).some(row=>row.text===''));
 assert.ok(!text.some(row=>/미입력|검토용|저장한 내용/.test(row.text)));assert.equal(h.draw.filter(row=>row.kind==='fill').length,1);
});
test('product labels preserve Unicode, blank lines and literal markup through wrapping without truncation',async()=>{
 const h=fixture(),input=plan(),value='<b>한글😀</b>\n\n'+('긴 문장 '.repeat(50));input.rows[5][1]=value;const result=await h.render(input);
 const caption=h.draw.find(row=>row.kind==='text'&&row.text===captions[5]+': '),next=h.draw.find(row=>row.kind==='text'&&row.text===captions[6]+': ');
 const lines=h.draw.filter(row=>row.kind==='text'&&!row.font.startsWith('bold')&&row.y>=caption.y&&row.y<next.y);
 assert.ok(lines.some(row=>row.text===''));assert.equal(lines.map(row=>row.text).join(''),value.replace(/\n/g,''));assert.ok(lines.some(row=>row.text.includes('<b>')));assert.ok(result.height>612);
 for(const line of lines)assert.ok(line.x+[...line.text].length*12<=800-32);
});
test('invalid nine-row plans and over-height contents fail before allocating an output bitmap or encoding PNG',async()=>{
 for(const mutate of [input=>input.rows.pop(),input=>input.width=359,input=>input.rows[0].push('third'),input=>input.rows[0][1]=42,input=>input.rows.forEach(row=>row[1]='한'.repeat(20000))]){
  const h=fixture(),input=plan();mutate(input);await assert.rejects(h.render(input));assert.equal(h.encoded,0);assert.equal(h.canvases[0].width,300);assert.equal(h.canvases[0].height,150);
 }
});
