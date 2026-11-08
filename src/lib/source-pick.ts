/**
 * 播放源选择与卡顿判断（纯函数，便于测试）。
 *
 * 选源原则：延迟快和高清优先（pickFastHd）；
 * 播放中持续卡顿时再按流畅度换源（pickFallback）：
 *   余量 = 实测下载速度 ÷ 片源码率。余量不足时，画质再高也会边播边卡。
 */

export interface SourceTestResult {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  /** 首个分片的码率（kbps），测不到时为空 */
  bitrateKbps?: number;
}

/** 余量达到这个值视为流畅。测速时多个源并发下载，实测速度偏低，所以门槛不设太高 */
export const SMOOTH_HEADROOM = 1.3;

/** "1.5 MB/s" / "800.0 KB/s" → KB/s；无法解析返回 0 */
export function parseSpeedKBps(s: string | undefined): number {
  const m = (s || '').match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
  return m ? parseFloat(m[1]) * (m[2] === 'MB/s' ? 1024 : 1) : 0;
}

/** 下载速度相对码率的余量；缺少数据时返回 null */
export function headroom(t: SourceTestResult): number | null {
  const speed = parseSpeedKBps(t.loadSpeed);
  if (!speed || !t.bitrateKbps || t.bitrateKbps <= 0) return null;
  return (speed * 8) / t.bitrateKbps;
}

const isUhd = (q: string) => q === '4K' || q === '2K';

/**
 * 从已按综合评分排好序的候选中选出播放源：
 *  1. 有余量数据且流畅的源中，4K/2K 优先，其次按原顺序（综合评分）；
 *  2. 都不流畅时，选余量最大的（最不容易卡）；
 *  3. 都没有余量数据时，沿用原顺序第一个。
 */
export function pickSmoothest<T extends { testResult: SourceTestResult }>(
  ranked: T[]
): T | undefined {
  if (!ranked.length) return undefined;
  const withHeadroom = ranked
    .map((r) => ({ r, h: headroom(r.testResult) }))
    .filter((x): x is { r: T; h: number } => x.h !== null);
  if (!withHeadroom.length) return ranked[0];

  const smooth = withHeadroom.filter((x) => x.h >= SMOOTH_HEADROOM);
  if (smooth.length) {
    return (smooth.find((x) => isUhd(x.r.testResult.quality)) || smooth[0]).r;
  }
  return withHeadroom.reduce((a, b) => (b.h > a.h ? b : a)).r;
}

/** 清晰度档位，越大越清晰；读不到分辨率（Safari 等）的「未知」排在 1080p 和 720p 之间 */
const QUALITY_RANK: Record<string, number> = {
  '4K': 5,
  '2K': 4,
  '1080p': 3,
  未知: 2.5,
  '720p': 2,
  '480p': 1,
  SD: 0,
};
export const qualityRank = (q: string) => QUALITY_RANK[q] ?? 0;

/** 延迟比最快的线路慢不超过这么多，都算「快」 */
export const FAST_PING_SLACK_MS = 150;

/**
 * 选源：延迟快和高清优先。
 *  1. 先圈出「快」的线路：延迟不超过最快线路的 1.5 倍、或只慢 150ms 以内；
 *  2. 快的线路里选清晰度最高的（4K > 2K > 1080p > …）；
 *  3. 清晰度相同选延迟更低的，再相同沿用原顺序（综合评分）。
 * 测不到延迟（0）的线路不参与第 1 步，只有全都测不到时才按清晰度选。
 */
export function pickFastHd<T extends { testResult: SourceTestResult }>(
  ranked: T[]
): T | undefined {
  if (!ranked.length) return undefined;
  const pings = ranked.map((r) => r.testResult.pingTime).filter((p) => p > 0);
  let pool = ranked;
  if (pings.length) {
    const best = Math.min(...pings);
    const limit = Math.max(best * 1.5, best + FAST_PING_SLACK_MS);
    pool = ranked.filter(
      (r) => r.testResult.pingTime > 0 && r.testResult.pingTime <= limit
    );
  }
  return pool.reduce((a, b) => {
    const qa = qualityRank(a.testResult.quality);
    const qb = qualityRank(b.testResult.quality);
    if (qb !== qa) return qb > qa ? b : a;
    const pa = a.testResult.pingTime || Infinity;
    const pb = b.testResult.pingTime || Infinity;
    return pb < pa ? b : a;
  });
}

/**
 * 卡顿监测：一段时间内缓冲次数达到阈值即判定为持续卡顿。
 * 拖动进度条、刚开始播放引起的缓冲由调用方排除。
 */
export class StallMonitor {
  private stalls: number[] = [];

  constructor(
    private readonly threshold = 3,
    private readonly windowMs = 90_000
  ) {}

  /** 记录一次缓冲，返回是否已达到持续卡顿 */
  record(now: number = Date.now()): boolean {
    this.stalls = this.stalls.filter((t) => now - t < this.windowMs);
    this.stalls.push(now);
    return this.stalls.length >= this.threshold;
  }

  reset() {
    this.stalls = [];
  }
}

/**
 * 持续卡顿时挑一个替代源：余量比当前源高出 30% 以上、且流畅的源，余量最大者优先；
 * 当前源没有余量数据时，只要候选流畅即可。没有合适的返回 undefined。
 */
export function pickFallback<
  T extends { key: string; testResult: SourceTestResult }
>(candidates: T[], currentKey: string, tried: Set<string>): T | undefined {
  const current = candidates.find((c) => c.key === currentKey);
  const currentH = current ? headroom(current.testResult) : null;
  const options = candidates
    .filter((c) => c.key !== currentKey && !tried.has(c.key))
    .map((c) => ({ c, h: headroom(c.testResult) }))
    .filter(
      (x): x is { c: T; h: number } =>
        x.h !== null &&
        x.h >= SMOOTH_HEADROOM &&
        (currentH === null || x.h >= currentH * 1.3)
    )
    .sort((a, b) => b.h - a.h);
  return options[0]?.c;
}
