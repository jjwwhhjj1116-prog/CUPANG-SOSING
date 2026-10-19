import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as diagnostics from '../../extensions/supplier-hub/rejection-details.mjs';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../app/components/supplier-hub-rejection-details.tsx',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,require(name){if(name==='react/jsx-runtime')return jsx;if(name==='../../extensions/supplier-hub/rejection-details.mjs')return diagnostics;throw Error('Unexpected UI dependency: '+name);}});
export const SupplierHubRejectionDetails=exports.SupplierHubRejectionDetails;
