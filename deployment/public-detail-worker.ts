import { GET } from '@/app/media/quotation/[token]/route';

/** Image-only public host. The application and original files stay behind Access. */
const publicDetailWorker = {
  async fetch(request: Request) {
    const token = /^\/media\/quotation\/([a-f0-9]{64})$/.exec(new URL(request.url).pathname)?.[1];
    if (!token) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {
      status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
    });
    const response = await GET(request, { params: Promise.resolve({ token }) });
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  },
};
export default publicDetailWorker;
