'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getDoubanCategories, getDoubanRecommends } from '@/lib/douban.client';
import { DEFAULT_FILTERS } from '@/lib/douban.filters';
import {
  appendUnique,
  DiscoverItem,
  DiscoverKind,
  FEED_SHELVES,
  FeedShelfDef,
  nextDiscoverKind,
} from '@/lib/home-feed';
import { DoubanItem } from '@/lib/types';

import Shelf, { SHELF_ITEM, ShelfSkeleton } from './Shelf';
import Spinner from './Spinner';
import { GUTTER, POSTER_GRID } from './ui';
import VideoCard from './VideoCard';

const GRID_PAGE = 24;

interface ShelfSection {
  def: FeedShelfDef;
  items: DoubanItem[] | null; // null = 加载中
}

/**
 * 首页无限画布：滚动到底部附近时逐排追加主题片架，
 * 片架用完后接「发现更多」网格无限分页，直到豆瓣没有更多。
 */
export default function InfiniteFeed({ enabled }: { enabled: boolean }) {
  const [sections, setSections] = useState<ShelfSection[]>([]);
  const [grid, setGrid] = useState<DiscoverItem[]>([]);
  // 每页新增条目的起始下标，用于给新追加的卡片做入场动画
  const [gridBatchStart, setGridBatchStart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [nearBottom, setNearBottom] = useState(false);

  const discover = useRef({
    last: null as DiscoverKind | null,
    start: { movie: 0, tv: 0 } as Record<DiscoverKind, number>,
    done: { movie: false, tv: false } as Record<DiscoverKind, boolean>,
  });
  const gridRef = useRef<DiscoverItem[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    []
  );

  // 底部哨兵进入视口下方 1200px 范围即视为「快到底了」
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver(
      (entries) => setNearBottom(entries[0].isIntersecting),
      { rootMargin: '0px 0px 1200px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  const loadNextShelf = useCallback(async (index: number) => {
    const def = FEED_SHELVES[index];
    setSections((prev) => [...prev, { def, items: null }]);
    let items: DoubanItem[] = [];
    let ok = true;
    try {
      const res = await getDoubanCategories({
        kind: def.kind,
        category: def.category,
        type: def.type,
        pageLimit: 20,
      });
      if (res.code === 200) items = res.list.filter((i) => i.poster);
      else ok = false;
    } catch {
      ok = false;
    }
    if (!aliveRef.current) return ok;
    setSections((prev) =>
      prev.map((s) => (s.def.key === def.key ? { def, items } : s))
    );
    return ok;
  }, []);

  const loadNextGridPage = useCallback(async () => {
    const st = discover.current;
    const kind = nextDiscoverKind(st.last, st.done);
    if (!kind) return 'end' as const;
    try {
      const res = await getDoubanRecommends({
        ...DEFAULT_FILTERS,
        type: kind,
        start: st.start[kind],
        limit: GRID_PAGE,
      });
      if (res.code !== 200) return 'error' as const;
      st.last = kind;
      st.start[kind] += GRID_PAGE;
      // 筛选接口会滤掉片单 / 广告，单页可能不足一页，以返回为空判断到底
      if (res.list.length === 0) st.done[kind] = true;
      const { list, added } = appendUnique(
        gridRef.current,
        res.list
          .filter((i) => i.poster)
          .map((i) => ({ ...i, kind } as DiscoverItem))
      );
      // 连续翻到的都是重复条目也视为到底，避免死循环
      if (added === 0 && res.list.length > 0 && st.start[kind] > 400) {
        st.done[kind] = true;
      }
      if (aliveRef.current && added > 0) {
        setGridBatchStart(gridRef.current.length);
        gridRef.current = list;
        setGrid(list);
      }
      return nextDiscoverKind(st.last, st.done) ? ('ok' as const) : 'end';
    } catch {
      return 'error' as const;
    }
  }, []);

  // 快到底、且没有在加载时，追加下一块内容。
  // 加载完一块后 tick+1 再检查一次：哨兵仍在可视范围（内容不够撑满 / 片架为空被隐藏）就继续加载，
  // 被新内容挤出可视范围后 IntersectionObserver 会把 nearBottom 置回 false 停下。
  const lockRef = useRef(false);
  const nextShelfRef = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !nearBottom || failed || finished || lockRef.current)
      return;
    lockRef.current = true;
    setBusy(true);
    (async () => {
      if (nextShelfRef.current < FEED_SHELVES.length) {
        await loadNextShelf(nextShelfRef.current++);
      } else {
        const r = await loadNextGridPage();
        if (r === 'error' && aliveRef.current) setFailed(true);
        if (r === 'end' && aliveRef.current) setFinished(true);
      }
      if (!aliveRef.current) return;
      lockRef.current = false;
      setBusy(false);
      // 留一帧给新内容撑开页面
      requestAnimationFrame(() => {
        if (aliveRef.current) setTick((t) => t + 1);
      });
    })();
  }, [
    enabled,
    nearBottom,
    failed,
    finished,
    tick,
    loadNextShelf,
    loadNextGridPage,
  ]);

  if (!enabled) return null;

  const inGridPhase = sections.length >= FEED_SHELVES.length;

  return (
    <>
      {sections.map(({ def, items }) =>
        items === null ? (
          <div key={def.key} className='feed-in'>
            <Shelf title={def.title} href={def.href}>
              <ShelfSkeleton />
            </Shelf>
          </div>
        ) : items.length > 0 ? (
          <div key={def.key} className='feed-in'>
            <Shelf title={def.title} href={def.href}>
              {items.map((it) => (
                <div key={it.id} className={SHELF_ITEM}>
                  <VideoCard
                    from='douban'
                    title={it.title}
                    poster={it.poster}
                    douban_id={it.id}
                    rate={it.rate}
                    year={it.year}
                    type={def.cardType === 'movie' ? 'movie' : ''}
                  />
                </div>
              ))}
            </Shelf>
          </div>
        ) : null
      )}

      {grid.length > 0 && (
        <section className={`feed-in mt-9 sm:mt-12 ${GUTTER}`}>
          <h2 className='atv-section-title mb-3 text-atv-label sm:mb-4'>
            发现更多
          </h2>
          <div className={POSTER_GRID}>
            {grid.map((it, i) => (
              <div
                key={`${it.kind}-${it.id}`}
                className={i >= gridBatchStart ? 'feed-in' : undefined}
                style={
                  i >= gridBatchStart
                    ? {
                        animationDelay: `${Math.min(
                          (i - gridBatchStart) * 25,
                          400
                        )}ms`,
                      }
                    : undefined
                }
              >
                <VideoCard
                  from='douban'
                  title={it.title}
                  poster={it.poster}
                  douban_id={it.id}
                  rate={it.rate}
                  year={it.year}
                  type={it.kind === 'movie' ? 'movie' : ''}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <div ref={sentinelRef} className='flex min-h-[1px] justify-center py-8'>
        {failed ? (
          <button
            onClick={() => setFailed(false)}
            className='rounded-full px-4 py-1.5 text-[13px] text-atv-secondary transition-colors hover:bg-atv-fill/15 hover:text-atv-label'
          >
            加载失败，点击重试
          </button>
        ) : finished ? (
          <span className='text-[13px] text-atv-tertiary'>已经到底了</span>
        ) : busy && inGridPhase ? (
          <Spinner size={24} />
        ) : null}
      </div>
    </>
  );
}
