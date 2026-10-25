// 直播订阅：解析 m3u / txt 订阅，套用频道剔除规则，并与本站网页已验证线路合并

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rules = require('./channel-rules');
const PROXY_PREFIX: string = rules.PROXY_PREFIX;
const toProxyUrl: (u: string) => string = rules.toProxyUrl;

export interface LiveChannel {
  name: string;
  logo?: string;
  urls: string[];
  /** 每条线路的类型：d 直连、p 经本站代理、c 国内线路（境外连不上），与 urls 一一对应 */
  kinds?: string;
  /** 只有国内线路：在境外可能看不了 */
  cn?: boolean;
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
  /** 订阅里网页无法播放（只有 http 线路）而被隐藏的频道数 */
  hidden?: number;
}

/** 默认：直接使用本站每 6 小时检测生成的频道（多线路、台标、节目单），不经订阅解析 */
export const DEFAULT_SUBSCRIPTION = '';
/** 本站电视订阅（OrionTV 等电视客户端填这个） */
export const SITE_SUBSCRIPTION = 'https://bde4.dpdns.org/tv/live.m3u';
/** 订阅预设（网页一键切换） */
export const SUBSCRIPTION_PRESETS = [
  { name: '本站频道（jackson23622/live）', url: DEFAULT_SUBSCRIPTION },
];
export const SUBSCRIPTION_KEY = 'live_subscription_url';
const MAX_WEB_URLS = 6;

/** 读取保存的订阅；旧版保存的「本站电视订阅」也视为默认（网页直接用本站数据效果更好） */
export function normalizeSubscription(url: string | null | undefined): string {
  const v = (url || '').trim();
  if (!v || v === SITE_SUBSCRIPTION || v.endsWith('/tv/live.m3u'))
    return DEFAULT_SUBSCRIPTION;
  return v;
}

/** IP 字面地址：Cloudflare 边缘函数无法代理 */
function isIpHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith('[');
  } catch {
    return true;
  }
}

export interface RawEntry {
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

/**
 * 套用频道剔除规则（src/lib/channel-rules.js）：只保留中文正规电视台，
 * 并把频道名、分组统一为规则里的标准名称。
 */
export function applyChannelRules(entries: RawEntry[]): RawEntry[] {
  const out: RawEntry[] = [];
  for (const e of entries) {
    const n = rules.classifyChannel({
      name: e.name,
      group: e.group,
      url: e.url,
    });
    if (n) out.push({ ...e, name: n.name, group: n.group });
  }
  return out;
}

/** 按规则里的分组顺序排列分组名 */
export function groupOrder(name: string): number {
  const i = (rules.GROUP_ORDER as string[]).indexOf(name);
  return i < 0 ? 999 : i;
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
  webVerified?: LiveData | null,
  /** 本站订阅：只显示本站检测过网页能播的频道（未验证的线路多半跨域受限或黑屏） */
  strict = false
): LiveData {
  const verified = new Map<string, LiveChannel>();
  for (const g of webVerified?.groups || []) {
    for (const c of g.channels)
      if (!verified.has(channelKey(c.name)))
        verified.set(channelKey(c.name), c);
  }

  type Acc = { name: string; logo?: string; urls: string[] };
  const groups = new Map<string, Map<string, Acc>>();
  for (const e of applyChannelRules(entries)) {
    if (!e.name) continue;
    if (!groups.has(e.group)) groups.set(e.group, new Map());
    const g = groups.get(e.group) as Map<string, Acc>;
    const key = channelKey(e.name);
    if (!g.has(key)) g.set(key, { name: e.name, logo: e.logo, urls: [] });
    const ch = g.get(key) as Acc;
    if (!ch.logo && e.logo) ch.logo = e.logo;
    const clean = e.url.split('#')[0];
    if (!ch.urls.includes(clean)) ch.urls.push(clean);
  }

  const result: LiveGroup[] = [];
  let hidden = 0;
  groups.forEach((chans, groupName) => {
    const channels: LiveChannel[] = [];
    chans.forEach((ch, key) => {
      const v = verified.get(key);
      const lines: { url: string; kind: string }[] = [];
      const seen = new Set<string>();
      const add = (url: string, kind: string) => {
        const k = url.startsWith(PROXY_PREFIX)
          ? decodeURIComponent(url.slice(PROXY_PREFIX.length))
          : url;
        const id = k.replace(/^https?:\/\//, '');
        if (seen.has(id)) return;
        seen.add(id);
        lines.push({ url, kind });
      };
      // 本站检测过的线路排最前
      (v?.urls || []).forEach((u, i) => add(u, v?.kinds?.[i] || 'd'));
      if (!strict) {
        // 订阅里的 https 线路先直连；http 线路浏览器会拦截，改走本站代理（IP 地址线路代理不了）
        ch.urls
          .filter((u) => u.startsWith('https://'))
          .forEach((u) => add(u, 'd'));
        ch.urls
          .filter((u) => u.startsWith('http://') && !isIpHost(u))
          .forEach((u) => add(toProxyUrl(u), 'p'));
      }
      const picked = lines.slice(0, MAX_WEB_URLS);
      // 网页无法播放的频道不显示（电视订阅里仍保留）
      if (!picked.length) {
        hidden++;
        return;
      }
      channels.push({
        name: ch.name,
        logo:
          v?.logo ||
          (ch.logo && ch.logo.startsWith('https://') ? ch.logo : undefined),
        urls: picked.map((x) => x.url),
        kinds: picked.map((x) => x.kind).join(''),
        cn: v?.cn,
        hd: v?.hd,
        height: v?.height,
      });
    });
    if (channels.length) {
      rules.sortChannels(groupName, channels);
      result.push({ name: groupName, channels });
    }
  });
  result.sort((a, b) => groupOrder(a.name) - groupOrder(b.name));
  return {
    groups: result,
    updatedAt: webVerified?.updatedAt,
    sources: webVerified?.sources,
    hidden,
  };
}

/**
 * 生成给电视客户端（OrionTV 等）用的 m3u：已套用剔除规则，每个频道保留第一条线路，
 * 按标准分组顺序排列。OrionTV 以地址作为频道 id 且不会自动换线，所以每频道只给一条。
 */
export function toTvM3u(entries: RawEntry[]): string {
  const groups = new Map<string, Map<string, RawEntry>>();
  for (const e of applyChannelRules(entries)) {
    if (!groups.has(e.group)) groups.set(e.group, new Map());
    const g = groups.get(e.group) as Map<string, RawEntry>;
    const key = channelKey(e.name);
    if (!g.has(key)) g.set(key, e);
  }
  const names = Array.from(groups.keys()).sort(
    (a, b) => groupOrder(a) - groupOrder(b)
  );
  const esc = (v?: string) => String(v || '').replace(/"/g, '');
  const lines = ['#EXTM3U'];
  for (const name of names) {
    const list = Array.from(
      (groups.get(name) as Map<string, RawEntry>).values()
    );
    rules.sortChannels(name, list);
    for (const c of list) {
      lines.push(
        `#EXTINF:-1 tvg-name="${esc(c.name)}"${
          c.logo ? ` tvg-logo="${esc(c.logo)}"` : ''
        } group-title="${esc(name)}",${c.name}`,
        c.url
      );
    }
  }
  return lines.join('\n') + '\n';
}
