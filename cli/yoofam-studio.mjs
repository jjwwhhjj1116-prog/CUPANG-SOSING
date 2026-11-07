#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createCliServer, CliError } from './server.mjs';
import { readDetailImageFile, startDetailWorker } from './detail-worker.mjs';

export const CLI_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export const CLI_TOOLS = [
  { name: 'status', description: '연결된 YOOFAM 계정과 읽기 연결 상태', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'product-query', description: '앱에서 명시적으로 허용한 1688 상품 정보 읽기. 상품 생성·수정·전송하지 않음.', inputSchema: { type: 'object', properties: { sourceUrl: { type: 'string', maxLength: 2048 } }, required: ['sourceUrl'], additionalProperties: false } },
  { name: 'category-profiles/list', description: '연결 계정에서 조회 가능한 카테고리 목록', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'collection-job/status', description: '연결 계정이 소유한 수집 작업 상태 조회', inputSchema: { type: 'object', properties: { jobId: { type: 'string', format: 'uuid' } }, required: ['jobId'], additionalProperties: false } },
  {name:'main-image/next',description:'회원이 대표이미지의 Codex로 수정 버튼으로 요청한 작업 1건과 원본 이미지를 가져옵니다. 요청이 없으면 job:null. 상품 형태·색상·브랜드 표기를 보존해 편집하고 main-image/complete에 결과 파일을 전달하세요.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'main-image/complete',description:'명시적으로 요청된 대표이미지의 편집 결과를 해당 상품·옵션 하나에 업로드합니다. 다른 가격·옵션·서플라이허브는 변경하지 않습니다. 로컬 PNG·JPEG 절대경로, 4MB 이하.',inputSchema:{type:'object',properties:{requestId:{type:'string',format:'uuid'},filePath:{type:'string',maxLength:4096}},required:['requestId','filePath'],additionalProperties:false}},
  { name: 'detail_image_next', description: '회원이 직접 요청한 상세 이미지 작업 하나와 원본을 가져옵니다. 대기 작업이 없으면 job:null입니다.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'detail_image_complete', description: '명시적으로 요청한 상세 이미지에 결과를 저장합니다. 4MB 이하 PNG 또는 JPEG의 로컬 절대경로가 필요합니다.', inputSchema: { type: 'object', properties: { requestId: { type: 'string', format: 'uuid' }, filePath: { type: 'string', maxLength: 4096 } }, required: ['requestId', 'filePath'], additionalProperties: false } },
];

const DETAIL_COMMANDS = new Map([['detail_image_next', 'detail-image/next'], ['detail_image_complete', 'detail-image/complete']]);
const USAGE = 'node cli/yoofam-studio.mjs serve [--stdio] [--port 49831] [--allow-local-dev] [--diagnostics] [--auto-detail]';
const WORKER_MESSAGES = {
  'codex-unavailable': 'PATH에서 Codex 실행 파일을 찾지 못했습니다.',
  'processing-failed': 'Codex 상세 이미지 결과를 확인하지 못했습니다. 로컬 Codex의 이미지 생성 지원과 로그인 상태를 확인해주세요.',
  'timed-out': 'Codex 상세 이미지 작업 시간이 초과됐습니다.',
  'save-unconfirmed': 'Codex 상세 이미지 저장 결과를 확인하지 못했습니다.',
  'bridge-unsupported': '상세 이미지 자동 연결을 지원하는 YOOFAM 앱으로 새로고침해주세요.',
  saved: '요청한 상세 이미지를 저장했습니다.',
};

export function parseArguments(args) {
  const options = { stdio: false, port: 49831, localDev: false, diagnostics: false, autoDetail: false };
  const rest = [...args];
  if (rest[0] === 'serve') rest.shift();
  while (rest.length) {
    const flag = rest.shift();
    if (flag === '--stdio') options.stdio = true;
    else if (flag === '--diagnostics') options.diagnostics = true;
    else if (flag === '--auto-detail') options.autoDetail = true;
    else if (flag === '--allow-local-dev') options.localDev = true;
    else if (flag === '--port') {
      const value = rest.shift();
      if (!value || !/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new CliError('ARGUMENT_INVALID', '--port는 1024~65535 정수로 지정해주세요.');
      options.port = Number(value);
    } else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new CliError('ARGUMENT_INVALID', `사용법: ${USAGE}`);
  }
  return options;
}

export async function startCli(args = process.argv.slice(2), streams = {}) {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  const diagnostic = streams.diagnostic ?? process.stderr;
  const options = parseArguments(args);
  if (options.help) {
    output.write(`YOOFAM 스튜디오 CLI ${CLI_VERSION}\n${USAGE}\n앱에서 회사 확인 후 연결하세요. 명령: status, query <1688 URL>, categories, job <UUID>, diagnostics, quit\n--diagnostics: 비밀값을 제외한 로컬 전송 단계만 stderr에 출력합니다.\n--auto-detail: 연결한 앱에서 요청한 상세 이미지를 로컬 Codex로 처리합니다.\n`);
    return null;
  }
  const server = createCliServer({
    port: options.port,
    allowedOrigins: options.localDev ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : [],
    onDiagnostic: options.diagnostics ? (event) => diagnostic.write(`${JSON.stringify({ type: 'transport-diagnostic', ...event })}\n`) : undefined,
  });
  const connection = await server.listen();
  const write = (value) => output.write(`${JSON.stringify(value)}\n`);
  // This one-time pairing URL is intentionally delivered only to the local caller.
  // It contains no app password/cookie and expires with this process in 15 minutes.
  if (options.stdio) write({ jsonrpc: '2.0', method: 'notifications/connectionReady', params: { connectUrl: connection.connectUrl, expiresAt: connection.expiresAt, protocolVersion: '1.0' } });
  else output.write(`YOOFAM 스튜디오 CLI ${CLI_VERSION}\n다음 주소를 현재 로그인된 Chrome에서 열고 계정·회사를 확인한 뒤 연결하세요.\n${connection.connectUrl}\n연결 주소는 공유하지 마세요. 15분 후 만료됩니다.\n명령: status | query <1688 URL> | categories | job <UUID> | diagnostics | quit\n`);
  const detailWorker = options.autoDetail ? startDetailWorker(server, {
    ...streams.detailWorker,
    report: (event) => diagnostic.write(`${WORKER_MESSAGES[event]}\n`),
  }) : null;
  let buffer = '';
  let discarding = false;
  let stopping = false;
  const pendingCalls = new Map();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    input.off('data', onData);
    input.off('end', onEnd);
    await server.close();
    await detailWorker;
  };
  const resultError = (id, error) => ({ jsonrpc: '2.0', id, error: { code: error instanceof CliError ? -32000 : -32603, message: error instanceof CliError ? error.message : '로컬 명령을 처리하지 못했습니다.', data: { code: error instanceof CliError ? error.code : 'COMMAND_FAILED' } } });
  const call = async (id, command, payload, rpc) => {
    command = DETAIL_COMMANDS.get(command) ?? command;
    if (command === 'detail-image/fail') throw new CliError('COMMAND_NOT_ALLOWED', '허용된 명령을 확인해주세요.');
    const key = `${typeof id}:${String(id)}`;
    if (pendingCalls.has(key)) throw new CliError('REQUEST_DUPLICATE', '현재 실행 중인 요청 번호입니다.');
    if (command === 'detail-image/complete') {
      if (!payload || Object.keys(payload).length !== 2 || typeof payload.filePath !== 'string' || payload.filePath.length > 4096 || !isAbsolute(payload.filePath)) throw new CliError('IMAGE_PATH_INVALID', '결과 이미지의 절대경로가 필요합니다.');
      if (typeof payload.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestId)) throw new CliError('COMMAND_INVALID', '상세 이미지 작업 번호를 확인해주세요.');
      payload = { requestId: payload.requestId, image: readDetailImageFile(payload.filePath) };
    }
    if(command==='main-image/complete'){
      if(!payload||Object.keys(payload).length!==2||typeof payload.filePath!=='string'||payload.filePath.length>4096||!isAbsolute(payload.filePath))throw new CliError('IMAGE_PATH_INVALID','결과 이미지의 절대경로가 필요합니다.');
      const stat=lstatSync(payload.filePath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<8||stat.size>4*1024*1024)throw new CliError('IMAGE_INVALID','4MB 이하 PNG·JPEG 파일이 필요합니다.');
      const bytes=readFileSync(payload.filePath),mimeType=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
      if(!mimeType||bytes.length!==stat.size)throw new CliError('IMAGE_INVALID','이미지 파일 내용·크기를 확인해주세요.');
      payload={requestId:payload.requestId,image:{mimeType,data:bytes.toString('base64')}};
    }
    const job = server.enqueue(command, payload);
    pendingCalls.set(key, job);
    try {
      const result = await job;
      const {image,...metadata}=(command==='main-image/next'||command==='detail-image/next')&&result?.image?result:{image:null,...result};
      write(rpc ? { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(metadata) },...(image?[{type:'image',data:image.data,mimeType:image.mimeType}]:[])], structuredContent: metadata } } : { id, ok: true, command, result:metadata });
    } catch (error) {
      write(rpc ? resultError(id, error) : { id, ok: false, error: { code: error instanceof CliError ? error.code : 'COMMAND_FAILED', message: error instanceof CliError ? error.message : '명령을 처리하지 못했습니다.' } });
    } finally { pendingCalls.delete(key); }
  };
  const handleLine = async (raw) => {
    const line = raw.trim();
    if (!line) return;
    let request; let rpc = false;
    try {
      if (options.stdio || line.startsWith('{')) {
        try { request = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 입력을 확인해주세요.' } }); return; }
        if (!request || typeof request !== 'object' || Array.isArray(request)) throw new CliError('REQUEST_INVALID', '명령 형식을 확인해주세요.');
        rpc = request.jsonrpc === '2.0';
        const id = request.id;
        if (rpc && request.method === 'notifications/initialized') return;
        if (rpc && request.method === 'notifications/cancelled') {
          const target = request.params?.requestId;
          pendingCalls.get(`${typeof target}:${String(target)}`)?.cancel(); return;
        }
        if ((typeof id !== 'string' && typeof id !== 'number') || (typeof id === 'string' && id.length > 128) || (typeof id === 'number' && !Number.isSafeInteger(id))) throw new CliError('REQUEST_INVALID', '문자 또는 정수 요청 번호가 필요합니다.');
        if (rpc && request.method === 'initialize') { write({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'yoofam-studio', version: CLI_VERSION } } }); return; }
        if (rpc && request.method === 'ping') { write({ jsonrpc: '2.0', id, result: {} }); return; }
        if (rpc && request.method === 'tools/list') { write({ jsonrpc: '2.0', id, result: { tools: CLI_TOOLS } }); return; }
        if (rpc && request.method !== 'tools/call') throw new CliError('METHOD_NOT_ALLOWED', '허용된 도구 조회·읽기 호출만 사용할 수 있습니다.');
        await call(id, rpc ? request.params?.name : request.command, (rpc ? request.params?.arguments : request.payload) ?? {}, rpc);
        return;
      }
      if (line === 'quit' || line === 'exit') { await stop(); input.pause(); return; }
      if (line === 'diagnostics') { write(server.getDiagnostics()); return; }
      const id = `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (line === 'status') await call(id, 'status', {}, false);
      else if (line === 'categories') await call(id, 'category-profiles/list', {}, false);
      else if (line.startsWith('query ')) await call(id, 'product-query', { sourceUrl: line.slice(6).trim() }, false);
      else if (line.startsWith('job ')) await call(id, 'collection-job/status', { jobId: line.slice(4).trim() }, false);
      else throw new CliError('COMMAND_NOT_ALLOWED', '명령: status | query <1688 URL> | categories | job <UUID> | diagnostics | quit');
    } catch (error) {
      write(rpc ? resultError(request?.id ?? null, error) : { id: request?.id ?? null, ok: false, error: { code: error instanceof CliError ? error.code : 'COMMAND_FAILED', message: error instanceof CliError ? error.message : '명령을 처리하지 못했습니다.' } });
    }
  };
  const onData = (chunk) => {
    // Bound input before waiting for a newline. No command receives a shell.
    for (const part of String(chunk).split(/(?<=\n)/)) {
      if (discarding) { if (part.endsWith('\n')) discarding = false; continue; }
      buffer += part;
      if (Buffer.byteLength(buffer, 'utf8') > 32_768) {
        buffer = ''; discarding = !part.endsWith('\n');
        write({ id: null, ok: false, error: { code: 'INPUT_TOO_LARGE', message: '명령 입력 크기가 제한을 초과했습니다.' } });
      } else if (buffer.endsWith('\n')) { const line = buffer; buffer = ''; void handleLine(line); }
    }
  };
  const onEnd = () => { const tail = buffer.trim(); buffer = ''; if (tail) void handleLine(tail).finally(stop); else void stop(); };
  input.setEncoding('utf8');
  input.on('data', onData); input.on('end', onEnd);
  const onSignal = () => { void stop().finally(() => input.pause()); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  return { server, connection, async close() { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); await stop(); }, diagnostic };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startCli().catch((error) => { process.stderr.write(`${error instanceof CliError ? error.message : '로컬 연결을 시작하지 못했습니다. 포트를 확인해주세요.'}\n`); process.exitCode = 1; });
}
