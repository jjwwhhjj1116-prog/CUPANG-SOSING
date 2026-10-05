export type LoginPreferences={email:string;rememberEmail:boolean;rememberMe:boolean};
const key='yoofam.login.preferences.v1';
const defaults:LoginPreferences={email:'',rememberEmail:true,rememberMe:true};

export function readLoginPreferences():LoginPreferences{
 try{
  const value=JSON.parse(window.localStorage.getItem(key)??'null') as Partial<LoginPreferences>|null;
  if(!value||typeof value!=='object')return {...defaults};
  const rememberEmail=value.rememberEmail!==false;
  return {rememberEmail,rememberMe:value.rememberMe!==false,email:rememberEmail&&typeof value.email==='string'?value.email.slice(0,254):''};
 }catch{return {...defaults};}
}

export function saveLoginPreferences(preferences:LoginPreferences):void{
 try{
  // Persist only a display identifier and choices; credentials remain in the HttpOnly session.
  window.localStorage.setItem(key,JSON.stringify({email:preferences.rememberEmail?preferences.email.trim().toLowerCase().slice(0,254):'',rememberEmail:preferences.rememberEmail,rememberMe:preferences.rememberMe}));
 }catch{/* Storage-disabled browsers can still log in normally. */}
}
