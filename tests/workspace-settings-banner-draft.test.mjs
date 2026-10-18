import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
const image=(name='local.png',bytes=png,type='image/png')=>new File([bytes],name,{type});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function until(check){for(let i=0;i<60;i++){if(check())return;await Promise.resolve();}assert.ok(check(),'controlled callback should reach its checkpoint');}

// Actual production component callbacks and validators; only React scheduling,
// blob URLs and upload transport are controlled. No account/product is written.
function harness({ownerId='local-yun',settings={},upload,onSave}={}){
 const cache=new Map(),calls=[],saveAttempts=[],busy=[],created=[],revoked=[];let active,closed=0,latePublications=0;
 let instance,props;
 const localURL={createObjectURL(file){const url='blob:local/'+(created.length+1);created.push({url,file});return url;},revokeObjectURL(url){revoked.push(url);}};
 const hooks={
  useState(initial){const i=active.index++,target=active;if(!(i in target.slots))target.slots[i]={kind:'state',value:typeof initial==='function'?initial():initial};return[target.slots[i].value,value=>{if(!target.alive){latePublications++;return;}target.slots[i].value=typeof value==='function'?value(target.slots[i].value):value;}];},
  useRef(initial){const i=active.index++;return active.slots[i]??(active.slots[i]={current:initial});},
  useLayoutEffect(callback,deps){const i=active.index++,target=active,previous=target.slots[i];if(!previous||!deps||deps.some((value,j)=>!Object.is(value,previous.deps[j]))){target.effects.push(()=>{previous?.cleanup?.();target.slots[i]={kind:'effect',deps,cleanup:callback()};});}},
 };
 const fetcher=async(path,init)=>{
  assert.equal(path,'/api/files');assert.equal(init.method,'POST');assert.equal(init.signal.aborted,false);
  const file=init.body.get('file');assert.ok(file instanceof File);
  const call={path,init,file,ownerId:props.workspaceOwnerId};calls.push(call);
  return upload?upload(call,calls.length):Response.json({key:call.ownerId+'/banner-'+calls.length+'.png'});
 };
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,File,Blob,FormData,AbortController,URL:localURL,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,fetch:fetcher,
    require(name){if(name==='react')return hooks;if(name==='@/app/components/settings-price-preview')return{SettingsPricePreview:()=>null,SettingsPriceRatio:()=>null};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});
  return exports;
 }
 const Editor=load('app/components/workspace-settings-editor.tsx').WorkspaceSettingsEditor;
 const initial={...load('app/workspace-settings.ts').newWorkspaceSettings,brand:'직접 설정 브랜드',topImageEnabled:true,bottomImageEnabled:true,...settings};
 const close=()=>{closed++;unmount();};
 function mount(id,value=initial){instance={slots:[],index:0,effects:[],alive:true};props={workspaceOwnerId:id,value,onBusy:value=>busy.push(value),onClose:close,onSave:async value=>{saveAttempts.push({ownerId:id,value:plain(value)});await onSave?.(value,id);}};return render();}
 function render(){active=instance;instance.index=0;instance.effects=[];const tree=Editor(props);instance.effects.splice(0).forEach(commit=>commit());return tree;}
 function unmount(){if(!instance.alive)return;instance.alive=false;for(const slot of instance.slots)if(slot?.kind==='effect')slot.cleanup?.();}
 const control=label=>{const all=nodes(render()),named=all.find(node=>node.props?.['aria-label']===label&&node.type==='input');if(named)return named;const parent=all.find(node=>node.type==='label'&&nodes(node.props.children).some(child=>child.type==='span'&&child.props.children===label));return parent&&nodes(parent).find(node=>['input','select','textarea'].includes(node.type));};
 const group=key=>nodes(render()).find(node=>node.props?.role==='group'&&node.props['aria-label']===(key==='top'?'공통 상단 이미지':'공통 하단 이미지'));
 const input=key=>control((key==='top'?'공통 상단 이미지':'공통 하단 이미지')+' 업로드');
 function choose(key,file){const event={target:{files:[file],value:'C:\\fakepath\\'+file.name}};input(key).props.onChange(event);assert.equal(event.target.value,'');}
 const clear=key=>nodes(group(key)).find(node=>node.type==='button'&&text(node)==='선택 해제').props.onClick();
 const preview=key=>nodes(group(key)).find(node=>node.type==='img')?.props.src;
 const toggle=(key,value)=>control(key==='top'?'상단 이미지 사용':'하단 이미지 사용').props.onChange({target:{checked:value}});
 mount(ownerId);
 return{initial,calls,saveAttempts,busy,created,revoked,load,render,control,group,input,choose,clear,preview,toggle,unmount,
  save:()=>render().props.onSubmit({preventDefault(){}}),get closed(){return closed;},get latePublications(){return latePublications;},
  cancel(){nodes(render()).find(node=>node.type==='button'&&text(node)==='취소').props.onClick();},
  switchOwner(id,value){unmount();mount(id,value??{...initial,brand:'새 계정 브랜드'});},
 };
}

