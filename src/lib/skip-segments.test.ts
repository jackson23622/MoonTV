import {
  formatSkip,
  inOutro,
  introSkipTarget,
  loadSkipConfig,
  loadSkipEnabled,
  saveSkipConfig,
  saveSkipEnabled,
} from './skip-segments';

describe('skip-segments', () => {
  beforeEach(() => localStorage.clear());

  it('开关默认关闭，可持久化', () => {
    expect(loadSkipEnabled()).toBe(false);
    saveSkipEnabled(true);
    expect(loadSkipEnabled()).toBe(true);
  });

  it('按片名存取配置，忽略大小写与首尾空格', () => {
    saveSkipConfig(' Friends ', { intro: 90, outro: 60 });
    expect(loadSkipConfig('friends')).toEqual({ intro: 90, outro: 60 });
    expect(loadSkipConfig('其它')).toEqual({ intro: 0, outro: 0 });
  });

  it('全为 0 时删除记录；非法值归零', () => {
    saveSkipConfig('a', { intro: 30, outro: 0 });
    saveSkipConfig('a', { intro: 0, outro: 0 });
    expect(localStorage.length).toBe(0);
    localStorage.setItem('skip_segments:b', '{"intro":"x","outro":-5}');
    expect(loadSkipConfig('b')).toEqual({ intro: 0, outro: 0 });
    localStorage.setItem('skip_segments:c', 'not json');
    expect(loadSkipConfig('c')).toEqual({ intro: 0, outro: 0 });
  });

  it('片头：在片头前跳到片头结束，已过片头或片太短不跳', () => {
    const cfg = { intro: 90, outro: 0 };
    expect(introSkipTarget(cfg, 0, 2700)).toBe(90);
    expect(introSkipTarget(cfg, 0, 0)).toBe(90); // 时长未知也跳
    expect(introSkipTarget(cfg, 300, 2700)).toBeNull();
    expect(introSkipTarget(cfg, 0, 100)).toBeNull();
    expect(introSkipTarget({ intro: 0, outro: 0 }, 0, 2700)).toBeNull();
  });

  it('片尾：进入最后 outro 秒判定，时长异常不判定', () => {
    const cfg = { intro: 0, outro: 120 };
    expect(inOutro(cfg, 2579, 2700)).toBe(false);
    expect(inOutro(cfg, 2580, 2700)).toBe(true);
    expect(inOutro(cfg, 10, 0)).toBe(false);
    expect(inOutro(cfg, 100, 150)).toBe(false);
  });

  it('formatSkip', () => {
    expect(formatSkip(0)).toBe('不跳过');
    expect(formatSkip(45)).toBe('45秒');
    expect(formatSkip(120)).toBe('2分钟');
    expect(formatSkip(95)).toBe('1分35秒');
  });
});
