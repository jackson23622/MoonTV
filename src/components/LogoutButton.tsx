/* eslint-disable no-console */

'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';

import { ICON_BTN } from './ui';

export const LogoutButton: React.FC = () => {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    if (loading) return;

    setLoading(true);

    try {
      // 调用注销API来清除cookie
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }

    window.location.reload();
  };

  return (
    <button
      onClick={handleLogout}
      className={ICON_BTN}
      aria-label='退出登录'
      title='退出登录'
    >
      <LogOut className='h-[18px] w-[18px]' />
    </button>
  );
};
