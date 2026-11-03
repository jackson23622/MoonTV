import { appendUnique, FEED_SHELVES, nextDiscoverKind } from './home-feed';

describe('home-feed', () => {
  it('片架 key 唯一', () => {
    const keys = FEED_SHELVES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('发现网格电影 / 剧集交替，到底的类别跳过', () => {
    const none = { movie: false, tv: false };
    expect(nextDiscoverKind(null, none)).toBe('movie');
    expect(nextDiscoverKind('movie', none)).toBe('tv');
    expect(nextDiscoverKind('tv', none)).toBe('movie');
    expect(nextDiscoverKind('tv', { movie: true, tv: false })).toBe('tv');
    expect(nextDiscoverKind(null, { movie: true, tv: true })).toBeNull();
  });

  it('追加按 id 去重，无新增时返回原数组', () => {
    const prev = [{ id: '1' }, { id: '2' }];
    const r = appendUnique(prev, [
      { id: '2' },
      { id: '3' },
      { id: '3' },
      { id: '' },
    ]);
    expect(r.list.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(r.added).toBe(1);
    const same = appendUnique(prev, [{ id: '1' }]);
    expect(same.list).toBe(prev);
    expect(same.added).toBe(0);
  });
});
