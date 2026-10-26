/* eslint-disable no-console,react-hooks/exhaustive-deps */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getDoubanCategories, getDoubanRecommends } from '@/lib/douban.client';
import {
  DEFAULT_FILTERS,
  DoubanFilterState,
  DoubanMediaType,
  normalizeFilters,
} from '@/lib/douban.filters';
import { DoubanItem, DoubanResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanFilterPanel from '@/components/DoubanFilterPanel';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

const PAGE_SIZE = 25;

const MODE_OPTIONS = [
  { label: '榜单', value: 'rank' },
  { label: '筛选', value: 'filter' },
];

function DoubanPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectorsReady, setSelectorsReady] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // 每次重置列表时递增，用于丢弃过期请求的返回（快速切换筛选时防止串数据）
  const requestIdRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const type = searchParams.get('type') || 'movie';
  const mediaType: DoubanMediaType =
    type === 'tv' || type === 'show' ? type : 'movie';

  // 模式与筛选条件以 URL 为准：刷新、分享、从播放页返回都能保留
  const mode: 'rank' | 'filter' =
    searchParams.get('mode') === 'filter' ? 'filter' : 'rank';
  const filters = useMemo(
    () =>
      normalizeFilters(mediaType, {
        genre: searchParams.get('genre'),
        region: searchParams.get('region'),
        year: searchParams.get('year'),
        platform: searchParams.get('platform'),
        sort: searchParams.get('sort'),
      }),
    [mediaType, searchParams]
  );
  const filterKey = `${mode}|${filters.genre}|${filters.region}|${filters.year}|${filters.platform}|${filters.sort}`;

  const updateUrl = useCallback(
    (nextMode: 'rank' | 'filter', nextFilters: DoubanFilterState) => {
      const qs = new URLSearchParams({ type });
      if (nextMode === 'filter') {
        qs.set('mode', 'filter');
        (Object.keys(DEFAULT_FILTERS) as (keyof DoubanFilterState)[]).forEach(
          (key) => {
            if (nextFilters[key] !== DEFAULT_FILTERS[key]) {
              qs.set(key, nextFilters[key]);
            }
          }
        );
      }
      router.replace(`/douban?${qs.toString()}`, { scroll: false });
    },
    [router, type]
  );

  const handleModeChange = useCallback(
    (value: string) => {
      const nextMode = value === 'filter' ? 'filter' : 'rank';
      if (nextMode === mode) return;
      setLoading(true);
      updateUrl(nextMode, nextMode === 'filter' ? filters : DEFAULT_FILTERS);
    },
    [mode, filters, updateUrl]
  );

  const handleFiltersChange = useCallback(
    (next: DoubanFilterState) => {
      setLoading(true);
      updateUrl('filter', next);
    },
    [updateUrl]
  );

  // 选择器状态 - 完全独立，不依赖URL参数
  const [primarySelection, setPrimarySelection] = useState<string>(() => {
    return type === 'movie' ? '热门' : '';
  });
  const [secondarySelection, setSecondarySelection] = useState<string>(() => {
    if (type === 'movie') return '全部';
    if (type === 'tv') return 'tv';
    if (type === 'show') return 'show';
    return '全部';
  });

  // 初始化时标记选择器为准备好状态
  useEffect(() => {
    // 短暂延迟确保初始状态设置完成
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, []); // 只在组件挂载时执行一次

  // type变化时立即重置selectorsReady（最高优先级）
  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true); // 立即显示loading状态
  }, [type]);

  // 当type变化时重置选择器状态
  useEffect(() => {
    // 批量更新选择器状态
    if (type === 'movie') {
      setPrimarySelection('热门');
      setSecondarySelection('全部');
    } else if (type === 'tv') {
      setPrimarySelection('');
      setSecondarySelection('tv');
    } else if (type === 'show') {
      setPrimarySelection('');
      setSecondarySelection('show');
    } else {
      setPrimarySelection('');
      setSecondarySelection('全部');
    }

    // 使用短暂延迟确保状态更新完成后标记选择器准备好
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, [type]);

  // 生成骨架屏数据
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  // 生成API请求参数的辅助函数
  const getRequestParams = useCallback(
    (pageStart: number) => {
      // 当type为tv或show时，kind统一为'tv'，category使用type本身
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: 25,
          pageStart,
        };
      }

      // 电影类型保持原逻辑
      return {
        kind: type as 'tv' | 'movie',
        category: primarySelection,
        type: secondarySelection,
        pageLimit: 25,
        pageStart,
      };
    },
    [type, primarySelection, secondarySelection]
  );

  // 按当前模式获取一页数据
  const fetchPage = useCallback(
    (pageStart: number): Promise<DoubanResult> =>
      mode === 'filter'
        ? getDoubanRecommends({
            type: mediaType,
            start: pageStart,
            limit: PAGE_SIZE,
            ...filters,
          })
        : getDoubanCategories(getRequestParams(pageStart)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, mediaType, filterKey, getRequestParams]
  );

  // 筛选接口会过滤掉片单/广告条目，单页可能不足 25 条，以返回为空判断到底
  const pageHasMore = useCallback(
    (list: DoubanItem[]) =>
      mode === 'filter' ? list.length > 0 : list.length === PAGE_SIZE,
    [mode]
  );

  // 防抖的数据加载函数
  const loadInitialData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchPage(0);
      if (requestId !== requestIdRef.current) return;

      if (data.code === 200) {
        setDoubanData(data.list);
        setHasMore(pageHasMore(data.list));
      } else {
        throw new Error(data.message || '获取数据失败');
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error(err);
      setDoubanData([]);
      setHasMore(false);
      setError('加载失败，请稍后重试或在设置中开启豆瓣代理');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [fetchPage, pageHasMore]);

  // 只在选择器准备好后才加载数据
  useEffect(() => {
    // 只有在选择器准备好时才开始加载
    if (!selectorsReady) {
      return;
    }

    // 重置页面状态
    setDoubanData([]);
    setCurrentPage(0);
    setHasMore(true);
    setIsLoadingMore(false);

    // 清除之前的防抖定时器
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // 使用防抖机制加载数据，避免连续状态更新触发多次请求
    debounceTimeoutRef.current = setTimeout(() => {
      loadInitialData();
    }, 100); // 100ms 防抖延迟

    // 清理函数
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [
    selectorsReady,
    type,
    primarySelection,
    secondarySelection,
    filterKey,
    loadInitialData,
  ]);

  // 单独处理 currentPage 变化（加载更多）
  useEffect(() => {
    if (currentPage > 0) {
      const requestId = requestIdRef.current;
      const fetchMoreData = async () => {
        try {
          setIsLoadingMore(true);

          const data = await fetchPage(currentPage * PAGE_SIZE);
          if (requestId !== requestIdRef.current) return;

          if (data.code === 200) {
            setDoubanData((prev) => {
              // 豆瓣分页偶有重复条目，按 id 去重
              const seen = new Set(prev.map((i) => i.id));
              return [...prev, ...data.list.filter((i) => !seen.has(i.id))];
            });
            setHasMore(pageHasMore(data.list));
          } else {
            throw new Error(data.message || '获取数据失败');
          }
        } catch (err) {
          console.error(err);
          if (requestId === requestIdRef.current) setHasMore(false);
        } finally {
          if (requestId === requestIdRef.current) setIsLoadingMore(false);
        }
      };

      fetchMoreData();
    }
  }, [currentPage, type, primarySelection, secondarySelection, filterKey]);

  // 设置滚动监听
  useEffect(() => {
    // 如果没有更多数据或正在加载，则不设置监听
    if (!hasMore || isLoadingMore || loading) {
      return;
    }

    // 确保 loadingRef 存在
    if (!loadingRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, isLoadingMore, loading]);

  // 处理选择器变化
  const handlePrimaryChange = useCallback(
    (value: string) => {
      // 只有当值真正改变时才设置loading状态
      if (value !== primarySelection) {
        setLoading(true);
        setPrimarySelection(value);
      }
    },
    [primarySelection]
  );

  const handleSecondaryChange = useCallback(
    (value: string) => {
      // 只有当值真正改变时才设置loading状态
      if (value !== secondarySelection) {
        setLoading(true);
        setSecondarySelection(value);
      }
    },
    [secondarySelection]
  );

  const getPageTitle = () => {
    // 根据 type 生成标题
    return type === 'movie' ? '电影' : type === 'tv' ? '电视剧' : '综艺';
  };

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);

    const queryString = params.toString();
    const activePath = `/douban${queryString ? `?${queryString}` : ''}`;
    return activePath;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 页面标题和选择器 */}
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          {/* 页面标题 */}
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
              来自豆瓣的精选内容
            </p>
          </div>

          {/* 选择器组件 */}
          <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm space-y-4 sm:space-y-5'>
            <CapsuleSwitch
              key={type}
              options={MODE_OPTIONS}
              active={mode}
              onChange={handleModeChange}
            />
            {mode === 'filter' ? (
              <DoubanFilterPanel
                type={mediaType}
                filters={filters}
                onChange={handleFiltersChange}
              />
            ) : (
              <DoubanSelector
                type={mediaType}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
              />
            )}
          </div>
        </div>

        {/* 内容展示区域 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          {/* 内容网格 */}
          <div className='grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
            {loading || !selectorsReady
              ? // 显示骨架屏
                skeletonData.map((index) => <DoubanCardSkeleton key={index} />)
              : // 显示实际数据
                doubanData.map((item, index) => (
                  <div key={`${item.title}-${index}`} className='w-full'>
                    <VideoCard
                      from='douban'
                      title={item.title}
                      poster={item.poster}
                      douban_id={item.id}
                      rate={item.rate}
                      year={item.year}
                      type={type === 'movie' ? 'movie' : ''} // 电影类型严格控制，tv 不控
                    />
                  </div>
                ))}
          </div>

          {/* 加载更多指示器 */}
          {hasMore && !loading && (
            <div
              ref={(el) => {
                if (el && el.offsetParent !== null) {
                  (
                    loadingRef as React.MutableRefObject<HTMLDivElement | null>
                  ).current = el;
                }
              }}
              className='flex justify-center mt-12 py-8'
            >
              {isLoadingMore && (
                <div className='flex items-center gap-2'>
                  <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                  <span className='text-gray-600'>加载中...</span>
                </div>
              )}
            </div>
          )}

          {/* 没有更多数据提示 */}
          {!hasMore && doubanData.length > 0 && (
            <div className='text-center text-gray-500 py-8'>已加载全部内容</div>
          )}

          {/* 空状态 / 错误 */}
          {!loading && doubanData.length === 0 && (
            <div className='text-center text-gray-500 py-8'>
              {error || '暂无相关内容'}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense>
      <DoubanPageClient />
    </Suspense>
  );
}
