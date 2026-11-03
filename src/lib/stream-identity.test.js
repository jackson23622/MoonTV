/* eslint-disable */
const {
  urlIdentity,
  identityConflict,
  identityConfirms,
  isPlaceholderUrl,
  streamKey,
} = require('./stream-identity');

describe('台名与线路地址对应', () => {
  test('从地址认台（只看路径与参数）', () => {
    expect(urlIdentity('http://a.com/live/cctv5p/index.m3u8').cctv).toBe(
      'CCTV5+'
    );
    expect(urlIdentity('http://a.com/CCTV-13/1.m3u8').cctv).toBe('CCTV13');
    expect(urlIdentity('http://a.com/cctv1hd.m3u8').cctv).toBe('CCTV1');
    expect(urlIdentity('http://a.com/x.m3u8?id=cctv4k').cctv).toBe('CCTV4K');
    expect(urlIdentity('http://a.com/cetv1/index.m3u8').cctv).toBe('CETV1');
    expect(urlIdentity('http://a.com/hunanws/index.m3u8').ws).toBe('湖南');
    expect(urlIdentity('http://a.com/live/zhejiang_weishi.m3u8').ws).toBe(
      '浙江'
    );
    // 域名里的 cctv、清晰度数字不算
    expect(urlIdentity('http://cctv1.example.com/live/a.m3u8').cctv).toBeNull();
    expect(urlIdentity('http://a.com/cctv1080.m3u8').cctv).toBeNull();
    // 同一地址出现多个台标识：认不出
    expect(urlIdentity('http://a.com/cctv1/cctv2.m3u8').cctv).toBeNull();
  });

  test('贴错台名的线路判为矛盾', () => {
    expect(
      identityConflict('CCTV-1', 'http://a.com/cctv5/index.m3u8')
    ).toBeTruthy();
    expect(
      identityConflict('CCTV-5', 'http://a.com/cctv5p/index.m3u8')
    ).toBeTruthy();
    expect(
      identityConflict('CCTV-1', 'http://a.com/hunanws.m3u8')
    ).toBeTruthy();
    expect(
      identityConflict('湖南卫视', 'http://a.com/zjws/jiangsuws.m3u8')
    ).toBeTruthy();
    expect(
      identityConflict('湖南卫视', 'http://a.com/cctv1/index.m3u8')
    ).toBeTruthy();
  });

  test('对得上或认不出的线路不误杀', () => {
    expect(
      identityConflict('CCTV-5+', 'http://a.com/cctv5plus/i.m3u8')
    ).toBeNull();
    expect(
      identityConflict('CCTV-1', 'http://a.com/live/123/index.m3u8')
    ).toBeNull();
    expect(
      identityConflict('湖南卫视', 'http://a.com/hunanws/i.m3u8')
    ).toBeNull();
    expect(
      identityConflict('山东教育卫视', 'http://a.com/shandongws.m3u8')
    ).toBeNull();
    expect(
      identityConflict('广州新闻', 'http://a.com/cctv1/i.m3u8')
    ).toBeNull();
  });

  test('多台名共用地址时由地址裁决', () => {
    expect(identityConfirms('CCTV-1', 'http://a.com/cctv1/i.m3u8')).toBe(true);
    expect(identityConfirms('CCTV-2', 'http://a.com/cctv1/i.m3u8')).toBe(false);
    expect(identityConfirms('CCTV-1', 'http://a.com/x/i.m3u8')).toBe(false);
  });

  test('占位画面与同流判定', () => {
    expect(isPlaceholderUrl('https://a.com/assets/nosignal.m3u8')).toBe(true);
    expect(isPlaceholderUrl('https://a.com/offline/seg1.ts')).toBe(true);
    expect(isPlaceholderUrl('https://a.com/live/cctv1/seg1.ts')).toBe(false);
    expect(streamKey('http://a.com/x.m3u8#kids')).toBe(
      streamKey('https://a.com/x.m3u8')
    );
  });
});
