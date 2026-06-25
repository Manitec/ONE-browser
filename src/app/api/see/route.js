import { NextResponse } from 'next/server';

// Proxies to Plex-Sable /api/see
// Required env var: PLEX_SEE_URL (e.g. https://plex-sable.vercel.app/api/see)

export async function POST(request) {
  const plexSeeUrl = process.env.PLEX_SEE_URL;
  if (!plexSeeUrl) {
    return NextResponse.json({ error: 'PLEX_SEE_URL not configured' }, { status: 500 });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { imageUrl, prompt, pageUrl, pageTitle } = body;

  if (!imageUrl && !pageUrl) {
    return NextResponse.json({ error: 'imageUrl or pageUrl required' }, { status: 400 });
  }

  const contextPrompt = prompt?.trim() ||
    `Joe is browsing: ${pageTitle ? `"${pageTitle}" — ` : ''}${pageUrl || imageUrl}. What do you see?`;

  const form = new FormData();
  form.append('prompt', contextPrompt);
  if (imageUrl) form.append('imageUrl', imageUrl);

  try {
    const res = await fetch(plexSeeUrl, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error || 'Plex error', detail: data.detail }, { status: res.status });
    }
    return NextResponse.json({ response: data.response });
  } catch (err) {
    return NextResponse.json({ error: 'Could not reach Plex', detail: err.message }, { status: 502 });
  }
}
