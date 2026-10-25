import { NextResponse } from 'next/server';

export const runtime = 'edge';

const MAX_BYTES = 8 * 1024 * 1024;

// 代为拉取第三方直播订阅（多数订阅站不允许浏览器跨域读取）。需登录（经 middleware），只返回 m3u / txt 文本
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('url');
  let target: URL;
  try {
    target = new URL(raw || '');
    if (!/^https?:$/.test(target.protocol)) throw new Error('protocol');
  } catch {
    return NextResponse.json({ error: '订阅地址无效' }, { status: 400 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: { 'User-Agent': 'okhttp/4.12.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `订阅地址返回 HTTP ${res.status}` },
        { status: 502 }
      );
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) {
      return NextResponse.json({ error: '订阅文件过大' }, { status: 413 });
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) {
      return NextResponse.json({ error: '订阅文件过大' }, { status: 413 });
    }
    const looksLikeList =
      /#EXTINF/i.test(text) ||
      /,#genre#/i.test(text) ||
      /^[^,\n]+,https?:\/\//m.test(text);
    if (!looksLikeList) {
      return NextResponse.json(
        { error: '不是 m3u 或 txt 直播订阅' },
        { status: 415 }
      );
    }
    return new Response(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, max-age=600',
      },
    });
  } catch {
    return NextResponse.json({ error: '订阅地址无法访问' }, { status: 502 });
  }
}
