import vm from 'node:vm';

// The observed company code lives in a menu, closed on a fresh Hub page.
// Run serialized extension functions against that visible-DOM lifecycle.
export function hubCompanyMenuPage({company,path,formReady=true}){
 let open=false,clicks=0;
 const menu={innerText:company.name,disabled:false,getClientRects:()=>[{}],click(){open=!open;clicks++;}};
 const input={disabled:false,readOnly:false,getClientRects:()=>[{}]};
 const label={innerText:'견적서 ID',getClientRects:()=>[{}]};
 const titles=['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.'];
 const document={body:{get innerText(){return [company.name,...(formReady?(path==='/qvt/registration'?titles:['견적서 ID']):[]),...(open?['Company Code: '+company.code]:[])].join('\n');}},
  documentElement:{dataset:{}},querySelectorAll(selector){
   if(selector==='button')return [menu];
   if(!formReady)return [];
   if(selector==='input[type="file"]')return [{},{},{}];
   if(selector==='input[id="quotationFile"][name="quotationFile"][type="text"]')return [input];
   if(selector==='label[for="quotationFile"]')return [label];
   return [];
  }};
 return {document,get clicks(){return clicks;},run:async(func,args=[])=>vm.runInNewContext(`(${func.toString()})(...args)`,{document,args,location:{origin:'https://supplier.coupang.com',pathname:path},setTimeout:callback=>queueMicrotask(callback)})};
}
