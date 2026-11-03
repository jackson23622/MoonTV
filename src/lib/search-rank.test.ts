import {
  normalizeTitle,
  rankSearchGroups,
  rankSearchResults,
  relevanceScore,
} from './search-rank';
import { SearchResult } from './types';

const item = (
  title: string,
  year = '2024',
  episodes = 1,
  source = 's'
): SearchResult => ({
  id: `${source}-${title}-${year}`,
  title,
  poster: '',
  episodes: Array.from({ length: episodes }, (_, i) => `u${i}`),
  source,
  source_name: source,
  year,
});

const titles = (list: SearchResult[]) => list.map((x) => x.title);

describe('normalizeTitle', () => {
  it('季数写法统一，第一季视为无季数', () => {
    expect(normalizeTitle('庆余年 第二季')).toBe('庆余年2');
    expect(normalizeTitle('庆余年第2季')).toBe('庆余年2');
    expect(normalizeTitle('庆余年2')).toBe('庆余年2');
    expect(normalizeTitle('Friends Season 10')).toBe('friends10');
    expect(normalizeTitle('怪奇物语 S4')).toBe('怪奇物语4');
    expect(normalizeTitle('庆余年第一季')).toBe('庆余年');
    expect(normalizeTitle('第十一季')).toBe('11');
  });

  it('忽略全角、标点与大小写', () => {
    expect(normalizeTitle('复仇者联盟４：终局之战')).toBe(
      '复仇者联盟4终局之战'
    );
    expect(normalizeTitle('《流浪地球》')).toBe('流浪地球');
    expect(normalizeTitle('Top 1')).toBe('top1');
  });
});

describe('relevanceScore 分档', () => {
  const q = '三体';
  it('完全一致 > 季数/版本 > 开头 > 包含 > 模糊', () => {
    const exact = relevanceScore('三体', q);
    const variant = relevanceScore('三体 第二季', q);
    const prefix = relevanceScore('三体：地球往事', q);
    const contains = relevanceScore('我的三体之章北海传', q);
    const fuzzy = relevanceScore('三生三世', q);
    expect(exact).toBe(1000);
    expect(variant).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(fuzzy);
  });

  it('季数写法不同也算完全一致', () => {
    expect(relevanceScore('庆余年 第2季', '庆余年第二季')).toBe(1000);
    expect(relevanceScore('庆余年', '庆余年 第一季')).toBe(1000);
  });

  it('版本后缀（国语版、剧场版）算同一部作品', () => {
    expect(relevanceScore('名侦探柯南剧场版', '名侦探柯南')).toBeGreaterThan(
      relevanceScore('名侦探柯南之零的执行人', '名侦探柯南')
    );
    expect(relevanceScore('甄嬛传 国语版', '甄嬛传')).toBeGreaterThanOrEqual(
      880
    );
  });

  it('包含时越靠前、多余字越少越高', () => {
    expect(relevanceScore('新流浪地球', '流浪地球')).toBeGreaterThan(
      relevanceScore('关于流浪地球的一切幕后', '流浪地球')
    );
  });

  it('多打了字（搜索词以标题开头）仍高于无关结果', () => {
    expect(relevanceScore('流浪地球2', '流浪地球2 吴京')).toBeGreaterThan(
      relevanceScore('流浪猫', '流浪地球2 吴京')
    );
  });

  it('多个关键词顺序不同也能命中', () => {
    expect(relevanceScore('复仇者联盟4：终局之战', '终局之战 复仇者')).toBe(
      505
    );
  });

  it('模糊相似：有共同字的高于无关的', () => {
    expect(relevanceScore('甄嬛传', '甄环传')).toBeGreaterThan(
      relevanceScore('大明王朝', '甄环传')
    );
  });
});

describe('rankSearchResults', () => {
  it('最接近的排最前，同分按可播放 → 年份新 → 原顺序', () => {
    const list = [
      item('三生三世十里桃花', '2017'),
      item('三体：地球往事', '2023'),
      item('三体', '2023', 0, 'a'), // 无剧集
      item('三体', '2024', 30, 'b'),
      item('三体', '2023', 30, 'c'),
      item('三体 第二季', '2026'),
      item('三体', '2023', 30, 'd'),
    ];
    const ranked = rankSearchResults(list, '三体');
    expect(ranked.map((x) => x.source + x.year)).toEqual([
      'b2024',
      'c2023',
      'd2023',
      'a2023',
      's2026',
      's2023',
      's2017',
    ]);
    expect(titles(ranked).slice(-1)).toEqual(['三生三世十里桃花']);
  });

  it('不修改原数组', () => {
    const list = [item('B'), item('A')];
    rankSearchResults(list, 'A');
    expect(titles(list)).toEqual(['B', 'A']);
  });
});

describe('rankSearchGroups', () => {
  it('分组按组内最高分排序，组内也按相关度排序', () => {
    const groups: [string, SearchResult[]][] = [
      ['g1', [item('流浪地球2', '2023')]],
      ['g2', [item('流浪地球', '2019', 1, 'x'), item('流浪地球', '2019', 0)]],
      ['g3', [item('流浪', '2010')]],
    ];
    const ranked = rankSearchGroups(groups, '流浪地球');
    expect(ranked.map((g) => g[0])).toEqual(['g2', 'g1', 'g3']);
    expect(ranked[0][1][0].source).toBe('x');
  });
});
