// 电视订阅清洗：解析 m3u / txt 订阅，套用频道剔除规则，输出给电视客户端的 m3u

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rules = require('./channel-rules');

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
