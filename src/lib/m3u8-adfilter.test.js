/* eslint-disable */
const { filterM3U8Ads } = require('./m3u8-adfilter');

function seg(dir, name, d = 4) {
  return `#EXTINF:${d.toFixed(6)},\n${dir}/${name}.ts`;
}
function block(dir, prefix, count, d = 4) {
  const out = [];
  for (let i = 0; i < count; i++)
    out.push(seg(dir, prefix + String(i).padStart(4, '0'), d));
  return out.join('\n');
}
const HEAD =
  '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n';

describe('filterM3U8Ads', () => {
  test('删除不同目录的插播段（片头 + 片中）', () => {
    const m3u8 =
      HEAD +
      block('https://ad.example.net/bet', 'x', 3, 5) +
      '\n#EXT-X-DISCONTINUITY\n' +
      block('/20260101/abc/1000kb/hls', 'aa11bb22cc3', 60) +
      '\n#EXT-X-DISCONTINUITY\n' +
      block('/ad/2026', 'p', 4, 3) +
      '\n#EXT-X-DISCONTINUITY\n' +
      block('/20260101/abc/1000kb/hls', 'aa11bb22cc3', 60, 4).replace(
        /0000/g,
        '9000'
      ) +
      '\n#EXT-X-ENDLIST\n';
    const r = filterM3U8Ads(m3u8);
    expect(r.removedBlocks).toBe(2);
    expect(r.content).not.toContain('ad.example.net');
    expect(r.content).not.toContain('/ad/2026');
    expect((r.content.match(/1000kb\/hls/g) || []).length).toBe(120);
    expect(r.content.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
    expect(r.content.startsWith('#EXTM3U')).toBe(true);
  });

  test('同目录但文件名形状不同的短插播也删除', () => {
    const m3u8 =
      HEAD +
      block('/hls/v1', 'abcdef12345', 50) +
      '\n#EXT-X-DISCONTINUITY\n' +
      block('/hls/v1', 'ad', 3, 5) +
      '\n#EXT-X-DISCONTINUITY\n' +
      block('/hls/v1', 'abcdef12345', 50).replace(/0000/g, '7000') +
      '\n#EXT-X-ENDLIST';
    const r = filterM3U8Ads(m3u8);
    expect(r.removedBlocks).toBe(1);
    expect(r.removedSeconds).toBe(15);
  });

  test('无广告的播放列表原样保留', () => {
    const m3u8 = HEAD + block('/hls/v1', 'abc', 30) + '\n#EXT-X-ENDLIST\n';
    expect(filterM3U8Ads(m3u8).content).toBe(m3u8);
  });

  test('正片本身被 DISCONTINUITY 分段时不误删', () => {
    const m3u8 =
      HEAD +
      block('/hls/v1', 'part', 40) +
      '\n#EXT-X-DISCONTINUITY\n' +
      block('/hls/v1', 'part', 40) +
      '\n#EXT-X-ENDLIST\n';
    const r = filterM3U8Ads(m3u8);
    expect(r.removedBlocks).toBe(0);
    expect((r.content.match(/\.ts/g) || []).length).toBe(80);
  });

  test('不补零的顺序编号文件名不会误删正片短分段', () => {
    const nums = (a, b) =>
      Array.from(
        { length: b - a },
        (_, i) => `#EXTINF:4.000000,\n/v/a/${a + i}.ts`
      ).join('\n');
    const m3u8 =
      HEAD +
      nums(1, 9) +
      '\n#EXT-X-DISCONTINUITY\n' +
      nums(9, 12) +
      '\n#EXT-X-DISCONTINUITY\n' +
      nums(12, 400) +
      '\n#EXT-X-ENDLIST\n';
    const r = filterM3U8Ads(m3u8);
    expect(r.removedBlocks).toBe(0);
    expect((r.content.match(/\.ts/g) || []).length).toBe(399);
  });

  test('主播放列表不处理', () => {
    const master =
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n1000k/hls/index.m3u8\n';
    expect(filterM3U8Ads(master).content).toBe(master);
  });

  test('加密流：删除插播后补回正片的 KEY', () => {
    const key = '#EXT-X-KEY:METHOD=AES-128,URI="/key/main.key"';
    const m3u8 =
      HEAD +
      key +
      '\n' +
      block('/hls/v1', 'abcdef12345', 40) +
      '\n#EXT-X-DISCONTINUITY\n' +
      '#EXT-X-KEY:METHOD=NONE\n' +
      block('https://ad.cdn.io/x', 'z', 3, 5) +
      '\n#EXT-X-DISCONTINUITY\n' +
      key +
      '\n' +
      block('/hls/v1', 'abcdef12345', 40).replace(/0000/g, '8000') +
      '\n#EXT-X-ENDLIST\n';
    const r = filterM3U8Ads(m3u8);
    expect(r.removedBlocks).toBe(1);
    expect(r.content).not.toContain('METHOD=NONE');
    const afterDisc = r.content.split('#EXT-X-DISCONTINUITY')[1];
    expect(afterDisc).toContain('/key/main.key');
  });
});
