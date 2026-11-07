'use client';

import { ChevronLeft, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { LogoutButton } from './LogoutButton';
import NavSearch from './NavSearch';
import { SettingsButton } from './SettingsButton';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { ICON_BTN, useScrolled } from './ui';

interface MobileHeaderProps {
  showBackButton?: boolean;
  /** 浮在首页大图上：顶部透明且强制深色 */
  overlay?: boolean;
  /** 搜索页：顶部直接显示搜索栏 */
  searchPage?: boolean;
}

/** 手机端顶部栏 */
const MobileHeader = ({
  showBackButton = false,
  overlay = false,
  searchPage = false,
}: MobileHeaderProps) => {
  const router = useRouter();
  // 右上角搜索：点放大镜展开成搜索栏；搜索页常驻
  const [searchOpen, setSearchOpen] = useState(searchPage);
  useEffect(() => setSearchOpen(searchPage), [searchPage]);
  const { siteName } = useSite();
  const scrolled = useScrolled();
  const transparent = overlay && !scrolled;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-[700] md:hidden transition-[background-color,border-color] duration-300 ${
        transparent
          ? 'dark border-b border-transparent'
          : 'atv-material border-b border-atv-separator/60'
      }`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* 顶部柔和渐变：浮在大图上时保证文字可读，渐隐范围比导航栏高，避免出现分界线 */}
      {transparent && (
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-28 bg-gradient-to-b from-black/60 via-black/25 to-transparent'
        />
      )}
      {searchOpen ? (
        <div className='flex h-12 items-center gap-2 px-3'>
          {(showBackButton || searchPage) && (
            <button
              onClick={() =>
                searchPage ? router.back() : setSearchOpen(false)
              }
              className={`${ICON_BTN} -ml-1 shrink-0`}
              aria-label='返回'
            >
              <ChevronLeft className='h-6 w-6' />
            </button>
          )}
          <NavSearch className='flex-1' autoFocus={!searchPage} />
          {!searchPage && (
            <button
              onClick={() => setSearchOpen(false)}
              className='shrink-0 px-1 text-[15px] text-atv-accent'
            >
              取消
            </button>
          )}
        </div>
      ) : (
        <div className='flex h-12 items-center justify-between px-3'>
          <div className='flex min-w-0 items-center'>
            {showBackButton && (
              <button
                onClick={() => router.back()}
                className={`${ICON_BTN} -ml-1`}
                aria-label='返回'
              >
                <ChevronLeft className='h-6 w-6' />
              </button>
            )}
            <Link
              href='/'
              className='truncate px-1 text-[17px] font-semibold tracking-tight text-atv-label'
            >
              {siteName}
            </Link>
          </div>
          <div className='flex items-center'>
            <button
              onClick={() => setSearchOpen(true)}
              className={ICON_BTN}
              aria-label='搜索'
            >
              <Search className='h-[18px] w-[18px]' />
            </button>
            <SettingsButton />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      )}
    </header>
  );
};

export default MobileHeader;
