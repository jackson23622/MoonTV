// 手机端全屏时按画面方向锁定屏幕：横向视频锁横屏，竖向视频（短剧等）锁竖屏；退出全屏解锁。
// Android Chrome / Edge / 三星浏览器等支持；iPhone Safari 不支持锁定方向（全屏时由系统播放器随手机旋转）。

type LockableOrientation = ScreenOrientation & {
  lock?: (o: 'landscape' | 'portrait') => Promise<void>;
  unlock?: () => void;
};

function orientationApi(): LockableOrientation | null {
  if (typeof window === 'undefined' || !window.screen) return null;
  return (window.screen.orientation as LockableOrientation) || null;
}

function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0)
  );
}

export async function lockForVideo(video?: HTMLVideoElement | null) {
  if (!isTouchDevice()) return;
  const api = orientationApi();
  if (!api?.lock) return;
  const portrait =
    !!video && video.videoWidth > 0 && video.videoHeight > video.videoWidth;
  try {
    await api.lock(portrait ? 'portrait' : 'landscape');
  } catch {
    // 不在全屏、浏览器不支持或用户设置不允许：保持原样
  }
}

export function unlockOrientation() {
  try {
    orientationApi()?.unlock?.();
  } catch {
    // ignore
  }
}

/** 监听原生全屏切换（<video controls> 的全屏按钮），全屏时锁方向、退出时解锁。返回取消监听函数 */
export function bindFullscreenOrientation(
  getVideo: () => HTMLVideoElement | null
): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const onChange = () => {
    const d = document as Document & { webkitFullscreenElement?: Element };
    if (document.fullscreenElement || d.webkitFullscreenElement)
      lockForVideo(getVideo());
    else unlockOrientation();
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('webkitfullscreenchange', onChange);
    unlockOrientation();
  };
}
