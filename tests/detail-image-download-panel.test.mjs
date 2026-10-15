import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import sharp from 'sharp';
import {pathToFileURL} from 'node:url';

// Reuse the real component renderer/temporary API fixture without registering
// the original panel test file's separate tests.
const fixtureURL=pathToFileURL(process.cwd()+'/tests/detail-image-composite-panel.test.mjs'),source=fs.readFileSync(fixtureURL,'utf8'),ast=ts.createSourceFile('fixture.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const statements=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isFunctionDeclaration(node)&&node.name?.text==='panel');
const extracted=statements.map(node=>{let value=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(name.startsWith('.'))value=value.replace("'"+name+"'",JSON.stringify(new URL(name,fixtureURL).href));}return value;}).join('\n').replace('return{render,button,locks,saved,props','return{runtime,render,button,locks,saved,props')+'\nexport {panel,companies,makeCompositeFixture,nodes,text};';
const {panel,companies,makeCompositeFixture,nodes,text}=await import('data:text/javascript,'+encodeURIComponent(extracted));
function capture(ui){
 const downloads=[],document=ui.runtime.document,create=document.createElement.bind(document);
 document.createElement=name=>name==='a'?{href:'',download:'',click(){downloads.push({name:this.download,blob:ui.runtime.blobs.get(this.href)});}}:create(name);
 return downloads;
}
const writes=f=>f.calls.filter(call=>['POST','PUT','PATCH','DELETE'].includes(call.init.method));
for(const company of companies)test(`integrated JPG button downloads an actual image without saving, uploading or changing a manual HTML draft (${company.companyCode})`,async()=>{
 const f=await makeCompositeFixture(company,{count:4,manualHtml:'<p>직접 편집한 HTML &amp; 그대로</p>'});let ui;
 try{ui=panel(f);const downloads=capture(ui),before=f.retained(),objects=f.originals();
  await ui.click('통합 이미지 다운로드');assert.equal(downloads.length,1);assert.match(downloads[0].name,/^YOOFAM-.*-detail\.jpg$/);
  assert.equal(downloads[0].blob.type,'image/jpeg');const metadata=await sharp(Buffer.from(await downloads[0].blob.arrayBuffer())).metadata();assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,800);assert.equal(metadata.height,4);
  assert.equal(writes(f).length,0);assert.equal(ui.saved.length,0);assert.equal(f.retained(),before);assert.equal(f.originals(),objects);assert.equal(ui.locks.at(-1),false);assert.ok(text(ui.render()).includes('JPG로 내려받았습니다'));
  assert.equal(nodes(ui.render()).some(node=>node.type==='img'),false,'download does not create an apply preview');
 }finally{ui?.close();f.api.close();}
});
test('integrated download ignores repeated clicks and cancels hidden-stage ABA before creating a download',async()=>{
 const f=await makeCompositeFixture(companies[0],{count:4});let ui;
 try{const original=f.request;let release,held=false;f.request=async(url,init)=>{if(!held&&url.includes('/quotation-fields')){held=true;await new Promise(resolve=>{release=resolve;});}return original(url,init);};
  ui=panel(f);const downloads=capture(ui),before=f.retained(),click=ui.button('통합 이미지 다운로드').props.onClick;
  click();click();assert.equal(ui.locks.filter(Boolean).length,1,'one synchronous request lock');
  ui.props({stageActive:false});ui.props({stageActive:true});release();await ui.idle();
  assert.equal(downloads.length,0);assert.equal(writes(f).length,0);assert.equal(f.retained(),before);assert.equal(ui.locks.at(-1),false);
  await ui.click('통합 이미지 다운로드');assert.equal(downloads.length,1,'a fresh explicit click still works');
 }finally{ui?.close();f.api.close();}
});
test('failed reads and changed view or text-edit locks never download or write a stale image',async()=>{
 for(const mode of ['inactive','disabled','dirty','read-error','changed-view']){
  const f=await makeCompositeFixture(companies[1],{count:4});let ui;
  try{const original=f.request;let release;if(mode==='read-error')f.request=async()=>Response.json({error:'검수 조회 실패'},{status:503});
   if(mode==='changed-view')f.request=async(url,init)=>{if(!release)await new Promise(resolve=>{release=resolve;});return original(url,init);};
   ui=panel(f);const downloads=capture(ui),before=f.retained(),click=ui.button('통합 이미지 다운로드').props.onClick;
   if(mode==='inactive')ui.props({stageActive:false});if(mode==='disabled')ui.props({disabled:true});if(mode==='dirty')ui.props({beforeApply:()=>false});
   click();if(mode==='changed-view'){ui.props({view:{...f.view,revision:f.view.revision+1}});release();}await ui.idle();
   assert.equal(downloads.length,0,mode);assert.equal(writes(f).length,0,mode);assert.equal(f.retained(),before,mode);assert.equal(ui.saved.length,0,mode);
   if(mode==='read-error')assert.ok(nodes(ui.render()).some(node=>node.props?.role==='alert'&&text(node).includes('검수 조회 실패')));
  }finally{ui?.close();f.api.close();}
 }
});
