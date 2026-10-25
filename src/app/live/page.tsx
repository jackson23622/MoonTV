/* eslint-disable no-console */
'use client';

import Hls from 'hls.js';
import {
  Check,
  Copy,
  Link2,
  RefreshCw,
  RotateCcw,
  Search,
  Tv2,
} from 'lucide-react';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  buildLiveData,
  DEFAULT_SUBSCRIPTION,
  LiveChannel,
  LiveData,
  normalizeSubscription,
  parseSubscription,
  SITE_SUBSCRIPTION,
  SUBSCRIPTION_KEY,
  SUBSCRIPTION_PRESETS,
} from '@/lib/live-subscription';
import { bindFullscreenOrientation } from '@/lib/orientation';

import PageLayout from '@/components/PageLayout';

type Programme = [number, number, string];
interface EpgData {
  updatedAt?: string;
  ch: Record<string, Programme[]>;
}

const LAST_KEY = 'live_last_channel';
const LINE_PREF_KEY = 'live_line_pref';
const START_TIMEOUT_MS = 10000; // 线路 10 秒内未开始播放则自动换下一条
const KIND_LABEL: Record<string, string> = { d: '直连', p: '代理', c: '国内' };

function readStore<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function readSubscription(): string {
  try {
    return normalizeSubscription(localStorage.getItem(SUBSCRIPTION_KEY));
  } catch {
    return DEFAULT_SUBSCRIPTION;
  }
}

/** 同站地址直接请求；其他站点经本站服务端代为拉取（订阅站通常不允许浏览器跨域读取） */
async function fetchSubscriptionText(url: string): Promise<string> {
  const target = new URL(url, window.location.href);
  const sameSite = target.origin === window.location.origin;
  const res = await fetch(
    sameSite
      ? target.pathname + target.search
      : `/api/live/subscription?url=${encodeURIComponent(target.toString())}`,
    { cache: 'no-cache' }
  );
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.text();
}

async function fetchSiteData(): Promise<LiveData | null> {
  try {
    const r = await fetch('/live/channels.json', { cache: 'no-cache' });
    return r.ok ? ((await r.json()) as LiveData) : null;
  } catch {
    return null;
  }
}

/** 从上次能播的线路开始（境内外网络不同，能播的线路也不同，自动记住） */
function preferredLine(ch: LiveChannel) {
  const pref = readStore<Record<string, string>>(LINE_PREF_KEY, {});
  const i = pref[ch.name] ? ch.urls.indexOf(pref[ch.name]) : -1;
  return i < 0 ? 0 : i;
}

function nowPlaying(list: Programme[] | undefined, nowSec: number) {
  if (!list) return -1;
  return list.findIndex((p) => p[0] <= nowSec && nowSec < p[1]);
}
const hhmm = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });

