import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {intakeOwnerScopeHarness,intakeScopeCompanies} from './helpers/intake-owner-scope.mjs';
import {reviewSourceFixture,reviewSourceUrl,sourceReviewModule,sourceReviewNodes,sourceReviewText} from './helpers/source-review-intake.mjs';
const selectionModel=sourceReviewModule('app/source-capture-selection.ts');

for(const company of intakeScopeCompanies)test(company.code+': newer review of the pinned capture remains explicitly reviewable and cannot start before its ACK',async()=>{
 const {before,saved}=reviewSourceFixture(company.owner,company),selection=selectionModel.sourceCaptureSelection(before);
 // Inject only fixture inputs and the parent boundary. The production row
 // lookup, stale-handler guard and exact-source start guard run unchanged.
 const componentSource=fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8')
  .replace('sourceItems=[]','sourceItems='+JSON.stringify([saved]))
  .replace(',onReviewSource }: {',",onReviewSource=(item,rowId)=>onRows(previous=>previous.map(row=>row.id===rowId?{...row,message:'explicit-review-'+item.revision}:row)) }: {");
 const h=intakeOwnerScopeHarness(company,{componentSource});
 try{
  h.setRows([{...h.rows[0],url:reviewSourceUrl,sourceCapture:selection}]);
  const button=h.button('수집정보 확인·수정');assert.equal(button.props.disabled,false);assert.match(sourceReviewText(h.render()),/검토 버전이 변경/);
  h.button('시작 (1건)').props.onClick();await h.settle();assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);assert.match(sourceReviewText(h.render()),/선택한 수집본을 다시 확인/);
  button.props.onClick();assert.equal(h.rows[0].message,'explicit-review-2');assert.equal(h.rows[0].sourceCapture.revision,1);assert.equal(h.posts.length,0);
  const stale=h.button('수집정보 확인·수정');h.setRows([{...h.rows[0],sourceCapture:{...selection,fingerprint:'b'.repeat(64)},message:'changed selection'}]);stale.props.onClick();assert.equal(h.rows[0].message,'changed selection');
  assert.equal(sourceReviewNodes(h.render()).some(node=>node.type==='button'&&sourceReviewText(node)==='수집정보 확인·수정'),false,'same URL with another fingerprint cannot offer the newer review');
 }finally{h.close();}
});
