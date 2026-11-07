'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

interface NavSearchProps {
  className?: string;
  /** 挂载时聚焦（手机端点开搜索时） */
  autoFocus?: boolean;
  /** 提交后回调（手机端收起搜索栏等） */
  onSubmitted?: () => void;
}

/**
 * 导航栏里的搜索框（全站唯一的搜索入口）：
 * 输入后回车跳到 /search?q=…；在搜索页时与地址栏的 q 同步，空搜索页自动聚焦。
 */
function NavSearchInner({
  className = '',
  autoFocus,
  onSubmitted,
}: NavSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onSearchPage = pathname === '/search';
  const q = onSearchPage ? searchParams.get('q') || '' : '';
  const [value, setValue] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  // 地址栏的搜索词变化（搜索历史点击、前进后退）时回显
  useEffect(() => {
    setValue(q);
  }, [q]);

  useEffect(() => {
    if (autoFocus || (onSearchPage && !q)) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, onSearchPage]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    setValue(trimmed);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    inputRef.current?.blur();
    onSubmitted?.();
  };

  return (
    <form onSubmit={submit} role='search' className={`relative ${className}`}>
      <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-atv-secondary' />
      <input
        ref={inputRef}
        type='search'
        enterKeyHint='search'
        autoComplete='off'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='搜索'
        aria-label='搜索影片'
        className={`h-9 w-full rounded-full pl-9 pr-8 text-sm text-atv-label outline-none transition-colors duration-200 placeholder:text-atv-secondary focus:ring-2 focus:ring-atv-accent [&::-webkit-search-cancel-button]:hidden ${
          onSearchPage
            ? 'bg-atv-fill/30'
            : 'bg-atv-fill/20 hover:bg-atv-fill/30'
        }`}
      />
      {value && (
        <button
          type='button'
          onClick={() => {
            setValue('');
            inputRef.current?.focus();
          }}
          className='absolute right-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-atv-secondary/60 text-atv-bg transition-colors hover:bg-atv-secondary'
          aria-label='清除输入'
        >
          <X className='h-2.5 w-2.5' strokeWidth={3} />
        </button>
      )}
    </form>
  );
}

export default function NavSearch(props: NavSearchProps) {
  return (
    <Suspense fallback={<div className={`h-9 ${props.className || ''}`} />}>
      <NavSearchInner {...props} />
    </Suspense>
  );
}
