/**
 * 自动跳过片头片尾
 *
 * - 总开关存 localStorage `enable_skip_segments`（默认关闭，藏在播放器设置菜单里）
 * - 片头 / 片尾时长按片名记忆（同一部剧每集片头片尾长度基本一致，换源也沿用）
 *   intro：片头结束的时间点（秒），起播时若在它之前则直接跳到这里
 *   outro：片尾长度（秒，从结尾往前算），播到 duration - outro 即视为看完
 */

export interface SkipConfig {
  intro: number;
  outro: number;
}

export const SKIP_ENABLE_KEY = 'enable_skip_segments';
const CONFIG_PREFIX = 'skip_segments:';

/** 片头片尾可选时长（秒），0 表示不跳过 */
export const SKIP_PRESETS = [0, 30, 60, 90, 120, 150, 180];

export const EMPTY_SKIP: SkipConfig = { intro: 0, outro: 0 };

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function skipConfigKey(title: string): string {
  return CONFIG_PREFIX + title.trim().toLowerCase();
}

function sanitize(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1800) : 0;
}

export function loadSkipEnabled(): boolean {
  return safeStorage()?.getItem(SKIP_ENABLE_KEY) === 'true';
}

export function saveSkipEnabled(on: boolean): void {
  try {
    safeStorage()?.setItem(SKIP_ENABLE_KEY, String(on));
  } catch {
    /* ignore */
  }
}

export function loadSkipConfig(title: string): SkipConfig {
  if (!title) return { ...EMPTY_SKIP };
  try {
    const raw = safeStorage()?.getItem(skipConfigKey(title));
    if (!raw) return { ...EMPTY_SKIP };
    const parsed = JSON.parse(raw);
    return { intro: sanitize(parsed?.intro), outro: sanitize(parsed?.outro) };
  } catch {
    return { ...EMPTY_SKIP };
  }
}

export function saveSkipConfig(title: string, cfg: SkipConfig): void {
  if (!title) return;
  const clean = { intro: sanitize(cfg.intro), outro: sanitize(cfg.outro) };
  try {
    const s = safeStorage();
    if (!s) return;
    if (!clean.intro && !clean.outro) s.removeItem(skipConfigKey(title));
    else s.setItem(skipConfigKey(title), JSON.stringify(clean));
  } catch {
    /* ignore */
  }
}

/** 秒数 → 设置菜单里显示的文字 */
export function formatSkip(sec: number): string {
  if (!sec) return '不跳过';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (!m) return `${s}秒`;
  return s ? `${m}分${s}秒` : `${m}分钟`;
}

/**
 * 起播时应跳到的位置；不需要跳返回 null。
 * 已经在片头之后（比如恢复了进度）不跳；片头长到占满整片（短片 / 时长异常）不跳。
 */
export function introSkipTarget(
  cfg: SkipConfig,
  currentTime: number,
  duration: number
): number | null {
  if (!cfg.intro) return null;
  if (currentTime >= cfg.intro - 1) return null;
  if (duration > 0 && cfg.intro >= duration - 30) return null;
  return cfg.intro;
}

/** 是否已进入片尾 */
export function inOutro(
  cfg: SkipConfig,
  currentTime: number,
  duration: number
): boolean {
  if (!cfg.outro || !(duration > 0)) return false;
  // 片尾长度至少要比整片短 60 秒，避免时长未知 / 异常时一开播就判定结束
  if (cfg.outro >= duration - 60) return false;
  return currentTime >= duration - cfg.outro;
}
