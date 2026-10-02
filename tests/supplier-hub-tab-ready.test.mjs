import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierHubUploadReady,supplierHubStatusReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {hubCompanyMenuPage} from './helpers/hub-company-menu.mjs';

const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
for(const company of companies)for(const [path,ready] of [['/qvt/registration',supplierHubUploadReady],['/qvt/wims',supplierHubStatusReady]])test(`a loaded ${path} form reaches exact company verification with its menu initially closed (${company.code})`,async()=>{
 const page=hubCompanyMenuPage({company,path});
 assert.equal(await page.run(ready),true,'form readiness must not depend on a later company-menu click');
 assert.equal(page.clicks,0);assert.equal(page.document.body.innerText.includes('Company Code:'),false);
 assert.equal((await page.run(verifySupplierHubCompany,[company])).code,company.code);assert.equal(page.clicks,1);
 assert.equal(await page.run(ready),true);
});
test('form loading and exact company verification remain separate checks',async()=>{
 for(const [path,ready] of [['/qvt/registration',supplierHubUploadReady],['/qvt/wims',supplierHubStatusReady]]){
  const loading=hubCompanyMenuPage({company:companies[0],path,formReady:false});assert.equal(await loading.run(ready),false);
  const wrong=hubCompanyMenuPage({company:companies[1],path});await assert.rejects(wrong.run(verifySupplierHubCompany,[companies[0]]),/회사/);assert.equal(wrong.clicks,0);
  const wrongCode=hubCompanyMenuPage({company:{name:companies[0].name,code:companies[1].code},path});await assert.rejects(wrongCode.run(verifySupplierHubCompany,[companies[0]]),/회사코드/);
 }
});
