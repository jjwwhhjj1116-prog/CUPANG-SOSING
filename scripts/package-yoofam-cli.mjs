import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { readPackageZip } from '../extensions/supplier-hub/package.mjs';

export const CLI_PACKAGE_FILES = ['README.md', 'bin.mjs', 'package.json', 'server.mjs', 'yoofam-studio.mjs'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const octal = (target, offset, length, value) => target.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');

// npm accepts this standard USTAR package/ layout. Fixed metadata makes releases reproducible.
export function packNpmTar(files) {
  const blocks = [];
  for (const file of files) {
    const header = Buffer.alloc(512);
    const name = `package/${file.name}`;
    if (!CLI_PACKAGE_FILES.includes(file.name) || Buffer.byteLength(name) > 100) throw Error('CLI TAR 파일명을 확인해주세요.');
    header.write(name, 0, 100, 'utf8');
    octal(header, 100, 8, file.name === 'bin.mjs' ? 0o755 : 0o644);
    octal(header, 108, 8, 0); octal(header, 116, 8, 0);
    octal(header, 124, 12, file.data.length); octal(header, 136, 12, 0);
    header.fill(0x20, 148, 156); header[156] = 0x30;
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, Buffer.from(file.data), Buffer.alloc((512 - file.data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
}

export function readNpmTar(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: 2 * 1024 * 1024 });
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      if (tar.length - offset < 1024 || tar.subarray(offset).some((value) => value !== 0)) throw Error('CLI TAR 종료 정보를 확인해주세요.');
      return files;
    }
    const string = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
    const number = (start, end) => {
      const value = string(start, end).trim();
      if (!/^[0-7]+$/.test(value)) throw Error('CLI TAR 숫자 정보를 확인해주세요.');
      return Number.parseInt(value, 8);
    };
    const name = string(0, 100), mode = number(100, 108), size = number(124, 136), checksum = number(148, 156);
    const checksumHeader = Buffer.from(header); checksumHeader.fill(0x20, 148, 156);
    if (checksumHeader.reduce((sum, value) => sum + value, 0) !== checksum || string(257, 263) !== 'ustar' || header[156] !== 0x30 || string(345, 500)) throw Error('CLI TAR 헤더를 확인해주세요.');
    const relativeName = name.startsWith('package/') ? name.slice(8) : '';
    if (!CLI_PACKAGE_FILES.includes(relativeName) || files.has(name) || mode !== (relativeName === 'bin.mjs' ? 0o755 : 0o644) || size > 1024 * 1024 || offset + 512 + size > tar.length) throw Error('CLI TAR 배포 범위를 확인해주세요.');
    const data = tar.subarray(offset + 512, offset + 512 + size);
    files.set(name, { data, mode });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw Error('CLI TAR 종료 정보가 없습니다.');
}

export function buildCliPackages(options = {}) {
  const root = options.root ?? new URL('../', import.meta.url), directory = new URL('cli/', root);
  const actual = fs.readdirSync(directory).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...CLI_PACKAGE_FILES].sort())) throw Error('CLI 배포 대상 파일을 확인해주세요.');
  const files = CLI_PACKAGE_FILES.map((name) => ({ name, data: Buffer.from(fs.readFileSync(new URL(name, directory), 'utf8').replace(/\r\n/g, '\n')) }));
  const pkg = JSON.parse(files.find((file) => file.name === 'package.json').data.toString('utf8'));
  if (pkg.name !== '@yoofam/studio-cli' || !/^\d+\.\d+\.\d+$/.test(pkg.version) || pkg.private || pkg.bin?.['yoofam-studio'] !== './bin.mjs' || pkg.engines?.node !== '>=22.13.0' || pkg.scripts || pkg.dependencies || pkg.optionalDependencies || pkg.peerDependencies || JSON.stringify([...(pkg.files ?? [])].sort()) !== JSON.stringify(CLI_PACKAGE_FILES.filter((name) => name !== 'package.json').sort())) throw Error('CLI 배포 정보를 확인해주세요.');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('app/exports/zip.ts', root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, TextEncoder, Uint8Array, Uint32Array, DataView });
  const archive = new Uint8Array(exports.zipFiles(files.map((file) => ({ ...file, name: `cli/${file.name}` }))));
  const unpacked = readPackageZip(archive);
  if (unpacked.size !== files.length || files.some((file) => !same(file.data, unpacked.get(`cli/${file.name}`) ?? []))) throw Error('CLI ZIP의 내용이 원본과 다릅니다.');
  const tgz = packNpmTar(files), npmFiles = readNpmTar(tgz);
  if (npmFiles.size !== files.length || files.some((file) => !same(file.data, npmFiles.get(`package/${file.name}`)?.data ?? []))) throw Error('CLI TGZ의 내용이 원본과 다릅니다.');
  const zipName = `yoofam-studio-cli-${pkg.version}.zip`, tgzName = `yoofam-studio-cli-${pkg.version}.tgz`;
  const manifest = {
    format: 'yoofam-cli-distribution-v1', name: pkg.name, version: pkg.version, node: pkg.engines.node,
    files: files.map((file) => ({ name: file.name, bytes: file.data.length, sha256: sha256(file.data), mode: file.name === 'bin.mjs' ? '0755' : '0644' })),
    zip: { name: zipName, bytes: archive.length, sha256: sha256(archive) },
    tgz: { name: tgzName, bytes: tgz.length, sha256: sha256(tgz), integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` },
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const artifacts = [[zipName, archive], [tgzName, tgz], ['yoofam-studio-cli-latest.tgz', tgz], ['yoofam-studio-cli-manifest.json', manifestBytes]];
  const downloads = new URL('public/downloads/', root);
  if (!options.check) fs.mkdirSync(downloads, { recursive: true });
  for (const [name, bytes] of artifacts) {
    const target = new URL(name, downloads);
    if (options.check) { if (!fs.existsSync(target) || !same(fs.readFileSync(target), bytes)) throw Error(`CLI 배포 파일을 다시 만들어주세요: ${name}`); }
    else fs.writeFileSync(target, bytes);
  }
  return { version: pkg.version, files: files.length, bytes: archive.length, sha256: sha256(archive), zip: manifest.zip, tgz: manifest.tgz, manifest: 'yoofam-studio-cli-manifest.json', checked: Boolean(options.check) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(buildCliPackages({ check: process.argv.includes('--check') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
