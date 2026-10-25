import { lockForVideo, unlockOrientation } from './orientation';

function mockScreen(touch: boolean, lockImpl?: (o: string) => Promise<void>) {
  const lock = jest.fn(lockImpl || (() => Promise.resolve()));
  const unlock = jest.fn();
  Object.defineProperty(window.screen, 'orientation', {
    configurable: true,
    value: { lock, unlock },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: touch && q.includes('coarse') }),
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: touch ? 5 : 0,
  });
  return { lock, unlock };
}

function video(w: number, h: number) {
  const v = document.createElement('video');
  Object.defineProperty(v, 'videoWidth', { value: w });
  Object.defineProperty(v, 'videoHeight', { value: h });
  return v;
}

describe('手机端全屏锁定方向', () => {
  test('横向片源锁横屏', async () => {
    const { lock } = mockScreen(true);
    await lockForVideo(video(1920, 1080));
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  test('竖向片源（短剧）锁竖屏', async () => {
    const { lock } = mockScreen(true);
    await lockForVideo(video(1080, 1920));
    expect(lock).toHaveBeenCalledWith('portrait');
  });

  test('尺寸未知时默认横屏', async () => {
    const { lock } = mockScreen(true);
    await lockForVideo(video(0, 0));
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  test('桌面端不锁定', async () => {
    const { lock } = mockScreen(false);
    await lockForVideo(video(1920, 1080));
    expect(lock).not.toHaveBeenCalled();
  });

  test('浏览器拒绝锁定（如 iPhone）时不报错；退出全屏解锁', async () => {
    const { unlock } = mockScreen(true, () =>
      Promise.reject(new Error('NotSupportedError'))
    );
    await expect(lockForVideo(video(1920, 1080))).resolves.toBeUndefined();
    unlockOrientation();
    expect(unlock).toHaveBeenCalled();
  });
});
