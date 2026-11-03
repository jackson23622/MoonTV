/**
 * 首页无限下拉：固定的几排热门片架之后，按滚动逐排追加主题片架，
 * 片架用完后进入「发现更多」海报网格，电影 / 剧集交替分页，直到豆瓣没有更多。
 * 本文件只放纯数据和纯函数，便于测试。
 */

import { DoubanItem } from './types';

export interface FeedShelfDef {
  key: string;
  title: string;
  /** recent_hot 接口参数 */
  kind: 'movie' | 'tv';
  category: string;
  type: string;
  /** 卡片类型：电影严格按电影搜索，剧集 / 综艺不限 */
  cardType: 'movie' | 'tv';
  /** 标题跳转到对应分类页 */
  href: string;
}

const movie = (
  key: string,
  title: string,
  category: string,
  type: string
): FeedShelfDef => ({
  key,
  title,
  kind: 'movie',
  category,
  type,
  cardType: 'movie',
  href: '/douban?type=movie',
});

const tv = (
  key: string,
  title: string,
  category: 'tv' | 'show',
  type: string
): FeedShelfDef => ({
  key,
  title,
  kind: 'tv',
  category,
  type,
  cardType: 'tv',
  href: `/douban?type=${category}`,
});

/** 首屏三排（热门电影 / 剧集 / 综艺）之后依次追加的片架 */
export const FEED_SHELVES: FeedShelfDef[] = [
  movie('m-latest', '最新电影', '最新', '全部'),
  tv('tv-cn', '国产剧', 'tv', 'tv_domestic'),
  movie('m-top', '豆瓣高分', '豆瓣高分', '全部'),
  tv('tv-us', '欧美剧', 'tv', 'tv_american'),
  movie('m-cn', '华语电影', '热门', '华语'),
  tv('tv-kr', '韩剧', 'tv', 'tv_korean'),
  movie('m-us', '欧美电影', '热门', '欧美'),
  tv('tv-jp', '日剧', 'tv', 'tv_japanese'),
  tv('tv-anime', '动漫', 'tv', 'tv_animation'),
  movie('m-kr', '韩国电影', '热门', '韩国'),
  movie('m-jp', '日本电影', '热门', '日本'),
  movie('m-hidden', '冷门佳片', '冷门佳片', '全部'),
  tv('tv-doc', '纪录片', 'tv', 'tv_documentary'),
  tv('show-cn', '国内综艺', 'show', 'show_domestic'),
  tv('show-intl', '国外综艺', 'show', 'show_foreign'),
];

export type DiscoverKind = 'movie' | 'tv';

export interface DiscoverItem extends DoubanItem {
  kind: DiscoverKind;
}

/** 发现网格下一页取哪一类：与上一页交替，已到底的类别跳过；都到底返回 null */
export function nextDiscoverKind(
  last: DiscoverKind | null,
  done: Record<DiscoverKind, boolean>
): DiscoverKind | null {
  const preferred: DiscoverKind = last === 'movie' ? 'tv' : 'movie';
  const other: DiscoverKind = preferred === 'movie' ? 'tv' : 'movie';
  if (!done[preferred]) return preferred;
  if (!done[other]) return other;
  return null;
}

/** 追加一页，按 id 去重（豆瓣分页偶有重复，电影 / 剧集也可能撞 id 以外的同名条目） */
export function appendUnique<T extends { id: string }>(
  prev: T[],
  next: T[]
): { list: T[]; added: number } {
  const seen = new Set(prev.map((i) => i.id));
  const fresh = next.filter((i) => {
    if (!i.id || seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
  return {
    list: fresh.length ? [...prev, ...fresh] : prev,
    added: fresh.length,
  };
}
