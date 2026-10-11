export type RegistrationFilterCondition={operator:''|'gte'|'lte'|'eq'|'ne';value:string};
export type RegistrationColumnFilter={mode:'values';values:string[]}|{mode:'conditions';conditions:RegistrationFilterCondition[]};
export type RegistrationFilterChoice={value:string;count:number};
const collator=new Intl.Collator('ko-KR',{numeric:true,sensitivity:'base'});
export function registrationFilterChoices(values:string[]):RegistrationFilterChoice[]{
 const counts=new Map<string,number>();for(const value of values)counts.set(value,(counts.get(value)??0)+1);
 return [...counts].sort(([left],[right])=>collator.compare(left,right)).map(([value,count])=>({value,count}));
}
export function matchesRegistrationColumnFilter(value:string,filter:RegistrationColumnFilter|undefined,numeric=false):boolean{
 if(!filter)return true;
 if(filter.mode==='values')return filter.values.includes(value);
 return filter.conditions.every(condition=>{
  if(!condition.operator)return true;
  const expected=condition.value.trim();
  const actualText=value.replace(/장$/u,'').trim(),limitText=expected.replace(/장$/u,'').trim();
  const actual=numeric&&actualText?Number(actualText):NaN,limit=numeric&&limitText?Number(limitText):NaN;
  const numbers=numeric&&Number.isFinite(actual)&&Number.isFinite(limit);
  if(condition.operator==='eq')return numbers?actual===limit:value===expected;
  if(condition.operator==='ne')return numbers?actual!==limit:value!==expected;
  if(!expected||numeric&&!numbers)return false;
  const comparison=numbers?actual-limit:collator.compare(value,expected);
  return condition.operator==='gte'?comparison>=0:condition.operator==='lte'?comparison<=0:false;
 });
}
