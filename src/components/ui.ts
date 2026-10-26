'use client';

import { useEffect, useState } from 'react';

/** 统一页边距（导航、片架、网格左对齐到同一条线） */
export const GUTTER = 'px-4 sm:px-8 lg:px-12 2xl:px-16';

/** 圆形图标按钮 */
export const ICON_BTN =
  'inline-flex h-9 w-9 items-center justify-center rounded-full text-atv-label/80 transition-colors duration-200 hover:bg-atv-fill/20 hover:text-atv-label';

/** 主导航项 */
export const NAV_ITEMS = [
  { label: '首页', href: '/' },
  { label: '电影', href: '/douban?type=movie' },
  { label: '剧集', href: '/douban?type=tv' },
  { label: '综艺', href: '/douban?type=show' },
] as const;

/** 判断导航项是否为当前页（豆瓣页按 type 匹配，忽略筛选参数） */
export function isNavActive(href: string, active: string): boolean {
  const decoded = decodeURIComponent(active || '/');
  if (href === '/') return decoded === '/';
  const type = href.match(/type=([^&]+)/)?.[1];
  if (type && decoded.startsWith('/douban')) {
    const activeType = decoded.match(/[?&]type=([^&]+)/)?.[1] || 'movie';
    return activeType === type;
  }
  return decoded === href || decoded.startsWith(href + '?');
}

/** 页面是否已向下滚动（滚动容器可能是 window 或 body） */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const check = () => {
      const y = Math.max(
        window.scrollY || 0,
        document.documentElement.scrollTop || 0,
        document.body.scrollTop || 0
      );
      setScrolled(y > threshold);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    document.body.addEventListener('scroll', check, { passive: true });
    return () => {
      window.removeEventListener('scroll', check);
      document.body.removeEventListener('scroll', check);
    };
  }, [threshold]);
  return scrolled;
}

/** 海报网格（分类页、搜索、收藏） */
export const POSTER_GRID =
  'grid grid-cols-3 gap-x-3 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] sm:gap-x-5 sm:gap-y-9 lg:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]';
