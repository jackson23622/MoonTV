/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { rankSearchGroups, rankSearchResults } from '@/lib/search-rank';
import { SearchResult } from '@/lib/types';

import PageLayout from '@/components/PageLayout';
import Spinner from '@/components/Spinner';
import { GUTTER, POSTER_GRID } from '@/components/ui';
import VideoCard from '@/components/VideoCard';

function SearchPageClient() {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  // 当前结果对应的搜索词（输入框正在编辑时不影响已有结果的排序）
  const [resultQuery, setResultQuery] = useState('');

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 默认启用聚合
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 聚合后的结果（按标题和年份分组）
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      // 使用 title + year + type 作为键，year 必然存在，但依然兜底 'unknown'
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    // 与搜索词越接近的排越前（组内同样按相关度）
    return rankSearchGroups(Array.from(map.entries()), resultQuery);
  }, [searchResults, resultQuery]);

  useEffect(() => {
    // 无搜索参数时聚焦搜索框
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    // 初始加载搜索历史
    getSearchHistory().then(setSearchHistory);

    // 监听搜索历史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    // 获取滚动位置的函数 - 专门针对 body 滚动
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持续检测滚动位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      requestAnimationFrame(checkScrollPosition);
    };

    // 启动持续检测
    isRunning = true;
    checkScrollPosition();

    // 监听 body 元素的滚动事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      isRunning = false; // 停止 requestAnimationFrame 循环

      // 移除 body 滚动事件监听器
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    // 当搜索参数变化时更新搜索状态
    const query = searchParams.get('q');
    if (query) {
      setSearchQuery(query);
      fetchSearchResults(query);

      // 保存到搜索历史 (事件监听会自动更新界面)
      addSearchHistory(query);
    } else {
      setShowResults(false);
    }
  }, [searchParams]);

  const fetchSearchResults = async (query: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}`
      );
      const data = await response.json();
      setResultQuery(query.trim());
      setSearchResults(rankSearchResults(data.results || [], query.trim()));
      setShowResults(true);
    } catch (error) {
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    // 回显搜索框
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);

    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    // 直接发请求
    fetchSearchResults(trimmed);

    // 保存到搜索历史 (事件监听会自动更新界面)
    addSearchHistory(trimmed);
  };

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  const resultCount =
    viewMode === 'agg' ? aggregatedResults.length : searchResults.length;

  return (
    <PageLayout activePath='/search'>
      <div className={`pt-4 sm:pt-8 ${GUTTER}`}>
        <h1 className='atv-large-title mb-4 sm:mb-6'>搜索</h1>

        {/* 搜索框 */}
        <form onSubmit={handleSearch} role='search' className='max-w-2xl'>
          <div className='relative'>
            <Search className='pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-atv-secondary' />
            <input
              id='searchInput'
              type='search'
              enterKeyHint='search'
              autoComplete='off'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='电影、剧集、综艺'
              aria-label='搜索影片'
              className='atv-input h-12 !rounded-xl pl-11 pr-11 !text-[17px] [&::-webkit-search-cancel-button]:hidden'
            />
            {searchQuery && (
              <button
                type='button'
                onClick={() => {
                  setSearchQuery('');
                  document.getElementById('searchInput')?.focus();
                }}
                className='absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-atv-secondary/60 text-atv-bg transition-colors hover:bg-atv-secondary'
                aria-label='清除输入'
              >
                <X className='h-3 w-3' strokeWidth={3} />
              </button>
            )}
          </div>
        </form>

        {/* 搜索结果或搜索历史 */}
        <div className='mt-8 sm:mt-10'>
          {isLoading ? (
            <div className='flex h-40 items-center justify-center'>
              <Spinner size={28} />
            </div>
          ) : showResults ? (
            <section>
              <div className='mb-6 flex items-center justify-between gap-4'>
                <h2 className='atv-section-title truncate'>
                  搜索结果
                  {resultCount > 0 && (
                    <span className='ml-2 text-base font-normal text-atv-secondary'>
                      {resultCount}
                    </span>
                  )}
                </h2>
                {/* 聚合开关 */}
                <label className='flex shrink-0 cursor-pointer select-none items-center gap-2.5'>
                  <span className='text-[15px] text-atv-label'>聚合片源</span>
                  <span className='relative'>
                    <input
                      type='checkbox'
                      className='peer sr-only'
                      checked={viewMode === 'agg'}
                      onChange={() =>
                        setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                      }
                    />
                    <span className='block h-[31px] w-[51px] rounded-full bg-atv-fill/30 transition-colors duration-200 peer-checked:bg-atv-green peer-focus-visible:ring-2 peer-focus-visible:ring-atv-accent' />
                    <span className='absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md transition-transform duration-200 peer-checked:translate-x-5' />
                  </span>
                </label>
              </div>
              {searchResults.length === 0 ? (
                <p className='py-16 text-center text-atv-secondary'>
                  没有找到“{resultQuery}”。试试更短的片名，或检查有没有错别字。
                </p>
              ) : (
                <div key={`search-results-${viewMode}`} className={POSTER_GRID}>
                  {viewMode === 'agg'
                    ? aggregatedResults.map(([mapKey, group]) => (
                        <VideoCard
                          key={`agg-${mapKey}`}
                          from='search'
                          items={group}
                          query={
                            searchQuery.trim() !== group[0].title
                              ? searchQuery.trim()
                              : ''
                          }
                        />
                      ))
                    : searchResults.map((item) => (
                        <VideoCard
                          key={`all-${item.source}-${item.id}`}
                          id={item.id}
                          title={item.title}
                          poster={item.poster}
                          episodes={item.episodes.length}
                          source={item.source}
                          source_name={item.source_name}
                          douban_id={item.douban_id?.toString()}
                          query={
                            searchQuery.trim() !== item.title
                              ? searchQuery.trim()
                              : ''
                          }
                          year={item.year}
                          from='search'
                          type={item.episodes.length > 1 ? 'tv' : 'movie'}
                        />
                      ))}
                </div>
              )}
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索历史
            <section>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='atv-section-title'>最近搜索</h2>
                <button
                  onClick={() => {
                    clearSearchHistory(); // 事件监听会自动更新界面
                  }}
                  className='text-[15px] text-atv-accent hover:opacity-80'
                >
                  清除
                </button>
              </div>
              <ul className='flex flex-wrap gap-2'>
                {searchHistory.map((item) => (
                  <li
                    key={item}
                    className='group flex items-center rounded-full bg-atv-fill/[0.14] text-[15px] text-atv-label transition-colors hover:bg-atv-fill/25'
                  >
                    <button
                      onClick={() => {
                        setSearchQuery(item);
                        router.push(
                          `/search?q=${encodeURIComponent(item.trim())}`
                        );
                      }}
                      className='py-2 pl-4 pr-1'
                    >
                      {item}
                    </button>
                    <button
                      aria-label={`删除“${item}”`}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item); // 事件监听会自动更新界面
                      }}
                      className='mr-1.5 flex h-6 w-6 items-center justify-center rounded-full text-atv-tertiary transition-colors hover:bg-atv-fill/25 hover:text-atv-label'
                    >
                      <X className='h-3.5 w-3.5' />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className='py-16 text-center text-atv-secondary'>
              输入片名，搜索所有片源。
            </p>
          )}
        </div>
      </div>

      {/* 返回顶部 */}
      <button
        onClick={scrollToTop}
        className={`atv-material fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-[500] flex h-11 w-11 items-center justify-center rounded-full text-atv-label shadow-lg ring-1 ring-atv-separator/60 transition-all duration-300 md:bottom-6 md:right-6 ${
          showBackToTop
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='h-5 w-5' strokeWidth={2.5} />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
