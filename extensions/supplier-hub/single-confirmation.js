// Isolated extension UI. No page message can supply a human confirmation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Shared only with the following classic content script in the isolated world.
const yoofamSingleConfirmation=(()=>{
  let active=null;
  function prompt(input,{signal}={}){
    if(active||!document.documentElement||document.visibilityState!=='visible'||signal?.aborted)return Promise.resolve(false);
    return new Promise(resolve=>{
      let settled=false,timer,observer;const listeners=[],previousFocus=document.activeElement,approved=new Set(),checks=[];
      const host=document.createElement('div'),root=host.attachShadow({mode:'closed'});
      const finish=value=>{
        if(settled)return;settled=true;clearTimeout(timer);observer?.disconnect();
        for(const [target,type,listener] of listeners)target.removeEventListener(type,listener);
        host.remove();if(active===finish)active=null;
        try{if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}catch{/* Detached or inert prior focus cannot authorize an action. */}resolve(value);
      };
      active=finish;
      try{
      const listen=(target,type,listener)=>{listeners.push([target,type,listener]);target.addEventListener(type,listener);};
      const element=(tag,text,parent)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(parent)parent.appendChild(node);return node;};
      const style=element('style',undefined,root);
      style.textContent=':host{position:fixed!important;inset:0!important;z-index:2147483647!important;color:#14203b!important;font:14px/1.6 system-ui,sans-serif!important}.backdrop{position:absolute;inset:0;background:#07162ba8;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}.dialog{background:#fff;max-width:720px;width:100%;max-height:calc(100vh - 40px);overflow:auto;border-radius:12px;padding:24px;box-sizing:border-box;box-shadow:0 16px 70px #0005}.dialog h2{margin:0 0 12px;font-size:20px}.context{white-space:pre-wrap;overflow-wrap:anywhere;color:#485670}.terms{white-space:pre-wrap;overflow-wrap:anywhere;max-height:38vh;overflow:auto;border:1px solid #d8dfeb;padding:12px;background:#f7f9fc}.choice{display:flex;gap:10px;margin:16px 0}.choice input{flex:none;width:18px;height:18px;margin-top:4px}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}button{font:inherit;border:1px solid #ccd5e5;border-radius:6px;padding:8px 16px;background:#fff;color:#14203b;cursor:pointer}button.primary{background:#238dc9;color:#fff;border-color:#238dc9}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:3px solid #78caff;outline-offset:2px}';
      const overlay=element('div',undefined,root);overlay.className='backdrop';
      const dialog=element('section',undefined,overlay);dialog.className='dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','yoofam-single-confirm-title');dialog.tabIndex=-1;
      const stage=input.challenge.stage,label=stage==='productPage'?'가격 정보 약관 확인':stage==='imagePage'?'표시사항 연락처 약관 확인':'개별 견적서 제출 확인';
      const heading=element('h2',label,dialog);heading.id='yoofam-single-confirm-title';
      const memberLabel=Array.isArray(input.identity.members)?`포함 옵션 ${input.identity.members.length}개`: `옵션 ${input.identity.optionId}`;
      const context=element('p',`${input.identity.company.name} · ${input.identity.company.code}\n상품 ${input.identity.productId} · ${memberLabel}\n문서 ${input.challenge.docId}`,dialog);context.className='context';
      element('p',stage==='productPage'||stage==='imagePage'?'Supplier Hub에 표시된 아래 약관을 읽고 현재 단계의 동의를 확인해주세요.':'작성한 상품·옵션과 견적 내용을 확인한 뒤 제출해주세요.',dialog);
      const addChoice=(key,text)=>{
        const label=element('label',undefined,dialog);label.className='choice';const box=element('input',undefined,label);box.type='checkbox';box.checked=false;
        element('span',text,label);checks.push(box);
        listen(box,'click',event=>{if(!event.isTrusted){box.checked=false;approved.delete(key);}else if(box.checked)approved.add(key);else approved.delete(key);update();});
      };
      for(const item of input.challenge.items){
        if(item.title)element('h3',item.title,dialog);
        if(item.termsText){const terms=element('div',item.termsText,dialog);terms.className='terms';terms.tabIndex=0;}
        if(item.required)addChoice(item.key,item.text);else element('p',item.text,dialog);
      }
      if(!input.challenge.items.some(item=>item.required))addChoice('__local-submit','작성한 견적서와 옵션을 확인했으며 Supplier Hub에 제출합니다.');
      const actions=element('div',undefined,dialog);actions.className='actions';
      const cancel=element('button','취소',actions);cancel.type='button';
      const confirm=element('button',stage==='productPage'||stage==='imagePage'?'동의하고 다음 단계 계속':'확인하고 견적서 제출',actions);confirm.type='button';confirm.className='primary';confirm.disabled=true;
      function update(){confirm.disabled=approved.size!==checks.length||checks.some(box=>!box.checked);}
      listen(cancel,'click',event=>{if(event.isTrusted)finish(false);});
      listen(confirm,'click',event=>{if(!event.isTrusted||confirm.disabled)return;
        if(signal?.aborted||document.visibilityState!=='visible'||!host.isConnected||Date.now()>input.challenge.expiresAt||approved.size!==checks.length||checks.some(box=>!box.checked))finish(false);
        else finish(true);
      });
      listen(overlay,'click',event=>{if(event.isTrusted&&event.target===overlay)finish(false);});
      listen(root,'keydown',event=>{
        if(!event.isTrusted)return;
        if(event.key==='Escape'){event.preventDefault();finish(false);return;}
        if(event.key==='Tab'){
          const focusable=[...checks,cancel,confirm].filter(node=>!node.disabled),focused=root.activeElement,first=focusable[0],last=focusable.at(-1);
          if(event.shiftKey&&(focused===first||focused===dialog)){event.preventDefault();last.focus();}
          else if(!event.shiftKey&&(focused===last||focused===dialog)){event.preventDefault();first.focus();}
        }
      });
      listen(document,'visibilitychange',()=>{if(document.visibilityState!=='visible')finish(false);});
      listen(window,'pagehide',()=>finish(false));
      if(signal)listen(signal,'abort',()=>finish(false));
      timer=setTimeout(()=>finish(false),Math.max(0,input.challenge.expiresAt-Date.now()));
      document.documentElement.appendChild(host);dialog.focus({preventScroll:true});
      if(typeof MutationObserver==='function'){observer=new MutationObserver(()=>{if(!host.isConnected)finish(false);});observer.observe(document.documentElement,{childList:true});}
      }catch{finish(false);}
    });
  }
  return Object.freeze({prompt});
})();
