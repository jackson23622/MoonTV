import { ImagePlaceholder } from '@/components/ImagePlaceholder';

/** 网格卡片加载占位（与 VideoCard 尺寸一致） */
const DoubanCardSkeleton = () => {
  return (
    <div className='w-full'>
      <ImagePlaceholder aspectRatio='aspect-[2/3]' />
      <div className='mt-2.5 h-3.5 w-3/4 rounded bg-atv-fill/15' />
      <div className='mt-1.5 h-3 w-1/2 rounded bg-atv-fill/10' />
    </div>
  );
};

export default DoubanCardSkeleton;
