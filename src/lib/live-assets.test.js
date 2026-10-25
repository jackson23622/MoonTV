/* eslint-disable */
const {
  buildLogoIndex,
  findLogo,
  extractEpg,
  parseXmltvTime,
} = require('../../scripts/live-assets');
const { rankWebLines, proxyable } = require('../../scripts/update-live');
const { matchKey, toProxyUrl } = require('./channel-rules');

describe('台标与节目单匹配', () => {
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

  test('XMLTV 时间', () => {
    expect(parseXmltvTime('20261025200000 +0800')).toBe(
      Date.UTC(2026, 9, 25, 12) / 1000
    );
  });

  test('节目单：按窗口截取、去重叠、别名与回退匹配', () => {
    const xml = `<?xml version="1.0"?><tv>
<channel id="CCTV1"><display-name lang="zh">CCTV1</display-name></channel>
<channel id="东方卫视"><display-name>东方卫视</display-name></channel>
<programme channel="CCTV1" start="20261025190000 +0800" stop="20261025193000 +0800"><title>新闻联播</title></programme>
<programme channel="CCTV1" start="20261025193000 +0800" stop="20261025200000 +0800"><title>焦点访谈 &amp; 天气</title></programme>
<programme channel="CCTV1" start="20261025193000 +0800" stop="20261025200000 +0800"><title>重复条目</title></programme>
<programme channel="CCTV1" start="20261001000000 +0800" stop="20261001010000 +0800"><title>太早</title></programme>
<programme channel="东方卫视" start="20261025190000 +0800" stop="20261025200000 +0800"><title>东方新闻</title></programme>
</tv>`;
    const now = Date.UTC(2026, 9, 25, 11, 40) / 1000;
    const epg = extractEpg(
      xml,
      ['CCTV-1', '东方卫视', '东方卫视4K', '湖南卫视'],
      now
    );
    expect(epg['CCTV-1'].map((p) => p[2])).toEqual([
      '新闻联播',
      '焦点访谈 & 天气',
    ]);
    expect(epg['东方卫视'][0][2]).toBe('东方新闻');
    expect(epg['东方卫视4K'][0][2]).toBe('东方新闻');
    expect(epg['湖南卫视']).toBeUndefined();
  });
});

describe('网页线路排序', () => {
  test('直连 > 国内 > 代理（标准端口优先）> H.265；同一地址只留一条', () => {
    const r = rankWebLines({
      direct: [
        { url: 'https://a/720.m3u8', height: 720, direct: true },
        { url: 'https://a/1080.m3u8', height: 1080, direct: true },
        {
          url: 'https://a/hevc.m3u8',
          height: 2160,
          video: 'hevc',
          direct: true,
        },
      ],
      proxy: [
        { url: 'http://b:9901/x.m3u8', height: 1080 },
        { url: 'http://c/y.m3u8', height: 576 },
        { url: 'http://a/1080.m3u8', height: 1080 },
      ],
      china: [{ url: 'https://cn/z.m3u8' }],
    });
    expect(r.map((x) => x.kind).join('')).toBe('ddcppd');
    expect(r.map((x) => x.url)).toEqual([
      'https://a/1080.m3u8',
      'https://a/720.m3u8',
      'https://cn/z.m3u8',
      toProxyUrl('http://c/y.m3u8'),
      toProxyUrl('http://b:9901/x.m3u8'),
      'https://a/hevc.m3u8',
    ]);
  });

  test('IP 地址线路不可代理', () => {
    expect(proxyable('http://1.2.3.4:8080/a.m3u8')).toBe(false);
    expect(proxyable('http://[2409::1]/a.m3u8')).toBe(false);
    expect(proxyable('http://tv.example.com/a.m3u8')).toBe(true);
  });
});
