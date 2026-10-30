// Connected, inert DOM for listing UI tests. There are no browser tabs,
// credentials, network requests, product scripts or actual site contents.
export function listingPickerDom(){
 const elements=[],viewListeners=new Map();let focused=null;
 const connect=(node,value)=>{node.isConnected=value;for(const child of node.childNodes)connect(child,value);if(node.testShadow)connect(node.testShadow,value);};
 const matches=(node,selector)=>{
  if(!node||node.tag==='#text')return false;
  return selector.split(',').some(part=>{
   const token=part.trim(),tag=/^[a-z0-9]+/iu.exec(token)?.[0];
   if(tag&&node.tag!==tag.toLowerCase())return false;
   const checks=[...token.matchAll(/\[([\w-]+)(?:([*]?=)["']?([^\]"']*)["']?)?\]/gu)];
   if(checks.some(([,name,operator,value])=>{const actual=node.getAttribute(name);return actual===null||operator==='='&&actual!==value||operator==='*='&&!actual.includes(value);}))return false;
   return !!tag||checks.length>0;
  });
 };
 function element(tag){
  const attrs=new Map(),listeners=new Map();let ownText='';
  const node={tag:tag.toLowerCase(),childNodes:[],parentNode:null,isConnected:false,style:{cssText:'',display:'',visibility:''},checked:false,disabled:false,hidden:false,shadowRoot:null,
   get id(){return attrs.get('id')||'';},set id(value){attrs.set('id',String(value));},get className(){return attrs.get('class')||'';},set className(value){attrs.set('class',String(value));},
   get textContent(){return ownText+node.childNodes.map(child=>child.textContent).join('');},set textContent(value){ownText=String(value);for(const child of node.childNodes){child.parentNode=null;connect(child,false);}node.childNodes=[];},
   get firstChild(){return node.childNodes[0]||null;},get ownText(){return ownText;},
   setAttribute(name,value){attrs.set(name,String(value));},getAttribute(name){return attrs.get(name)??null;},removeAttribute(name){attrs.delete(name);},
   append(...children){for(const child of children){child.remove();child.parentNode=node;node.childNodes.push(child);connect(child,node.isConnected);}},
   insertBefore(child,before){child.remove();child.parentNode=node;const index=node.childNodes.indexOf(before);if(index<0)node.childNodes.push(child);else node.childNodes.splice(index,0,child);connect(child,node.isConnected);},
   replaceChildren(...children){for(const child of [...node.childNodes])child.remove();ownText='';node.append(...children);},
   remove(){if(node.parentNode){node.parentNode.childNodes=node.parentNode.childNodes.filter(child=>child!==node);node.parentNode=null;}connect(node,false);},
   attachShadow({mode}){const shadow=element('#shadow');node.testShadow=shadow;shadow.host=node;connect(shadow,node.isConnected);if(mode==='open')node.shadowRoot=shadow;return shadow;},
   querySelectorAll(selector){const found=[];const visit=current=>{for(const child of current.childNodes){if(matches(child,selector))found.push(child);visit(child);}};visit(node);return found;},
   closest(selector){let current=node;while(current){if(matches(current,selector))return current;current=current.parentNode;}return null;},
   addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(listener);},
   removeEventListener(type,listener){listeners.set(type,(listeners.get(type)||[]).filter(value=>value!==listener));},
   async emit(type,options={}){const event={type,isTrusted:true,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...options};await Promise.all((listeners.get(type)||[]).map(listener=>listener(event)));return event;},
   focus(){focused=node;},
  };elements.push(node);return node;
 }
 const documentElement=element('html');documentElement.isConnected=true;
 const document={documentElement,createElement:element,createTextNode(value){const node=element('#text');node.textContent=value;return node;},
  getElementById(id){const visit=node=>node.id===id?node:node.childNodes.map(visit).find(Boolean);return visit(documentElement)||null;},
  querySelectorAll(selector){return documentElement.querySelectorAll(selector);},
  defaultView:{addEventListener(type,listener){viewListeners.set(type,listener);},removeEventListener(type){viewListeners.delete(type);}},
 };
 function card(offerId,{fallback=false,title=`原文商品 ${offerId}`,thumbnail='https://cbu01.alicdn.com/img/test.jpg',price='¥ 4.60'}={}){
  const root=element(fallback?'a':'div');if(fallback){root.className='offerCard-item';root.setAttribute('href',`https://detail.1688.com/offer/${offerId}.html?from=listing`);}else{root.setAttribute('data-offer-grid-cell','');root.setAttribute('data-offer-id',offerId);}
  const link=fallback?root:element('a');if(!fallback){link.setAttribute('href',`https://detail.1688.com/offer/${offerId}.html?from=listing`);root.append(link);}
  const heading=element('h3');heading.textContent=title;const image=element('img');image.setAttribute('src',thumbnail);image.setAttribute('alt',title);const displayPrice=element('span');displayPrice.setAttribute('data-price',price);link.append(heading,image,displayPrice);documentElement.append(root);
  return {root,link,heading,image,displayPrice};
 }
 return {document,elements,card,element,matches,get focused(){return focused;},async pagehide(){await viewListeners.get('pagehide')?.();},find(label,tag='button'){return elements.find(node=>node.tag===tag&&node.textContent===label&&node.isConnected);}};
}

export function listingTimers(){
 let serial=0;const tasks=new Map();
 return {setTimeout(fn,ms){const id=++serial;tasks.set(id,{fn,ms});return id;},clearTimeout(id){tasks.delete(id);},get tasks(){return [...tasks.values()];},async run(ms){const ids=[...tasks].filter(([,task])=>task.ms===ms).map(([id])=>id);for(const id of ids){const task=tasks.get(id);tasks.delete(id);if(task)await task.fn();}await Promise.resolve();await Promise.resolve();}};
}
