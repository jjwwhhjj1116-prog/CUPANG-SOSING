export const DATASETS = ['skus','watchTargets','discoveries','keywords','reviews','sourcingCandidates','comparisons','purchaseOrders','importBatches','purchaseLines','inventorySnapshots','inventoryLines','inboundEvents','sales','salesDeductions','adReports','adMetrics','campaigns','campaignSkus','expenseCategories','expenses','openingBalances','statementApprovals','periodClosures','jobs'] as const;
export type Dataset = typeof DATASETS[number];
export type Values = Record<string, unknown>;
export type OpsRecord = {id:string; values:Values; createdAt:string; updatedAt:string};
export type OperationsDocument = {schemaVersion:1; records:Record<Dataset,OpsRecord[]>};
export type OperationsScope = {ownerId:string;companyCode:string;companyName:string};
export type DerivedViews = Record<string,Values[]>;
export type OperationsSnapshot = {document:OperationsDocument; revision:number; scope:OperationsScope; accountContext:string; derived:DerivedViews; updatedAt:string|null};
export type OperationsCommand = {type:'upsert'|'remove'|'import'|'promote-candidate'|'confirm-expenses'|'close-period'|'reopen-period'|'receive-order'|'queue-job'|'cancel-job'|'sync-products'|'ingest-collection'; dataset?:Dataset; id?:string; values?:Values; rows?:Values[]; ids?:string[]; month?:string; kind?:string; source?:string};
export type Field = {key:string;label:string;type?:'text'|'number'|'date'|'month'|'textarea'|'select'|'checkbox'|'sku'|'campaign'|'batch';required?:boolean;options?:string[];optionLabels?:Record<string,string>;default?:unknown;hint?:string};
export type TableColumn = {key:string;label:string;format?:'money'|'number'|'percent'|'date'};
export type OperationsContext = {
 snapshot:OperationsSnapshot; year:number; month:string; search:string; busy:boolean; error?:string;
 command:(command:OperationsCommand)=>Promise<boolean>;
 notify:(message:string)=>void;
 collect?:(kind:string,values:Values,dataset?:Dataset)=>Promise<void>;
};
export function str(v:unknown){return v==null?'':String(v);}
export function num(v:unknown){const n=Number(v);return Number.isFinite(n)?n:0;}
export function records(ctx:OperationsContext,dataset:Dataset){return ctx.snapshot.document.records[dataset];}
export function derived(ctx:OperationsContext,key:string){return ctx.snapshot.derived[key]??[];}
export function selectedPeriod(ctx:OperationsContext){return ctx.month||String(ctx.year);}
