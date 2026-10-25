import {
  isAllowedTarget,
  isForbiddenContentType,
  maybePlaylist,
  rewritePlaylist,
} from '@/lib/live-proxy';

export const runtime = 'edge';

const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function fail(status: number, msg: string) {
  return new Response(msg, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * 直播边缘代理：网页无法直连的线路（http、不允许跨域）经 Cloudflare 边缘转发。
 * 播放列表改写为经本站代理的地址；分片以流的方式原样转发，不缓存、不落盘。需登录（经 middleware）。
 */
export async function GET(request: Request) {
  const target = isAllowedTarget(new URL(request.url).searchParams.get('u'));
  if (!target) return fail(400, 'invalid url');

  const headers: Record<string, string> = {
    'User-Agent': request.headers.get('user-agent') || UA,
    Accept: '*/*',
  };
  const range = request.headers.get('range');
  if (range) headers.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return fail(502, 'upstream unreachable');
  }
  if (!upstream.ok) {
    upstream.body?.cancel();
    return fail(
      upstream.status === 404 ? 404 : 502,
      'upstream ' + upstream.status
    );
  }

  const contentType = upstream.headers.get('content-type') || '';
  // 网页、脚本等非音视频内容拒绝转发（个别服务器把 m3u8 标成 text/html，先嗅探再判断）
  const forbidden = isForbiddenContentType(contentType);
  const finalUrl = upstream.url || target.toString();

  if (maybePlaylist(new URL(finalUrl), contentType)) {
    const len = Number(upstream.headers.get('content-length') || 0);
    if (len <= MAX_PLAYLIST_BYTES) {
      const buf = new Uint8Array(await upstream.arrayBuffer());
      const head = new TextDecoder()
        .decode(buf.subarray(0, 16))
        .replace(/^\uFEFF/, '');
      if (head.startsWith('#EXTM3U')) {
        const text = new TextDecoder().decode(buf);
        return new Response(rewritePlaylist(text, finalUrl), {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
      if (forbidden) return fail(415, 'not a media stream');
      // 不是列表（无扩展名的分片地址）：原样返回
      return new Response(buf, {
        status: upstream.status,
        headers: {
          'Content-Type': contentType || 'video/mp2t',
          'Cache-Control': 'private, max-age=60',
        },
      });
    }
  }

  if (forbidden) {
    upstream.body?.cancel();
    return fail(415, 'not a media stream');
  }
  // 分片 / 密钥：流式转发
  const out = new Headers({
    'Content-Type': contentType || 'video/mp2t',
    'Cache-Control': 'private, max-age=60',
  });
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
