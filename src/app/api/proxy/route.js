import { NextResponse } from 'next/server';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive',
};

function resolveUrl(raw, base) {
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('javascript:')) return null;
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function rewriteHtml(html, pageUrl) {
  // Rewrite src, href, action attributes
  html = html.replace(/(<[^>]+?\s)(src|href|action)=("([^"]*)"|'([^']*)')/gi, (match, pre, attr, _q, dq, sq) => {
    const raw = dq ?? sq;
    const quote = dq !== undefined ? '"' : "'";
    const resolved = resolveUrl(raw, pageUrl);
    if (!resolved) return match;
    if (resolved.includes('/api/proxy')) return match;
    return `${pre}${attr}=${quote}/api/proxy?url=${encodeURIComponent(resolved)}${quote}`;
  });

  // Rewrite srcset
  html = html.replace(/srcset=("([^"]*)"|'([^']*)')/gi, (match, _q, dq, sq) => {
    const raw = dq ?? sq;
    const quote = dq !== undefined ? '"' : "'";
    const rewritten = raw.split(',').map(part => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const resolved = resolveUrl(url, pageUrl);
      if (!resolved || resolved.includes('/api/proxy')) return part.trim();
      return `/api/proxy?url=${encodeURIComponent(resolved)}${descriptor ? ' ' + descriptor : ''}`;
    }).join(', ');
    return `srcset=${quote}${rewritten}${quote}`;
  });

  // Rewrite CSS url()
  html = html.replace(/url\(("([^"]*)"|'([^']*)'|([^)"']+))\)/gi, (match, _q, dq, sq, bare) => {
    const raw = dq ?? sq ?? bare;
    const resolved = resolveUrl(raw?.trim(), pageUrl);
    if (!resolved || resolved.includes('/api/proxy')) return match;
    return `url("/api/proxy?url=${encodeURIComponent(resolved)}")`;
  });

  // Remove CSP meta tags
  html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

  // Inject base tag
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head><base href="${pageUrl}">`);
  }

  return html;
}

// GET — proxy any asset (image, CSS, JS, font)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) return new NextResponse('url param required', { status: 400 });

  let validUrl;
  try {
    validUrl = new URL(decodeURIComponent(url)).href;
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  try {
    const res = await fetch(validUrl, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000),
    });

    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const body = await res.arrayBuffer();

    return new NextResponse(body, {
      status: res.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    if (err.name === 'TimeoutError') return new NextResponse('Timeout', { status: 504 });
    return new NextResponse(err.message, { status: 502 });
  }
}

// POST — fetch full HTML page, rewrite all asset URLs
export async function POST(request) {
  let url;
  try {
    ({ url } = await request.json());
  } catch {
    return new NextResponse('Invalid JSON body', { status: 400 });
  }

  if (!url) return new NextResponse('URL is required', { status: 400 });

  let validUrl;
  try {
    validUrl = url.startsWith('http://') || url.startsWith('https://')
      ? url
      : 'https://' + url;
    new URL(validUrl);
  } catch {
    return new NextResponse('Invalid URL format', { status: 400 });
  }

  try {
    const res = await fetch(validUrl, {
      headers: { ...HEADERS, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Upgrade-Insecure-Requests': '1' },
      signal: AbortSignal.timeout(30000),
    });

    const html = await res.text();
    if (!html?.trim()) return new NextResponse('Empty response from target', { status: 502 });

    const rewritten = rewriteHtml(html, res.url || validUrl);

    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Final-Url': res.url || validUrl,
      },
    });
  } catch (err) {
    if (err.name === 'TimeoutError') return new NextResponse('Request timeout', { status: 504 });
    return new NextResponse(err.message || 'Proxy error', { status: 502 });
  }
}
