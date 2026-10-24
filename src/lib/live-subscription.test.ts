import {
  buildLiveData,
  channelKey,
  parseSubscription,
} from './live-subscription';

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

describe('直播订阅', () => {
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

  test('合并网页已验证线路；只有 http 的频道标为仅电视', () => {
    const verified = {
      updatedAt: '2026-10-25T00:00:00Z',
      groups: [
        {
          name: '央视频道',
          channels: [
            {
              name: 'CCTV-1',
              urls: ['https://ok/cctv1.m3u8'],
              hd: true,
              height: 1080,
            },
          ],
        },
      ],
    };
    const d = buildLiveData(parseSubscription(M3U), verified);
    const all = d.groups.flatMap((g) => g.channels);
    const cctv1 = all.find((c) => c.name === 'CCTV-1');
    expect(cctv1?.urls[0]).toBe('https://ok/cctv1.m3u8');
    expect(cctv1?.hd).toBe(true);
    expect(cctv1?.tvOnly).toBe(false);
    const jykt = all.find((c) => c.name === '金鹰卡通');
    expect(jykt?.tvOnly).toBe(true);
    const tvbs = all.find((c) => c.name === 'TVBS新聞台');
    expect(tvbs?.tvOnly).toBe(false);
    expect(tvbs?.urls).toEqual(['https://tw.example/tvbs.m3u8']);
    // 片段 #kids 不影响地址
    const cctv14 = all.find((c) => c.name === 'CCTV-14');
    expect(cctv14?.urls.every((u) => !u.includes('#'))).toBe(true);
  });

  test('频道名 key', () => {
    expect(channelKey('东森新闻台')).toBe(channelKey('东森新闻'));
  });
});
