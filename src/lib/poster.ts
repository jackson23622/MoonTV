// 封面多线路加载：国内直连优先，失败逐级回退，并换用更清晰的豆瓣规格

const DOUBAN_IMG_RE = /^https?:\/\/img\d*\.doubanio\.com(\/.*)$/i;
const DOUBAN_HOSTS = ['img9', 'img3', 'img1', 'img2'];
// 社区维护的豆瓣图片镜像（Cloudflare 加速），最后兜底
const DOUBAN_MIRRORS = ['https://img.doubanio.cmliussss.net', 'https://img.doubanio.cmliussss.com'];

export type PosterSize = 'card' | 'large';

/** 豆瓣封面换成更清晰的规格：卡片用 m（约 2 倍于卡片宽度），详情页用 l */
export function sharpenDouban(url: string, size: PosterSize = 'card'): string {
  const target = size === 'large' ? 'l_ratio_poster' : 'm_ratio_poster';
  return url.replace(/\/(s|m|l)_ratio_poster\//, `/${target}/`);
}

/** 生成按优先级排列的候选地址（已去重） */
export function posterCandidates(
  raw: string | undefined | null,
  size: PosterSize = 'card',
  proxyWrap?: (u: string) => string
): string[] {
  if (!raw) return [];
  let url = raw.trim();
  if (url.startsWith('//')) url = 'https:' + url;
  const list: string[] = [];

  const m = url.match(DOUBAN_IMG_RE);
  if (m) {
    const sharp = sharpenDouban(`https://img9.doubanio.com${m[1]}`, size);
    const path = sharp.replace(/^https:\/\/img9\.doubanio\.com/, '');
    const original = url.replace(/^http:/i, 'https:');
    const originalSharp = sharpenDouban(original, size);
    // 用户自定义的图片代理优先
    if (proxyWrap) {
      const proxied = proxyWrap(originalSharp);
      if (proxied !== originalSharp) list.push(proxied);
    }
    list.push(originalSharp);
    for (const h of DOUBAN_HOSTS) list.push(`https://${h}.doubanio.com${path}`);
    list.push(`/api/image-proxy?url=${encodeURIComponent(originalSharp)}`);
    for (const mirror of DOUBAN_MIRRORS) list.push(`${mirror}${path}`);
    // 清晰版都失败时，再试一次原始规格
    if (originalSharp !== original) list.push(original);
  } else {
    if (proxyWrap) {
      const proxied = proxyWrap(url);
      if (proxied !== url) list.push(proxied);
    }
    // http 封面在 https 页面会被浏览器拦截：先升级 https，再经本站代理
    if (/^http:\/\//i.test(url)) {
      list.push(url.replace(/^http:/i, 'https:'));
      list.push(`/api/image-proxy?url=${encodeURIComponent(url)}`);
    } else {
      list.push(url);
      if (/^https:\/\//i.test(url)) {
        list.push(`/api/image-proxy?url=${encodeURIComponent(url)}`);
      }
    }
  }
  return Array.from(new Set(list));
}
