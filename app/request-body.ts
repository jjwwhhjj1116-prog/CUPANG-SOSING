export class RequestBodyError extends Error {
  constructor(public readonly status: 400 | 413, message: string) { super(message); this.name = 'RequestBodyError'; }
}
function limit(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('A positive request byte limit is required.');
}
export async function readBoundedStream(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
  limit(maxBytes);
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel().catch(() => undefined); throw new RequestBodyError(413, `본문은 ${maxBytes.toLocaleString('ko-KR')}바이트 이하이어야 합니다.`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  limit(maxBytes);
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new RequestBodyError(413, `본문은 ${maxBytes.toLocaleString('ko-KR')}바이트 이하이어야 합니다.`);
  }
  try { return await readBoundedStream(request.body, maxBytes); }
  catch (error) { if (error instanceof RequestBodyError) throw error; throw new RequestBodyError(400, '요청 본문을 읽지 못했습니다.'); }
}
export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const bytes = await readBoundedBytes(request, maxBytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new RequestBodyError(400, '올바른 UTF-8 텍스트가 필요합니다.'); }
}
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new RequestBodyError(400, 'JSON 형식으로 요청해주세요.');
  const text = await readBoundedText(request, maxBytes);
  try { return JSON.parse(text) as unknown; }
  catch { throw new RequestBodyError(400, '올바른 JSON 객체가 필요합니다.'); }
}
