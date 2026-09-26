import { assetRoles, type AssetRole } from '@/app/product-content';
export type ImageDraft = Record<AssetRole,string[]>;
export type ImageStage = 'main'|'additional'|'detail'|undefined;
export function imageStageRoles(stage:ImageStage):AssetRole[] {
 return stage==='main'?['main','size','label']:stage==='additional'?['additional']:stage==='detail'?['detailTop','detail','detailBottom']:Object.keys(assetRoles) as AssetRole[];
}
/** Moving a file into this stage also removes its saved assignment elsewhere,
 * without saving unrelated edits made in another stage. */
export function imageStagePatch(initial:ImageDraft,draft:ImageDraft,stage:ImageStage):Partial<ImageDraft> {
 const roles=imageStageRoles(stage);const claimed=new Set(roles.flatMap(role=>draft[role]));const patch:Partial<ImageDraft>={};
 for(const role of Object.keys(assetRoles) as AssetRole[]){
  const next=roles.includes(role)?draft[role]:initial[role].filter(key=>!claimed.has(key));
  if(JSON.stringify(next)!==JSON.stringify(initial[role]))patch[role]=[...next];
 }
 return patch;
}
export function mergeSavedImageStage(initial:ImageDraft,draft:ImageDraft,saved:ImageDraft,stage:ImageStage):ImageDraft {
 const roles=imageStageRoles(stage);
 return Object.fromEntries((Object.keys(assetRoles) as AssetRole[]).map(role=>[role,[...(roles.includes(role)||JSON.stringify(draft[role])===JSON.stringify(initial[role])?saved[role]:draft[role])]])) as ImageDraft;
}