test('selection, replacement, same-file reselection, clearing and cancel are local and retain the enable switch',()=>{
 const f=harness({settings:{topImageKey:'local-yun/saved.png'}}),before=JSON.stringify(f.initial),first=image('first.png');
 f.choose('top',first);const firstUrl=f.preview('top');assert.match(firstUrl,/^blob:/);assert.equal(f.calls.length,0);
 f.choose('top',first);const secondUrl=f.preview('top');assert.notEqual(secondUrl,firstUrl);assert.deepEqual(f.revoked,[firstUrl]);
 f.choose('top',image('replacement.png'));const thirdUrl=f.preview('top');assert.deepEqual(f.revoked,[firstUrl,secondUrl]);
 f.clear('top');assert.equal(f.preview('top'),undefined);assert.equal(f.control('상단 이미지 사용').props.checked,true);assert.deepEqual(f.revoked,[firstUrl,secondUrl,thirdUrl]);
 f.choose('bottom',image('footer.png'));const footer=f.preview('bottom');f.cancel();assert.equal(f.closed,1);assert.ok(f.revoked.includes(footer));
 assert.equal(f.calls.length,0);assert.equal(f.saveAttempts.length,0);assert.equal(JSON.stringify(f.initial),before);assert.equal(f.latePublications,0);
});

test('drop and paste share local selection and save pending files even after their switches are disabled',async()=>{
 const f=harness();let prevented=0;const top=image('drop.png'),bottom=image('paste.png');
 f.group('top').props.onDrop({preventDefault(){prevented++;},dataTransfer:{files:[top]}});
 f.group('bottom').props.onPaste({preventDefault(){prevented++;},clipboardData:{files:[bottom]}});
 assert.equal(prevented,2);assert.equal(f.calls.length,0);assert.match(f.preview('top'),/^blob:/);assert.match(f.preview('bottom'),/^blob:/);
 f.toggle('top',false);f.toggle('bottom',false);assert.equal(f.group('top'),undefined);
 await f.save();assert.deepEqual(f.calls.map(call=>call.file.name),['drop.png','paste.png']);assert.equal(f.saveAttempts.length,1);
 const value=f.saveAttempts[0].value;assert.equal(value.topImageEnabled,false);assert.equal(value.bottomImageEnabled,false);assert.equal(value.topImageKey,'local-yun/banner-1.png');assert.equal(value.bottomImageKey,'local-yun/banner-2.png');
 f.unmount();assert.deepEqual([...f.revoked].sort(),f.created.map(item=>item.url).sort());
});

