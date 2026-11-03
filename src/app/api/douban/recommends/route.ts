import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import {
  buildDoubanRecommendUrl,
  DoubanMediaType,
  DoubanRecommendApiResponse,
  normalizeFilters,
  parseDoubanRecommend,
} from '@/lib/douban.filters';
import { DoubanResult } from '@/lib/types';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const type = (searchParams.get('type') || 'movie') as DoubanMediaType;
  if (!['movie', 'tv', 'show'].includes(type)) {
    return NextResponse.json(
      { error: 'type 参数必须是 movie / tv / show' },
      { status: 400 }
    );
  }

  const limit = parseInt(searchParams.get('limit') || '25');
  const start = parseInt(searchParams.get('start') || '0');
  if (!(limit >= 1 && limit <= 100) || !(start >= 0)) {
    return NextResponse.json(
      { error: 'limit 需在 1-100 之间，start 不能小于 0' },
      { status: 400 }
    );
  }

  const filters = normalizeFilters(type, {
    genre: searchParams.get('genre'),
    region: searchParams.get('region'),
    year: searchParams.get('year'),
    platform: searchParams.get('platform'),
    sort: searchParams.get('sort'),
  });

  const target = buildDoubanRecommendUrl({ type, start, limit, ...filters });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: 'https://movie.douban.com/',
        Accept: 'application/json, text/plain, */*',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP error! Status: ${res.status}`);
    }

    const data: DoubanRecommendApiResponse = await res.json();
    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: parseDoubanRecommend(data),
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}`,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { error: '获取豆瓣筛选数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
