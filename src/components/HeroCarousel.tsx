'use client';

import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Backdrop } from '@/lib/douban.backdrop';
import { getDoubanBackdrop } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';
import { getImageFallbackUrl, processImageUrl } from '@/lib/utils';

import { GUTTER } from './ui';

export interface HeroSlide {
  item: DoubanItem;
  kind: 'movie' | 'tv' | 'show';
}

const INTERVAL_MS = 7000;
const KIND_LABEL = { movie: '电影', tv: '剧集', show: '综艺' } as const;

/** 豆瓣海报换成大图（失败时回落到原图） */
function largePoster(url: string): string {
  return url.replace(/\/[sm]_ratio_poster\//, '/l_ratio_poster/');
}

function HeroImage({
  src,
  className,
  eager,
  onLoad,
  onFail,
}: {
  src: string;
  className: string;
  eager?: boolean;
  onLoad?: () => void;
  /** 所有地址都失败 */
  onFail?: () => void;
}) {
  const original = src;
  const [current, setCurrent] = useState(() =>
    processImageUrl(largePoster(original))
  );
  const triedOriginal = useRef(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt=''
      aria-hidden
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy='no-referrer'
      className={className}
      onLoad={onLoad}
      onError={() => {
        if (!triedOriginal.current && largePoster(original) !== original) {
          triedOriginal.current = true;
          setCurrent(processImageUrl(original));
          return;
        }
        const next = getImageFallbackUrl(original, current);
        if (next) setCurrent(next);
        else onFail?.();
      }}
    />
  );
}

/** 视口是否为桌面宽度（≥768px） */
function useIsDesktop(): boolean | null {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return desktop;
}

/** 满屏高度：优先 100svh（手机地址栏不遮挡），旧浏览器回落 100vh */
const HERO_HEIGHT =
  'h-screen min-h-[520px] supports-[height:100svh]:h-[100svh]';

/**
 * 首页大图轮播，铺满整屏：
 *   桌面端 —— 豆瓣横版剧照铺满（加载完成后淡入）；影片没有合适剧照时，
 *            回落为虚化海报背景 + 右侧清晰海报。
 *   手机端 —— 清晰竖版海报铺满。
 * 始终使用深色（无论站点主题），7 秒自动切换，悬停 / 聚焦 / 减少动态效果时暂停。
 */
export default function HeroCarousel({
  slides,
  loading,
}: {
  slides: HeroSlide[];
  loading?: boolean;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const isDesktop = useIsDesktop();
  // 每部影片的剧照：undefined 未取到 / null 没有合适的 / Backdrop
  const [backdrops, setBackdrops] = useState<
    Record<string, Backdrop | null | undefined>
  >({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  // 桌面端才取剧照（手机端用竖版海报，省流量）
  useEffect(() => {
    if (!isDesktop || !count) return;
    let alive = true;
    slides.forEach((s) => {
      const id = s.item.id;
      getDoubanBackdrop(s.kind === 'movie' ? 'movie' : 'tv', id).then((b) => {
        if (alive) setBackdrops((prev) => ({ ...prev, [id]: b }));
      });
    });
    return () => {
      alive = false;
    };
  }, [isDesktop, count, slides]);

  const go = useCallback(
    (to: number) => setIndex(((to % count) + count) % count),
    [count]
  );

  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % count);
    }, INTERVAL_MS);
    return () => clearInterval(t);
  }, [count, paused, index]);

  // 手机端左右滑动切换
  const touchX = useRef<number | null>(null);

  if (loading || !count) {
    return (
      <section
        className={`dark relative w-full overflow-hidden bg-black ${HERO_HEIGHT}`}
      >
        <div
          className='absolute inset-0 opacity-60'
          style={{
            background:
              'linear-gradient(90deg, #0d0d0f 25%, #1a1a1d 50%, #0d0d0f 75%)',
            backgroundSize: '200% 100%',
            animation: 'shine 1.8s ease-in-out infinite',
          }}
        />
      </section>
    );
  }

  const play = (s: HeroSlide) => {
    const stype = s.kind === 'movie' ? 'movie' : 'tv';
    router.push(
      `/play?title=${encodeURIComponent(s.item.title.trim())}${
        s.item.year ? `&year=${s.item.year}` : ''
      }&stype=${stype}`
    );
  };

  return (
    <section
      className={`group/hero dark relative w-full overflow-hidden bg-black text-white ${HERO_HEIGHT}`}
      aria-roledescription='carousel'
      aria-label='精选推荐'
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(index + 1);
        if (e.key === 'ArrowLeft') go(index - 1);
      }}
    >
      {slides.map((s, i) => {
        const active = i === index;
        const near =
          active ||
          i === (index + 1) % count ||
          i === (index - 1 + count) % count;
        return (
          <div
            key={s.item.id}
            className={`absolute inset-0 transition-opacity duration-[1200ms] ease-apple ${
              active ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={!active}
            aria-roledescription='slide'
            aria-label={`${i + 1} / ${count}：${s.item.title}`}
          >
            {near && (
              <>
                {/* 底图：手机端清晰海报铺满；桌面端放大虚化（剧照未到或没有剧照时可见） */}
                <HeroImage
                  src={s.item.poster}
                  eager={i === 0}
                  className={`absolute inset-0 h-full w-full object-cover object-top md:scale-125 md:blur-3xl md:brightness-[0.6] md:saturate-150 ${
                    active ? 'hero-zoom' : ''
                  }`}
                />
                {/* 桌面端：横版剧照铺满整屏 */}
                {isDesktop && backdrops[s.item.id] && (
                  <HeroImage
                    key={backdrops[s.item.id]?.url}
                    src={(backdrops[s.item.id] as Backdrop).url}
                    eager={active}
                    onLoad={() =>
                      setLoaded((prev) => ({ ...prev, [s.item.id]: true }))
                    }
                    onFail={() =>
                      setBackdrops((prev) => ({ ...prev, [s.item.id]: null }))
                    }
                    className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ease-apple ${
                      loaded[s.item.id] ? 'opacity-100' : 'opacity-0'
                    } ${active ? 'hero-zoom-all' : ''}`}
                  />
                )}
              </>
            )}
          </div>
        );
      })}

      {/* 文字可读性渐变（在背景之上、清晰海报之下） */}
      <div className='pointer-events-none absolute inset-0 bg-gradient-to-t from-black from-[22%] via-black/75 via-[42%] to-transparent to-[72%] md:from-black/90 md:from-0% md:via-black/20 md:via-35% md:to-transparent md:to-60%' />
      <div className='pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-black/80 via-black/35 via-40% to-transparent to-70% md:block' />

      {/* 桌面端：右侧清晰海报 */}
      {slides.map((s, i) => {
        const active = i === index;
        const near =
          active ||
          i === (index + 1) % count ||
          i === (index - 1 + count) % count;
        // 有剧照（或还在取）时不显示右侧海报，剧照本身就是主图
        if (!near || !isDesktop || backdrops[s.item.id] !== null) return null;
        return (
          <div
            key={`poster-${s.item.id}`}
            aria-hidden
            className={`absolute right-[7vw] top-1/2 hidden aspect-[2/3] h-[64%] -translate-y-[46%] transition-opacity duration-[1200ms] ease-apple md:block ${
              active ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <HeroImage
              src={s.item.poster}
              eager={i === 0}
              className={`h-full w-full rounded-2xl object-cover shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 transition-transform duration-[1200ms] ease-apple ${
                active
                  ? 'translate-y-0 scale-100'
                  : 'translate-y-4 scale-[0.98]'
              }`}
            />
          </div>
        );
      })}

      {/* 片名与操作 */}
      {slides.map((s, i) => {
        const active = i === index;
        const meta = [
          s.item.rate ? `★ ${s.item.rate}` : '',
          s.item.year,
          KIND_LABEL[s.kind],
        ].filter(Boolean);
        return (
          <div
            key={`text-${s.item.id}`}
            className={`absolute inset-x-0 bottom-0 pb-[calc(52px+env(safe-area-inset-bottom)+4.5rem)] md:bottom-[15%] md:pb-0 ${GUTTER} transition-all duration-700 ease-apple ${
              active
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none translate-y-3 opacity-0'
            }`}
            aria-hidden={!active}
          >
            <div className='max-w-xl'>
              <h2 className='text-[2.5rem] font-bold leading-[1.05] tracking-[-0.03em] drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] [text-wrap:balance] sm:text-5xl lg:text-[4.5rem]'>
                {s.item.title}
              </h2>
              <p className='mt-3 flex flex-wrap items-center gap-x-3 text-[15px] font-medium text-white/75'>
                {meta.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </p>
              <div className='mt-6 flex items-center gap-3'>
                <button
                  onClick={() => play(s)}
                  tabIndex={active ? 0 : -1}
                  className='atv-btn-primary h-11 px-7 text-[15px]'
                >
                  <Play className='h-4 w-4 fill-current' />
                  播放
                </button>
                <a
                  href={`https://movie.douban.com/subject/${s.item.id}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  tabIndex={active ? 0 : -1}
                  className='atv-btn-secondary h-11 px-5 text-[15px] backdrop-blur-md'
                >
                  豆瓣详情
                </a>
              </div>
            </div>
          </div>
        );
      })}

      {/* 翻页 */}
      {count > 1 && (
        <>
          <button
            onClick={() => go(index - 1)}
            className='atv-material-dark absolute left-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-white opacity-0 transition-opacity duration-200 hover:bg-white/20 focus-visible:opacity-100 group-hover/hero:opacity-100 md:flex'
            aria-label='上一部'
          >
            <ChevronLeft className='h-6 w-6' />
          </button>
          <button
            onClick={() => go(index + 1)}
            className='atv-material-dark absolute right-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-white opacity-0 transition-opacity duration-200 hover:bg-white/20 focus-visible:opacity-100 group-hover/hero:opacity-100 md:flex'
            aria-label='下一部'
          >
            <ChevronRight className='h-6 w-6' />
          </button>
          <div
            className={`absolute bottom-[calc(52px+env(safe-area-inset-bottom)+1.5rem)] flex items-center gap-1.5 md:bottom-[8%] ${GUTTER} md:left-auto md:right-0`}
          >
            {slides.map((s, i) => (
              <button
                key={`dot-${s.item.id}`}
                onClick={() => go(i)}
                aria-label={`第 ${i + 1} 部：${s.item.title}`}
                aria-current={i === index}
                className='group/dot flex h-6 items-center'
              >
                <span
                  className={`block h-1.5 rounded-full transition-all duration-500 ease-apple ${
                    i === index
                      ? 'w-6 bg-white'
                      : 'w-1.5 bg-white/40 group-hover/dot:bg-white/70'
                  }`}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
