/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const CACHE_SECONDS = 15720000; // 半年

// 豆瓣图床只认豆瓣来源；其他图床用图片自身站点作来源，避免被防盗链拦截
function refererFor(url: URL): string {
  if (/(^|\.)doubanio\.com$/i.test(url.hostname)) {
    return 'https://movie.douban.com/';
  }
  return `${url.protocol}//${url.host}/`;
}

// OrionTV 兼容接口，同时作为网页端海报/剧照的兜底代理
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(imageUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }

  // Cloudflare 边缘缓存：同一张图在同一节点只回源一次
  const cache: Cache | undefined = (globalThis as any).caches?.default;
  const cacheKey = new Request(
    `https://image-proxy.cache/${encodeURIComponent(target.toString())}`
  );
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch {
      // 缓存不可用时直接回源
    }
  }

  try {
    let imageResponse = await fetch(target.toString(), {
      headers: { Referer: refererFor(target), 'User-Agent': UA },
    });
    // 部分图床拒绝任何外部来源，去掉 Referer 再试一次
    if (imageResponse.status === 403 || imageResponse.status === 401) {
      imageResponse = await fetch(target.toString(), {
        headers: { 'User-Agent': UA },
      });
    }

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status }
      );
    }

    const contentType = imageResponse.headers.get('content-type') || '';
    // 只转发图片，防止被当成任意网页代理
    if (contentType && !contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Not an image' }, { status: 415 });
    }

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType || 'image/jpeg');
    headers.set(
      'Cache-Control',
      `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, immutable`
    );
    headers.set('CDN-Cache-Control', `public, s-maxage=${CACHE_SECONDS}`);

    const response = new Response(imageResponse.body, { status: 200, headers });
    if (cache) {
      try {
        await cache.put(cacheKey, response.clone());
      } catch {
        // 忽略缓存写入失败
      }
    }
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 500 }
    );
  }
}
