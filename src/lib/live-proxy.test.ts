import {
  isAllowedTarget,
  maybePlaylist,
  proxied,
  rewritePlaylist,
} from './live-proxy';

describe('直播边缘代理', () => {
  test('只允许公网 http(s) 地址', () => {
    expect(isAllowedTarget('http://live.example.com/a.m3u8')).not.toBeNull();
    expect(isAllowedTarget('https://cdn.example.cn:8443/x')).not.toBeNull();
    for (const bad of [
      null,
      'ftp://a.com/x',
      'file:///etc/passwd',
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://10.0.0.1/x',
      'http://192.168.1.1/x',
      'http://172.20.0.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/x',
      'http://[fd00::1]/x',
      'http://intranet/x',
      'http://user:pw@a.com/x',
    ])
      expect(isAllowedTarget(bad)).toBeNull();
  });

  test('改写主列表、子列表、分片、密钥、初始化分片地址', () => {
    const base = 'http://a.com/live/index.m3u8?token=1';
    const out = rewritePlaylist(
      [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1',
        '#EXT-X-MAP:URI="/init.mp4"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1',
        'hd/index.m3u8',
        '#EXTINF:6,',
        'https://b.com/seg1.ts',
        '',
      ].join('\n'),
      base
    );
    expect(out).toContain(`URI="${proxied('http://a.com/live/key.bin')}"`);
    expect(out).toContain(`URI="${proxied('http://a.com/init.mp4')}"`);
    expect(out).toContain(proxied('http://a.com/live/hd/index.m3u8'));
    expect(out).toContain(proxied('https://b.com/seg1.ts'));
    expect(out.split('\n')[0]).toBe('#EXTM3U');
    expect(out).toContain('#EXTINF:6,');
  });

  test('区分播放列表与分片', () => {
    expect(maybePlaylist(new URL('http://a.com/x.m3u8'), '')).toBe(true);
    expect(maybePlaylist(new URL('http://a.com/live.php?id=1'), '')).toBe(true);
    expect(
      maybePlaylist(new URL('http://a.com/1.ts'), 'application/octet-stream')
    ).toBe(false);
    expect(maybePlaylist(new URL('http://a.com/1.ts'), 'video/mp2t')).toBe(
      false
    );
  });
});
