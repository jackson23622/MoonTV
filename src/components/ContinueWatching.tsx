/* eslint-disable no-console */
'use client';

import { useEffect, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import Shelf, { SHELF_ITEM, ShelfSkeleton } from '@/components/Shelf';
import VideoCard from '@/components/VideoCard';

interface ContinueWatchingProps {
  className?: string;
}

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [loading, setLoading] = useState(true);

  // 处理播放记录数据更新的函数
  const updatePlayRecords = (allRecords: Record<string, PlayRecord>) => {
    // 将记录转换为数组并根据 save_time 由近到远排序
    const recordsArray = Object.entries(allRecords).map(([key, record]) => ({
      ...record,
      key,
    }));

    // 按 save_time 降序排序（最新的在前面）
    const sortedRecords = recordsArray.sort(
      (a, b) => b.save_time - a.save_time
    );

    setPlayRecords(sortedRecords);
  };

  useEffect(() => {
    const fetchPlayRecords = async () => {
      try {
        setLoading(true);

        // 从缓存或API获取所有播放记录
        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayRecords();

    // 监听播放记录更新事件
    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      }
    );

    return unsubscribe;
  }, []);

  // 如果没有播放记录，则不渲染组件
  if (!loading && playRecords.length === 0) {
    return null;
  }

  // 计算播放进度百分比
  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  // 从 key 中解析 source 和 id
  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };

  return (
    <div className={className}>
      <Shelf
        title='继续观看'
        action={
          !loading && playRecords.length > 0 ? (
            <button
              className='rounded-full px-3 py-1 text-sm text-atv-secondary transition-colors hover:bg-atv-fill/15 hover:text-atv-label'
              onClick={async () => {
                await clearAllPlayRecords();
                setPlayRecords([]);
              }}
            >
              清空
            </button>
          ) : null
        }
      >
        {loading ? (
          <ShelfSkeleton count={6} />
        ) : (
          playRecords.map((record) => {
            const { source, id } = parseKey(record.key);
            return (
              <div key={record.key} className={SHELF_ITEM}>
                <VideoCard
                  id={id}
                  title={record.title}
                  poster={record.cover}
                  year={record.year}
                  source={source}
                  source_name={record.source_name}
                  progress={getProgress(record)}
                  episodes={record.total_episodes}
                  currentEpisode={record.index}
                  query={record.search_title}
                  from='playrecord'
                  onDelete={() =>
                    setPlayRecords((prev) =>
                      prev.filter((r) => r.key !== record.key)
                    )
                  }
                  type={record.total_episodes > 1 ? 'tv' : ''}
                />
              </div>
            );
          })
        )}
      </Shelf>
    </div>
  );
}
