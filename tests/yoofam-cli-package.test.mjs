import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildCliPackages, CLI_PACKAGE_FILES, readNpmTar } from '../scripts/package-yoofam-cli.mjs';
import { readPackageZip } from '../extensions/supplier-hub/package.mjs';
import { isCliEntrypoint } from '../cli/bin.mjs';

const repo = new URL('../', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('cli/package.json', repo), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const base = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(base, 'yoofam-cli-package-'));
  const root = pathToFileURL(directory + path.sep);
  fs.mkdirSync(new URL('cli/', root));
  fs.mkdirSync(new URL('app/exports/', root), { recursive: true });
  fs.copyFileSync(new URL('app/exports/zip.ts', repo), new URL('app/exports/zip.ts', root));
  for (const name of CLI_PACKAGE_FILES) fs.copyFileSync(new URL(`cli/${name}`, repo), new URL(`cli/${name}`, root));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), base);
    assert.ok(path.basename(resolved).startsWith('yoofam-cli-package-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { root, directory, downloads: new URL('public/downloads/', root) };
}

function node(args, options = {}) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60_000, windowsHide: true, ...options });
  assert.ifError(result.error);
  return result;
}

function npmCommand(shim, args) {
  // Only fixed test flags are accepted; cmd.exe is used solely to run npm's Windows shim.
  assert.ok(args.every((value) => ['--version', '--help', 'status'].includes(value)));
  const options = { encoding: 'utf8', timeout: 60_000, windowsHide: true, env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` } };
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${shim}" ${args.join(' ')}"`], { ...options, windowsVerbatimArguments: true })
    : spawnSync(shim, args, options);
  assert.ifError(result.error);
  return result;
}

test('npm package exposes one versioned executable with no dependencies or install lifecycle', () => {
  assert.equal(pkg.name, '@yoofam/studio-cli'); assert.equal(pkg.version, '0.1.2');
  assert.equal(pkg.engines.node, '>=22.13.0');
  assert.deepEqual(pkg.bin, { 'yoofam-studio': './bin.mjs' });
  assert.deepEqual([...pkg.files].sort(), CLI_PACKAGE_FILES.filter((name) => name !== 'package.json').sort());
  for (const key of ['private', 'scripts', 'dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies']) assert.equal(pkg[key], undefined);
});

