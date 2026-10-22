#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { startCli } from './yoofam-studio.mjs';

export const CLI_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const HELP = `YOOFAM 스튜디오 CLI ${CLI_VERSION}
사용법:
  yoofam-studio start [--stdio] [--port 49831] [--diagnostics]
  yoofam-studio serve [--stdio] [--port 49831] [--diagnostics]
  yoofam-studio status
  yoofam-studio --version

start/serve는 이 터미널에서 실행됩니다. Ctrl+C로 종료합니다.
status는 설치된 버전과 Node.js만 확인하며 실행 중인 서버나 계정을 조회하지 않습니다.
실행 후 출력되는 연결 주소를 현재 로그인한 Chrome에서 열어 연결하세요.
`;

export async function runCli(args = process.argv.slice(2), streams = {}) {
  const output = streams.output ?? process.stdout;
  if (args.length === 0 || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0]))) {
    output.write(HELP);
    return null;
  }
  if (args.length === 1 && ['--version', '-v', 'version'].includes(args[0])) {
    output.write(`${CLI_VERSION}\n`);
    return null;
  }
  if (args.length === 1 && args[0] === 'status') {
    output.write(`YOOFAM 스튜디오 CLI ${CLI_VERSION}\nNode.js ${process.version}\n설치 확인 완료. 실행 중인 서버나 연결 계정은 조회하지 않았습니다.\n시작: yoofam-studio start\n`);
    return null;
  }
  const forwarded = [...args];
  if (forwarded[0] === 'start') forwarded[0] = 'serve';
  return startCli(forwarded, streams);
}

export function isCliEntrypoint(moduleUrl = import.meta.url, argument = process.argv[1], resolvePath = realpathSync) {
  if (!argument) return false;
  try { return moduleUrl === pathToFileURL(resolvePath(argument)).href; }
  catch { return false; }
}

if (isCliEntrypoint()) {
  runCli().catch((error) => {
    process.stderr.write(`${typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.message : '로컬 연결을 시작하지 못했습니다. 명령과 포트를 확인해주세요.'}\n`);
    process.exitCode = 1;
  });
}
