import {parse} from 'parse5';

// Complete inert HTML documents, including parent relationships. No browser,
// source request, frames or executable scripts are used by this fixture.
export function productDocument(html){
 const matches=(node,selector)=>selector.split(',').some(part=>{
  part=part.trim();const chain=part.split(/\s+(?![^\[]*\])/u);
  if(chain.length>1){const last=chain.pop();if(!matches(node,last))return false;for(let parent=node.parentElement;parent;parent=parent.parentElement)if(matches(parent,chain.join(' ')))return true;return false;}
  if(/^[a-z][\w-]*$/iu.test(part))return node.tagName===part.toUpperCase();
  const attribute=/^(?:([\w-]+))?\[([\w-]+)(?:(\*?=)"([^"]*)"( i)?)?\]$/u.exec(part);
  if(attribute){if(attribute[1]&&node.tagName!==attribute[1].toUpperCase())return false;const value=node.getAttribute(attribute[2]);if(!attribute[3])return value!==null;if(value===null)return false;const actual=attribute[5]?value.toLowerCase():value,wanted=attribute[5]?attribute[4].toLowerCase():attribute[4];return attribute[3]==='*='?actual.includes(wanted):actual===wanted;}
  const id=/^#([\w-]+)$/u.exec(part);if(id)return node.getAttribute('id')===id[1];
  const cls=/^(?:([\w-]+))?\.([\w-]+)$/u.exec(part);if(cls)return(!cls[1]||node.tagName===cls[1].toUpperCase())&&(node.getAttribute('class')??'').split(/\s+/u).includes(cls[2]);
  throw Error('Unsupported synthetic document selector: '+part);
 });
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
 const wrap=(raw,parent=null)=>{
  const node={tagName:raw.tagName?.toUpperCase(),nodeName:raw.nodeName,nodeType:raw.nodeName==='#text'?3:1,nodeValue:raw.value,children:[],childNodes:[],parentElement:parent,
   getAttribute:name=>raw.attrs?.find(pair=>pair.name===name)?.value??null,matches:selector=>matches(node,selector),closest(selector){for(let current=node;current;current=current.parentElement)if(matches(current,selector))return current;return null;},
   contains(other){for(let current=other;current;current=current.parentElement)if(current===node)return true;return false;},querySelectorAll:selector=>descendants(node).filter(child=>matches(child,selector)),querySelector:selector=>node.querySelectorAll(selector)[0]??null};
  node.childNodes=(raw.childNodes??[]).map(child=>wrap(child,node));node.children=node.childNodes.filter(child=>child.nodeType!==3);
  Object.defineProperty(node,'textContent',{get:()=>raw.nodeName==='#text'?raw.value:node.childNodes.map(child=>child.textContent).join('')});return node;
 };
 return wrap(parse(html));
}
