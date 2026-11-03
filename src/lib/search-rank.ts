/**
 * 搜索结果相关度排序：与搜索词越接近的排越前。
 * 服务端 /api/search（OrionTV 等客户端直接使用其顺序）与网页搜索页共用。
 * 只调整顺序，不改变返回的数据结构。
 */

import { SearchResult } from './types';

const CN_NUM: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 一~九十九 的中文数字转阿拉伯数字 */
function cnToNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0);
  if (s.length === 1 && s in CN_NUM) return CN_NUM[s];
  return null;
}

// 空白与常见标点、符号（含全角），比较时忽略
const PUNCT_RE =
  /[\s·・•:：\-—–_,，.。、;；!！?？'"“”‘’《》〈〉<>()（）[\]【】{}「」『』/\\|~～#&*+=^`@$%]/g;

/**
 * 标题规范化：全角转半角、转小写、去标点空格，
 * 「第二季 / 第2季 / Season 2 / S2」统一成「2」，「第一季」视为没有季数。
 */
export function normalizeTitle(raw: string): string {
  // 季数先换成带标记的数字（§2§），便于只对季数做「第一季」的处理
  let s = (raw || '').normalize('NFKC').toLowerCase();
  s = s.replace(
    /第\s*([零一二两三四五六七八九十\d]+)\s*[季部]/g,
    (all: string, n: string) => {
      const v = cnToNumber(n);
      return v === null ? all : `§${v}§`;
    }
  );
  s = s.replace(/season\s*(\d+)/g, '§$1§');
  s = s.replace(/(^|[^a-z])s(\d{1,2})(?!\d)/g, '$1§$2§');
  // 结尾的第一季 = 无季数（「庆余年第一季」与「庆余年」视为同一部）
  s = s.replace(/§0*1§\s*$/, '');
  return s.replace(/§/g, '').replace(PUNCT_RE, '');
}

// 标题 = 搜索词 + 这些后缀：同一部作品的季数 / 版本，仅次于完全一致
const VARIANT_RE = new RegExp(
  '^(?:' +
    [
      '\\d{1,3}',
      '(?:19|20)\\d{2}',
      '[上中下]',
      '(?:剧场|电影|电视剧|动画|动漫|真人|tv|网络|特别|纪念|重制|新|旧|完整|未删减|无删减|导演剪辑|加长|精编|纯享|会员|蓝光|高清|超清|hd|4k|1080p|国语|粤语|普通话|国配|台配|日语|英语|韩语|中字|双语)版?',
      '大电影',
      '特别篇',
      '番外篇?',
      '前传',
      '续集?',
      'ova',
      'oad',
      'sp',
      'movie',
    ].join('|') +
    ')+$'
);

function bigrams(s: string): string[] {
  if (s.length < 2) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** 二元组 Dice 相似度 0~1 */
function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  A.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
  let hit = 0;
  for (const x of B) {
    const c = counts.get(x) || 0;
    if (c > 0) {
      hit++;
      counts.set(x, c - 1);
    }
  }
  return (2 * hit) / (A.length + B.length);
}

/** 最长公共子序列长度（字符按顺序出现即可） */
function lcs(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

const cap = (n: number, max: number) => Math.min(Math.max(n, 0), max);

/**
 * 标题与搜索词的相关度，分档（高档恒大于低档）：
 *   1000      规范化后完全一致
 *   880~900   搜索词 + 季数 / 版本后缀（同一部作品）
 *   750~800   以搜索词开头
 *   625~700   包含搜索词（越靠前、多余字越少越高）
 *   550~600   搜索词以标题开头（多打了字，如「流浪地球2 吴京」）
 *   510~560   搜索词包含标题
 *   505       多个关键词全部出现（顺序不同）
 *   0~500     模糊相似度（二元组 + 公共子序列）
 */
export function relevanceScore(title: string, query: string): number {
  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  if (!q || !t) return 0;
  if (t === q) return 1000;

  if (t.startsWith(q)) {
    const rest = t.slice(q.length);
    if (VARIANT_RE.test(rest)) return 900 - cap(rest.length, 20);
    return 800 - cap(rest.length, 50);
  }

  const idx = t.indexOf(q);
  if (idx >= 0) {
    return 700 - cap(idx, 50) - cap(t.length - q.length, 50) * 0.5;
  }

  if (t.length >= 2) {
    if (q.startsWith(t)) return 600 - cap(q.length - t.length, 50);
    if (q.includes(t)) return 560 - cap(q.length - t.length, 50);
  }

  const tokens = (query || '')
    .split(/[\s,，、/|]+/)
    .map(normalizeTitle)
    .filter(Boolean);
  if (tokens.length >= 2 && tokens.every((k) => t.includes(k))) return 505;

  const sim = 0.6 * dice(q, t) + 0.4 * (lcs(q, t) / Math.max(q.length, 1));
  return Math.round(500 * cap(sim, 1) * 100) / 100;
}

function yearValue(y?: string): number {
  const n = parseInt(y || '', 10);
  return Number.isFinite(n) ? n : -1;
}

/**
 * 同分时的次序：有可播放剧集的在前 → 年份新的在前 → 保持原顺序（视频源配置顺序）
 */
function compareTie(
  a: { item: SearchResult; index: number },
  b: { item: SearchResult; index: number }
): number {
  const ea = a.item.episodes?.length ? 1 : 0;
  const eb = b.item.episodes?.length ? 1 : 0;
  if (ea !== eb) return eb - ea;
  const ya = yearValue(a.item.year);
  const yb = yearValue(b.item.year);
  if (ya !== yb) return yb - ya;
  return a.index - b.index;
}

/** 按相关度从高到低排序（返回新数组，不修改入参） */
export function rankSearchResults<T extends SearchResult>(
  results: T[],
  query: string
): T[] {
  const cache = new Map<string, number>();
  const scoreOf = (title: string) => {
    let s = cache.get(title);
    if (s === undefined) {
      s = relevanceScore(title, query);
      cache.set(title, s);
    }
    return s;
  };
  return results
    .map((item, index) => ({ item, index, score: scoreOf(item.title) }))
    .sort((a, b) => b.score - a.score || compareTie(a, b))
    .map((x) => x.item);
}

/** 聚合分组排序：每组取组内最高分 */
export function rankSearchGroups<T extends SearchResult>(
  groups: [string, T[]][],
  query: string
): [string, T[]][] {
  return groups
    .map((g, index) => {
      const ranked = rankSearchResults(g[1], query);
      return {
        group: [g[0], ranked] as [string, T[]],
        item: ranked[0],
        index,
        score: ranked.length ? relevanceScore(ranked[0].title, query) : 0,
      };
    })
    .sort((a, b) => b.score - a.score || compareTie(a, b))
    .map((x) => x.group);
}
