/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

import { parseSubscription, toTvM3u } from '@/lib/live-subscription';

export const runtime = 'edge';

const MAX_BYTES = 8 * 1024 * 1024;
const CACHE_SECONDS = 1800;

/**
 * 电视客户端订阅清洗：/tv/filter.m3u?url=<任意 m3u / txt 订阅>
 * 按 src/lib/channel-rules.js 只保留中文正规电视台，输出 m3u。
 * /tv/ 路径免登录（电视客户端无法登录），只返回清洗后的频道列表。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let target: URL;
  try {
    target = new URL(searchParams.get('url') || '');
    if (!/^https?:$/.test(target.protocol)) throw new Error('protocol');
  } catch {
    return NextResponse.json(
      { error: '用法：/tv/filter.m3u?url=订阅地址' },
      { status: 400 }
    );
  }

  const cache: Cache | undefined = (globalThis as any).caches?.default;
  const cacheKey = new Request(
    `https://tv-filter.cache/${encodeURIComponent(target.toString())}`
  );
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let text = '';
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
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) {
      return NextResponse.json({ error: '订阅文件过大' }, { status: 413 });
    }
    text = await res.text();
    if (text.length > MAX_BYTES) {
      return NextResponse.json({ error: '订阅文件过大' }, { status: 413 });
    }
  } catch {
    return NextResponse.json({ error: '订阅地址无法访问' }, { status: 502 });
  }

  const entries = parseSubscription(text);
  if (!entries.length) {
    return NextResponse.json(
      { error: '不是 m3u 或 txt 直播订阅' },
      { status: 415 }
    );
  }

  const response = new Response(toTvM3u(entries), {
    headers: {
      'Content-Type': 'audio/x-mpegurl; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
    },
  });
  if (cache) {
    const ctx = (globalThis as any)[
      Symbol.for('__cloudflare-request-context__')
    ]?.ctx;
    const put = cache.put(cacheKey, response.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return response;
}
