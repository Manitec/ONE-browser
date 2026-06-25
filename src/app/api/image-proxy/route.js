import { NextResponse } from 'next/server';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://www.google.com/',
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return new NextResponse('Missing url param', { status: 400 });
  }

  let validUrl;
  try {
    validUrl = decodeURIComponent(imageUrl);
    new URL(validUrl); // validate
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  // Only allow http/https
  if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
    return new NextResponse('Only http/https allowed', { status: 400 });
  }

  try {
    const res = await fetch(validUrl, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!res.ok) {
      return new NextResponse(`Upstream error: ${res.status}`, { status: res.status });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';

    // Only allow image content types
    if (!contentType.startsWith('image/') && !contentType.startsWith('application/octet-stream')) {
      return new NextResponse('Not an image', { status: 415 });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new NextResponse(`Failed: ${err.message}`, { status: 502 });
  }
}
