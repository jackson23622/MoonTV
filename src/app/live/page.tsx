/* eslint-disable no-console */
'use client';

import Hls from 'hls.js';
import { RefreshCw, Search, Tv2 } from 'lucide-react';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import PageLayout from '@/components/PageLayout';

interface LiveChannel {
  name: string;
  logo?: string;
  urls: string[];
  hd?: boolean;
  height?: number;
}
interface LiveGroup {
  name: string;
  channels: LiveChannel[];
}
interface LiveData {
  updatedAt: string;
  sources: { name: string; url: string }[];
  groups: LiveGroup[];
}

const LAST_KEY = 'live_last_channel';
const START_TIMEOUT_MS = 10000; // 线路 10 秒内未开始播放则自动换下一条

function LivePageClient() {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [current, setCurrent] = useState<LiveChannel | null>(null);
  const [lineIndex, setLineIndex] = useState(0);
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'playing' | 'failed'
  >('idle');

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载频道数据
  useEffect(() => {
    fetch('/live/channels.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((d: LiveData) => {
        setData(d);
        setGroup(d.groups[0]?.name || '');
        try {
          const last = localStorage.getItem(LAST_KEY);
          const all = d.groups.flatMap((g) => g.channels);
          const ch =
            (last && all.find((c) => c.name === last)) ||
            d.groups[0]?.channels[0];
          if (ch) {
            const g = d.groups.find((x) => x.channels.includes(ch));
            if (g) setGroup(g.name);
            setCurrent(ch);
            setLineIndex(0);
          }
        } catch {
          // ignore
        }
      })
      .catch((e) => setError('直播频道加载失败：' + e.message));
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const nextLine = useCallback(() => {
    setLineIndex((i) => {
      if (current && i + 1 < current.urls.length) return i + 1;
      setStatus('failed');
      return i;
    });
  }, [current]);

  // 播放当前频道的当前线路
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return;
    const url = current.urls[lineIndex];
    if (!url) return;

    cleanup();
    setStatus('loading');

    const onPlaying = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus('playing');
    };
    video.addEventListener('playing', onPlaying);
    timerRef.current = setTimeout(() => {
      console.warn('[直播] 线路超时，切换下一条', url);
      nextLine();
    }, START_TIMEOUT_MS);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 8000,
        levelLoadingTimeOut: 8000,
        fragLoadingTimeOut: 15000,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) {
          console.warn('[直播] 线路失败，切换下一条', url, d.details);
          nextLine();
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => undefined);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生 HLS
      video.src = url;
      const onErr = () => nextLine();
      video.addEventListener('error', onErr, { once: true });
      video.play().catch(() => undefined);
    } else {
      setStatus('failed');
    }

    return () => {
      video.removeEventListener('playing', onPlaying);
      cleanup();
    };
  }, [current, lineIndex, cleanup, nextLine]);

  useEffect(() => cleanup, [cleanup]);

  // 全部线路失败后停止加载，避免后台反复重试
  useEffect(() => {
    if (status === 'failed') cleanup();
  }, [status, cleanup]);

  const selectChannel = (ch: LiveChannel) => {
    setCurrent(ch);
    setLineIndex(0);
    setStatus('loading');
    try {
      localStorage.setItem(LAST_KEY, ch.name);
    } catch {
      // ignore
    }
  };

  const visible = useMemo(() => {
    if (!data) return [];
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      return data.groups
        .flatMap((g) => g.channels)
        .filter((c) => c.name.toLowerCase().includes(kw));
    }
    return data.groups.find((g) => g.name === group)?.channels || [];
  }, [data, group, keyword]);

  const updatedText = data
    ? new Date(data.updatedAt).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '';

  return (
    <PageLayout activePath='/live'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        <div className='mb-4 flex items-center gap-2'>
          <Tv2 className='h-6 w-6 text-green-600 dark:text-green-400' />
          <h1 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
            电视直播
          </h1>
          {updatedText && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              频道更新于 {updatedText}
            </span>
          )}
        </div>

        {error && <div className='text-red-500 py-10 text-center'>{error}</div>}

        {!error && (
          <div className='grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4'>
            {/* 播放器 */}
            <div>
              <div className='relative w-full aspect-video bg-black rounded-xl overflow-hidden'>
                <video
                  ref={videoRef}
                  className='w-full h-full'
                  controls
                  playsInline
                  autoPlay
                  muted={false}
                />
                {status === 'loading' && (
                  <div className='absolute inset-0 flex items-center justify-center text-white/80 text-sm pointer-events-none'>
                    正在连接{current ? ` ${current.name}` : ''}（线路{' '}
                    {lineIndex + 1}/{current?.urls.length || 1}）…
                  </div>
                )}
                {status === 'failed' && (
                  <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/90 text-sm bg-black/70'>
                    <span>
                      {current?.name} 所有线路暂时无法播放，请换个频道试试
                    </span>
                    <button
                      onClick={() => {
                        setLineIndex(0);
                        setStatus('loading');
                        setCurrent((c) => (c ? { ...c } : c));
                      }}
                      className='px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white'
                    >
                      重试
                    </button>
                  </div>
                )}
              </div>
              {current && (
                <div className='mt-3 flex items-center justify-between gap-3'>
                  <div className='text-lg font-semibold text-gray-800 dark:text-gray-200'>
                    {current.name}
                    {current.height ? (
                      <span className='ml-2 text-xs font-normal text-gray-500 dark:text-gray-400'>
                        {current.height}p
                      </span>
                    ) : null}
                  </div>
                  {current.urls.length > 1 && (
                    <div className='flex items-center gap-1 text-sm'>
                      {current.urls.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setLineIndex(i);
                            setStatus('loading');
                          }}
                          className={`px-2 py-1 rounded ${
                            i === lineIndex
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200'
                          }`}
                        >
                          线路{i + 1}
                        </button>
                      ))}
                      <button
                        title='换下一条线路'
                        onClick={() => {
                          setLineIndex((i) =>
                            current ? (i + 1) % current.urls.length : 0
                          );
                          setStatus('loading');
                        }}
                        className='ml-1 p-1 rounded text-gray-600 hover:text-green-600 dark:text-gray-300'
                      >
                        <RefreshCw className='h-4 w-4' />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 频道列表 */}
            <div className='flex flex-col min-h-0'>
              <div className='relative mb-3'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400' />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder='搜索频道'
                  className='w-full h-10 rounded-lg bg-gray-50/80 py-2 pl-9 pr-3 text-sm text-gray-700 border border-gray-200/50 focus:outline-none focus:ring-2 focus:ring-green-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                />
              </div>
              {!keyword && data && (
                <div className='mb-3 flex flex-wrap gap-2'>
                  {data.groups.map((g) => (
                    <button
                      key={g.name}
                      onClick={() => setGroup(g.name)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        g.name === group
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      {g.name}
                      <span className='ml-1 opacity-70'>
                        {g.channels.length}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2 lg:max-h-[60vh] overflow-y-auto pr-1'>
                {!data && !error && (
                  <div className='col-span-full text-sm text-gray-500 py-6 text-center'>
                    加载频道中…
                  </div>
                )}
                {data && !visible.length && (
                  <div className='col-span-full text-sm text-gray-500 py-6 text-center'>
                    没有找到频道
                  </div>
                )}
                {visible.map((ch) => (
                  <button
                    key={ch.name}
                    onClick={() => selectChannel(ch)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                      current?.name === ch.name
                        ? 'bg-green-500/20 text-green-700 dark:text-green-400 ring-1 ring-green-500/40'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-gray-800/70 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {ch.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ch.logo}
                        alt=''
                        loading='lazy'
                        referrerPolicy='no-referrer'
                        className='h-6 w-10 object-contain flex-shrink-0'
                        onError={(e) =>
                          ((e.target as HTMLImageElement).style.visibility =
                            'hidden')
                        }
                      />
                    ) : (
                      <Tv2 className='h-5 w-5 flex-shrink-0 opacity-60' />
                    )}
                    <span className='truncate'>{ch.name}</span>
                    {ch.hd && (
                      <span className='ml-auto flex-shrink-0 rounded px-1 text-[10px] leading-4 bg-green-600/90 text-white'>
                        高清
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {data && (
                <p className='mt-3 text-xs text-gray-400 dark:text-gray-500'>
                  频道来自 GitHub：{data.sources.map((s) => s.name).join('、')}
                  ，每 6 小时自动检测更新。
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default function LivePage() {
  return (
    <Suspense>
      <LivePageClient />
    </Suspense>
  );
}