function LivePageClient() {
  const [data, setData] = useState<LiveData | null>(null);
  const [epg, setEpg] = useState<EpgData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [current, setCurrent] = useState<LiveChannel | null>(null);
  const [lineIndex, setLineIndex] = useState(0);
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'playing' | 'failed'
  >('idle');
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const [subUrl, setSubUrl] = useState<string>(DEFAULT_SUBSCRIPTION);
  const [subInput, setSubInput] = useState<string>(DEFAULT_SUBSCRIPTION);
  const [subOpen, setSubOpen] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triedRef = useRef(0); // 当前频道已尝试的线路数
  const playingRef = useRef(false); // 当前线路是否已开始播放

  // 每分钟刷新一次「正在播放」
  useEffect(() => {
    const t = setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      60000
    );
    return () => clearInterval(t);
  }, []);

  const loadSubscription = useCallback(async (url: string) => {
    setSubLoading(true);
    setError(null);
    try {
      const site = await fetchSiteData();
      let d: LiveData;
      if (!url) {
        if (!site?.groups?.length) throw new Error('本站频道数据暂不可用');
        d = site;
      } else {
        const entries = parseSubscription(await fetchSubscriptionText(url));
        if (!entries.length) throw new Error('订阅里没有可识别的频道');
        d = buildLiveData(entries, site);
      }
      setData(d);
      setSubUrl(url);

      const all = d.groups.flatMap((g) => g.channels);
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_KEY);
      } catch {
        // ignore
      }
      const ch = (last && all.find((c) => c.name === last)) || all[0] || null;
      const g = ch
        ? d.groups.find((x) => x.channels.includes(ch))
        : d.groups[0];
      setGroup(g?.name || '');
      triedRef.current = 1;
      setCurrent(ch);
      setLineIndex(ch ? preferredLine(ch) : 0);
    } catch (e) {
      setError('直播频道加载失败：' + (e as Error).message);
      setData(null);
    } finally {
      setSubLoading(false);
    }
  }, []);

  useEffect(() => {
    const url = readSubscription();
    setSubInput(url);
    loadSubscription(url);
    fetch('/live/epg.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<EpgData>) : null))
      .then((e) => e && setEpg(e))
      .catch(() => undefined);
  }, [loadSubscription]);

  const saveSubscription = (url: string) => {
    const value = normalizeSubscription(url);
    try {
      if (value === DEFAULT_SUBSCRIPTION)
        localStorage.removeItem(SUBSCRIPTION_KEY);
      else localStorage.setItem(SUBSCRIPTION_KEY, value);
    } catch {
      // ignore
    }
    setSubInput(value);
    loadSubscription(value);
  };

  const copyTvSubscription = async () => {
    try {
      await navigator.clipboard.writeText(subUrl || SITE_SUBSCRIPTION);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const cleanup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  // 换下一条线路（从起始线路开始环绕一圈，全部失败才报错）
  const nextLine = useCallback(() => {
    if (!current) return;
    if (triedRef.current >= current.urls.length) {
      setStatus('failed');
      return;
    }
    triedRef.current += 1;
    setLineIndex((i) => (i + 1) % current.urls.length);
  }, [current]);

  // 播放当前频道的当前线路
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return;
    const url = current.urls[lineIndex];
    if (!url) {
      cleanup();
      setStatus('failed');
      return;
    }

    cleanup();
    setStatus('loading');
    playingRef.current = false;

    const onPlaying = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      playingRef.current = true;
      setStatus('playing');
      // 记住这个频道能播的线路
      const pref = readStore<Record<string, string>>(LINE_PREF_KEY, {});
      if (pref[current.name] !== url) {
        pref[current.name] = url;
        writeStore(LINE_PREF_KEY, pref);
      }
      // 有声音没画面（纯音频线路或解码失败）：3 秒后仍无画面就换下一条
      timerRef.current = setTimeout(() => {
        if (video.videoWidth === 0 && video.currentTime > 0) {
          console.warn('[直播] 线路无画面，切换下一条', url);
          nextLine();
        }
      }, 3000);
    };
    video.addEventListener('playing', onPlaying);
    timerRef.current = setTimeout(() => {
      console.warn('[直播] 线路超时，切换下一条', url);
      nextLine();
    }, START_TIMEOUT_MS);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 1,
        levelLoadingTimeOut: 8000,
        levelLoadingMaxRetry: 2,
        fragLoadingTimeOut: 15000,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        // 播放中途的媒体错误先尝试原地恢复，恢复不了再换线
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && playingRef.current) {
          hls.recoverMediaError();
          return;
        }
        console.warn('[直播] 线路失败，切换下一条', url, d.details);
        nextLine();
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

  // 手机端点全屏直接横屏（直播画面都是横向）
  useEffect(() => bindFullscreenOrientation(() => videoRef.current), []);

  // 全部线路失败后停止加载，避免后台反复重试
  useEffect(() => {
    if (status === 'failed') cleanup();
  }, [status, cleanup]);

  const selectChannel = (ch: LiveChannel) => {
    triedRef.current = 1;
    setCurrent(ch);
    setLineIndex(preferredLine(ch));
    setStatus('loading');
    try {
      localStorage.setItem(LAST_KEY, ch.name);
    } catch {
      // ignore
    }
  };

  const pickLine = (i: number) => {
    triedRef.current = current ? current.urls.length : 1; // 手动选线不再自动轮换
    setLineIndex(i);
    setStatus('loading');
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

  const total = data
    ? data.groups.reduce((a, g) => a + g.channels.length, 0)
    : 0;
  const hiddenChannels = data?.hidden || 0;
  const updatedText = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const programmes = current ? epg?.ch[current.name] : undefined;
  const playingIdx = nowPlaying(programmes, nowSec);
  const upcoming =
    programmes && playingIdx >= 0
      ? programmes.slice(playingIdx, playingIdx + 6)
      : programmes?.filter((p) => p[1] > nowSec).slice(0, 6) || [];
  const kind = current?.kinds?.[lineIndex] || '';

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
              {total} 个频道 · {updatedText} 更新
            </span>
          )}
          <button
            onClick={() => setSubOpen((v) => !v)}
            className='ml-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
          >
            <Link2 className='h-4 w-4' />
            直播源
          </button>
        </div>

        {subOpen && (
          <div className='mb-4 rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50/80 dark:bg-gray-800/60'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              直播源
            </label>
            <div className='mb-2 flex flex-wrap gap-2'>
              {SUBSCRIPTION_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => saveSubscription(p.url)}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    subUrl === p.url
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className='flex flex-col sm:flex-row gap-2'>
              <input
                value={subInput}
                onChange={(e) => setSubInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && saveSubscription(subInput)
                }
                placeholder='自定义 m3u / txt 订阅地址（留空 = 本站频道）'
                className='flex-1 h-10 rounded-lg bg-white py-2 px-3 text-sm text-gray-700 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-400 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700'
              />
              <div className='flex gap-2'>
                <button
                  onClick={() => saveSubscription(subInput)}
                  disabled={subLoading}
                  className='h-10 px-4 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm'
                >
                  {subLoading ? '加载中…' : '加载'}
                </button>
                <button
                  onClick={() => saveSubscription(DEFAULT_SUBSCRIPTION)}
                  title='恢复本站频道'
                  className='h-10 px-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 text-sm flex items-center gap-1'
                >
                  <RotateCcw className='h-4 w-4' />
                  默认
                </button>
                <button
                  onClick={copyTvSubscription}
                  title='复制电视客户端订阅地址'
                  className='h-10 px-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200 text-sm flex items-center gap-1'
                >
                  {copied ? (
                    <Check className='h-4 w-4' />
                  ) : (
                    <Copy className='h-4 w-4' />
                  )}
                  {copied ? '已复制' : '电视订阅'}
                </button>
              </div>
            </div>
            <p className='mt-2 text-xs text-gray-500 dark:text-gray-400 leading-5'>
              本站精选每 6 小时从多个 IPTV
              仓库检测更新，每个频道多条线路按顺序自动切换：
              「直连」浏览器直接播放；「国内」国内网络直连的线路；「代理」http
              或不允许跨域的线路经本站 Cloudflare 转发（最慢，作兜底）。
              每个频道会记住上次能播的线路。
              {hiddenChannels > 0 &&
                ` 当前订阅另有 ${hiddenChannels} 个频道只有 IP 地址 / IPv6 线路，网页无法播放，已隐藏。`}
              <br />
              电视客户端（OrionTV「设置 → 直播源」）填
              <span className='font-mono break-all'> {SITE_SUBSCRIPTION}</span>
              ；其他订阅想按同样规则清洗，可填
              <span className='font-mono break-all'>
                {' '}
                https://bde4.dpdns.org/tv/filter.m3u?url=订阅地址
              </span>
              。
            </p>
          </div>
        )}

        {error && <div className='text-red-500 py-10 text-center'>{error}</div>}

        {!error && (
          <div className='grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4'>
            {/* 播放器 + 节目单 */}
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
                    {lineIndex + 1}/{current?.urls.length || 1}
                    {KIND_LABEL[kind] ? ` · ${KIND_LABEL[kind]}` : ''}）…
                  </div>
                )}
                {status === 'failed' && (
                  <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/90 text-sm bg-black/70'>
                    <span className='px-4 text-center'>
                      {current?.cn
                        ? `${current.name} 只有国内线路，当前网络无法播放`
                        : `${current?.name} 所有线路暂时无法播放，请换个频道试试`}
                    </span>
                    <button
                      onClick={() => current && selectChannel({ ...current })}
                      className='px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white'
                    >
                      重试
                    </button>
                  </div>
                )}
              </div>

              {current && (
                <div className='mt-3 flex flex-wrap items-center justify-between gap-3'>
                  <div className='flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-gray-200'>
                    {current.logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={current.logo}
                        alt=''
                        referrerPolicy='no-referrer'
                        className='h-7 w-12 object-contain'
                      />
                    )}
                    {current.name}
                    {current.height ? (
                      <span className='text-xs font-normal text-gray-500 dark:text-gray-400'>
                        {current.height}p
                      </span>
                    ) : null}
                  </div>
                  {current.urls.length > 1 && (
                    <div className='flex flex-wrap items-center gap-1 text-sm'>
                      {current.urls.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => pickLine(i)}
                          title={KIND_LABEL[current.kinds?.[i] || ''] || ''}
                          className={`px-2 py-1 rounded ${
                            i === lineIndex
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200'
                          }`}
                        >
                          {i + 1}
                          {KIND_LABEL[current.kinds?.[i] || ''] && (
                            <span className='ml-0.5 text-[10px] opacity-80'>
                              {KIND_LABEL[current.kinds?.[i] || '']}
                            </span>
                          )}
                        </button>
                      ))}
                      <button
                        title='换下一条线路'
                        onClick={() =>
                          pickLine((lineIndex + 1) % current.urls.length)
                        }
                        className='ml-1 p-1 rounded text-gray-600 hover:text-green-600 dark:text-gray-300'
                      >
                        <RefreshCw className='h-4 w-4' />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {upcoming.length > 0 && (
                <div className='mt-3 rounded-xl bg-gray-50 dark:bg-gray-800/70 p-3'>
                  {upcoming.map((p) => {
                    const live = p[0] <= nowSec && nowSec < p[1];
                    const pct = live
                      ? Math.round(((nowSec - p[0]) / (p[1] - p[0])) * 100)
                      : 0;
                    return (
                      <div
                        key={p[0]}
                        className={`flex items-center gap-3 py-1 text-sm ${
                          live
                            ? 'text-green-700 dark:text-green-400 font-medium'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        <span className='w-12 flex-shrink-0 font-mono text-xs'>
                          {hhmm(p[0])}
                        </span>
                        <span className='truncate'>{p[2]}</span>
                        {live && (
                          <span className='ml-auto flex items-center gap-2 flex-shrink-0'>
                            <span className='hidden sm:block h-1 w-20 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden'>
                              <span
                                className='block h-full bg-green-500'
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            <span className='text-[10px] rounded px-1 bg-green-600 text-white'>
                              正在播
                            </span>
                          </span>
                        )}
                      </div>
                    );
                  })}
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
                      {g.name.replace(/频道$/, '')}
                      <span className='ml-1 opacity-70'>
                        {g.channels.length}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 lg:max-h-[64vh] overflow-y-auto pr-1'>
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
                {visible.map((ch) => {
                  const list = epg?.ch[ch.name];
                  const idx = nowPlaying(list, nowSec);
                  const title = list && idx >= 0 ? list[idx][2] : '';
                  return (
                    <button
                      key={ch.name}
                      onClick={() => selectChannel(ch)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
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
                          className='h-7 w-12 object-contain flex-shrink-0'
                          onError={(e) =>
                            ((e.target as HTMLImageElement).style.visibility =
                              'hidden')
                          }
                        />
                      ) : (
                        <span className='h-7 w-12 flex items-center justify-center flex-shrink-0'>
                          <Tv2 className='h-5 w-5 opacity-50' />
                        </span>
                      )}
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate font-medium'>
                          {ch.name}
                        </span>
                        {title && (
                          <span className='block truncate text-xs opacity-60'>
                            {title}
                          </span>
                        )}
                      </span>
                      {ch.cn ? (
                        <span className='flex-shrink-0 rounded px-1 text-[10px] leading-4 bg-amber-500/90 text-white'>
                          国内
                        </span>
                      ) : (
                        ch.hd && (
                          <span className='flex-shrink-0 rounded px-1 text-[10px] leading-4 bg-green-600/90 text-white'>
                            {ch.height && ch.height >= 2160 ? '4K' : '高清'}
                          </span>
                        )
                      )}
                    </button>
                  );
                })}
              </div>
              {data && (
                <p className='mt-3 text-xs text-gray-400 dark:text-gray-500'>
                  {subUrl
                    ? `当前订阅：${subUrl}`
                    : '频道、台标与节目单均来自 jackson23622/live，每 6 小时检测更新。'}
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
