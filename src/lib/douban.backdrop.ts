/**
 * 首页大图用的横版剧照：取豆瓣移动端 rexxar 接口的影片图片，
 *   https://m.douban.com/rexxar/api/v2/{movie|tv}/{id}/photos?start=0&count=12
 * 返回 photos[].image.large.{url,width,height}。从中挑一张清晰的横图，
 * 没有合适的返回 null，由页面回落到海报。纯函数，服务端与浏览器共用。
 */

export type BackdropKind = 'movie' | 'tv';

export interface Backdrop {
  url: string;
  width: number;
  height: number;
}

/** 至少这么宽才算清晰（大屏铺满不至于糊） */
const MIN_WIDTH = 960;
/** 宽高比至少 1.3（排除竖版海报、方图） */
const MIN_RATIO = 1.3;
/** 只看前几张：豆瓣按热度排序，越靠前越有代表性 */
const SCAN = 12;

export function buildPhotosUrl(kind: BackdropKind, id: string): string {
  return `https://m.douban.com/rexxar/api/v2/${kind}/${encodeURIComponent(
    id
  )}/photos?start=0&count=${SCAN}`;
}

interface RawImage {
  url?: string;
  width?: number;
  height?: number;
}
interface RawPhotos {
  photos?: Array<{ image?: { large?: RawImage; normal?: RawImage } } | null>;
}

/** 从图片列表挑一张：第一张足够清晰的横图；都不够清晰时取最宽的横图 */
export function pickBackdrop(
  data: RawPhotos | null | undefined
): Backdrop | null {
  const list = (data?.photos || []).slice(0, SCAN);
  let widest: Backdrop | null = null;
  for (const p of list) {
    const img = p?.image?.large;
    const width = Number(img?.width) || 0;
    const height = Number(img?.height) || 0;
    if (!img?.url || !width || !height) continue;
    if (width / height < MIN_RATIO) continue;
    const b = { url: img.url.replace(/^http:/, 'https:'), width, height };
    if (width >= MIN_WIDTH) return b;
    if (!widest || width > widest.width) widest = b;
  }
  return widest && widest.width >= 640 ? widest : null;
}

export function isValidDoubanId(id: string | null | undefined): id is string {
  return !!id && /^\d{4,12}$/.test(id);
}
