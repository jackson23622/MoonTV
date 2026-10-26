'use client';

import React, { useEffect, useMemo, useRef } from 'react';

import {
  DoubanFilterState,
  DoubanMediaType,
  FilterOption,
  GENRE_OPTIONS,
  getSortOptions,
  getYearOptions,
  isDefaultFilters,
  PLATFORM_OPTIONS,
  REGION_OPTIONS,
} from '@/lib/douban.filters';

interface DoubanFilterPanelProps {
  type: DoubanMediaType;
  filters: DoubanFilterState;
  onChange: (next: DoubanFilterState) => void;
}

interface RowProps {
  label: string;
  options: FilterOption[];
  value: string;
  onSelect: (value: string) => void;
}

const FilterRow: React.FC<RowProps> = ({ label, options, value, onSelect }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // 选中项不在可视范围时，横向滚动到可见位置（移动端选项很多）
  useEffect(() => {
    const container = scrollRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    const cLeft = container.scrollLeft;
    const cRight = cLeft + container.clientWidth;
    const aLeft = active.offsetLeft;
    const aRight = aLeft + active.offsetWidth;
    if (aLeft < cLeft || aRight > cRight) {
      container.scrollTo({ left: aLeft - 16, behavior: 'smooth' });
    }
  }, [value]);

  return (
    <div className='flex items-start gap-2 sm:gap-3'>
      <span className='shrink-0 pt-1 sm:pt-1.5 text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 w-9 sm:w-12'>
        {label}
      </span>
      <div
        ref={scrollRef}
        className='flex-1 min-w-0 overflow-x-auto scrollbar-hide sm:overflow-visible'
      >
        <div className='flex gap-1.5 sm:gap-2 sm:flex-wrap w-max sm:w-auto pr-4 sm:pr-0'>
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                ref={active ? activeRef : undefined}
                onClick={() => !active && onSelect(opt.value)}
                className={`whitespace-nowrap rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm transition-colors duration-150 ${
                  active
                    ? 'bg-green-500 text-white font-medium shadow-sm cursor-default'
                    : 'text-gray-700 hover:bg-gray-200/80 dark:text-gray-300 dark:hover:bg-gray-700/70'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const DoubanFilterPanel: React.FC<DoubanFilterPanelProps> = ({
  type,
  filters,
  onChange,
}) => {
  const yearOptions = useMemo(() => getYearOptions(), []);
  const set = (key: keyof DoubanFilterState) => (value: string) =>
    onChange({ ...filters, [key]: value });

  const summary = [
    filters.genre,
    filters.region,
    filters.year,
    type === 'movie' ? 'all' : filters.platform,
  ].filter((v) => v !== 'all');

  return (
    <div className='space-y-2.5 sm:space-y-3'>
      <FilterRow
        label='类型'
        options={GENRE_OPTIONS[type]}
        value={filters.genre}
        onSelect={set('genre')}
      />
      <FilterRow
        label='地区'
        options={REGION_OPTIONS[type]}
        value={filters.region}
        onSelect={set('region')}
      />
      <FilterRow
        label='年代'
        options={yearOptions}
        value={filters.year}
        onSelect={set('year')}
      />
      {type !== 'movie' && (
        <FilterRow
          label='平台'
          options={PLATFORM_OPTIONS}
          value={filters.platform}
          onSelect={set('platform')}
        />
      )}
      <FilterRow
        label='排序'
        options={getSortOptions(type)}
        value={filters.sort}
        onSelect={set('sort')}
      />

      {!isDefaultFilters(filters) && (
        <div className='flex items-center justify-between pt-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400'>
          <span className='truncate'>
            {summary.length > 0 ? `已选：${summary.join(' · ')}` : '已调整排序'}
          </span>
          <button
            onClick={() =>
              onChange({
                genre: 'all',
                region: 'all',
                year: 'all',
                platform: 'all',
                sort: 'T',
              })
            }
            className='shrink-0 ml-3 text-green-600 hover:text-green-700 dark:text-green-400'
          >
            重置
          </button>
        </div>
      )}
    </div>
  );
};

export default DoubanFilterPanel;
