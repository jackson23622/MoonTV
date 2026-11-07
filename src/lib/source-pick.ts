/**
 * 播放源选择与卡顿判断（纯函数，便于测试）。
 *
 * 选源原则：
 *   1. 插播广告优先：没有插播、或插播能被完全过滤掉的线路优先，可能漏过滤广告的线路靠后；
 *   2. 同一档里先保证流畅，再追求画质。
 *      余量 = 实测下载速度 ÷ 片源码率。余量不足时，画质再高也会边播边卡。
 *   所有线路都不流畅时，流畅优先于广告（卡到看不了比看到广告更糟）。
 */

export interface SourceTestResult {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  /** 首个分片的码率（kbps），测不到时为空 */
  bitrateKbps?: number;
  /** 插播广告分析（m3u8-adfilter.analyzeAds），取不到播放列表时为空 */
  ads?: AdInfo | null;
}

export interface AdInfo {
  /** 能识别并过滤掉的广告段数 */
  adBlocks: number;
  adSeconds: number;
  /** 过滤后仍保留、不像正片的短段数（可能漏过滤的插播） */
  suspiciousBlocks: number;
}

/**
 * 广告风险档位，越小越好：
 *  0 无插播；1 有插播但能完全过滤（需开启去广告）；1.5 未知；
 *  2 可能漏过滤的插播，或关闭去广告时有插播。
 */
export function adRisk(t: SourceTestResult, blockAd = true): number {
  const a = t.ads;
  if (!a) return 1.5;
  if (a.suspiciousBlocks > 0) return 2;
  if (a.adBlocks > 0) return blockAd ? 1 : 2;
  return 0;
}

/** 选源列表里显示的广告标签 */
export function adLabel(
  t: SourceTestResult | undefined,
  blockAd = true
): string {
  if (!t || !t.ads) return '';
  const r = adRisk(t, blockAd);
  return r === 0 ? '无广告' : r === 1 ? '已去广告' : '可能有广告';
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

/** 在一组候选里按流畅 → 画质选：流畅的源中 4K/2K 优先，否则按原顺序（综合评分） */
function pickSmoothIn<T extends { testResult: SourceTestResult }>(
  ranked: T[]
): T | undefined {
  const smooth = ranked.filter((r) => {
    const h = headroom(r.testResult);
    return h !== null && h >= SMOOTH_HEADROOM;
  });
  return smooth.find((r) => isUhd(r.testResult.quality)) || smooth[0];
}

/**
 * 从已按综合评分排好序的候选中选出播放源：
 *  1. 按广告风险从低到高逐档找，档内有流畅的源就选（4K/2K 优先，其次原顺序）；
 *  2. 都不流畅时，选余量最大的（最不容易卡）；
 *  3. 都没有余量数据时，选广告风险最低档里原顺序第一个。
 */
export function pickSmoothest<T extends { testResult: SourceTestResult }>(
  ranked: T[],
  blockAd = true
): T | undefined {
  if (!ranked.length) return undefined;
  const risks = Array.from(
    new Set(ranked.map((r) => adRisk(r.testResult, blockAd)))
  ).sort((a, b) => a - b);

  for (const risk of risks) {
    const picked = pickSmoothIn(
      ranked.filter((r) => adRisk(r.testResult, blockAd) === risk)
    );
    if (picked) return picked;
  }

  const withHeadroom = ranked
    .map((r) => ({ r, h: headroom(r.testResult) }))
    .filter((x): x is { r: T; h: number } => x.h !== null);
  if (withHeadroom.length) {
    return withHeadroom.reduce((a, b) => (b.h > a.h ? b : a)).r;
  }
  return ranked.find((r) => adRisk(r.testResult, blockAd) === risks[0]);
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
 * 持续卡顿时挑一个替代源：余量比当前源高出 30% 以上、且流畅的源，广告风险低的优先，同档余量最大者优先；
 * 当前源没有余量数据时，只要候选流畅即可。没有合适的返回 undefined。
 */
export function pickFallback<
  T extends { key: string; testResult: SourceTestResult }
>(
  candidates: T[],
  currentKey: string,
  tried: Set<string>,
  blockAd = true
): T | undefined {
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
    // 广告风险低的优先，同档余量大的优先
    .sort(
      (a, b) =>
        adRisk(a.c.testResult, blockAd) - adRisk(b.c.testResult, blockAd) ||
        b.h - a.h
    );
  return options[0]?.c;
}
