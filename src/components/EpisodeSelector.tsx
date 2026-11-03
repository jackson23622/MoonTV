/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SearchResult } from '@/lib/types';
import {
  getImageFallbackUrl,
  getVideoResolutionFromM3u8,
  processImageUrl,
} from '@/lib/utils';

import Spinner from './Spinner';

// 定义视频信息类型
interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean; // 添加错误状态标识
}

interface EpisodeSelectorProps {
  /** 总集数 */
  totalEpisodes: number;
  /** 每页显示多少集，默认 50 */
  episodesPerPage?: number;
  /** 当前选中的集数（1 开始） */
  value?: number;
  /** 用户点击选集后的回调 */
  onChange?: (episodeNumber: number) => void;
  /** 换源相关 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 预计算的测速结果，避免重复测速 */
  precomputedVideoInfo?: Map<string, VideoInfo>;
}

/**
 * 选集组件，支持分页、自动滚动聚焦当前分页标签，以及换源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // 存储每个源的视频信息
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );

  // 使用 ref 来避免闭包问题
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  // 同步状态到 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  // 主要的 tab 状态：'episodes' 或 'sources'
  // 当只有一集时默认展示 "换源"，并隐藏 "选集" 标签
  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources'
  );

  // 当前分页索引（0 开始）
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 是否倒序显示
  const [descending, setDescending] = useState<boolean>(false);

  // 获取视频信息的函数 - 移除 attemptedSources 依赖避免不必要的重新创建
  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;

    // 使用 ref 获取最新的状态，避免闭包问题
    if (attemptedSourcesRef.current.has(sourceKey)) {
      return;
    }

    // 获取第一集的URL
    if (!source.episodes || source.episodes.length === 0) {
      return;
    }
    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

    // 标记为已尝试
    setAttemptedSources((prev) => new Set(prev).add(sourceKey));

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl);
      setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
    } catch (error) {
      // 失败时保存错误状态
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        })
      );
    }
  }, []);

  // 当有预计算结果时，先合并到videoInfoMap中
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      // 原子性地更新两个状态，避免时序问题
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          if (!info.hasError) {
            newSet.add(key);
          }
        });
        return newSet;
      });

      // 同步更新 ref，确保 getVideoInfo 能立即看到更新
      precomputedVideoInfo.forEach((info, key) => {
        if (!info.hasError) {
          attemptedSourcesRef.current.add(key);
        }
      });
    }
  }, [precomputedVideoInfo]);

  // 读取本地“优选和测速”开关，默认开启
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 当切换到换源tab并且有源数据时，异步获取视频信息 - 移除 attemptedSources 依赖避免循环触发
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (
        !optimizationEnabled || // 若关闭测速则直接退出
        activeTab !== 'sources' ||
        availableSources.length === 0
      )
        return;

      // 筛选出尚未测速的播放源
      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      const batchSize = Math.ceil(pendingSources.length / 2);

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }
    };

    fetchVideoInfosInBatches();
    // 依赖项保持与之前一致
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled]);

  // 升序分页标签
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return `${start}-${end}`;
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  // 分页标签始终保持升序
  const categories = categoriesAsc;

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 当分页切换时，将激活的分页标签滚动到视口中间
  useEffect(() => {
    const btn = buttonRefs.current[currentPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      // 手动计算滚动位置，只滚动分页标签容器
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 计算按钮相对于容器的位置
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 计算目标滚动位置，使按钮居中
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 平滑滚动到目标位置
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [currentPage, pageCount]);

  // 处理换源tab点击，只在点击时才搜索
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback((index: number) => {
    setCurrentPage(index);
  }, []);

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      onChange?.(episodeNumber);
    },
    [onChange]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );

  return (
    <div className='flex h-full flex-col overflow-hidden rounded-2xl bg-atv-elevated px-3 ring-1 ring-black/5 dark:ring-white/[0.06] md:ml-1 sm:px-4'>
      {/* 选集 / 换源：分段控件 */}
      <div className='flex-shrink-0 pb-3 pt-3'>
        <div role='tablist' className='flex rounded-[9px] bg-atv-fill/20 p-0.5'>
          {(totalEpisodes > 1
            ? ([
                ['episodes', '选集'],
                ['sources', '换源'],
              ] as const)
            : ([['sources', '换源']] as const)
          ).map(([key, label]) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                role='tab'
                aria-selected={active}
                onClick={() =>
                  key === 'episodes'
                    ? setActiveTab('episodes')
                    : handleSourceTabClick()
                }
                className={`flex-1 rounded-[7px] py-1.5 text-[13px] font-semibold transition-all duration-200 ${
                  active
                    ? 'bg-atv-thumb text-atv-label shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]'
                    : 'text-atv-label/70 hover:text-atv-label'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 选集 Tab 内容 */}
      {activeTab === 'episodes' && (
        <>
          {/* 分类标签 */}
          <div className='mb-3 flex flex-shrink-0 items-center gap-2'>
            <div
              className='scrollbar-hide flex-1 overflow-x-auto'
              ref={categoryContainerRef}
            >
              <div className='flex min-w-max gap-1'>
                {categories.map((label, idx) => {
                  const isActive = idx === currentPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      aria-pressed={isActive}
                      className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
                        isActive
                          ? 'bg-atv-fill/25 text-atv-label'
                          : 'text-atv-secondary hover:text-atv-label'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 向上/向下按钮 */}
            <button
              className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-atv-secondary transition-colors hover:bg-atv-fill/20 hover:text-atv-label'
              aria-label={descending ? '正序排列' : '倒序排列'}
              title={descending ? '正序排列' : '倒序排列'}
              onClick={() => {
                // 切换集数排序（正序/倒序）
                setDescending((prev) => !prev);
              }}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>

          {/* 集数网格 */}
          <div className='scrollbar-hide grid h-full auto-rows-[40px] grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2 overflow-y-auto pb-4'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i
              );
              return episodes;
            })().map((episodeNumber) => {
              const isActive = episodeNumber === value;
              return (
                <button
                  key={episodeNumber}
                  onClick={() => handleEpisodeClick(episodeNumber - 1)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`flex h-10 items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition-all duration-200 ${
                    isActive
                      ? 'bg-atv-label text-atv-bg'
                      : 'bg-atv-fill/[0.14] text-atv-label/85 hover:bg-atv-fill/25 hover:text-atv-label'
                  }`}
                >
                  {episodeNumber}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 换源 Tab 内容 */}
      {activeTab === 'sources' && (
        <div className='flex h-full flex-col'>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center gap-2.5 py-10'>
              <Spinner size={18} />
              <span className='text-[13px] text-atv-secondary'>
                正在查找其他片源
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <p className='px-4 text-center text-[13px] text-atv-red'>
                {sourceSearchError}
              </p>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <p className='text-center text-[13px] text-atv-secondary'>
                  没有找到其他片源
                </p>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='scrollbar-hide flex-1 space-y-1 overflow-y-auto pb-20'>
                {availableSources
                  .sort((a, b) => {
                    const aIsCurrent =
                      a.source?.toString() === currentSource?.toString() &&
                      a.id?.toString() === currentId?.toString();
                    const bIsCurrent =
                      b.source?.toString() === currentSource?.toString() &&
                      b.id?.toString() === currentId?.toString();
                    if (aIsCurrent && !bIsCurrent) return -1;
                    if (!aIsCurrent && bIsCurrent) return 1;
                    return 0;
                  })
                  .map((source, index) => {
                    const isCurrentSource =
                      source.source?.toString() === currentSource?.toString() &&
                      source.id?.toString() === currentId?.toString();
                    return (
                      <div
                        key={`${source.source}-${source.id}`}
                        onClick={() =>
                          !isCurrentSource && handleSourceClick(source)
                        }
                        role={isCurrentSource ? undefined : 'button'}
                        tabIndex={isCurrentSource ? undefined : 0}
                        onKeyDown={(e) => {
                          if (
                            !isCurrentSource &&
                            (e.key === 'Enter' || e.key === ' ')
                          ) {
                            e.preventDefault();
                            handleSourceClick(source);
                          }
                        }}
                        aria-current={isCurrentSource ? 'true' : undefined}
                        className={`relative flex select-none items-start gap-3 rounded-xl px-2 py-2.5 transition-colors duration-200 ${
                          isCurrentSource
                            ? 'bg-atv-fill/[0.18]'
                            : 'cursor-pointer hover:bg-atv-fill/10'
                        }`}
                      >
                        {/* 封面 */}
                        <div className='h-20 w-[3.4rem] flex-shrink-0 overflow-hidden rounded-lg bg-atv-elevated2'>
                          {source.episodes && source.episodes.length > 0 && (
                            <img
                              src={processImageUrl(source.poster)}
                              alt={source.title}
                              className='w-full h-full object-cover'
                              referrerPolicy='no-referrer'
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                const next = target.dataset.fallback
                                  ? null
                                  : getImageFallbackUrl(
                                      source.poster,
                                      target.src
                                    );
                                if (next) {
                                  target.dataset.fallback = '1';
                                  target.src = next;
                                } else {
                                  target.style.display = 'none';
                                }
                              }}
                            />
                          )}
                        </div>

                        {/* 信息区域 */}
                        <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                          {/* 标题和分辨率 - 顶部 */}
                          <div className='flex items-start justify-between gap-3 h-6'>
                            <div className='flex-1 min-w-0 relative group/title'>
                              <h3 className='truncate text-[15px] font-medium leading-tight text-atv-label'>
                                {source.title}
                              </h3>
                              {/* 标题级别的 tooltip - 第一个元素不显示 */}
                              {index !== 0 && (
                                <div className='pointer-events-none invisible absolute bottom-full left-1/2 z-[500] mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-atv-elevated2 px-3 py-1 text-xs text-atv-label opacity-0 shadow-lg transition-all delay-100 duration-200 group-hover/title:visible group-hover/title:opacity-100'>
                                  {source.title}
                                </div>
                              )}
                            </div>
                            {(() => {
                              const sourceKey = `${source.source}-${source.id}`;
                              const videoInfo = videoInfoMap.get(sourceKey);

                              if (videoInfo && videoInfo.quality !== '未知') {
                                if (videoInfo.hasError) {
                                  return (
                                    <span className='flex-shrink-0 text-[11px] font-medium text-atv-red'>
                                      检测失败
                                    </span>
                                  );
                                } else {
                                  // 清晰度徽章（Apple TV 的 4K / HD 描边样式）：越清晰越醒目
                                  const isHigh = [
                                    '4K',
                                    '2K',
                                    '1080p',
                                    '720p',
                                  ].includes(videoInfo.quality);

                                  return (
                                    <span
                                      className={`flex-shrink-0 rounded-[4px] border px-1 text-[10px] font-bold leading-4 ${
                                        isHigh
                                          ? 'border-atv-label/50 text-atv-label/90'
                                          : 'border-atv-tertiary/60 text-atv-secondary'
                                      }`}
                                    >
                                      {videoInfo.quality}
                                    </span>
                                  );
                                }
                              }

                              return null;
                            })()}
                          </div>

                          {/* 源名称和集数信息 - 垂直居中 */}
                          <div className='flex items-center justify-between'>
                            <span className='truncate text-[13px] text-atv-secondary'>
                              {isCurrentSource && (
                                <span className='mr-1.5 font-medium text-atv-label'>
                                  正在播放
                                </span>
                              )}
                              {source.source_name}
                            </span>
                            {source.episodes.length > 1 && (
                              <span className='flex-shrink-0 text-xs text-atv-tertiary'>
                                {source.episodes.length} 集
                              </span>
                            )}
                          </div>

                          {/* 网络信息 - 底部 */}
                          <div className='flex items-end h-6'>
                            {(() => {
                              const sourceKey = `${source.source}-${source.id}`;
                              const videoInfo = videoInfoMap.get(sourceKey);
                              if (videoInfo) {
                                if (!videoInfo.hasError) {
                                  return (
                                    <div className='flex items-end gap-3 text-xs tabular-nums text-atv-tertiary'>
                                      <span>{videoInfo.loadSpeed}</span>
                                      <span>{videoInfo.pingTime}ms</span>
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div className='text-xs text-atv-tertiary'>
                                      无测速数据
                                    </div>
                                  ); // 占位div
                                }
                              }
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                <div className='mt-auto flex-shrink-0 border-t border-atv-separator/70 pt-2'>
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        );
                      }
                    }}
                    className='w-full py-2 text-center text-[13px] text-atv-accent transition-opacity hover:opacity-80'
                  >
                    片源不对？去搜索
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
