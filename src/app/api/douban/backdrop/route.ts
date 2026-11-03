/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

import {
  BackdropKind,
  buildPhotosUrl,
  isValidDoubanId,
  pickBackdrop,
} from '@/lib/douban.backdrop';

export const runtime = 'edge';

// 剧照基本不变，豆瓣限流又严，缓存一天
const CACHE_SECONDS = 86400;

/** 首页大图：返回影片的一张横版剧照 { url, width, height }，没有时 { url: null } */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kind = (
    searchParams.get('kind') === 'tv' ? 'tv' : 'movie'
  ) as BackdropKind;
  const id = searchParams.get('id');
  if (!isValidDoubanId(id)) {
    return NextResponse.json({ error: 'id 不正确' }, { status: 400 });
  }

  const cache: Cache | undefined = (globalThis as any).caches?.default;
  const cacheKey = new Request(`https://douban-backdrop.cache/${kind}/${id}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let body: Record<string, unknown> = { url: null };
  let ok = true;
  try {
    const res = await fetch(buildPhotosUrl(kind, id), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Referer: 'https://m.douban.com/',
        Accept: 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      body = { ...(pickBackdrop(await res.json()) || { url: null }) };
    } else {
      ok = false;
    }
  } catch {
    ok = false;
  }

  const response = NextResponse.json(body, {
    headers: {
      // 失败只短暂缓存，避免一次限流导致一整天没有大图
      'Cache-Control': `public, max-age=${ok ? CACHE_SECONDS : 300}`,
    },
  });
  if (cache && ok) {
    const ctx = (globalThis as any)[
      Symbol.for('__cloudflare-request-context__')
    ]?.ctx;
    const put = cache.put(cacheKey, response.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return response;
}