test('save uploads top then bottom before settings save and leaves every other setting exact',async()=>{
 const order=[],f=harness({upload:async(call,index)=>{order.push('upload:'+call.file.name);return Response.json({key:'local-yun/accepted-'+index+'.png'});},onSave:async()=>{order.push('settings');}}),before=plain(f.initial);
 f.choose('top',image('top.png'));f.choose('bottom',image('bottom.png'));assert.deepEqual(order,[]);
 await f.save();assert.deepEqual(order,['upload:top.png','upload:bottom.png','settings']);assert.deepEqual(f.busy,[true,false]);
 const expected={...before,topImageKey:'local-yun/accepted-1.png',bottomImageKey:'local-yun/accepted-2.png'};assert.deepEqual(f.saveAttempts[0].value,expected);assert.deepEqual(f.initial,before);
 await f.save();assert.equal(f.calls.length,2,'a second save of the same acknowledged files must reuse their keys');assert.equal(f.saveAttempts.length,2);f.unmount();
});

test('a bottom upload failure keeps both previews and reuses the successful top upload on retry',async()=>{
 const f=harness({upload:async(call,index)=>index===2?Response.json({error:'local bottom failure'},{status:503}):Response.json({key:'local-yun/accepted-'+index+'.png'})});
 const top=image('top.png');f.choose('top',top);f.choose('bottom',image('bottom.png'));const topUrl=f.preview('top'),bottomUrl=f.preview('bottom');
 await f.save();assert.equal(f.calls.length,2);assert.equal(f.saveAttempts.length,0);assert.match(text(f.render()),/local bottom failure/);assert.equal(f.preview('top'),topUrl);assert.equal(f.preview('bottom'),bottomUrl);
 f.choose('top',top);assert.notEqual(f.preview('top'),topUrl,'explicit reselection still updates its local preview');
 await f.save();assert.deepEqual(f.calls.map(call=>call.file.name),['top.png','bottom.png','bottom.png']);assert.equal(f.saveAttempts.length,1);assert.equal(f.saveAttempts[0].value.topImageKey,'local-yun/accepted-1.png');assert.equal(f.saveAttempts[0].value.bottomImageKey,'local-yun/accepted-3.png');f.unmount();
});

test('settings save failure retains pending previews and uploaded keys while subsequent manual edits remain saveable',async()=>{
 let attempts=0;const f=harness({onSave:async()=>{if(++attempts===1)throw Error('local settings failure');}});
 f.choose('top',image());const preview=f.preview('top');await f.save();assert.equal(f.calls.length,1);assert.match(text(f.render()),/local settings failure/);assert.equal(f.preview('top'),preview);assert.equal(f.revoked.length,0);
 f.control('브랜드명').props.onChange({target:{value:'수정해 다시 저장한 브랜드'}});await f.save();assert.equal(f.calls.length,1);assert.equal(f.saveAttempts.length,2);assert.equal(f.saveAttempts[1].value.brand,'수정해 다시 저장한 브랜드');assert.equal(f.saveAttempts[1].value.topImageKey,f.saveAttempts[0].value.topImageKey);f.unmount();
});

test('invalid metadata does not replace a valid pending file or authorize an upload',async()=>{
 const f=harness();f.choose('top',image('valid.png'));const preview=f.preview('top');
 const invalid=[image('empty.png',new Uint8Array()),image('text.txt',png,'text/plain'),image('oversized.png',new Uint8Array(10*1024*1024+1)),{name:'forged.png',type:'image/png',size:8}];
 for(const file of invalid){f.choose('top',file);assert.equal(f.preview('top'),preview);assert.equal(f.created.length,1);assert.equal(f.calls.length,0);assert.ok(nodes(f.render()).some(node=>node.props?.role==='alert'));}
 await f.save();assert.equal(f.calls.length,1);assert.equal(f.calls[0].file.name,'valid.png');f.unmount();
});

