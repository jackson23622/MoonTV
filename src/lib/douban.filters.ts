/**
 * 豆瓣多条件筛选（类型 / 地区 / 年代 / 平台 / 排序）
 *
 * 使用豆瓣移动端 rexxar 接口：
 *   https://m.douban.com/rexxar/api/v2/{movie|tv}/recommend
 * 该接口参数全部是中文标签，因此选项的 value 直接使用豆瓣标签文字，
 * 'all' 表示不限。本文件只包含纯函数，服务端（edge）和浏览器端共用。
 */

import { DoubanItem } from './types';

export type DoubanMediaType = 'movie' | 'tv' | 'show';

export interface FilterOption {
  label: string;
  value: string;
}

export interface DoubanFilterState {
  genre: string; // 类型
  region: string; // 地区
  year: string; // 年代
  platform: string; // 平台（仅剧集/综艺）
  sort: string; // 排序：T 综合 / U 近期热度 / R 首映(播)时间 / S 高分优先
}

export const DEFAULT_FILTERS: DoubanFilterState = {
  genre: 'all',
  region: 'all',
  year: 'all',
  platform: 'all',
  sort: 'T',
};

const ALL: FilterOption = { label: '全部', value: 'all' };

const toOptions = (labels: string[]): FilterOption[] => [
  ALL,
  ...labels.map((l) => ({ label: l, value: l })),
];

export const GENRE_OPTIONS: Record<DoubanMediaType, FilterOption[]> = {
  movie: toOptions([
    '喜剧',
    '动作',
    '爱情',
    '科幻',
    '动画',
    '悬疑',
    '惊悚',
    '恐怖',
    '犯罪',
    '冒险',
    '奇幻',
    '战争',
    '历史',
    '传记',
    '音乐',
    '歌舞',
    '武侠',
    '灾难',
    '西部',
    '纪录片',
    '短片',
  ]),
  tv: toOptions([
    '剧情',
    '喜剧',
    '爱情',
    '悬疑',
    '古装',
    '武侠',
    '家庭',
    '犯罪',
    '动作',
    '科幻',
    '奇幻',
    '动画',
    '惊悚',
    '恐怖',
    '历史',
    '战争',
    '冒险',
    '传记',
    '音乐',
    '歌舞',
  ]),
  show: toOptions(['真人秀', '脱口秀', '音乐', '歌舞']),
};

const MOVIE_REGIONS = [
  '华语',
  '欧美',
  '韩国',
  '日本',
  '中国大陆',
  '中国香港',
  '中国台湾',
  '美国',
  '英国',
  '法国',
  '德国',
  '意大利',
  '西班牙',
  '印度',
  '泰国',
  '俄罗斯',
  '加拿大',
  '澳大利亚',
  '爱尔兰',
  '瑞典',
  '巴西',
  '丹麦',
];

const TV_REGIONS = [
  '华语',
  '欧美',
  '国外',
  '韩国',
  '日本',
  '中国大陆',
  '中国香港',
  '中国台湾',
  '美国',
  '英国',
  '泰国',
  '意大利',
  '法国',
  '德国',
  '西班牙',
  '俄罗斯',
  '瑞典',
  '巴西',
  '丹麦',
  '印度',
  '加拿大',
  '爱尔兰',
  '澳大利亚',
];

export const REGION_OPTIONS: Record<DoubanMediaType, FilterOption[]> = {
  movie: toOptions(MOVIE_REGIONS),
  tv: toOptions(TV_REGIONS),
  show: toOptions(TV_REGIONS),
};

/** 年代：当前年代 + 近若干个单独年份 + 往前按年代 */
export function getYearOptions(now: Date = new Date()): FilterOption[] {
  const currentYear = now.getFullYear();
  const decadeStart = Math.floor(currentYear / 10) * 10;
  const years: string[] = [];
  // 当前年份往回到上个年代的最后一年，例如 2026 → 2026…2019
  for (let y = currentYear; y >= decadeStart - 1; y--) {
    years.push(String(y));
  }
  const decades = [`${decadeStart}年代`];
  for (let d = decadeStart - 10; d >= 1960; d -= 10) {
    decades.push(d >= 2000 ? `${d}年代` : `${String(d).slice(2)}年代`);
  }
  // 顺序：全部、当前年代、近年逐年、更早的年代、更早
  return toOptions([decades[0], ...years, ...decades.slice(1), '更早']);
}

