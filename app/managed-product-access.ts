import {getChatGPTUser} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';

export async function managedProductAccess(){
 const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
 if(!company||!user?.membership||user.membership.id!==user.userId)return null;
 return {ownerId:user.userId,company};
}
