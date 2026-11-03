// Inert support for the one recorded module-only wrapper. Never call it or read
// window.context: only its supplied literal argument is product source data.
const wrapper='(function(b,d){var c=d.module||{};var e={};for(var a in c){if(typeof c[a]==="string"){e[a]=c[a]}}Object.assign(e,c[b]||{});Object.assign(d,{module:e});return d})(window.contextPath,';
const fail=()=>{throw Error('현재 상품의 context 원문 형식·크기·중복 항목을 확인하지 못했습니다.');};
export function readPageContextLiteral(code){
 if(typeof code!=='string'||code.length>4*1024*1024)fail();
 const prefix=/^\s*(?:window\.contextPath\s*=\s*"\/default"\s*;\s*)?window\.context\s*=\s*/u.exec(code);
 if(!prefix)return null;
 let index=prefix[0].length;if(!code.startsWith(wrapper,index))fail();index+=wrapper.length;
 while(/\s/u.test(code[index]??'')&&index<code.length)index++;
 if(code[index]!=='{')fail();const start=index,parts=[],stack=[];let entries=0;
 const key=(scope,value)=>{if(['__proto__','prototype','constructor'].includes(value)||scope.keys.has(value)||++entries>50000)fail();scope.keys.add(value);};
 for(;index<code.length&&index-start<=2*1024*1024;index++){
  const character=code[index],scope=stack.at(-1);
  if(character==='"'){
   const begin=index;let escaped=false,closed=false;
   for(index++;index<code.length&&index-start<=2*1024*1024;index++){
    if(escaped){escaped=false;continue;}if(code[index]==='\\'){escaped=true;continue;}
    if(code[index]==='"'){closed=true;break;}
   }
   if(!closed)fail();const token=code.slice(begin,index+1);let value;try{value=JSON.parse(token);}catch{fail();}
   if(scope?.object&&scope.key)key(scope,value);parts.push(token);continue;
  }
  if(scope?.object&&scope.key&&/[0-9]/u.test(character)){
   const token=/^(?:0|[1-9]\d{0,29})(?=\s*:)/u.exec(code.slice(index))?.[0];if(!token)fail();
   key(scope,token);parts.push(JSON.stringify(token));index+=token.length-1;continue;
  }
  if(character==='{'||character==='['){if(stack.length>=64)fail();stack.push({object:character==='{',key:character==='{',keys:new Set()});}
  else if(character==='}'||character===']'){
   if(!scope||scope.object!==(character==='}'))fail();stack.pop();parts.push(character);
   if(!stack.length){
    if(!/^\s*\)\s*;?\s*$/u.test(code.slice(index+1)))fail();
    const literal=parts.join('');if(new TextEncoder().encode(literal).byteLength>2*1024*1024)fail();
    let value;try{value=JSON.parse(literal);}catch{fail();}return {value,literal};
   }
   continue;
  }else if(character===','&&scope?.object)scope.key=true;
  else if(character===','&&scope&&!scope.object&&++entries>50000)fail();
  else if(character===':'&&scope?.object)scope.key=false;
  parts.push(character);
 }
 return fail();
}