test('reproducible npm TGZ and legacy ZIP preserve the exact five-file allowlist and executable mode', (t) => {
  const { root, downloads } = fixture(t);
  const first = buildCliPackages({ root }), second = buildCliPackages({ root });
  assert.deepEqual(first, second);
  const tarBytes = fs.readFileSync(new URL(first.tgz.name, downloads)), tar = readNpmTar(tarBytes);
  const zipBytes = fs.readFileSync(new URL(first.zip.name, downloads)), zip = readPackageZip(zipBytes);
  assert.deepEqual([...tar.keys()].sort(), CLI_PACKAGE_FILES.map((name) => `package/${name}`).sort());
  assert.deepEqual([...zip.keys()].sort(), CLI_PACKAGE_FILES.map((name) => `cli/${name}`).sort());
  for (const name of CLI_PACKAGE_FILES) {
    const source = fs.readFileSync(new URL(`cli/${name}`, root), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(tar.get(`package/${name}`).data.toString('utf8'), source);
    assert.deepEqual(Buffer.from(zip.get(`cli/${name}`)), Buffer.from(source));
    assert.equal(tar.get(`package/${name}`).mode, name === 'bin.mjs' ? 0o755 : 0o644);
  }
  assert.equal(first.tgz.sha256, sha256(tarBytes)); assert.equal(first.zip.sha256, sha256(zipBytes));
  assert.deepEqual(fs.readFileSync(new URL('yoofam-studio-cli-latest.tgz', downloads)), tarBytes);
  const manifest = JSON.parse(fs.readFileSync(new URL(first.manifest, downloads), 'utf8'));
  assert.equal(manifest.format, 'yoofam-cli-distribution-v1'); assert.equal(manifest.version, pkg.version);
  assert.deepEqual(manifest.tgz, first.tgz); assert.deepEqual(manifest.zip, first.zip);
  for (const file of manifest.files) assert.equal(file.sha256, sha256(tar.get(`package/${file.name}`).data));
  const before = fs.statSync(new URL(first.tgz.name, downloads)).mtimeMs;
  assert.equal(buildCliPackages({ root, check: true }).checked, true);
  assert.equal(fs.statSync(new URL(first.tgz.name, downloads)).mtimeMs, before);
});

test('check mode detects changed versioned packages, latest aliases, and manifests', (t) => {
  const { root, downloads } = fixture(t);
  const release = buildCliPackages({ root });
  for (const name of [release.tgz.name, release.zip.name, 'yoofam-studio-cli-latest.tgz', release.manifest]) {
    const target = new URL(name, downloads), previous = fs.readFileSync(target);
    fs.writeFileSync(target, Buffer.concat([previous, Buffer.from('changed')]));
    assert.throws(() => buildCliPackages({ root, check: true }), /다시 만들어주세요/);
    fs.writeFileSync(target, previous);
  }
  assert.equal(buildCliPackages({ root, check: true }).checked, true);
});

test('packaging rejects extra credential files and npm install scripts instead of shipping them', (t) => {
  const { root } = fixture(t);
  fs.writeFileSync(new URL('cli/.env', root), 'SYNTHETIC_SECRET=never-package');
  assert.throws(() => buildCliPackages({ root }), /배포 대상 파일/);
  fs.unlinkSync(new URL('cli/.env', root));
  const packageFile = new URL('cli/package.json', root), clean = fs.readFileSync(packageFile, 'utf8');
  fs.writeFileSync(packageFile, JSON.stringify({ ...pkg, scripts: { postinstall: 'do-not-run' } }));
  assert.throws(() => buildCliPackages({ root }), /배포 정보/);
  fs.writeFileSync(packageFile, clean);
  assert.equal(buildCliPackages({ root }).files, 5);
});

test('local --version/status/help do not start a server or request a browser/account connection', () => {
  const entry = fileURLToPath(new URL('cli/bin.mjs', repo));
  const version = node([entry, '--version']); assert.equal(version.status, 0); assert.equal(version.stdout, `${pkg.version}\n`); assert.equal(version.stderr, '');
  const status = node([entry, 'status']); assert.equal(status.status, 0); assert.match(status.stdout, /설치 확인 완료/); assert.match(status.stdout, /조회하지 않았습니다/);
  for (const args of [[], ['--help'], ['start', '--help'], ['serve', '--help']]) {
    const result = node([entry, ...args]); assert.equal(result.status, 0); assert.match(result.stdout, new RegExp(pkg.version.replaceAll('.', '\\.')));
    assert.doesNotMatch(result.stdout, /#port=|token=|connectionReady/); assert.equal(result.stderr, '');
  }
  const invalid = node([entry, 'start', '--not-a-command']); assert.equal(invalid.status, 1); assert.doesNotMatch(invalid.stderr, /token=|Bearer/);
});

test('main entrypoint resolves npm symlinks and does not execute imported or missing entrypoints', (t) => {
  const { directory } = fixture(t);
  const realEntry = fileURLToPath(new URL('cli/bin.mjs', repo));
  const symlink = path.join(directory, 'npm-symlink.mjs');
  const moduleUrl = pathToFileURL(fs.realpathSync(realEntry)).href;
  assert.equal(isCliEntrypoint(moduleUrl, realEntry), true);
  assert.equal(isCliEntrypoint(moduleUrl, undefined), false);
  assert.equal(isCliEntrypoint(moduleUrl, path.join(directory, 'missing.mjs')), false);
  assert.equal(isCliEntrypoint(pathToFileURL(path.join(directory, 'importer.mjs')).href, realEntry), false);
  try { fs.symlinkSync(realEntry, symlink, 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
    t.diagnostic('Windows file symlink privileges are unavailable; checking the exact argv symlink-to-realpath resolution model.');
    assert.equal(isCliEntrypoint(moduleUrl, symlink, (argument) => { assert.equal(argument, symlink); return fs.realpathSync(realEntry); }), true);
    return;
  }
  assert.equal(isCliEntrypoint(moduleUrl, symlink), true);
  const output = node([symlink, '--version']);
  assert.equal(output.status, 0); assert.equal(output.stdout, `${pkg.version}\n`); assert.equal(output.stderr, '');
});

test('an offline install into an isolated npm prefix produces working commands without lifecycle execution', (t) => {
  const { root, directory, downloads } = fixture(t), release = buildCliPackages({ root });
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../node_modules/npm/bin/npm-cli.js'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  const npm = candidates.find((candidate) => candidate.endsWith('npm-cli.js') && fs.existsSync(candidate));
  assert.ok(npm, 'The package installation check requires the installed npm CLI.');
  const prefix = path.join(directory, 'isolated-prefix'), cache = path.join(directory, 'empty-cache');
  const installed = node([npm, 'install', '--offline', '--ignore-scripts', '--global', '--no-audit', '--no-fund', '--prefix', prefix, '--cache', cache, fileURLToPath(new URL(release.tgz.name, downloads))], { cwd: directory });
  assert.equal(installed.status, 0, installed.stderr);
  const installedRoot = path.join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', '@yoofam/studio-cli');
  const installedBin = path.join(installedRoot, 'bin.mjs');
  assert.ok(fs.existsSync(installedBin));
  const shim = path.join(prefix, process.platform === 'win32' ? 'yoofam-studio.cmd' : 'bin/yoofam-studio');
  assert.ok(fs.existsSync(shim));
  const version = npmCommand(shim, ['--version']); assert.equal(version.status, 0, version.stderr); assert.equal(version.stdout.trim(), pkg.version);
  const help = npmCommand(shim, ['--help']); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /Ctrl\+C/);
  const status = npmCommand(shim, ['status']); assert.equal(status.status, 0, status.stderr); assert.match(status.stdout, /설치 확인 완료/);
  const packageInstalled = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(packageInstalled.scripts, undefined); assert.equal(packageInstalled.dependencies, undefined);
  assert.deepEqual(fs.readdirSync(installedRoot).sort(), [...CLI_PACKAGE_FILES].sort());
});
