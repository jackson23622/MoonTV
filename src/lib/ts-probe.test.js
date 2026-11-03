/* eslint-disable */
const {
  probeTsVideo,
  codecsKind,
  pickVariant,
  AUDIO_URL_RE,
} = require('./ts-probe');

// 生成最小 TS：PAT（节目 1 → PMT PID 0x1000）+ PMT（给定 stream_type 列表）
function makeTs(streamTypes) {
  const pkt = (pid, payload) => {
    const b = new Uint8Array(188).fill(0xff);
    b[0] = 0x47;
    b[1] = 0x40 | ((pid >> 8) & 0x1f);
    b[2] = pid & 0xff;
    b[3] = 0x10;
    b[4] = 0x00; // pointer field
    b.set(payload, 5);
    return b;
  };
  const pat = [
    0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xf0, 0x00, 0,
    0, 0, 0,
  ];
  const es = streamTypes.flatMap((t, i) => [t, 0xe1, 0x00 + i, 0xf0, 0x00]);
  const len = 9 + es.length + 4;
  const pmt = [
    0x02,
    0xb0,
    len,
    0x00,
    0x01,
    0xc1,
    0x00,
    0x00,
    0xe1,
    0x00,
    0xf0,
    0x00,
    ...es,
    0,
    0,
    0,
    0,
  ];
  const out = new Uint8Array(188 * 3);
  out.set(pkt(0, pat), 0);
  out.set(pkt(0x1000, pmt), 188);
  out.set(pkt(0x100, [0]), 376);
  return out;
}

describe('线路音视频探测', () => {
  test('H.264 + AAC → h264', () =>
    expect(probeTsVideo(makeTs([0x1b, 0x0f]))).toBe('h264'));
  test('音频在前也能识别视频', () =>
    expect(probeTsVideo(makeTs([0x0f, 0x1b]))).toBe('h264'));
  test('只有 AAC → none（黑屏）', () =>
    expect(probeTsVideo(makeTs([0x0f]))).toBe('none'));
  test('H.265 → hevc', () =>
    expect(probeTsVideo(makeTs([0x24, 0x0f]))).toBe('hevc'));
  test('非 TS → unknown', () =>
    expect(probeTsVideo(new Uint8Array(400))).toBe('unknown'));

  test('CODECS 判断', () => {
    expect(codecsKind('mp4a.40.2')).toBe('audio');
    expect(codecsKind('avc1.64001f,mp4a.40.2')).toBe('video');
    expect(codecsKind('hvc1.1.6.L120.90,mp4a.40.2')).toBe('hevc');
    expect(codecsKind(undefined)).toBe('unknown');
  });

  test('主列表优先选浏览器能放的最高清视频', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"',
      'audio.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=3840x2160,CODECS="hvc1.2.4.L150,mp4a.40.2"',
      '4k.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
      '720.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      '1080.m3u8',
    ].join('\n');
    expect(pickVariant(master)).toMatchObject({
      uri: '1080.m3u8',
      height: 1080,
      kind: 'video',
    });
  });

  test('音频地址特征', () => {
    expect(
      AUDIO_URL_RE.test(
        'https://piccpndks.v.kcdnvip.com/audio/cctv4_2/index.m3u8'
      )
    ).toBe(true);
    expect(
      AUDIO_URL_RE.test(
        'https://playtv-live.ifeng.com/live/06OLEGEGM4G_audio.m3u8'
      )
    ).toBe(true);
    expect(
      AUDIO_URL_RE.test(
        'https://satellitepull.cnr.cn/live/wx32dycjgb/playlist.m3u8'
      )
    ).toBe(true);
    expect(
      AUDIO_URL_RE.test(
        'https://ali-m-l.cztv.com/channels/lantian/channel008/1080p.m3u8'
      )
    ).toBe(false);
  });
});
