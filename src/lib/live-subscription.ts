// 直播订阅：解析 m3u / txt 订阅，并与本站网页已验证线路合并

export interface LiveChannel {
  name: string;
  logo?: string;
  urls: string[];
  hd?: boolean;
  height?: number;
  /** 订阅里只有 http 线路、且没有网页已验证线路：浏览器无法播放，仅电视客户端可用 */
  tvOnly?: boolean;
}
export interface LiveGroup {
  name: string;
  channels: LiveChannel[];
}
export interface LiveData {
  updatedAt?: string;
  sources?: { name: string; url: string }[];
  groups: LiveGroup[];
}

export const DEFAULT_SUBSCRIPTION = 'https://bde4.dpdns.org/tv/live.m3u';
export const SUBSCRIPTION_KEY = 'live_subscription_url';
const MAX_WEB_URLS = 4;

interface RawEntry {
  name: string;
  url: string;
  group: string;
  logo?: string;
}

/** 解析 m3u（#EXTINF）或 txt（「分组,#genre#」+「名称,地址」）订阅 */
export function parseSubscription(text: string): RawEntry[] {
  const out: RawEntry[] = [];
  if (!text) return out;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  if (/#EXTINF/i.test(text)) {
    let info: Omit<RawEntry, 'url'> | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const attr = (k: string) =>
          (line.match(new RegExp(`${k}="([^"]*)"`, 'i')) || [])[1] || '';
        info = {
          name:
            line.slice(line.lastIndexOf(',') + 1).trim() || attr('tvg-name'),
          group: attr('group-title') || '默认分组',
          logo: attr('tvg-logo') || undefined,
        };
      } else if (!line.startsWith('#') && info && /^https?:\/\//i.test(line)) {
        out.push({ ...info, url: line });
        info = null;
      }
    }
    return out;
  }

  let group = '默认分组';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const idx = line.indexOf(',');
    if (idx < 0) continue;
    const left = line.slice(0, idx).trim();
    const right = line.slice(idx + 1).trim();
    if (right === '#genre#') {
      group = left || group;
      continue;
    }
    // 一行多个地址用 # 分隔（DIYP 习惯）
    for (const url of right.split('#')) {
      if (/^https?:\/\//i.test(url.trim()))
        out.push({ name: left, url: url.trim(), group });
    }
  }
  return out;
}

/** 频道名比较用的 key：去空白、去「频道/台」结尾、统一大小写 */
export function channelKey(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/(频道|頻道|台)$/, '')
    .toUpperCase();
}

/**
 * 把订阅转换为网页可播放的频道列表。
 * webVerified：本站检测过的网页可播线路（channels.json），同名频道优先用它们。
 */
export function buildLiveData(
  entries: RawEntry[],
  webVerified?: LiveData | null
): LiveData {
  const verified = new Map<string, LiveChannel>();
  for (const g of webVerified?.groups || []) {
    for (const c of g.channels)
      if (!verified.has(channelKey(c.name)))
        verified.set(channelKey(c.name), c);
  }

  const groups = new Map<
    string,
    Map<string, { name: string; logo?: string; urls: string[] }>
  >();
  for (const e of entries) {
    if (!e.name) continue;
    if (!groups.has(e.group)) groups.set(e.group, new Map());
    const g = groups.get(e.group) as Map<
      string,
      { name: string; logo?: string; urls: string[] }
    >;
    const key = channelKey(e.name);
    if (!g.has(key)) g.set(key, { name: e.name, logo: e.logo, urls: [] });
    const ch = g.get(key) as { name: string; logo?: string; urls: string[] };
    if (!ch.logo && e.logo) ch.logo = e.logo;
    const clean = e.url.split('#')[0];
    if (!ch.urls.includes(clean)) ch.urls.push(clean);
  }

  const result: LiveGroup[] = [];
  groups.forEach((chans, groupName) => {
    const channels: LiveChannel[] = [];
    chans.forEach((ch, key) => {
      const v = verified.get(key);
      const https = ch.urls.filter((u) => u.startsWith('https://'));
      // http 线路浏览器会拦截：只尝试一条升级为 https 的地址，避免逐条超时等待
      const upgraded = ch.urls
        .filter((u) => u.startsWith('http://'))
        .slice(0, 1)
        .map((u) => 'https://' + u.slice(7));
      const urls = Array.from(
        new Set([...(v?.urls || []), ...https, ...(v ? [] : upgraded)])
      ).slice(0, MAX_WEB_URLS);
      const tvOnly = !v && https.length === 0;
      channels.push({
        name: ch.name,
        logo:
          (ch.logo && ch.logo.startsWith('https://') ? ch.logo : undefined) ||
          v?.logo,
        urls,
        hd: v?.hd,
        height: v?.height,
        tvOnly,
      });
    });
    // 网页能播的排前面
    channels.sort((a, b) => Number(!!a.tvOnly) - Number(!!b.tvOnly));
    if (channels.length) result.push({ name: groupName, channels });
  });
  return {
    groups: result,
    updatedAt: webVerified?.updatedAt,
    sources: webVerified?.sources,
  };
}
