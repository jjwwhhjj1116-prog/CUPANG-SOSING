#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createCliServer, CliError } from './server.mjs';

export const CLI_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export const CLI_TOOLS = [
  { name: 'status', description: '연결된 YOOFAM 계정과 읽기 연결 상태', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'product-query', description: '앱에서 명시적으로 허용한 1688 상품 정보 읽기. 상품 생성·수정·전송하지 않음.', inputSchema: { type: 'object', properties: { sourceUrl: { type: 'string', maxLength: 2048 } }, required: ['sourceUrl'], additionalProperties: false } },
  { name: 'category-profiles/list', description: '연결 계정에서 조회 가능한 카테고리 목록', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'collection-job/status', description: '연결 계정이 소유한 수집 작업 상태 조회', inputSchema: { type: 'object', properties: { jobId: { type: 'string', format: 'uuid' } }, required: ['jobId'], additionalProperties: false } },
];

export function parseArguments(args) {
  const options = { stdio: false, port: 49831, localDev: false, diagnostics: false };
  const rest = [...args];
  if (rest[0] === 'serve') rest.shift();
  while (rest.length) {
    const flag = rest.shift();
    if (flag === '--stdio') options.stdio = true;
    else if (flag === '--diagnostics') options.diagnostics = true;
    else if (flag === '--allow-local-dev') options.localDev = true;
    else if (flag === '--port') {
      const value = rest.shift();
      if (!value || !/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new CliError('ARGUMENT_INVALID', '--port는 1024~65535 정수로 지정해주세요.');
      options.port = Number(value);
    } else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new CliError('ARGUMENT_INVALID', '사용법: node cli/yoofam-studio.mjs serve [--stdio] [--port 49831] [--allow-local-dev] [--diagnostics]');
  }
  return options;
}

export async function startCli(args = process.argv.slice(2), streams = {}) {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  const diagnostic = streams.diagnostic ?? process.stderr;
  const options = parseArguments(args);
  if (options.help) {
    output.write(`YOOFAM 스튜디오 CLI ${CLI_VERSION}\nnode cli/yoofam-studio.mjs serve [--stdio] [--port 49831] [--allow-local-dev] [--diagnostics]\n앱에서 회사 확인 후 연결하세요. 명령: status, query <1688 URL>, categories, job <UUID>, diagnostics, quit\n--diagnostics: 비밀값을 제외한 로컬 전송 단계만 stderr에 출력합니다.\n`);
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
  };
  const resultError = (id, error) => ({ jsonrpc: '2.0', id, error: { code: error instanceof CliError ? -32000 : -32603, message: error instanceof CliError ? error.message : '로컬 명령을 처리하지 못했습니다.', data: { code: error instanceof CliError ? error.code : 'COMMAND_FAILED' } } });
  const call = async (id, command, payload, rpc) => {
    const key = `${typeof id}:${String(id)}`;
    if (pendingCalls.has(key)) throw new CliError('REQUEST_DUPLICATE', '현재 실행 중인 요청 번호입니다.');
    const job = server.enqueue(command, payload);
    pendingCalls.set(key, job);
    try {
      const result = await job;
      write(rpc ? { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } } : { id, ok: true, command, result });
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
