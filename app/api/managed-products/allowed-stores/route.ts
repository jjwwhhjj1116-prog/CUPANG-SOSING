import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {managedProductAccountContext} from '@/app/managed-products';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {MANAGED_STORE_SETTINGS_BYTES,ManagedStoreSettingsError,managedStoreSettingsConflict,normalizeManagedVendorNames} from '@/app/managed-store-settings';
import {readManagedStoreSettings,managedStoreSettingsCurrent,saveManagedStoreSettings} from '@/db/managed-store-settings';

const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'no-store'}}),digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const failure=(error:unknown)=>error instanceof ManagedStoreSettingsError?json({error:error.message,code:error.code},error.status):error instanceof RequestBodyError?json({error:error.message},error.status):json({error:'허용 판매처 저장 결과를 확인하지 못했습니다. 입력을 유지하고 현재 저장본을 다시 확인해주세요.'},503);
async function accessCurrent(expected:string){const access=await managedProductAccess();if(!access||await managedProductAccountContext(access.ownerId,access.company)!==expected)throw managedStoreSettingsConflict();}
export async function GET(request:Request){
 const access=await managedProductAccess();if(!access)return json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},403);
 try{const params=new URL(request.url).searchParams,expected=params.get('expectedAccountContext');if([...params.keys()].some(key=>key!=='expectedAccountContext')||params.getAll('expectedAccountContext').length!==1||!digest(expected))throw new ManagedStoreSettingsError('허용 판매처를 조회할 현재 계정을 확인해주세요.');
  const account=await managedProductAccountContext(access.ownerId,access.company);if(account!==expected)throw managedStoreSettingsConflict();const snapshot=await readManagedStoreSettings(access.ownerId,access.company);await accessCurrent(account);if(!await managedStoreSettingsCurrent(access.ownerId,access.company,snapshot))throw managedStoreSettingsConflict();await accessCurrent(account);return json(snapshot.view);
 }catch(error){return failure(error);}
}
export async function PUT(request:Request){
 const access=await managedProductAccess();if(!access)return json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},403);
 try{if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new ManagedStoreSettingsError('같은 사이트에서 허용 판매처 설정을 저장해주세요.');if(new URL(request.url).search)throw new ManagedStoreSettingsError('허용 판매처 저장 요청의 경로를 확인해주세요.');
  const body=await readBoundedJson(request,MANAGED_STORE_SETTINGS_BYTES+2048) as Record<string,unknown>;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==4||Object.keys(body).some(key=>!['expectedAccountContext','expectedRevision','expectedInputFingerprint','allowedVendorNames'].includes(key))||!digest(body.expectedAccountContext)||!digest(body.expectedInputFingerprint)||!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<0||(body.expectedRevision as number)>=Number.MAX_SAFE_INTEGER||!Array.isArray(body.allowedVendorNames))throw new ManagedStoreSettingsError('검토한 허용 판매처 설정과 현재 저장 버전을 확인해주세요.');
  const account=await managedProductAccountContext(access.ownerId,access.company);if(account!==body.expectedAccountContext)throw managedStoreSettingsConflict();const names=normalizeManagedVendorNames(body.allowedVendorNames),snapshot=await readManagedStoreSettings(access.ownerId,access.company);
  if(snapshot.view.revision!==body.expectedRevision||snapshot.view.inputFingerprint!==body.expectedInputFingerprint)throw managedStoreSettingsConflict();await accessCurrent(account);const receipt=await saveManagedStoreSettings(access.ownerId,access.company,snapshot,names);await accessCurrent(account);
  const saved=await readManagedStoreSettings(access.ownerId,access.company),same=JSON.stringify(snapshot.view.allowedVendorNames)===JSON.stringify(names),expectedRevision=snapshot.source&&same?snapshot.view.revision:snapshot.view.revision+1;
  if(saved.view.revision!==expectedRevision||saved.view.updatedAt!==receipt.updatedAt||JSON.stringify(saved.view.allowedVendorNames)!==JSON.stringify(names)||!await managedStoreSettingsCurrent(access.ownerId,access.company,saved))throw managedStoreSettingsConflict();await accessCurrent(account);return json(saved.view);
 }catch(error){return failure(error);}
}
