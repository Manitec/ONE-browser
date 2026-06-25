import { NextResponse } from 'next/server';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'en-US,en;q=0.5',
};

function extractMeta(html, baseUrl) {
  const get = (prop) => {
    const m =
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
    return m ? m[1].trim() : null;
  };

  const title =
    get('og:title') ||
    get('twitter:title') ||
    (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()) ||
    null;

  const description =
    get('og:description') ||
    get('twitter:description') ||
    get('description') ||
    null;

  let image =
    get('og:image') ||
    get('twitter:image') ||
    get('twitter:image:src') ||
    null;

  // Resolve relative image URLs
  if (image && !image.startsWith('http')) {
    try { image = new URL(image, baseUrl).href; } catch { image = null; }
  }

  // Fallback: first <img> with a real src
  if (!image) {
    const imgMatch = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (imgMatch) image = imgMatch[1];
  }

  const favicon = (() => {
    const m = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
    if (!m) return null;
    try { return new URL(m[1], baseUrl).href; } catch { return null; }
  })();

  return { title, description, image, favicon };
}

export async function POST(request) {
  let url;
  try { ({ url } = await request.json()); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  let validUrl;
  try {
    validUrl = url.startsWith('http') ? url : 'https://' + url;
    new URL(validUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  try {
    const res = await fetch(validUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    const meta = extractMeta(html, res.url || validUrl);
    return NextResponse.json({ ...meta, finalUrl: res.url || validUrl });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