export const PLATFORM_OPTIONS: FilterOption[] = toOptions([
  '腾讯视频',
  '爱奇艺',
  '优酷',
  '湖南卫视',
  'Netflix',
  'HBO',
  'BBC',
  'NHK',
  'CBS',
  'NBC',
  'tvN',
]);

export function getSortOptions(type: DoubanMediaType): FilterOption[] {
  return [
    { label: '综合排序', value: 'T' },
    { label: '近期热度', value: 'U' },
    { label: type === 'movie' ? '首映时间' : '首播时间', value: 'R' },
    { label: '高分优先', value: 'S' },
  ];
}

const VALID_SORTS = new Set(['T', 'U', 'R', 'S']);

/** 校验/规范化外部传入的筛选值（URL 参数等），非法值回落为默认值 */
export function normalizeFilters(
  type: DoubanMediaType,
  raw: Partial<Record<keyof DoubanFilterState, string | null>>
): DoubanFilterState {
  const pick = (value: string | null | undefined, options: FilterOption[]) =>
    value && options.some((o) => o.value === value) ? value : 'all';

  return {
    genre: pick(raw.genre, GENRE_OPTIONS[type]),
    region: pick(raw.region, REGION_OPTIONS[type]),
    year: pick(raw.year, getYearOptions()),
    platform: type === 'movie' ? 'all' : pick(raw.platform, PLATFORM_OPTIONS),
    sort: raw.sort && VALID_SORTS.has(raw.sort) ? raw.sort : 'T',
  };
}

export function isDefaultFilters(f: DoubanFilterState): boolean {
  return (
    f.genre === 'all' &&
    f.region === 'all' &&
    f.year === 'all' &&
    f.platform === 'all' &&
    f.sort === 'T'
  );
}

export interface DoubanRecommendParams extends DoubanFilterState {
  type: DoubanMediaType;
  start: number;
  limit: number;
}

/** 构造豆瓣 recommend 接口地址 */
export function buildDoubanRecommendUrl(p: DoubanRecommendParams): string {
  const v = (x: string) => (x && x !== 'all' ? x : '');
  const kind = p.type === 'movie' ? 'movie' : 'tv';
  const genre = v(p.genre);
  const region = v(p.region);
  const year = v(p.year);
  const platform = p.type === 'movie' ? '' : v(p.platform);
  const sort = p.sort === 'T' ? '' : p.sort;

  // 剧集和综艺共用 tv 接口，用「形式」区分
  const format = p.type === 'tv' ? '电视剧' : p.type === 'show' ? '综艺' : '';

  const selectedCategories: Record<string, string> = { 类型: genre };
  if (format) selectedCategories['形式'] = format;
  if (region) selectedCategories['地区'] = region;

  const tags: string[] = [];
  if (genre) tags.push(genre);
  else if (format) tags.push(format);
  if (region) tags.push(region);
  if (year) tags.push(year);
  if (platform) tags.push(platform);

  const qs = new URLSearchParams();
  qs.set('refresh', '0');
  qs.set('start', String(p.start));
  qs.set('count', String(p.limit));
  qs.set('selected_categories', JSON.stringify(selectedCategories));
  qs.set('uncollect', 'false');
  qs.set('score_range', '0,10');
  qs.set('tags', tags.join(','));
  if (sort) qs.set('sort', sort);

  return `https://m.douban.com/rexxar/api/v2/${kind}/recommend?${qs.toString()}`;
}

export interface DoubanRecommendApiResponse {
  total?: number;
  items?: Array<{
    id: string;
    title: string;
    type?: string;
    year?: string;
    card_subtitle?: string;
    pic?: { large?: string; normal?: string };
    rating?: { value?: number } | null;
  }>;
}

/** 把豆瓣原始返回转为站内 DoubanItem，过滤掉广告/片单等非影视条目 */
export function parseDoubanRecommend(
  data: DoubanRecommendApiResponse
): DoubanItem[] {
  return (data.items || [])
    .filter((item) => item && (item.type === 'movie' || item.type === 'tv'))
    .map((item) => ({
      id: String(item.id),
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.year || item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));
}
