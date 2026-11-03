'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import ScrollableRow, { SHELF_ITEM } from './ScrollableRow';
import { GUTTER } from './ui';

interface ShelfProps {
  title: string;
  /** 标题可点击跳转（Apple TV：标题后带 ›） */
  href?: string;
  onTitleClick?: () => void;
  /** 标题行右侧的次要操作 */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** 首页片架：标题 + 横向滚动的卡片 */
export default function Shelf({
  title,
  href,
  onTitleClick,
  action,
  children,
}: ShelfProps) {
  const heading = (
    <>
      {title}
      {(href || onTitleClick) && (
        <ChevronRight
          className='h-5 w-5 text-atv-secondary transition-transform duration-200 group-hover/title:translate-x-0.5'
          strokeWidth={2.5}
        />
      )}
    </>
  );
  const titleClass =
    'atv-section-title group/title inline-flex items-center gap-0.5 text-atv-label';

  return (
    <section className='mt-7 sm:mt-9'>
      <div className={`flex items-center justify-between ${GUTTER}`}>
        <h2>
          {href ? (
            <Link href={href} className={titleClass}>
              {heading}
            </Link>
          ) : onTitleClick ? (
            <button onClick={onTitleClick} className={titleClass}>
              {heading}
            </button>
          ) : (
            <span className={titleClass}>{heading}</span>
          )}
        </h2>
        {action}
      </div>
      <ScrollableRow>{children}</ScrollableRow>
    </section>
  );
}

/** 片架加载占位 */
export function ShelfSkeleton({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={SHELF_ITEM}>
          <div
            className='aspect-[2/3] w-full rounded-xl'
            style={{
              background:
                'linear-gradient(90deg, var(--skeleton-color) 25%, var(--skeleton-highlight) 50%, var(--skeleton-color) 75%)',
              backgroundSize: '200% 100%',
              animation: 'shine 1.6s ease-in-out infinite',
            }}
          />
          <div className='mt-2.5 h-3.5 w-3/4 rounded bg-atv-fill/15' />
          <div className='mt-1.5 h-3 w-1/2 rounded bg-atv-fill/10' />
        </div>
      ))}
    </>
  );
}

export { SHELF_ITEM };
