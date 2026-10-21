import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/workspace-close.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const root=(flags)=>({querySelector:selector=>flags[selector.includes('saving')?'busy':'dirty']?{}:null});
test('unsaved workspace closes only after discard; completed saves do not prompt',()=>{
 const flags={busy:false,dirty:true};let prompts=0;
 assert.equal(exports.requestWorkspaceClose(root(flags),()=>{prompts++;return false;}),'cancel');
 assert.equal(exports.requestWorkspaceClose(root(flags),()=>{prompts++;return true;}),'close');
 flags.dirty=false;assert.equal(exports.requestWorkspaceClose(root(flags),()=>{throw Error('unexpected prompt');}),'close');assert.equal(prompts,2);
});
test('in-flight writes block close even if discard would be approved; retry reads current state',()=>{
 const flags={busy:true,dirty:true};const element=root(flags);
 assert.equal(exports.requestWorkspaceClose(element,()=>{throw Error('must not discard during write');}),'busy');
 flags.busy=false;assert.equal(exports.requestWorkspaceClose(element,()=>false),'cancel');
 flags.dirty=false;assert.equal(exports.requestWorkspaceClose(element,()=>false),'close');
});
test('closed workspace has no pending state',()=>{assert.equal(exports.requestWorkspaceClose(null,()=>{throw Error('unexpected prompt');}),'close');});

test('free-image apply ignores only its own reviewed draft while closing still guards it and retained source drafts remain protected',()=>{
 const flags={freeDirty:true,freeBusy:false,otherDirty:false,otherBusy:false};
 const element={querySelector:selector=>{
  const busy=selector.includes('saving'),own=busy?flags.freeBusy:flags.freeDirty,other=busy?flags.otherBusy:flags.otherDirty;
  return other||own&&!selector.includes(':not([data-free-image-editor])')?{}:null;
 }};
 assert.equal(exports.workspaceEditState(element).dirty,true);assert.equal(exports.workspaceEditState(element,true).dirty,false);
 assert.equal(exports.requestWorkspaceClose(element,()=>false),'cancel');
 flags.freeBusy=true;assert.equal(exports.requestWorkspaceClose(element,()=>{throw Error('no discard during save');}),'busy');assert.equal(exports.workspaceEditState(element,true).busy,false);
 flags.otherDirty=true;flags.otherBusy=true;assert.equal(exports.workspaceEditState(element,true).dirty,true);assert.equal(exports.workspaceEditState(element,true).busy,true);
});

test('SEO generation ignores only its memo marker while close, quotation and image operations retain its dirty guard',()=>{
 const flags={seoDirty:true,seoBusy:false,freeDirty:false,otherDirty:false,otherBusy:false};
 const element={querySelector:selector=>{const busy=selector.includes('saving');const own=busy?flags.seoBusy:flags.seoDirty,other=busy?flags.otherBusy:flags.otherDirty;
  return other||own&&!selector.includes(':not([data-seo-generation-input])')||!busy&&flags.freeDirty&&!selector.includes(':not([data-free-image-editor])')?{}:null;}};
 assert.equal(exports.workspaceEditState(element).dirty,true);assert.equal(exports.workspaceEditState(element,false,true).dirty,false);assert.equal(exports.workspaceEditState(element,true).dirty,true);assert.equal(exports.requestWorkspaceClose(element,()=>false),'cancel');
 flags.seoBusy=true;assert.equal(exports.workspaceEditState(element).busy,true);assert.equal(exports.requestWorkspaceClose(element,()=>{throw Error('must not discard a request');}),'busy');flags.seoBusy=false;
 flags.otherDirty=true;assert.equal(exports.workspaceEditState(element,false,true).dirty,true);flags.otherDirty=false;flags.freeDirty=true;assert.equal(exports.workspaceEditState(element,false,true).dirty,true);flags.freeDirty=false;flags.otherBusy=true;assert.equal(exports.workspaceEditState(element,false,true).busy,true);
});

test('quotation entry finds hidden source drafts, deduplicates steps and excludes unrelated quotation drafts',()=>{
 const element=(step,own=false,nested=false)=>({getAttribute:key=>key==='data-quotation-source-step'?step:own?'true':'false',querySelector:()=>nested?{}:null});
 const elements=[element('SEO',true),element('가격',false,true),element('SEO',true),element('대표 이미지')];
 const page={querySelector:()=>null,querySelectorAll:()=>elements};
 assert.deepEqual(Array.from(exports.quotationSourceState(page).steps),['SEO','가격']);
 elements.splice(0);assert.equal(exports.quotationSourceState(page).steps.length,0);
 page.querySelector=()=>({});assert.equal(exports.quotationSourceState(page).busy,true);
 assert.equal(exports.quotationSourceState(null).steps.length,0);
});

const sourceRoot=rows=>({querySelector:selector=>rows.find(row=>{
 const kind=selector.includes('saving')?'busy':'dirty';
 if(!row[kind])return false;
 if(row.upload&&selector.includes(`:not([data-image-upload-queue="${row.upload}"])`))return false;
 if(row.chart&&selector.includes(':not([data-size-chart-workspace])'))return false;
 return true;
})??null});

test('upload start consumes only its own queued files and keeps hidden or other stage drafts guarded',()=>{
 for(const stage of ['additional','detail']){
  const own={upload:stage,dirty:true,busy:true},rows=[own],page=sourceRoot(rows);
  assert.equal(exports.workspaceSourceWriteState(page,stage+'-upload').dirty,false);
  assert.equal(exports.workspaceSourceWriteState(page,stage+'-upload').busy,false);
  assert.equal(exports.requestWorkspaceClose(page,()=>{throw Error('in-flight queue cannot be discarded');}),'busy');
  for(const other of [{upload:stage==='additional'?'detail':'additional',dirty:true},{chart:true,dirty:true},{dirty:true,hidden:true},{busy:true,hidden:true}]){
   rows.push(other);const next=exports.workspaceSourceWriteState(page,stage+'-upload');
   assert.equal(next[other.busy?'busy':'dirty'],true);rows.pop();
  }
 }
});

test('size-chart commit consumes its table draft while nested document writes and other stages still block it',()=>{
 const rows=[{chart:true,dirty:true,busy:true}],page=sourceRoot(rows);
 assert.equal(exports.workspaceSourceWriteState(page,'size-chart').dirty,false);
 assert.equal(exports.workspaceSourceWriteState(page,'size-chart').busy,false);
 for(const other of [{dirty:true,nestedDocument:true},{busy:true,nestedDocument:true},{upload:'additional',dirty:true},{upload:'detail',busy:true},{dirty:true,hidden:true}]){
  rows.push(other);const next=exports.workspaceSourceWriteState(page,'size-chart');assert.equal(next[other.busy?'busy':'dirty'],true);rows.pop();
 }
 assert.equal(exports.requestWorkspaceClose(page,()=>false),'busy');
});

test('source writes fail closed if the workspace disappeared or the source kind is not supported',()=>{
 for(const [page,source]of [[null,'size-chart'],[sourceRoot([]),'unexpected'],[sourceRoot([]),'toString']]){
  const next=exports.workspaceSourceWriteState(page,source);assert.equal(next.busy,true);assert.equal(next.dirty,true);
 }
});
