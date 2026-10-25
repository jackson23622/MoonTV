// 直播边缘代理的纯函数部分（地址校验、m3u8 改写），供 /api/live/proxy 与单测使用

export const LIVE_PROXY_PATH = '/api/live/proxy';

export function proxied(url: string): string {
  return `${LIVE_PROXY_PATH}?u=${encodeURIComponent(url)}`;
}

/** 只允许公网 http(s) 地址：挡掉本机、内网、链路本地等地址，避免被当作内网探测跳板 */
export function isAllowedTarget(raw: string | null): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (!host.includes('.') && !host.includes(':'))
  )
    return null;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
      return null;
  }
  if (host.includes(':')) {
    if (
      host === '::1' ||
      host === '::' ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:')
    )
      return null;
  }
  return u;
}

/** 看起来是播放列表（而不是视频分片）的地址 / 类型 */
export function maybePlaylist(url: URL, contentType: string): boolean {
  if (/mpegurl|m3u/i.test(contentType)) return true;
  if (/\.m3u8?$/i.test(url.pathname)) return true;
  if (/^text\//i.test(contentType)) return true;
  // 动态脚本地址（.php 等）常以 octet-stream 返回列表；有媒体扩展名的才认定是分片
  return !/\.(ts|m4s|mp4|m4v|m4a|aac|mp3|fmp4|cmfv|cmfa|key|jpe?g|png|webp)$/i.test(
    url.pathname
  );
}

/** 改写 m3u8：所有子列表、分片、密钥、初始化分片地址都改为经本站代理的绝对地址 */
export function rewritePlaylist(text: string, baseUrl: string): string {
  const abs = (ref: string) => {
    const r = ref.trim();
    if (!r || r.startsWith('data:')) return r;
    try {
      return proxied(new URL(r, baseUrl).toString());
    } catch {
      return r;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#'))
        return t.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${abs(u)}"`);
      return abs(t);
    })
    .join('\n');
}

/** 明显不是音视频的响应（网页、脚本等）一律拒绝，防止代理被当作通用网页代理 */
export function isForbiddenContentType(contentType: string): boolean {
  return /text\/html|javascript|application\/json|text\/css|xml/i.test(
    contentType
  );
}
