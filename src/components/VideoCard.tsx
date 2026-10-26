/* eslint-disable @typescript-eslint/no-explicit-any */

import { ExternalLink, Heart, Play, X } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { getImageFallbackUrl, processImageUrl } from '@/lib/utils';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';

interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: string;
  onDelete?: () => void;
  rate?: string;
  items?: SearchResult[];
  type?: string;
}

export default function VideoCard({
  id,
  title = '',
  query = '',
  poster = '',
  episodes,
  source,
  source_name,
  progress = 0,
  year,
  from,
  currentEpisode,
  douban_id,
  onDelete,
  rate,
  items,
  type = '',
}: VideoCardProps) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isAggregate = from === 'search' && !!items?.length;

  const aggregateData = useMemo(() => {
    if (!isAggregate || !items) return null;
    const countMap = new Map<string | number, number>();
    const episodeCountMap = new Map<number, number>();
    items.forEach((item) => {
      if (item.douban_id && item.douban_id !== 0) {
        countMap.set(item.douban_id, (countMap.get(item.douban_id) || 0) + 1);
      }
      const len = item.episodes?.length || 0;
      if (len > 0) {
        episodeCountMap.set(len, (episodeCountMap.get(len) || 0) + 1);
      }
    });

    const getMostFrequent = <T extends string | number>(
      map: Map<T, number>
    ) => {
      let maxCount = 0;
      let result: T | undefined;
      map.forEach((cnt, key) => {
        if (cnt > maxCount) {
          maxCount = cnt;
          result = key;
        }
      });
      return result;
    };

    return {
      first: items[0],
      mostFrequentDoubanId: getMostFrequent(countMap),
      mostFrequentEpisodes: getMostFrequent(episodeCountMap) || 0,
    };
  }, [isAggregate, items]);

  const actualTitle = aggregateData?.first.title ?? title;
  const actualPoster = aggregateData?.first.poster ?? poster;
  const [posterSrc, setPosterSrc] = useState(() =>
    processImageUrl(actualPoster)
  );
  useEffect(() => {
    setPosterSrc(processImageUrl(actualPoster));
  }, [actualPoster]);
  const actualSource = aggregateData?.first.source ?? source;
  const actualId = aggregateData?.first.id ?? id;
  const actualDoubanId = String(
    aggregateData?.mostFrequentDoubanId ?? douban_id
  );
  const actualEpisodes = aggregateData?.mostFrequentEpisodes ?? episodes;
  const actualYear = aggregateData?.first.year ?? year;
  const actualQuery = query || '';
  const actualSearchType = isAggregate
    ? aggregateData?.first.episodes?.length === 1
      ? 'movie'
      : 'tv'
    : type;

  // 获取收藏状态
  useEffect(() => {
    if (from === 'douban' || !actualSource || !actualId) return;

    const fetchFavoriteStatus = async () => {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setFavorited(fav);
      } catch (err) {
        throw new Error('检查收藏状态失败');
      }
    };

    fetchFavoriteStatus();

    // 监听收藏状态更新事件
    const storageKey = generateStorageKey(actualSource, actualId);
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        // 检查当前项目是否在新的收藏列表中
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      }
    );

    return unsubscribe;
  }, [from, actualSource, actualId]);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from === 'douban' || !actualSource || !actualId) return;
      try {
        if (favorited) {
          // 如果已收藏，删除收藏
          await deleteFavorite(actualSource, actualId);
          setFavorited(false);
        } else {
          // 如果未收藏，添加收藏
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
          });
          setFavorited(true);
        }
      } catch (err) {
        throw new Error('切换收藏状态失败');
      }
    },
    [
      from,
      actualSource,
      actualId,
      actualTitle,
      source_name,
      actualYear,
      actualPoster,
      actualEpisodes,
      favorited,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from !== 'playrecord' || !actualSource || !actualId) return;
      try {
        await deletePlayRecord(actualSource, actualId);
        onDelete?.();
      } catch (err) {
        throw new Error('删除播放记录失败');
      }
    },
    [from, actualSource, actualId, onDelete]
  );

  const handleClick = useCallback(() => {
    if (from === 'douban') {
      router.push(
        `/play?title=${encodeURIComponent(actualTitle.trim())}${
          actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`
      );
    } else if (actualSource && actualId) {
      router.push(
        `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
          actualTitle
        )}${actualYear ? `&year=${actualYear}` : ''}${
          isAggregate ? '&prefer=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`
      );
    }
  }, [
    from,
    actualSource,
    actualId,
    router,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
  ]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: true,
        showDoubanLink: false,
        showRating: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: !isAggregate,
        showCheckCircle: false,
        showDoubanLink: !!actualDoubanId,
        showRating: false,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: true,
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: true,
        showRating: !!rate,
      },
    };
    return configs[from] || configs.search;
  }, [from, isAggregate, actualDoubanId, rate]);

  // 卡片下方的次要信息
  const meta = (() => {
    if (from === 'douban') {
      return [rate ? `★ ${rate}` : '', actualYear || '']
        .filter(Boolean)
        .join('  ');
    }
    const year = actualYear && actualYear !== 'unknown' ? actualYear : '';
    if (from === 'playrecord' && currentEpisode && (actualEpisodes ?? 0) > 1) {
      return [`看到第 ${currentEpisode} 集`, source_name]
        .filter(Boolean)
        .join(' · ');
    }
    if (isAggregate) {
      const n = items?.length || 0;
      return [year, n > 1 ? `${n} 个片源` : source_name]
        .filter(Boolean)
        .join(' · ');
    }
    return [year, source_name].filter(Boolean).join(' · ');
  })();

  const episodeBadge =
    actualEpisodes && actualEpisodes > 1
      ? currentEpisode
        ? `${currentEpisode}/${actualEpisodes}`
        : `${actualEpisodes} 集`
      : '';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const actionBtn =
    'atv-material-dark flex h-8 w-8 items-center justify-center rounded-full text-white transition-transform duration-200 hover:scale-110';

  return (
    <div
      role='link'
      tabIndex={0}
      aria-label={actualTitle}
      className='group relative w-full cursor-pointer select-none rounded-xl focus-visible:outline-none'
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {/* 海报：悬停 / 焦点时浮起（tvOS 焦点效果） */}
      <div className='atv-lift relative aspect-[2/3] overflow-hidden rounded-xl bg-atv-elevated shadow-card ring-1 ring-black/5 group-focus-visible:ring-2 group-focus-visible:ring-atv-accent dark:ring-white/[0.06]'>
        {!isLoading && (
          <div className='absolute inset-0'>
            <ImagePlaceholder aspectRatio='h-full' />
          </div>
        )}
        <Image
          src={posterSrc}
          alt={actualTitle}
          fill
          sizes='(max-width: 640px) 33vw, 200px'
          className={`object-cover transition-opacity duration-500 ${
            isLoading ? 'opacity-100' : 'opacity-0'
          }`}
          referrerPolicy='no-referrer'
          onLoadingComplete={() => setIsLoading(true)}
          onError={() => {
            const next = getImageFallbackUrl(actualPoster, posterSrc);
            if (next) setPosterSrc(next);
          }}
        />

        {/* 顶部高光：模拟 tvOS 海报的玻璃反光 */}
        <div className='pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.08] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100' />

        {/* 底部渐变：承载进度条 */}
        {config.showProgress && progress > 0 && (
          <div className='pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent' />
        )}

        {/* 集数 */}
        {episodeBadge && (
          <span className='atv-material-dark absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white'>
            {episodeBadge}
          </span>
        )}

        {/* 播放提示 */}
        {config.showPlayButton && (
          <div className='pointer-events-none absolute inset-0 hidden items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 sm:flex'>
            <span className='atv-material-dark flex h-12 w-12 items-center justify-center rounded-full'>
              <Play className='ml-0.5 h-5 w-5 fill-white text-white' />
            </span>
          </div>
        )}

        {/* 操作按钮 */}
        {(config.showHeart ||
          config.showCheckCircle ||
          config.showDoubanLink) && (
          <div className='absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100'>
            {config.showDoubanLink &&
              actualDoubanId &&
              actualDoubanId !== 'undefined' && (
                <a
                  href={`https://movie.douban.com/subject/${actualDoubanId}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  onClick={(e) => e.stopPropagation()}
                  className={actionBtn}
                  aria-label='在豆瓣查看'
                  title='在豆瓣查看'
                >
                  <ExternalLink className='h-4 w-4' />
                </a>
              )}
            {config.showCheckCircle && (
              <button
                onClick={handleDeleteRecord}
                className={actionBtn}
                aria-label='从继续观看中移除'
                title='从继续观看中移除'
              >
                <X className='h-4 w-4' strokeWidth={2.5} />
              </button>
            )}
            {config.showHeart && (
              <button
                onClick={handleToggleFavorite}
                className={actionBtn}
                aria-label={favorited ? '取消收藏' : '收藏'}
                title={favorited ? '取消收藏' : '收藏'}
              >
                <Heart
                  className={`h-4 w-4 ${
                    favorited ? 'fill-atv-red text-atv-red' : 'text-white'
                  }`}
                />
              </button>
            )}
          </div>
        )}

        {/* 观看进度 */}
        {config.showProgress && progress > 0 && (
          <div className='absolute inset-x-2.5 bottom-2.5 h-1 overflow-hidden rounded-full bg-white/30'>
            <div
              className='h-full rounded-full bg-white'
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* 标题与信息 */}
      <div className='mt-2.5 px-0.5'>
        <p
          className='truncate text-[13px] font-medium leading-5 text-atv-label sm:text-sm'
          title={actualTitle}
        >
          {actualTitle}
        </p>
        {meta && (
          <p className='truncate text-xs leading-4 text-atv-secondary'>
            {meta}
          </p>
        )}
      </div>
    </div>
  );
}
