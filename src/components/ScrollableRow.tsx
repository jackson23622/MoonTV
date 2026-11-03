'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { GUTTER } from './ui';

interface ScrollableRowProps {
  children: React.ReactNode;
  /** 子项之间的间距 class */
  gap?: string;
}

/**
 * 横向片架（Apple TV 样式）：左侧与页面边距对齐、右侧出血，
 * 按页吸附滚动；桌面端悬停时两侧出现翻页按钮。
 */
export default function ScrollableRow({
  children,
  gap = 'gap-3 sm:gap-4 lg:gap-5',
}: ScrollableRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  }, []);

  useEffect(() => {
    check();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: false });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [check]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  const arrow =
    'atv-material absolute top-0 bottom-10 z-10 hidden w-10 items-center justify-center text-atv-label opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 focus-visible:opacity-100 md:flex lg:w-12';

  return (
    <div className='group/row relative'>
      <div
        ref={ref}
        onScroll={check}
        className={`scrollbar-hide flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain pb-2 pt-3 ${gap} ${GUTTER} scroll-px-4 sm:scroll-px-8 lg:scroll-px-12 2xl:scroll-px-16`}
      >
        {children}
        {/* 右侧留白，最后一张卡片也能完整浮起 */}
        <div aria-hidden className='w-px flex-shrink-0' />
      </div>
      {canLeft && (
        <button
          onClick={() => page(-1)}
          className={`${arrow} left-0 rounded-r-2xl`}
          aria-label='向左翻页'
        >
          <ChevronLeft className='h-7 w-7' strokeWidth={2.2} />
        </button>
      )}
      {canRight && (
        <button
          onClick={() => page(1)}
          className={`${arrow} right-0 rounded-l-2xl`}
          aria-label='向右翻页'
        >
          <ChevronRight className='h-7 w-7' strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

/** 片架中单个卡片的宽度（与 snap 对齐） */
export const SHELF_ITEM =
  'w-[30vw] max-w-[9.5rem] flex-shrink-0 snap-start sm:w-40 sm:max-w-none lg:w-44 2xl:w-48';
