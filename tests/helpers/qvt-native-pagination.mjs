import fs from 'node:fs';
import vm from 'node:vm';
import * as parse5 from 'parse5';

// Small inert DOM for serialized page readers. It parses retained markup; no
// vendor JavaScript, browser APIs, clipboard or remote requests are executed.
export const css={root:'_2rJmZwpWK6AkvdeVOL1bZs',item:'_3oMgfdzXLjxSxO_d0iK9z5',active:'_2pdnZ_VjGkLzJF5y1X3O-4',disabled:'_1H2KZYPdwpNDFms8Cnn5Jq',first:'_1GYxV0xthnO8RlMLUrpvLd',previous:'_3UdPicq8SQhncPE0mT6xld',forward:'tOfUlMHROQa_ehrySEQmm',last:'V0kzo79OFKevPhLFGB8kc'};
export const company={code:'A01526306',name:'유앤채'};
export const query={startDate:'2026-10-01',endDate:'2026-10-19',status:'전체',title:''};
export const quotationId='synthetic-quotation';
export const headers=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
const fixture=new URL('../fixtures/hub-qvt-pagination-20261019.html',import.meta.url);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function nativeMarkup(current=1,end=6){
 const first=Math.floor((current-1)/10)*10+1,last=Math.min(end,first+9),forward=first+10>=end?0:first+10;
 const control=(token,target,label,disabled=false)=>`<li class="${token}${disabled?' '+css.disabled:''}"><a data-page="${target}">${escape(label)}</a></li>`;
 return `<ul class="pagination ${css.root}">${control(css.first,1,'<<',current===1)}${control(css.previous,first===1?0:first-1,'<',first===1)}${Array.from({length:last-first+1},(_,i)=>control(css.item+(first+i===current?' '+css.active:''),first+i,String(first+i))).join('')}${control(css.forward,forward,'>',forward===0)}${control(css.last,end,'>>',current===last)}</ul>`;
}
function simple(node,selector){
 let rest=selector.trim(),tag=rest.match(/^[a-zA-Z][\w-]*/)?.[0];
 if(tag){if(node.tagName!==tag.toUpperCase())return false;rest=rest.slice(tag.length);}
 while(rest){
  let match;if((match=/^\.([\w-]+)/.exec(rest))){if(!(node.getAttribute('class')??'').split(/\s+/).includes(match[1]))return false;}
  else if((match=/^#([\w-]+)/.exec(rest))){if(node.getAttribute('id')!==match[1])return false;}
  else if((match=/^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))){if(node.getAttribute(match[1])===null||match[2]!==undefined&&node.getAttribute(match[1])!==match[2])return false;}
  else return false;rest=rest.slice(match[0].length);
 }return true;
}
function matches(node,selector){return selector.split(',').some(part=>{const chain=part.trim().split(/\s+/);let current=node;if(!simple(current,chain.pop()))return false;while(chain.length){const part=chain.pop();current=current.parentElement;while(current&&!simple(current,part))current=current.parentElement;if(!current)return false;}return true;});}
export class Element{
 constructor(raw,parent=null){this.raw=raw;this.parentElement=parent;this.childNodes=(raw.childNodes??[]).map(child=>new Element(child,this));this.tagName=raw.tagName?.toUpperCase()??'';}
 get children(){return this.childNodes.filter(child=>child.tagName);}
 get innerText(){if(this.raw.nodeName==='#text')return this.raw.value;if(this.tagName==='BR')return '\n';return this.childNodes.map(child=>child.innerText+(['DIV','P','BR','LI','TR'].includes(child.tagName)?'\n':'')).join('');}
 getAttribute(name){return this.raw.attrs?.find(attr=>attr.name===name)?.value??null;}
 setAttribute(name,value){this.raw.attrs??=[];const attr=this.raw.attrs.find(attr=>attr.name===name);if(attr)attr.value=String(value);else this.raw.attrs.push({name,value:String(value)});}
 get value(){return this.currentValue??this.getAttribute('value')??'';}set value(value){this.currentValue=value;}
 get type(){return this.getAttribute('type')??'';}
 get disabled(){return this.getAttribute('disabled')!==null;}
 get readOnly(){return this.getAttribute('readonly')!==null;}
 get checked(){return this.currentChecked??this.getAttribute('checked')!==null;}set checked(value){this.currentChecked=value;}
 getClientRects(){return this.hidden?[]:[{}];}
 matches(selector){return matches(this,selector);}
 querySelectorAll(selector){const result=[];for(const child of this.children){if(child.matches(selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
 contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
 dispatchEvent(){}
 click(){this.onClick?.();}
}
export function parsed(html){return new Element(parse5.parseFragment(html));}
export function retainedPager(){return fs.readFileSync(fixture,'utf8');}
export function qvtHarness({mode='single',quotation=quotationId,start=1,end=6,company:account=company,pager:customPager,mutate,skip=false,changedCompany=false,changedFilter=false,unrelated=false,href,capturedPages,total=end,requestQuery=query}={}){
 let current=start,observer,searches=0,moves=0;const timers=new Map(),actions=[];
 const controls=parsed(`<div>${['productName','quotationFile','barcode','skuId','sourcingChannelId','isReplyNeeded'].map(id=>`<input type="${id==='isReplyNeeded'?'checkbox':'text'}" id="${id}" name="${id}" value="${id==='quotationFile'&&mode==='single'?quotation:''}">`).join('')}<select id="state"></select><select id="progress"></select><input type="text" placeholder="date" value="${query.startDate}"><input type="text" placeholder="date" value="${query.endDate}"><button data-action="reset">재설정</button><button data-action="search">검색</button><button data-action="company">${account.name}</button></div>`);
 let table,pager;
 const doc={get body(){return{innerText:`Company Code: ${changedCompany&&moves? 'A99999999':account.code} ${total}개 검색됨`};},querySelectorAll(selector){return[...controls.querySelectorAll(selector),...(table.matches(selector)?[table]:[]),...table.querySelectorAll(selector),...(pager.matches(selector)?[pager]:[]),...pager.querySelectorAll(selector)];}};
 function render(notify=false){
  const old=table;
  table=parsed(capturedPages?.[current-1]?.table??`<table><thead><tr>${headers.map(text=>`<th>${text}</th>`).join('')}</tr></thead><tbody><tr>${['합성 상품 '+current,'2026/10/19 10:00:00','합성 카테고리 (991742)','-','-',quotationId,'synthetic-sku-'+current,'상품 검수중','가격/정책'].map(text=>`<td>${text}</td>`).join('')}</tr></tbody></table>`).querySelector('table');
  pager=parsed(customPager??capturedPages?.[current-1]?.pager??nativeMarkup(current,end)).querySelector('ul');mutate?.(pager,current);
  for(const anchor of pager.querySelectorAll('a[data-page]')){if(href)anchor.setAttribute('href',href);anchor.onClick=()=>{actions.push({kind:'page',label:anchor.innerText,target:Number(anchor.getAttribute('data-page'))});moves++;current=Number(anchor.getAttribute('data-page'))+(skip?1:0);if(changedFilter)controls.querySelector('input#productName').value='changed';render(true);};}
  if(notify)observer?.([{type:'childList',target:unrelated?{}:old,addedNodes:unrelated?[]:[table]}]);
 }
 render();controls.querySelector('[data-action="reset"]').onClick=()=>{for(const control of controls.querySelectorAll('input,select')){control.value='';control.checked=false;}current=1;};
 controls.querySelector('[data-action="search"]').onClick=()=>{searches++;actions.push({kind:'search'});current=1;render(true);};
 const context=vm.createContext({document:doc,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims',href:'https://supplier.coupang.com/qvt/wims'},URL,Date,TextEncoder,Error,Set,Map,HTMLInputElement:Element,HTMLSelectElement:Element,Event:class{constructor(type){this.type=type;}},MutationObserver:class{constructor(callback){observer=callback;}observe(){}disconnect(){observer=null;}},setTimeout(callback,ms){timers.set(callback,ms);return callback;},clearTimeout(callback){timers.delete(callback);}});
 const run=(fn,...args)=>vm.runInContext(`(${fn.toString()})(...__args)`,Object.assign(context,{__args:args}));
 async function settle(pending){let done=false,value,error;Promise.resolve(pending).then(result=>{done=true;value=result;},cause=>{done=true;error=cause;});for(let i=0;i<1000&&!done;i++){await Promise.resolve();for(const[callback,ms]of[...timers])if(ms===350){timers.delete(callback);callback();}}if(!done){for(const callback of [...timers.keys()])callback();await Promise.resolve();await Promise.resolve();}if(error)throw error;if(!done)throw Error('Local QVT fixture did not settle');return value;}
 return{run,settle,actions,timers,requestQuery,get pager(){return pager;},get current(){return current;},get searches(){return searches;},get moves(){return moves;}};
}
