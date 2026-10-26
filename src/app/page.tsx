/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronLeft } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';

// 客户端收藏 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import ContinueWatching from '@/components/ContinueWatching';
import HeroCarousel, { HeroSlide } from '@/components/HeroCarousel';
import PageLayout from '@/components/PageLayout';
import Shelf, { SHELF_ITEM, ShelfSkeleton } from '@/components/Shelf';
import { useSite } from '@/components/SiteProvider';
import { GUTTER, POSTER_GRID } from '@/components/ui';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVariety, setHotVariety] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { announcement } = useSite();

  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 收藏夹数据
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const fetchDoubanData = async () => {
      try {
        setLoading(true);

        // 并行获取热门电影、剧集、综艺（任一失败不影响其它）
        const [moviesData, tvShowsData, varietyData] = await Promise.all([
          getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
          }).catch(() => null),
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }).catch(
            () => null
          ),
          getDoubanCategories({
            kind: 'tv',
            category: 'show',
            type: 'show',
          }).catch(() => null),
        ]);

        if (moviesData?.code === 200) setHotMovies(moviesData.list);
        if (tvShowsData?.code === 200) setHotTvShows(tvShowsData.list);
        if (varietyData?.code === 200) setHotVariety(varietyData.list);
      } catch (error) {
        console.error('获取豆瓣数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDoubanData();
  }, []);

  // 处理收藏数据更新的函数
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();

    // 根据保存时间排序（从近到远）
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  // 加载收藏（首页片架与收藏页共用）
  useEffect(() => {
    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
    };

    loadFavorites();

    // 监听收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      }
    );

    return unsubscribe;
  }, []);

  // 大图轮播：热门电影与剧集交错，取前 6 部有海报的
  const heroSlides = useMemo<HeroSlide[]>(() => {
    const movies = hotMovies.filter((m) => m.poster).slice(0, 4);
    const tv = hotTvShows.filter((t) => t.poster).slice(0, 2);
    const order: HeroSlide[] = [];
    const pick = [
      movies[0] && { item: movies[0], kind: 'movie' as const },
      tv[0] && { item: tv[0], kind: 'tv' as const },
      movies[1] && { item: movies[1], kind: 'movie' as const },
      movies[2] && { item: movies[2], kind: 'movie' as const },
      tv[1] && { item: tv[1], kind: 'tv' as const },
      movies[3] && { item: movies[3], kind: 'movie' as const },
    ];
    pick.forEach((p) => p && order.push(p));
    return order;
  }, [hotMovies, hotTvShows]);
  const showHero = loading || heroSlides.length > 0;

  const doubanShelf = (
    items: DoubanItem[],
    type: 'movie' | 'tv'
  ): React.ReactNode =>
    loading ? (
      <ShelfSkeleton />
    ) : (
      items.map((it) => (
        <div key={it.id} className={SHELF_ITEM}>
          <VideoCard
            from='douban'
            title={it.title}
            poster={it.poster}
            douban_id={it.id}
            rate={it.rate}
            year={it.year}
            type={type === 'movie' ? 'movie' : ''}
          />
        </div>
      ))
    );

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  return (
    <PageLayout overlayHeader={activeTab === 'home' && showHero}>
      {activeTab === 'favorites' ? (
        // 收藏页
        <div className={`pt-4 sm:pt-8 ${GUTTER}`}>
          <button
            onClick={() => setActiveTab('home')}
            className='-ml-1 mb-1 inline-flex items-center text-[15px] text-atv-accent hover:opacity-80'
          >
            <ChevronLeft className='h-5 w-5' />
            首页
          </button>
          <div className='mb-6 flex items-end justify-between sm:mb-8'>
            <h1 className='atv-large-title'>我的收藏</h1>
            {favoriteItems.length > 0 && (
              <button
                className='rounded-full px-3 py-1 text-sm text-atv-secondary transition-colors hover:bg-atv-fill/15 hover:text-atv-label'
                onClick={async () => {
                  await clearAllFavorites();
                  setFavoriteItems([]);
                }}
              >
                清空
              </button>
            )}
          </div>
          {favoriteItems.length === 0 ? (
            <p className='py-16 text-center text-atv-secondary'>
              还没有收藏。在影片卡片上点心形即可收藏。
            </p>
          ) : (
            <div className={POSTER_GRID}>
              {favoriteItems.map((item) => (
                <VideoCard
                  key={item.id + item.source}
                  query={item.search_title}
                  {...item}
                  from='favorite'
                  type={item.episodes > 1 ? 'tv' : ''}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        // 首页
        <>
          {showHero ? (
            <HeroCarousel slides={heroSlides} loading={loading} />
          ) : (
            <div className='pt-[calc(3rem+env(safe-area-inset-top))] md:pt-14' />
          )}
          <div className='pb-4'>
            <ContinueWatching />
            {favoriteItems.length > 0 && (
              <Shelf
                title='我的收藏'
                onTitleClick={() => setActiveTab('favorites')}
              >
                {favoriteItems.slice(0, 20).map((item) => (
                  <div key={item.id + item.source} className={SHELF_ITEM}>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
              </Shelf>
            )}
            <Shelf title='热门电影' href='/douban?type=movie'>
              {doubanShelf(hotMovies, 'movie')}
            </Shelf>
            <Shelf title='热门剧集' href='/douban?type=tv'>
              {doubanShelf(hotTvShows, 'tv')}
            </Shelf>
            {(loading || hotVariety.length > 0) && (
              <Shelf title='热门综艺' href='/douban?type=show'>
                {doubanShelf(hotVariety, 'tv')}
              </Shelf>
            )}
            {!loading && hotMovies.length === 0 && hotTvShows.length === 0 && (
              <p className={`py-16 text-center text-atv-secondary ${GUTTER}`}>
                豆瓣数据加载失败。可在设置中开启豆瓣代理后刷新。
              </p>
            )}
          </div>
        </>
      )}
      {announcement && showAnnouncement && (
        <div className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm'>
          <div
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='announcement-title'
            className='w-full max-w-sm overflow-hidden rounded-2xl bg-atv-elevated text-center shadow-2xl ring-1 ring-black/5 dark:ring-white/10'
          >
            <div className='px-6 pb-5 pt-6'>
              <h3
                id='announcement-title'
                className='text-[17px] font-semibold text-atv-label'
              >
                提示
              </h3>
              <p className='mt-2 text-[13px] leading-relaxed text-atv-secondary'>
                {announcement}
              </p>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full border-t border-atv-separator/70 py-3 text-[17px] font-semibold text-atv-accent transition-colors hover:bg-atv-fill/10'
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
