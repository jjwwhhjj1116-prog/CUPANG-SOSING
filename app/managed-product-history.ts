export type ManagedHistoryState='missing'|'invalid'|'empty'|'valid';
export type ManagedHistoryChange={state:ManagedHistoryState;changedRecently:boolean;current:string;latest:{date:string;previous:string|null}|null};
export type ManagedProductHistory={productId:ManagedHistoryChange;price:ManagedHistoryChange;otherSellers:{state:ManagedHistoryState;matched:boolean|null;names:string[]};sourceImportPrice:{state:ManagedHistoryState;latest:{date:string;price:string}|null;value:number|null;noImport:boolean|null}};
export type NormalizedManagedHistory={productId:Omit<ManagedHistoryChange,'changedRecently'>&{latestAt:number|null};price:Omit<ManagedHistoryChange,'changedRecently'>&{latestAt:number|null};otherSellers:ManagedProductHistory['otherSellers'];sourceImportPrice:ManagedProductHistory['sourceImportPrice']};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const literal=(value:unknown):string|null=>typeof value==='string'?value:typeof value==='number'&&Number.isFinite(value)?String(value):null;
function decoded(raw:unknown):{state:ManagedHistoryState;value:unknown}{
 if(raw===undefined)return{state:'missing',value:null};if(raw===null||typeof raw==='string'&&!raw.trim())return{state:'empty',value:null};
 try{const value=typeof raw==='string'?JSON.parse(raw):raw;return{state:value===null?'empty':'valid',value};}catch{return{state:'invalid',value:null};}
}
function timestamp(value:unknown):number|null{
 // The observed predicate uses new Date(entry.date), including numeric epochs
 // and native Date.parse-compatible non-ISO strings. No SQL date guess is used.
 try{const at=new Date(value as string).getTime();return Number.isFinite(at)?at:null;}catch{return null;}
}
/** Same local-calendar rolling threshold, retaining the current time of day.
 * Future records are not excluded: the observed filter has no upper bound. */
export function managedHistoryCutoff(now=Date.now()):number{const date=new Date(now);if(!Number.isFinite(date.getTime()))throw Error('변경내역 조회 시각을 확인해주세요.');date.setDate(date.getDate()-7);return date.getTime();}
function history(raw:unknown,previousKey:string,current:string){
 const parsed=decoded(raw);let state=parsed.state,latestAt:number|null=null,latest:ManagedHistoryChange['latest']=null;
 if(state==='valid'){
  if(!Array.isArray(parsed.value))state='invalid';else if(!parsed.value.length)state='empty';else{
   for(const entry of parsed.value){if(!object(entry)||!Object.hasOwn(entry,'date'))continue;const at=timestamp(entry.date);if(at===null||latestAt!==null&&at<=latestAt)continue;latestAt=at;latest={date:new Date(at).toISOString(),previous:literal(entry[previousKey])};}
   if(latestAt===null)state='invalid';
  }
 }
 return{state,current,latest,latestAt};
}
function sourceImport(raw:unknown):ManagedProductHistory['sourceImportPrice']{
 const parsed=decoded(raw);let state=parsed.state,latestAt:number|null=null,latest:ManagedProductHistory['sourceImportPrice']['latest']=null,value:number|null=state==='missing'||state==='empty'?0:null,noImport:boolean|null=state==='missing'||state==='empty'?true:null;
 if(state==='valid'){
  if(!Array.isArray(parsed.value))state='invalid';else if(!parsed.value.length){state='empty';value=0;noImport=true;}else{
   let selected:Record<string,unknown>|null=null;
   for(const entry of parsed.value){if(!object(entry)||!Object.hasOwn(entry,'date'))continue;const at=timestamp(entry.date);if(at===null||latestAt!==null&&at<=latestAt)continue;latestAt=at;selected=entry;}
   if(latestAt===null||!selected)state='invalid';else{
    const rawPrice=selected['매입가'],price=rawPrice===undefined||rawPrice===null||rawPrice===false||rawPrice===''||typeof rawPrice==='string'&&!rawPrice.trim()?'0':literal(rawPrice);
    const effective=rawPrice||0;noImport=!effective||(effective as number)<=0;
    if(price===null||!Number.isFinite(Number(price)))state='invalid';else{value=Number(price);latest={date:new Date(latestAt).toISOString(),price};}
   }
  }
 }
 return{state,latest,value,noImport};
}
/** Derived read model only. The original cells, including malformed JSON and
 * unknown fields, are never normalized back into the seller's source. */
export function normalizeManagedProductHistory(values:Record<string,unknown>):NormalizedManagedHistory{
 const sellers=decoded(values.otherSellers);let otherSellers:ManagedProductHistory['otherSellers']={state:sellers.state,matched:null,names:[]};
 if(sellers.state==='valid')otherSellers=object(sellers.value)?{state:'valid',matched:Boolean(sellers.value.hasOtherSellers),names:Array.isArray(sellers.value.otherVendorNames)?sellers.value.otherVendorNames.filter((name):name is string=>typeof name==='string'&&!!name.trim()):[]}:{state:'invalid',matched:null,names:[]};
 return{productId:history(values.productIdHistory,'productId',literal(values['노출ID'])||literal(values.productId)||''),price:history(values.priceHistory,'price',literal(values['공급가'])??''),otherSellers,sourceImportPrice:sourceImport(values['매입정보'])};
}
export function managedProductHistoryView(value:NormalizedManagedHistory,cutoff:number):ManagedProductHistory{
 const change=(item:NormalizedManagedHistory['productId']):ManagedHistoryChange=>({state:item.state,current:item.current,latest:item.latest,changedRecently:item.latestAt!==null&&item.latestAt>=cutoff});
 return{productId:change(value.productId),price:change(value.price),otherSellers:value.otherSellers,sourceImportPrice:value.sourceImportPrice};
}
