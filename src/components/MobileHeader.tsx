'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { LogoutButton } from './LogoutButton';
import { SettingsButton } from './SettingsButton';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { ICON_BTN, useScrolled } from './ui';

interface MobileHeaderProps {
  showBackButton?: boolean;
  /** 浮在首页大图上：顶部透明且强制深色 */
  overlay?: boolean;
}

/** 手机端顶部栏 */
const MobileHeader = ({
  showBackButton = false,
  overlay = false,
}: MobileHeaderProps) => {
  const router = useRouter();
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
          <SettingsButton />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
};

export default MobileHeader;
