import {
  buildDoubanRecommendUrl,
  DEFAULT_FILTERS,
  getYearOptions,
  normalizeFilters,
  parseDoubanRecommend,
} from './douban.filters';

const parse = (url: string) => {
  const u = new URL(url);
  return {
    path: u.pathname,
    selected: JSON.parse(u.searchParams.get('selected_categories') || '{}'),
    tags: u.searchParams.get('tags'),
    sort: u.searchParams.get('sort'),
    start: u.searchParams.get('start'),
    count: u.searchParams.get('count'),
  };
};

describe('buildDoubanRecommendUrl', () => {
  it('电影：类型+地区+年代+排序', () => {
    const r = parse(
      buildDoubanRecommendUrl({
        type: 'movie',
        start: 25,
        limit: 25,
        genre: '科幻',
        region: '美国',
        year: '2024',
        platform: '腾讯视频', // 电影忽略平台
        sort: 'S',
      })
    );
    expect(r.path).toBe('/rexxar/api/v2/movie/recommend');
    expect(r.selected).toEqual({ 类型: '科幻', 地区: '美国' });
    expect(r.tags).toBe('科幻,美国,2024');
    expect(r.sort).toBe('S');
    expect(r.start).toBe('25');
    expect(r.count).toBe('25');
  });

  it('剧集：不选类型时用形式作标签，综合排序不传 sort', () => {
    const r = parse(
      buildDoubanRecommendUrl({
        type: 'tv',
        start: 0,
        limit: 25,
        ...DEFAULT_FILTERS,
        year: '2010年代',
        platform: 'Netflix',
      })
    );
    expect(r.path).toBe('/rexxar/api/v2/tv/recommend');
    expect(r.selected).toEqual({ 类型: '', 形式: '电视剧' });
    expect(r.tags).toBe('电视剧,2010年代,Netflix');
    expect(r.sort).toBeNull();
  });

  it('综艺走 tv 接口，形式=综艺', () => {
    const r = parse(
      buildDoubanRecommendUrl({
        type: 'show',
        start: 0,
        limit: 25,
        ...DEFAULT_FILTERS,
        genre: '真人秀',
        region: '韩国',
      })
    );
    expect(r.path).toBe('/rexxar/api/v2/tv/recommend');
    expect(r.selected).toEqual({ 类型: '真人秀', 形式: '综艺', 地区: '韩国' });
    expect(r.tags).toBe('真人秀,韩国');
  });
});

describe('getYearOptions', () => {
  it('2026 年：2020年代、2026…2019 逐年、更早年代', () => {
    const labels = getYearOptions(new Date('2026-10-27')).map((o) => o.value);
    expect(labels.slice(0, 2)).toEqual(['all', '2020年代']);
    expect(labels).toContain('2026');
    expect(labels).toContain('2019');
    expect(labels).not.toContain('2018');
    expect(labels.slice(-7)).toEqual([
      '2010年代',
      '2000年代',
      '90年代',
      '80年代',
      '70年代',
      '60年代',
      '更早',
    ]);
  });
});

describe('normalizeFilters', () => {
  it('非法值回落为默认，电影平台恒为 all', () => {
    expect(
      normalizeFilters('movie', {
        genre: '不存在',
        region: '日本',
        year: '1888',
        platform: 'Netflix',
        sort: 'X',
      })
    ).toEqual({ ...DEFAULT_FILTERS, region: '日本' });
  });
});

describe('parseDoubanRecommend', () => {
  it('过滤非影视条目并取年份', () => {
    const list = parseDoubanRecommend({
      items: [
        {
          id: '1',
          title: 'A',
          type: 'movie',
          year: '2024',
          pic: { normal: 'n.jpg' },
          rating: { value: 8.12 },
        },
        { id: '2', title: '片单', type: 'doulist' },
        {
          id: '3',
          title: 'B',
          type: 'tv',
          card_subtitle: '2019 / 美国 / 剧情',
          pic: { large: 'l.jpg' },
          rating: null,
        },
      ],
    });
    expect(list).toEqual([
      { id: '1', title: 'A', poster: 'n.jpg', rate: '8.1', year: '2024' },
      { id: '3', title: 'B', poster: 'l.jpg', rate: '', year: '2019' },
    ]);
  });
});