test('invalid or unfinished ordinary settings stop before file uploads and never persist a blob preview URL',async()=>{
 const f=harness();f.choose('top',image());const preview=f.preview('top');
 for(const value of ['-1','']){
  f.control('적용환율 (CNY → KRW)').props.onChange({target:{value}});await f.save();
  assert.equal(f.calls.length,0);assert.equal(f.saveAttempts.length,0);assert.equal(f.preview('top'),preview);
 }
 f.control('적용환율 (CNY → KRW)').props.onChange({target:{value:'350'}});await f.save();
 assert.equal(f.calls.length,1);assert.equal(f.saveAttempts.length,1);assert.equal(f.saveAttempts[0].value.exchangeRate,350);
 assert.equal(f.saveAttempts[0].value.topImageKey,'local-yun/banner-1.png');assert.doesNotMatch(JSON.stringify(f.saveAttempts[0].value),/blob:/);f.unmount();
});

test('a forged image body rejected by the real byte validator cannot trigger settings save',async()=>{
 let f;f=harness({upload:async call=>{try{f.load('app/image-files.ts').imageFileType(new Uint8Array(await call.file.arrayBuffer()));return Response.json({key:'local-yun/validated.png'});}catch{return Response.json({error:'local invalid image bytes'},{status:400});}}});
 f.choose('top',image('forged.png',new Uint8Array([1,2,3])));const preview=f.preview('top');await f.save();assert.equal(f.saveAttempts.length,0);assert.equal(f.preview('top'),preview);assert.match(text(f.render()),/local invalid image bytes/);f.unmount();
});

test('foreign, malformed or lost upload acknowledgements leave settings unsaved and preserve pending preview',async()=>{
 for(const response of [()=>Response.json({key:'local-other/private.png'}),()=>Response.json({key:'https://outside.invalid/file.png'}),()=>Response.json({key:'local-yun/../unsafe.png'}),()=>Response.json(null),()=>new Response('{broken',{headers:{'content-type':'application/json'}}),()=>{throw Error('local acknowledgement lost');}]){
  const f=harness({upload:response});f.choose('top',image());const preview=f.preview('top');await f.save();assert.equal(f.saveAttempts.length,0);assert.equal(f.preview('top'),preview);assert.deepEqual(f.busy,[true,false]);f.unmount();
 }
});

test('busy state rejects retained choose, drop, paste, clear, cancel and duplicate save callbacks',async()=>{
 const upload=deferred(),f=harness({upload:()=>upload.promise});f.choose('top',image('kept.png'));
 const group=f.group('top'),input=f.input('top'),clear=nodes(group).find(node=>node.type==='button'&&text(node)==='선택 해제'),cancel=nodes(f.render()).find(node=>node.type==='button'&&text(node)==='취소'),submit=f.render().props.onSubmit,preview=f.preview('top');
 const pending=f.save();await until(()=>f.calls.length===1);await submit({preventDefault(){}});
 input.props.onChange({target:{files:[image('blocked.png')],value:'x'}});group.props.onDrop({preventDefault(){},dataTransfer:{files:[image('blocked.png')]}});group.props.onPaste({preventDefault(){},clipboardData:{files:[image('blocked.png')]}});clear.props.onClick();cancel.props.onClick();
 assert.equal(f.preview('top'),preview);assert.equal(f.calls.length,1);assert.equal(f.closed,0);assert.equal(f.created.length,1);
 upload.resolve(Response.json({key:'local-yun/kept.png'}));await pending;assert.equal(f.saveAttempts.length,1);f.unmount();
});

