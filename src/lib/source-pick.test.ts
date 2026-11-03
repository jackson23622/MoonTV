import {
  headroom,
  parseSpeedKBps,
  pickFallback,
  pickSmoothest,
  StallMonitor,
} from './source-pick';

const r = (quality: string, loadSpeed: string, bitrateKbps?: number) => ({
  testResult: { quality, loadSpeed, pingTime: 100, bitrateKbps },
});

describe('parseSpeedKBps / headroom', () => {
  it('解析速度并计算余量', () => {
    expect(parseSpeedKBps('1.5 MB/s')).toBe(1536);
    expect(parseSpeedKBps('800.0 KB/s')).toBe(800);
    expect(parseSpeedKBps('未知')).toBe(0);
    // 1 MB/s = 8192 kbps，码率 4096 kbps → 余量 2
    expect(headroom(r('1080p', '1.0 MB/s', 4096).testResult)).toBe(2);
    expect(headroom(r('1080p', '未知', 4096).testResult)).toBeNull();
    expect(headroom(r('1080p', '1.0 MB/s').testResult)).toBeNull();
  });
});

describe('pickSmoothest', () => {
  it('4K 速度跟不上码率时不选，改选流畅的 1080p', () => {
    const fast1080 = r('1080p', '1.2 MB/s', 5000); // 余量约 2.0
    const slow4k = r('4K', '1.5 MB/s', 16000); // 余量约 0.77
    expect(pickSmoothest([slow4k, fast1080])).toBe(fast1080);
  });

  it('4K 流畅时优先 4K', () => {
    const a1080 = r('1080p', '2.0 MB/s', 5000);
    const ok4k = r('4K', '4.0 MB/s', 16000); // 余量约 2.05
    expect(pickSmoothest([a1080, ok4k])).toBe(ok4k);
  });

  it('都不流畅时选余量最大的', () => {
    const a = r('1080p', '300.0 KB/s', 5000); // 0.49
    const b = r('1080p', '500.0 KB/s', 4000); // 1.0
    expect(pickSmoothest([a, b])).toBe(b);
  });

  it('没有余量数据时沿用评分第一', () => {
    const a = r('1080p', '未知');
    const b = r('4K', '未知');
    expect(pickSmoothest([a, b])).toBe(a);
    expect(pickSmoothest([])).toBeUndefined();
  });
});

describe('StallMonitor', () => {
  it('90 秒内缓冲 3 次判定为持续卡顿，窗口外的不计', () => {
    const m = new StallMonitor(3, 90_000);
    expect(m.record(0)).toBe(false);
    expect(m.record(10_000)).toBe(false);
    expect(m.record(95_000)).toBe(false); // 第一次已过期，窗口内只剩 2 次
    expect(m.record(98_000)).toBe(true);
    m.reset();
    expect(m.record(120_000)).toBe(false);
  });
});

describe('pickFallback', () => {
  const c = (key: string, speed: string, br?: number) => ({
    key,
    testResult: {
      quality: '1080p',
      loadSpeed: speed,
      pingTime: 50,
      bitrateKbps: br,
    },
  });

  it('选余量明显更大的流畅源，跳过已尝试的', () => {
    const list = [
      c('a', '600.0 KB/s', 5000), // 当前 0.98
      c('b', '1.0 MB/s', 5000), // 1.64
      c('c', '2.0 MB/s', 5000), // 3.28
    ];
    expect(pickFallback(list, 'a', new Set())?.key).toBe('c');
    expect(pickFallback(list, 'a', new Set(['c']))?.key).toBe('b');
  });

  it('没有明显更好的源时不切换', () => {
    const list = [c('a', '1.0 MB/s', 5000), c('b', '1.1 MB/s', 5000)];
    expect(pickFallback(list, 'a', new Set())).toBeUndefined();
  });
});
