import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {managedProductAccountContext} from '@/app/managed-products';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {applyOperationsCommand,deriveOperations,OperationsError,OPERATIONS_LIMIT} from '@/app/operations/engine';
import {readOperations,saveOperations,operationsProductRows,type StoredOperations} from '@/db/operations';
import type {OperationsScope,OperationsCommand,OperationsSnapshot} from '@/app/operations/types';

const headers={'cache-control':'no-store'},json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers});
const fail=(error:unknown)=>error instanceof OperationsError||error instanceof RequestBodyError?json({error:error.message,...(error instanceof OperationsError?{code:error.code}:{})},error.status):json({error:'운영관리 자료를 읽거나 저장하지 못했습니다. 입력을 유지하고 다시 시도해주세요.'},503);
const conflict=()=>new OperationsError('로그인 계정 또는 승인 회사가 바뀌었습니다. 최신 자료를 다시 확인해주세요.',409,'OPERATIONS_SCOPE_CHANGED');
function yearOf(request:Request){const value=new URL(request.url).searchParams.get('year')??String(new Date().getUTCFullYear());if(!/^\d{4}$/.test(value)||Number(value)<2000||Number(value)>2200)throw new OperationsError('조회 연도를 확인해주세요.');return Number(value);}
async function context(){const a=await managedProductAccess();if(!a)return null;return{scope:{ownerId:a.ownerId,companyCode:a.company.code,companyName:a.company.name},accountContext:await managedProductAccountContext(a.ownerId,a.company)};}
async function stillCurrent(expected:string){const c=await context();if(!c||c.accountContext!==expected)throw conflict();return c;}
function snapshot(stored:StoredOperations,scope:OperationsScope,accountContext:string,year:number):OperationsSnapshot{return{...stored,scope,accountContext,derived:deriveOperations(stored.document,year)};}
export async function GET(request:Request){
 const a=await context();if(!a)return json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},403);
 try{const year=yearOf(request),requested=new URL(request.url).searchParams.get('accountContext');if(requested!==null&&requested!==a.accountContext)throw conflict();const result=await readOperations(a.scope);await stillCurrent(a.accountContext);return json(snapshot(result,a.scope,a.accountContext,year));}catch(error){return fail(error);}
}
export async function POST(request:Request){
 const a=await context();if(!a)return json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},403);
 try{
  const year=yearOf(request);
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new OperationsError('같은 사이트에서 운영 자료를 저장해주세요.',403);
  const body=await readBoundedJson(request,OPERATIONS_LIMIT) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['expectedRevision','accountContext','command'].includes(k))||!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<0||typeof body.accountContext!=='string'||!body.command)throw new OperationsError('계정 범위·저장 버전·작업 내용을 확인해주세요.');
  if(body.accountContext!==a.accountContext)throw conflict();const stored=await readOperations(a.scope);if(stored.revision!==body.expectedRevision)throw new OperationsError('다른 창에서 자료가 변경되었습니다. 입력을 유지하고 최신 자료를 확인해주세요.',409,'OPERATIONS_CONFLICT');
  let command=body.command as OperationsCommand;
  if(command.type==='sync-products')command={type:'sync-products',rows:await operationsProductRows(a.scope)};
  const document=applyOperationsCommand(stored.document,command);await stillCurrent(a.accountContext);const result=await saveOperations(a.scope,stored.revision,document);await stillCurrent(a.accountContext);
  return json(snapshot(result,a.scope,a.accountContext,year));
 }catch(error){return fail(error);}
}
