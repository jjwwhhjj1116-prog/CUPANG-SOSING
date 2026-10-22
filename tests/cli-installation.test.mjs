import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const installation=providedOptionModule('app/cli-installation.ts');
const pkg=JSON.parse(fs.readFileSync(new URL('../cli/package.json',import.meta.url),'utf8'));
test('web installation references the exact versioned distribution and public tag without app credentials',()=>{
 assert.equal(installation.CLI_RELEASE_VERSION,pkg.version);assert.equal(installation.CLI_RELEASE_TAG,'yoofam-cli-v'+pkg.version);
 const url=new URL(installation.CLI_PACKAGE_URL);assert.equal(url.protocol,'https:');assert.equal(url.hostname,'raw.githubusercontent.com');assert.equal(url.search,'');assert.equal(url.hash,'');assert.equal(url.username,'');assert.equal(url.password,'');
 assert.equal(url.pathname,`/jjwwhhjj1116-prog/CUPANG-SOSING/yoofam-cli-v${pkg.version}/public/downloads/yoofam-studio-cli-${pkg.version}.tgz`);
 assert.ok(fs.statSync(new URL('../public/downloads/yoofam-studio-cli-'+pkg.version+'.tgz',import.meta.url)).size>0);
});
test('PowerShell and Mac commands install the same package without lifecycle, elevation or policy overrides',()=>{
 for(const platform of ['windows','mac']){
  const commands=installation.cliInstallCommands(platform);
  assert.equal(commands.install,`${platform==='windows'?'npm.cmd':'npm'} install --global --ignore-scripts --no-audit --no-fund '${installation.CLI_PACKAGE_URL}'`);
  assert.equal(commands.start,`${platform==='windows'?'yoofam-studio.cmd':'yoofam-studio'} start`);
  assert.equal(commands.status,`${platform==='windows'?'yoofam-studio.cmd':'yoofam-studio'} status`);
  assert.doesNotMatch(Object.values(commands).join('\n'),/ExecutionPolicy|Bypass|Invoke-Expression|\biex\b|taskkill|sudo|cookie|Bearer|password|--force|--unsafe|\|\s*(sh|bash)/i);
 }
});
