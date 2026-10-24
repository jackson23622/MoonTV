'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { posterCandidates, PosterSize } from '@/lib/poster';
import { processImageUrl } from '@/lib/utils';

interface PosterImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  size?: PosterSize;
  /** 首屏图片可设为 eager */
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
  /** 全部线路失败时回调 */
  onFail?: () => void;
}

// 单条线路超过该时间未加载完成，就切换到下一条（弱网下避免一直卡在不通的线路）
const STALL_MS = 6000;

/**
 * 多线路封面：直连 → 豆瓣其他子域 → 本站图片代理 → 公共镜像，逐级回退。
 * 使用原生 <img>（站点已关闭 Next 图片优化），并保持 no-referrer 以绕过防盗链。
 */
export default function PosterImage({
  src,
  alt,
  className,
  size = 'card',
  loading = 'lazy',
  onLoad,
  onFail,
}: PosterImageProps) {
  const candidates = useMemo(
    () => posterCandidates(src, size, (u) => processImageUrl(u)),
    [src, size]
  );
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [candidates]);

  const next = () => {
    setIndex((i) => {
      if (i + 1 < candidates.length) return i + 1;
      onFail?.();
      return i;
    });
  };

  // 卡住超时切换：仅在图片已进入视口开始加载后计时
  useEffect(() => {
    if (loaded || index >= candidates.length) return;
    const img = imgRef.current;
    if (!img) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      if (timer) return;
      timer = setTimeout(() => {
        if (imgRef.current && !imgRef.current.complete) next();
      }, STALL_MS);
    };
    let observer: IntersectionObserver | null = null;
    if (loading === 'lazy' && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          start();
          observer?.disconnect();
        }
      });
      observer.observe(img);
    } else {
      start();
    }
    return () => {
      if (timer) clearTimeout(timer);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, candidates, loaded]);

  if (!candidates.length) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      key={candidates[index]}
      src={candidates[index]}
      alt={alt}
      className={className}
      loading={loading}
      decoding='async'
      referrerPolicy='no-referrer'
      onLoad={(e) => {
        const img = e.currentTarget;
        // 部分防盗链会返回 1x1 占位图，视为失败
        if (img.naturalWidth <= 2 && img.naturalHeight <= 2) {
          next();
          return;
        }
        setLoaded(true);
        onLoad?.();
      }}
      onError={next}
    />
  );
}
