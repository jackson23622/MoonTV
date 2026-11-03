'use client';

import { Clapperboard, House, Search, Sparkles, Tv } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isNavActive } from './ui';

interface MobileBottomNavProps {
  /** 主动指定当前激活的路径。未提供时使用 usePathname() */
  activePath?: string;
}

const ITEMS = [
  { icon: House, label: '首页', href: '/' },
  { icon: Clapperboard, label: '电影', href: '/douban?type=movie' },
  { icon: Tv, label: '剧集', href: '/douban?type=tv' },
  { icon: Sparkles, label: '综艺', href: '/douban?type=show' },
  { icon: Search, label: '搜索', href: '/search' },
];

/** 手机端底部标签栏（iOS 样式） */
const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const current = activePath ?? pathname;

  return (
    <nav
      className='atv-material fixed inset-x-0 bottom-0 z-[700] border-t border-atv-separator/60 md:hidden'
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label='主导航'
    >
      <ul className='flex h-[52px] items-stretch'>
        {ITEMS.map((item) => {
          const active = isNavActive(item.href, current);
          const Icon = item.icon;
          return (
            <li key={item.href} className='flex-1'>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  active ? 'text-atv-label' : 'text-atv-tertiary'
                }`}
              >
                <Icon
                  className='h-[22px] w-[22px]'
                  strokeWidth={active ? 2.2 : 1.8}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
