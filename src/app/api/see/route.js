import { NextResponse } from 'next/server';

// /api/see — gives Plex eyes on a page
// Accepts: { pageUrl, prompt } OR { imageUrl, prompt } (legacy image path preserved)
// If pageUrl is provided: fetches server-side, extracts text+images, sends to Plex as structured prompt
// If only imageUrl: legacy path — forwards image directly to Plex-Sable
// Required env: PLEX_SEE_URL (e.g. https://plex-sable.vercel.app/api/see)

function extractPageContent(html, url) {
  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Meta description
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const description = metaMatch ? metaMatch[1].trim() : '';

  // OG title/description as fallback
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);

  // Strip scripts, styles, nav, footer, head
  let body = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ');

  // Extract image srcs
  const imgMatches = [...body.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
  const images = imgMatches
    .map(m => {
      const src = m[1];
      if (src.startsWith('http')) return src;
      if (src.startsWith('//')) return 'https:' + src;
      if (src.startsWith('/')) {
        try { const u = new URL(url); return u.origin + src; } catch { return null; }
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 10);

  // Strip all remaining tags, decode entities, collapse whitespace
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000); // keep it tight for the prompt

  return {
    title: title || ogTitleMatch?.[1] || '',
    description: description || ogDescMatch?.[1] || '',
    text,
    images,
  };
}

export async function POST(request) {
  const plexSeeUrl = process.env.PLEX_SEE_URL;
  if (!plexSeeUrl) {
    return NextResponse.json({ error: 'PLEX_SEE_URL not configured' }, { status: 500 });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { imageUrl, pageUrl, prompt } = body;

  if (!imageUrl && !pageUrl) {
    return NextResponse.json({ error: 'imageUrl or pageUrl required' }, { status: 400 });
  }

  // --- LEGACY: image-only path ---
  if (imageUrl && !pageUrl) {
    const contextPrompt = prompt?.trim() || `What do you see in this image?`;
    const form = new FormData();
    form.append('prompt', contextPrompt);
    form.append('imageUrl', imageUrl);
    try {
      const res = await fetch(plexSeeUrl, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json({ error: data.error || 'Plex error' }, { status: res.status });
      return NextResponse.json({ response: data.response });
    } catch (err) {
      return NextResponse.json({ error: 'Could not reach Plex', detail: err.message }, { status: 502 });
    }
  }

  // --- NEW: server-side page reading path ---
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

  // Build structured prompt for Plex
  const lines = [
    `Joe is asking you to read this page: ${pageUrl}`,
    pageContent.title ? `Page title: "${pageContent.title}"` : null,
    pageContent.description ? `Description: ${pageContent.description}` : null,
    pageContent.images.length > 0 ? `Images on page: ${pageContent.images.join(', ')}` : null,
    `Page content:\n${pageContent.text}`,
    prompt ? `Joe's question: ${prompt}` : 'What can you tell Joe about this page?',
  ].filter(Boolean).join('\n\n');

  const form = new FormData();
  form.append('prompt', lines);
  // Send first image if available so Plex can also see it visually
  if (pageContent.images[0]) form.append('imageUrl', pageContent.images[0]);

  try {
    const res = await fetch(plexSeeUrl, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.error || 'Plex error' }, { status: res.status });
    return NextResponse.json({
      response: data.response,
      meta: {
        title: pageContent.title,
        description: pageContent.description,
        imageCount: pageContent.images.length,
        textLength: pageContent.text.length,
      }
    });
  } catch (err) {
    return NextResponse.json({ error: 'Could not reach Plex', detail: err.message }, { status: 502 });
  }
}
