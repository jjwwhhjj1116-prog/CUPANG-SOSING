import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const file=new URL('../app/components/dashboard-client.tsx',import.meta.url),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let declaration;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='prepareCurrentSubmission')declaration=node;ts.forEachChild(node,visit);}visit(ast);assert.ok(declaration);
const close={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/workspace-close.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,close);
const compiled=ts.transpileModule(`function build(context:any){const {batchBusyRef,detail,liveSubmissionContext,submissionContext,settingsOperationRef,workspaceOwnerId,detailNavigation,productNavigation,registrationLayoutReady,detailBody,setCloseNotice,optionWorkspaceReturn,optionBoardScope,setOptionBoardProduct,setOptionReturnFocus,openSubmission,setDetail}=context;${declaration.getText(ast)}return prepareCurrentSubmission;} exports.build=build;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};vm.runInNewContext(compiled,{exports:module.exports,workspaceEditState:close.exports.workspaceEditState});
function fixture({accept=true,busy=false,dirty=false,layout=true}={}){
 const actions=[],attempts=[],context={batchBusyRef:{current:false},detail:{id:'synthetic-handoff',owner_id:'owner'},submissionContext:{owner:'owner'},settingsOperationRef:{current:{mounted:true,ownerId:'owner'}},workspaceOwnerId:'owner',detailNavigation:7,productNavigation:{current:7},registrationLayoutReady:layout,
  detailBody:{current:{querySelector:selector=>selector.includes('saving')?busy?{}:null:dirty?{}:null}},optionWorkspaceReturn:{current:{productId:'synthetic-handoff',focusLabel:'선택한 옵션'}},optionBoardScope:{current:{productId:'synthetic-handoff'}},
  setCloseNotice:value=>actions.push(['notice',value]),setOptionBoardProduct:value=>actions.push(['board',value]),setOptionReturnFocus:value=>actions.push(['focus',value]),setDetail:value=>actions.push(['detail',value]),openSubmission:target=>{attempts.push(target);return accept;}};
 context.liveSubmissionContext={current:context.submissionContext};return{context,actions,attempts,run:module.exports.build(context)};
}

test('rejected quotation handoff preserves the editor, option-board return context and navigation generation',()=>{
 const f=fixture({accept:false}),original=JSON.stringify([f.context.optionWorkspaceReturn,f.context.optionBoardScope]);f.run('exact-profile');
 assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].product,f.context.detail);assert.equal(f.attempts[0].profileId,'exact-profile');assert.deepEqual(f.actions,[]);assert.equal(JSON.stringify([f.context.optionWorkspaceReturn,f.context.optionBoardScope]),original);assert.equal(f.context.productNavigation.current,7);
});

test('successful quotation handoff preserves explicit and queryless profile scopes and retires the source callback synchronously',()=>{
 for(const profileId of [undefined,'exact-profile']){const f=fixture();f.run(profileId);f.run('stale-other-profile');assert.equal(f.attempts.length,1,'the old workspace callback cannot replace the new review before its first render');assert.equal(f.attempts[0].product,f.context.detail);assert.equal(f.attempts[0].profileId,profileId);assert.equal(f.context.optionWorkspaceReturn.current,null);assert.equal(f.context.optionBoardScope.current,null);assert.deepEqual(f.actions,[['board',null],['focus',undefined],['notice',''],['detail',null]]);assert.equal(f.context.productNavigation.current,8);}
});

test('dirty/saving/layout, batch, owner, unmount and navigation guards reject before any submission entry',()=>{
 const cases=[fixture({busy:true}),fixture({dirty:true}),fixture({layout:false}),...['batch','owner','unmounted','navigation','context'].map(reason=>{const f=fixture();if(reason==='batch')f.context.batchBusyRef.current=true;if(reason==='owner')f.context.settingsOperationRef.current.ownerId='other';if(reason==='unmounted')f.context.settingsOperationRef.current.mounted=false;if(reason==='navigation')f.context.productNavigation.current++;if(reason==='context')f.context.liveSubmissionContext.current={};return f;})];
 for(const f of cases){f.run('exact-profile');assert.equal(f.attempts.length,0);assert.ok(f.context.optionWorkspaceReturn.current);assert.ok(f.context.optionBoardScope.current);assert.equal(f.actions.some(([type])=>type==='detail'||type==='board'||type==='focus'),false);}
});