test('each accessible preview button opens only its own chooser and rejects busy or unmounted callbacks',async()=>{
 const upload=deferred(),f=harness({upload:()=>upload.promise,settings:{topImageKey:'local-yun/top.png',bottomImageKey:'local-yun/bottom.png'}}),clicked=[];
 const top=f.input('top'),bottom=f.input('bottom');top.props.ref({click(){clicked.push('top');}});bottom.props.ref({click(){clicked.push('bottom');}});
 const button=key=>nodes(f.group(key)).find(node=>node.type==='button'&&node.props['aria-label']===(key==='top'?'공통 상단 이미지 변경':'공통 하단 이미지 변경'));
 const oldTop=button('top'),oldBottom=button('bottom');oldTop.props.onClick();oldBottom.props.onClick();assert.deepEqual(clicked,['top','bottom']);assert.equal(f.calls.length,0);
 f.choose('top',image());const pending=f.save();await until(()=>f.calls.length===1);oldTop.props.onClick();oldBottom.props.onClick();assert.deepEqual(clicked,['top','bottom']);assert.equal(button('top').props.disabled,true);
 f.unmount();oldTop.props.onClick();oldBottom.props.onClick();top.props.ref({click(){assert.fail('retired chooser ref must not be restored');}});
 upload.resolve(Response.json({key:'local-yun/late.png'}));await pending;assert.deepEqual(clicked,['top','bottom']);assert.equal(f.saveAttempts.length,0);assert.equal(f.latePublications,0);
});

test('unmount cancels the pending operation and ignores its late acknowledgement and retained callbacks',async()=>{
 const upload=deferred(),f=harness({upload:()=>upload.promise});f.choose('top',image());const input=f.input('top'),submit=f.render().props.onSubmit,preview=f.preview('top');
 const pending=f.save();await until(()=>f.calls.length===1);f.unmount();assert.equal(f.calls[0].init.signal.aborted,true);assert.ok(f.revoked.includes(preview));assert.deepEqual(f.busy,[true,false]);
 input.props.onChange({target:{files:[image('old.png')],value:'x'}});await submit({preventDefault(){}});upload.resolve(Response.json({key:'local-yun/late.png'}));await pending;
 assert.equal(f.saveAttempts.length,0);assert.equal(f.calls.length,1);assert.deepEqual(f.busy,[true,false]);assert.equal(f.latePublications,0);
});

test('an account-key remount cannot publish an old upload into the new company or release its newer busy state',async()=>{
 const oldUpload=deferred(),newUpload=deferred(),f=harness({upload:call=>call.ownerId==='local-yun'?oldUpload.promise:newUpload.promise});
 f.choose('top',image('old.png'));const oldPending=f.save();await until(()=>f.calls.length===1);f.switchOwner('local-waih');assert.equal(f.preview('top'),undefined);
 f.choose('top',image('new.png'));const newPending=f.save();await until(()=>f.calls.length===2);assert.deepEqual(f.busy,[true,false,true]);
 oldUpload.resolve(Response.json({key:'local-yun/old.png'}));await oldPending;assert.equal(f.saveAttempts.length,0);assert.deepEqual(f.busy,[true,false,true]);
 newUpload.resolve(Response.json({key:'local-waih/new.png'}));await newPending;assert.equal(f.saveAttempts.length,1);assert.equal(f.saveAttempts[0].ownerId,'local-waih');assert.equal(f.saveAttempts[0].value.topImageKey,'local-waih/new.png');assert.equal(f.saveAttempts[0].value.brand,'새 계정 브랜드');assert.equal(f.latePublications,0);f.unmount();
});

test('an acknowledged key from a failed old-account save is never reused in the new account',async()=>{
 const file=image('same-file.png'),f=harness({upload:async call=>Response.json({key:call.ownerId+'/cached.png'}),onSave:async(_value,owner)=>{if(owner==='local-yun')throw Error('old account settings failure');}});
 f.choose('top',file);await f.save();assert.equal(f.calls.length,1);assert.equal(f.saveAttempts[0].value.topImageKey,'local-yun/cached.png');
 f.switchOwner('local-waih');f.choose('top',file);await f.save();assert.equal(f.calls.length,2);assert.equal(f.saveAttempts[1].value.topImageKey,'local-waih/cached.png');assert.equal(f.saveAttempts[1].ownerId,'local-waih');f.unmount();
});
