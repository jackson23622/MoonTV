/* eslint-disable */
const { buildLogoIndex, findLogo } = require('../../scripts/live-assets');
const { matchKey } = require('./channel-rules');

describe('台标匹配', () => {
  test('频道名统一 key', () => {
    expect(matchKey('CCTV-5+ 体育赛事')).toBe('CCTV5+');
    expect(matchKey('CCTV-1')).toBe('CCTV1');
    expect(matchKey('中国教育1台')).toBe('CETV1');
    expect(matchKey('TVBS新聞台')).toBe('TVBS新闻');
  });

  test('台标：正名优先，CCTV 付费频道去前缀，4K 版沿用普通版', () => {
    const idx = buildLogoIndex([
      'CCTV1.png',
      'CCTV5+.png',
      '东方卫视.png',
      '风云剧场.png',
      '文化精品.png',
      'guangdong.png',
      '凤凰卫视香港台.png',
    ]);
    expect(findLogo(idx, 'CCTV-1')).toBe('CCTV1.png');
    expect(findLogo(idx, 'CCTV-5+')).toBe('CCTV5+.png');
    expect(findLogo(idx, 'CCTV-风云剧场')).toBe('风云剧场.png');
    expect(findLogo(idx, 'CCTV央视文化精品')).toBe('文化精品.png');
    expect(findLogo(idx, '东方卫视4K')).toBe('东方卫视.png');
    expect(findLogo(idx, '凤凰香港')).toBe('凤凰卫视香港台.png');
    expect(findLogo(idx, '广东卫视')).toBeNull();
  });
});
