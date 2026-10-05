import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoricalAiImportSql} from '../scripts/prepare-historical-ai-import.mjs';
import {historicalHarness,historicalRow,historicalQuote,historicalDocument as doc} from './helpers/historical-ai-registrations.mjs';
const owner='19625393-93f4-4670-a46c-e3a8434c70ec';
function harness(){const h=historicalHarness();h.sqlite.prepare('UPDATE members SET id=?').run(owner);return h;}
test('dry-run generated production SQL preserves source records, stays bounded and can be replayed without writes',async()=>{
 const h=harness();try{
  const rows=Array.from({length:177},(_,index)=>historicalRow(String(261002001001+index))),quote=historicalQuote(),documents=[doc('page1.json',rows.slice(0,100)),doc('page2.json',rows.slice(100)),doc('quote.json',quote)],plan=await createHistoricalAiImportSql(owner,documents);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM historical_ai_records').get().n,0);assert.equal(plan.summary.registrations,177);assert.equal(plan.summary.partialQuotations,1);assert.ok(plan.summary.maxStatementBytes<90000);
  h.sqlite.exec(plan.sql);const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM historical_ai_records ORDER BY record_kind,registration_id').all());assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM historical_ai_records').get().n,178);
  assert.deepEqual(JSON.parse(h.sqlite.prepare("SELECT source_payload FROM historical_ai_records WHERE record_kind='quotation'").get().source_payload),quote);
  h.sqlite.exec(plan.sql);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM historical_ai_records ORDER BY record_kind,registration_id').all()),before);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name LIKE 'historical_ai_stage_%'").get().n,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,0);
 }finally{h.close();}
});
test('generated SQL preserves all records on one conflict, orphan quotation or changed fixed membership',async()=>{
 for(const scenario of ['conflict','orphan','member']){
  const h=harness();try{
   const first=await createHistoricalAiImportSql(owner,[doc('original.json',[historicalRow()])]);h.sqlite.exec(first.sql);const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM historical_ai_records').all());
   const changed=historicalRow();changed.cells[13]='등록완료';const documents=[doc('new.json',scenario==='conflict'?[changed,historicalRow('261002001002')]:[historicalRow('261002001002')])];
   if(scenario==='orphan')documents.push(doc('orphan.json',historicalQuote('261002001009')));if(scenario==='member')h.sqlite.exec("UPDATE members SET company_code='A01526306',company_name='유앤채'");
   const plan=await createHistoricalAiImportSql(owner,documents);h.sqlite.exec(plan.sql);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM historical_ai_records').all()),before,scenario);
   assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name LIKE 'historical_ai_stage_%'").get().n,0);
  }finally{h.close();}
 }
});
