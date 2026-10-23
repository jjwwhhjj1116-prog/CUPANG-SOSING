/** Minimal connected DOM for the shipped collector's host/lease lifecycle.
 * No source selectors, network, timers or page scripts are executed here. */
export function pageCollectorDom({title='합성 원문',scripts=[],querySelector=()=>null,querySelectorAll=()=>[]}={}){
 const elements=[];
 function connect(node,value){node.isConnected=value;for(const child of node.childNodes)connect(child,value);for(const child of node.testShadow?.childNodes??[])connect(child,value);}
 function element(tag){
  const attributes=new Map(),styleValues=new Map();let cssText='';
  const style={get cssText(){return cssText;},set cssText(value){cssText=value;styleValues.clear();for(const field of value.split(';')){const index=field.indexOf(':');if(index>=0)styleValues.set(field.slice(0,index).trim(),field.slice(index+1).trim());}attributes.set('style',value);},get length(){return styleValues.size;},get position(){return styleValues.get('position')??'';},get right(){return styleValues.get('right')??'';},get bottom(){return styleValues.get('bottom')??'';},get zIndex(){return styleValues.get('z-index')??'';}};
  const node={tag,localName:tag.toLowerCase(),style,childNodes:[],isConnected:false,shadowRoot:null,textContent:'',disabled:false,hidden:false,title:'',parent:null,
   get id(){return attributes.get('id')??'';},set id(value){attributes.set('id',value);},get attributes(){return [...attributes].map(([name,value])=>({name,value}));},
   setAttribute(name,value){attributes.set(name,String(value));},getAttribute(name){return attributes.get(name)??null;},removeAttribute(name){attributes.delete(name);},
   append(...children){for(const child of children){child.parent=node;node.childNodes.push(child);connect(child,node.isConnected);}},
   remove(){if(node.parent)node.parent.childNodes=node.parent.childNodes.filter(child=>child!==node);node.parent=null;connect(node,false);},
   attachShadow({mode}){const shadow={childNodes:[],append(...children){for(const child of children){child.parent=shadow;shadow.childNodes.push(child);connect(child,node.isConnected);}}};node.testShadow=shadow;if(mode==='open')node.shadowRoot=shadow;return shadow;},
   addEventListener(type,listener){if(type==='click')node.click=listener;}};
  elements.push(node);return node;
 }
 const documentElement=element('html');documentElement.isConnected=true;
 const document={title,scripts,documentElement,createElement:element,querySelector,querySelectorAll,getElementById(id){const visit=node=>node.id===id?node:node.childNodes.map(visit).find(Boolean);return visit(documentElement)??null;}};
 return {document,elements};
}
