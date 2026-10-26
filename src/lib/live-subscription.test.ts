import { channelKey, parseSubscription, toTvM3u } from './live-subscription';

const M3U = `#EXTM3U
#EXTINF:-1 tvg-name="CCTV-1" tvg-logo="https://logo/cctv1.png" group-title="央视频道",CCTV-1
http://1.2.3.4/cctv1.m3u8
#EXTINF:-1 group-title="少儿频道",CCTV-14
http://1.2.3.4/cctv14.m3u8#kids
#EXTINF:-1 group-title="少儿频道",金鹰卡通
http://5.6.7.8/jykt.m3u8
#EXTINF:-1 group-title="港澳台",TVBS新聞台
https://tw.example/tvbs.m3u8
`;

const TXT = `央视频道,#genre#
CCTV-1,http://a/1.m3u8#http://b/1.m3u8
卫视频道,#genre#
湖南卫视,https://c/hn.m3u8
`;

describe('订阅解析', () => {
  test('解析 m3u', () => {
    const e = parseSubscription(M3U);
    expect(e).toHaveLength(4);
    expect(e[0]).toMatchObject({
      name: 'CCTV-1',
      group: '央视频道',
      logo: 'https://logo/cctv1.png',
    });
  });

  test('解析 txt（含 # 分隔多线路）', () => {
    const e = parseSubscription(TXT);
    expect(e.map((x) => x.url)).toEqual([
      'http://a/1.m3u8',
      'http://b/1.m3u8',
      'https://c/hn.m3u8',
    ]);
    expect(e[2].group).toBe('卫视频道');
  });

  test('频道名 key', () => {
    expect(channelKey('东森新闻台')).toBe(channelKey('东森新闻'));
  });
});

describe('电视订阅清洗（/tv/filter.m3u）', () => {
  const DIRTY = `#EXTM3U
#EXTINF:-1 group-title="其他",周星驰电影
http://a/zxc.m3u8
#EXTINF:-1 group-title="央视",CCTV1
http://a/cctv1.m3u8
#EXTINF:-1 group-title="央视",CCTV-1 综合
http://b/cctv1.m3u8
#EXTINF:-1 group-title="国际",CGTN英语
http://a/cgtn.m3u8
#EXTINF:-1 group-title="宗教",GOOD TV CH1 綜合台
http://a/good.m3u8
#EXTINF:-1 group-title="台湾",TVBS新聞台
http://a/tvbs.m3u8
#EXTINF:-1 group-title="动漫",海绵宝宝
https://live.metshop.top/douyu/1
#EXTINF:-1 group-title="卫视",湖南卫视
http://a/hn.m3u8
`;

  test('只保留正规台，同名频道只留一条，按标准分组排序', () => {
    const out = toTvM3u(parseSubscription(DIRTY));
    const names = out.match(/,[^\n]+$/gm)?.map((s) => s.slice(1));
    expect(names).toEqual(['CCTV-1', '湖南卫视', 'TVBS新聞台']);
    expect(out).toContain('group-title="央视频道"');
    expect(out).toContain('http://a/cctv1.m3u8');
    expect(out).not.toContain('http://b/cctv1.m3u8');
  });

  test('清洗结果再清洗一次保持不变（规则幂等）', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const file = path.join(process.cwd(), 'public/tv/live.m3u');
    const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : DIRTY;
    const once = toTvM3u(parseSubscription(source));
    const twice = toTvM3u(parseSubscription(once));
    expect(twice).toBe(once);
  });
});
