import { NextResponse } from 'next/server';

// /api/see — gives Plex eyes on a page
//
// pageUrl path  → server-fetches page, extracts text, sends JSON to PLEX_OBSERVE_URL (/api/observe)
// imageUrl path → legacy FormData forward to PLEX_SEE_URL (/api/see)
//
// Required env:
//   PLEX_OBSERVE_URL  e.g. https://plex-sable.vercel.app/api/observe
//   PLEX_SEE_URL      e.g. https://plex-sable.vercel.app/api/see  (legacy images)

function extractPageContent(html, url) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  const metaMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const description = metaMatch ? metaMatch[1].trim() : '';

  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  const ogDescMatch  = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);

  let body = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,  ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi,      ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi,' ')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi,    ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi,' ');

  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  return {
    title:       title || ogTitleMatch?.[1] || '',
    description: description || ogDescMatch?.[1] || '',
    text,
  };
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { imageUrl, pageUrl, prompt, selectedText } = body;

  if (!imageUrl && !pageUrl) {
    return NextResponse.json({ error: 'imageUrl or pageUrl required' }, { status: 400 });
  }

  // ----------------------------------------------------------------
  // LEGACY: image-only → plex-sable /api/see (FormData + vision model)
  // ----------------------------------------------------------------
  if (imageUrl && !pageUrl) {
    const plexSeeUrl = process.env.PLEX_SEE_URL;
    if (!plexSeeUrl) return NextResponse.json({ error: 'PLEX_SEE_URL not configured' }, { status: 500 });

    const form = new FormData();
    form.append('prompt', prompt?.trim() || 'What do you see in this image?');
    form.append('imageUrl', imageUrl);
    try {
      const res  = await fetch(plexSeeUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
      const data = await res.json();
      if (!res.ok) return NextResponse.json({ error: data.error || 'Plex error' }, { status: res.status });
      return NextResponse.json({ response: data.response });
    } catch (err) {
      return NextResponse.json({ error: 'Could not reach Plex', detail: err.message }, { status: 502 });
    }
  }

  // ----------------------------------------------------------------
  // PAGE path → server-fetch + extract → plex-sable /api/observe (JSON)
  // ----------------------------------------------------------------
  const plexObserveUrl = process.env.PLEX_OBSERVE_URL;
  if (!plexObserveUrl) return NextResponse.json({ error: 'PLEX_OBSERVE_URL not configured' }, { status: 500 });

  // 1. Fetch the page server-side
  let pageContent;
  try {
    const pageRes = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ONE-browser/1.0; +https://manitec.pw)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!pageRes.ok) {
      return NextResponse.json({ error: `Page fetch failed: ${pageRes.status}` }, { status: 502 });
    }
    const contentType = pageRes.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return NextResponse.json({ error: 'URL does not return HTML' }, { status: 400 });
    }
    const html = await pageRes.text();
    pageContent = extractPageContent(html, pageUrl);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch page', detail: err.message }, { status: 502 });
  }

  // 2. Send to plex-sable /api/observe as JSON
  const observePayload = {
    url:          pageUrl,
    title:        pageContent.title   || undefined,
    pageText:     pageContent.text    || undefined,
    selectedText: selectedText        || undefined,
    source:       'one-browser',
    sessionId:    'joe',
    silent:       false,
  };

  try {
    const res  = await fetch(plexObserveUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(observePayload),
      signal:  AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.error || 'Plex error' }, { status: res.status });
    return NextResponse.json({
      response: data.response,
      observed: data.observed,
      id:       data.id,
      meta: {
        title:       pageContent.title,
        description: pageContent.description,
        textLength:  pageContent.text.length,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Could not reach Plex', detail: err.message }, { status: 502 });
  }
}
