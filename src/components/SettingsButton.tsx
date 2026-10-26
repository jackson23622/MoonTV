/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { ICON_BTN } from './ui';

export const SettingsButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [imageProxyUrl, setImageProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [enableImageProxy, setEnableImageProxy] = useState(false);
  const [enableDoubanProxy, setEnableDoubanProxy] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

  // 从 localStorage 读取设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAggregateSearch = localStorage.getItem(
        'defaultAggregateSearch'
      );
      if (savedAggregateSearch !== null) {
        setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
      }

      const savedEnableDoubanProxy = localStorage.getItem('enableDoubanProxy');
      const defaultDoubanProxy =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
      if (savedEnableDoubanProxy !== null) {
        setEnableDoubanProxy(JSON.parse(savedEnableDoubanProxy));
      } else if (defaultDoubanProxy) {
        // 如果有默认豆瓣代理配置，则默认开启
        setEnableDoubanProxy(true);
      }

      const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
      if (savedDoubanProxyUrl !== null) {
        setDoubanProxyUrl(savedDoubanProxyUrl);
      } else if (defaultDoubanProxy) {
        setDoubanProxyUrl(defaultDoubanProxy);
      }

      const savedEnableImageProxy = localStorage.getItem('enableImageProxy');
      const defaultImageProxy =
        (window as any).RUNTIME_CONFIG?.IMAGE_PROXY || '';
      if (savedEnableImageProxy !== null) {
        setEnableImageProxy(JSON.parse(savedEnableImageProxy));
      } else if (defaultImageProxy) {
        // 如果有默认图片代理配置，则默认开启
        setEnableImageProxy(true);
      }

      const savedImageProxyUrl = localStorage.getItem('imageProxyUrl');
      if (savedImageProxyUrl !== null) {
        setImageProxyUrl(savedImageProxyUrl);
      } else if (defaultImageProxy) {
        setImageProxyUrl(defaultImageProxy);
      }

      const savedEnableOptimization =
        localStorage.getItem('enableOptimization');
      if (savedEnableOptimization !== null) {
        setEnableOptimization(JSON.parse(savedEnableOptimization));
      }
    }
  }, []);

  // 保存设置到 localStorage
  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
    }
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanProxyUrl', value);
    }
  };

  const handleImageProxyUrlChange = (value: string) => {
    setImageProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('imageProxyUrl', value);
    }
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(value));
    }
  };

  const handleImageProxyToggle = (value: boolean) => {
    setEnableImageProxy(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableImageProxy', JSON.stringify(value));
    }
  };

  const handleDoubanProxyToggle = (value: boolean) => {
    setEnableDoubanProxy(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableDoubanProxy', JSON.stringify(value));
    }
  };

  const handleSettingsClick = () => {
    setIsOpen(!isOpen);
  };

  const handleClosePanel = () => {
    setIsOpen(false);
  };

  // 重置所有设置为默认值
  const handleResetSettings = () => {
    const defaultImageProxy = (window as any).RUNTIME_CONFIG?.IMAGE_PROXY || '';
    const defaultDoubanProxy =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';

    // 重置所有状态
    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setDoubanProxyUrl(defaultDoubanProxy);
    setEnableDoubanProxy(!!defaultDoubanProxy);
    setEnableImageProxy(!!defaultImageProxy);
    setImageProxyUrl(defaultImageProxy);

    // 保存到 localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
      localStorage.setItem(
        'enableDoubanProxy',
        JSON.stringify(!!defaultDoubanProxy)
      );
      localStorage.setItem(
        'enableImageProxy',
        JSON.stringify(!!defaultImageProxy)
      );
      localStorage.setItem('imageProxyUrl', defaultImageProxy);
    }
  };

  // 设置面板内容
  const settingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm'
        onClick={handleClosePanel}
      />

      {/* 设置面板 */}
      <div
        role='dialog'
        aria-modal='true'
        aria-label='本地设置'
        className='fixed left-1/2 top-1/2 z-[1001] max-h-[85vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-atv-elevated p-5 shadow-2xl ring-1 ring-black/5 dark:ring-white/10'
      >
        {/* 标题栏 */}
        <div className='mb-5 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <h3 className='text-[20px] font-semibold tracking-tight text-atv-label'>
              本地设置
            </h3>
            <button
              onClick={handleResetSettings}
              className='rounded-full px-2.5 py-1 text-xs font-medium text-atv-red transition-colors hover:bg-atv-red/10'
              title='重置为默认设置'
            >
              重置
            </button>
          </div>
          <button
            onClick={handleClosePanel}
            className='flex h-8 w-8 items-center justify-center rounded-full bg-atv-fill/20 text-atv-secondary transition-colors hover:bg-atv-fill/30'
            aria-label='关闭'
          >
            <X className='h-4 w-4' strokeWidth={2.5} />
          </button>
        </div>

        {/* 设置项 */}
        <div className='space-y-5'>
          {/* 默认聚合搜索结果 */}
          <div className='flex items-center justify-between gap-4'>
            <div>
              <h4 className='text-[15px] text-atv-label'>默认聚合搜索结果</h4>
              <p className='mt-0.5 text-xs text-atv-secondary'>
                搜索时默认按标题和年份聚合显示结果
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={defaultAggregateSearch}
                  onChange={(e) => handleAggregateToggle(e.target.checked)}
                />
                <div className='h-[31px] w-[51px] rounded-full bg-atv-fill/30 transition-colors duration-200 peer-checked:bg-atv-green peer-focus-visible:ring-2 peer-focus-visible:ring-atv-accent'></div>
                <div className='absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md transition-transform duration-200 peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 优选和测速 */}
          <div className='flex items-center justify-between gap-4'>
            <div>
              <h4 className='text-[15px] text-atv-label'>启用优选和测速</h4>
              <p className='mt-0.5 text-xs text-atv-secondary'>
                如出现播放器劫持问题可关闭
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={enableOptimization}
                  onChange={(e) => handleOptimizationToggle(e.target.checked)}
                />
                <div className='h-[31px] w-[51px] rounded-full bg-atv-fill/30 transition-colors duration-200 peer-checked:bg-atv-green peer-focus-visible:ring-2 peer-focus-visible:ring-atv-accent'></div>
                <div className='absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md transition-transform duration-200 peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 分割线 */}
          <div className='border-t border-atv-separator/70'></div>

          {/* 豆瓣代理开关 */}
          <div className='flex items-center justify-between gap-4'>
            <div>
              <h4 className='text-[15px] text-atv-label'>启用豆瓣代理</h4>
              <p className='mt-0.5 text-xs text-atv-secondary'>
                启用后，豆瓣数据将通过代理服务器获取
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={enableDoubanProxy}
                  onChange={(e) => handleDoubanProxyToggle(e.target.checked)}
                />
                <div className='h-[31px] w-[51px] rounded-full bg-atv-fill/30 transition-colors duration-200 peer-checked:bg-atv-green peer-focus-visible:ring-2 peer-focus-visible:ring-atv-accent'></div>
                <div className='absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md transition-transform duration-200 peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 豆瓣代理地址设置 */}
          <div className='space-y-2'>
            <div>
              <h4 className='text-[15px] text-atv-label'>豆瓣代理地址</h4>
              <p className='mt-0.5 text-xs text-atv-secondary'>
                仅在启用豆瓣代理时生效，留空则使用服务器 API
              </p>
            </div>
            <input
              type='text'
              className={`atv-input !py-2.5 !text-sm ${
                enableDoubanProxy ? '' : 'cursor-not-allowed opacity-50'
              }`}
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={doubanProxyUrl}
              onChange={(e) => handleDoubanProxyUrlChange(e.target.value)}
              disabled={!enableDoubanProxy}
            />
          </div>

          {/* 分割线 */}
          <div className='border-t border-atv-separator/70'></div>

          {/* 图片代理开关 */}
          <div className='flex items-center justify-between gap-4'>
            <div>
              <h4 className='text-[15px] text-atv-label'>启用图片代理</h4>
              <p className='mt-0.5 text-xs text-atv-secondary'>
                启用后，所有图片加载将通过代理服务器
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={enableImageProxy}
                  onChange={(e) => handleImageProxyToggle(e.target.checked)}
                />
                <div className='h-[31px] w-[51px] rounded-full bg-atv-fill/30 transition-colors duration-200 peer-checked:bg-atv-green peer-focus-visible:ring-2 peer-focus-visible:ring-atv-accent'></div>
                <div className='absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md transition-transform duration-200 peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 图片代理地址设置 */}
          <div className='space-y-2'>
            <div>
              <h4 className='text-[15px] text-atv-label'>图片代理地址</h4>
              <p className='mt-0.5 text-xs text-atv-secondary'>
                仅在启用图片代理时生效
              </p>
            </div>
            <input
              type='text'
              className={`atv-input !py-2.5 !text-sm ${
                enableImageProxy ? '' : 'cursor-not-allowed opacity-50'
              }`}
              placeholder='例如: https://imageproxy.example.com/?url='
              value={imageProxyUrl}
              onChange={(e) => handleImageProxyUrlChange(e.target.value)}
              disabled={!enableImageProxy}
            />
          </div>
        </div>

        {/* 底部说明 */}
        <div className='mt-5 border-t border-atv-separator/70 pt-4'>
          <p className='text-center text-xs text-atv-secondary'>
            这些设置保存在本地浏览器中
          </p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        onClick={handleSettingsClick}
        className={ICON_BTN}
        aria-label='设置'
        title='设置'
      >
        <Settings className='h-[18px] w-[18px]' />
      </button>

      {/* 使用 Portal 将设置面板渲染到 document.body */}
      {isOpen && mounted && createPortal(settingsPanel, document.body)}
    </>
  );
};
