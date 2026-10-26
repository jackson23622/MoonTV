'use client';

import { ChevronLeft, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { LogoutButton } from './LogoutButton';
import { SettingsButton } from './SettingsButton';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { GUTTER, ICON_BTN, isNavActive, NAV_ITEMS, useScrolled } from './ui';

interface TopNavProps {
  activePath: string;
  /** 浮在首页大图上：顶部透明且强制深色，滚动后变为毛玻璃 */
  overlay?: boolean;
  showBack?: boolean;
}

/** 桌面端顶部导航（Apple TV 网页版样式） */
export default function TopNav({
  activePath,
  overlay = false,
  showBack = false,
}: TopNavProps) {
  const router = useRouter();
  const { siteName } = useSite();
  const scrolled = useScrolled();
  const transparent = overlay && !scrolled;
  const searchActive = activePath.startsWith('/search');

  return (
    <header
      className={`fixed inset-x-0 top-0 z-[700] hidden md:block transition-[background-color,border-color] duration-300 ${
        transparent
          ? 'dark border-b border-transparent'
          : 'atv-material border-b border-atv-separator/60'
      }`}
    >
      {/* 顶部柔和渐变：浮在大图上时保证文字可读，渐隐范围比导航栏高，避免出现分界线 */}
      {transparent && (
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-32 bg-gradient-to-b from-black/60 via-black/25 to-transparent'
        />
      )}
      <nav
        className={`relative flex h-14 items-center justify-between ${GUTTER}`}
        aria-label='主导航'
      >
        <div className='flex min-w-0 items-center gap-1'>
          {showBack && (
            <button
              onClick={() => router.back()}
              className={`${ICON_BTN} -ml-2`}
              aria-label='返回'
            >
              <ChevronLeft className='h-6 w-6' />
            </button>
          )}
          <Link
            href='/'
            className='truncate text-[19px] font-semibold tracking-tight text-atv-label'
          >
            {siteName}
          </Link>
        </div>

        <ul className='absolute left-1/2 flex -translate-x-1/2 items-center gap-1'>
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(item.href, activePath);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-full px-4 py-1.5 text-[15px] font-medium transition-colors duration-200 ${
                    active
                      ? 'bg-atv-fill/25 text-atv-label'
                      : 'text-atv-label/70 hover:text-atv-label'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className='flex items-center gap-1'>
          <Link
            href='/search'
            aria-current={searchActive ? 'page' : undefined}
            className={`mr-2 hidden h-9 items-center gap-2 rounded-full px-3.5 text-sm transition-colors duration-200 lg:flex lg:w-52 ${
              searchActive
                ? 'bg-atv-fill/30 text-atv-label'
                : 'bg-atv-fill/20 text-atv-secondary hover:bg-atv-fill/30'
            }`}
          >
            <Search className='h-4 w-4' />
            搜索
          </Link>
          <Link
            href='/search'
            className={`${ICON_BTN} lg:hidden`}
            aria-label='搜索'
          >
            <Search className='h-[18px] w-[18px]' />
          </Link>
          <SettingsButton />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </nav>
    </header>
  );
}
