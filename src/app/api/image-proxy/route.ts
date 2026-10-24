/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CACHE_SECONDS = 15720000; // 半年

function refererFor(url: URL): string {
  if (/(^|\.)doubanio\.com$/i.test(url.hostname)) return 'https://movie.douban.com/';
  return `${url.protocol}//${url.host}/`;
}

// 图片代理（OrionTV 兼容接口）：封面直连失败时的回退线路，结果缓存在 Cloudflare 边缘
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(imageUrl);
    if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
  } catch {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }

  // Cloudflare 边缘缓存（Pages Functions 不会自动缓存函数响应）
  const cache: Cache | undefined = (globalThis as any).caches?.default;
  const cacheKey = new Request(`https://image-proxy.cache/${encodeURIComponent(target.toString())}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        Referer: refererFor(target),
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: upstream.statusText || 'Upstream error' },
        { status: upstream.ok ? 502 : upstream.status }
      );
    }
    // 只代理图片，防止被当作通用代理滥用
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Not an image' }, { status: 415 });
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}, immutable`);
    headers.set('CDN-Cache-Control', `public, s-maxage=${CACHE_SECONDS}`);
    headers.set('Access-Control-Allow-Origin', '*');

    const response = new Response(upstream.body, { status: 200, headers });
    if (cache) {
      const ctx = (globalThis as any)[Symbol.for('__cloudflare-request-context__')]?.ctx;
      const put = cache.put(cacheKey, response.clone());
      if (ctx?.waitUntil) ctx.waitUntil(put);
      else await put;
    }
    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Error fetching image' }, { status: 500 });
  }
}
