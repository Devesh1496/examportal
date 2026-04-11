/**
 * Cloudflare Worker — PDF Proxy
 *
 * Proxies PDF downloads from sites that block Google Cloud IPs (Cloud Run).
 * Cloudflare's edge IPs are not blocked by Indian government sites like RSSB.
 *
 * Deploy:
 *   1. Go to https://workers.cloudflare.com/ → Create Worker
 *   2. Paste this script → Save and Deploy
 *   3. Copy the *.workers.dev URL
 *   4. Set PDF_PROXY_URL=https://your-worker.workers.dev in Cloud Run env vars
 *
 * Usage: GET https://your-worker.workers.dev/?url=https://rssb.rajasthan.gov.in/...
 * Security: Only your backend calls this (protect with a secret token if needed)
 */

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Authorization',
        },
      });
    }

    const reqUrl = new URL(request.url);
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Optional: protect with a secret token
    // const secret = reqUrl.searchParams.get('token');
    // if (secret !== env.PROXY_SECRET) return new Response('Unauthorized', { status: 401 });

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Proxy] Fetching: ${targetUrl}`);

    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
          'Referer': parsedUrl.origin + '/',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: `Target server returned ${response.status}` }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const contentType = response.headers.get('Content-Type') || 'application/pdf';
      const body = await response.arrayBuffer();

      // Verify it looks like a PDF
      const header = new TextDecoder().decode(new Uint8Array(body).slice(0, 5));
      if (!header.includes('%PDF')) {
        return new Response(
          JSON.stringify({ error: `Response is not a PDF (header: "${header}")` }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': body.byteLength.toString(),
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      console.error(`[Proxy] Error: ${err.message}`);
      return new Response(
        JSON.stringify({ error: `Proxy fetch failed: ${err.message}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};
