/* eslint-disable */
// 直播线路的音视频探测（纯 JS、无依赖，检测脚本与测试共用）
// 用途：剔除「只有声音、画面全黑」的线路（广播、纯音频流），识别浏览器播不了的 H.265 线路。

// MPEG-TS PMT 里的 stream_type
const VIDEO_TYPES = {
  0x01: 'mpeg1',
  0x02: 'mpeg2',
  0x10: 'mpeg4',
  0x1b: 'h264',
  0x24: 'hevc',
  0x42: 'avs',
  0xd2: 'avs2',
};

/**
 * 解析 TS 分片开头的 PAT / PMT，返回分片里的视频编码。
 * @param {Uint8Array} buf 分片开头若干字节（建议 ≥ 3760，即 20 个 TS 包）
 * @returns {'h264'|'hevc'|'mpeg2'|'mpeg1'|'mpeg4'|'avs'|'avs2'|'none'|'unknown'}
 *   none = 只有音频；unknown = 不是 TS 或没找到 PMT（如 fMP4 分片），无法判断
 */
function probeTsVideo(buf) {
  if (!buf || buf.length < 188) return 'unknown';
  let start = -1;
  for (let i = 0; i < Math.min(buf.length - 188, 188); i++) {
    if (buf[i] === 0x47 && buf[i + 188] === 0x47) {
      start = i;
      break;
    }
  }
  if (start < 0) return 'unknown';

  let pmtPid = -1;
  for (let o = start; o + 188 <= buf.length; o += 188) {
    if (buf[o] !== 0x47) continue;
    const pid = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2];
    const pusi = buf[o + 1] & 0x40;
    let p = o + 4;
    if (buf[o + 3] & 0x20) p += 1 + buf[o + 4]; // adaptation field
    if (!pusi) continue;
    p += 1 + buf[p]; // pointer field
    if (p + 12 > o + 188) continue;

    if (pid === 0 && buf[p] === 0x00) {
      // PAT：取第一个节目的 PMT PID
      const sectionLen = ((buf[p + 1] & 0x0f) << 8) | buf[p + 2];
      for (let q = p + 8; q + 4 <= p + 3 + sectionLen - 4; q += 4) {
        const program = (buf[q] << 8) | buf[q + 1];
        if (program !== 0) {
          pmtPid = ((buf[q + 2] & 0x1f) << 8) | buf[q + 3];
          break;
        }
      }
    } else if (pid === pmtPid && buf[p] === 0x02) {
      // PMT：遍历基本流
      const sectionLen = ((buf[p + 1] & 0x0f) << 8) | buf[p + 2];
      const infoLen = ((buf[p + 10] & 0x0f) << 8) | buf[p + 11];
      const end = Math.min(p + 3 + sectionLen - 4, o + 188);
      let q = p + 12 + infoLen;
      let video = 'none';
      while (q + 5 <= end) {
        const type = VIDEO_TYPES[buf[q]];
        if (type && video === 'none') video = type;
        const esInfo = ((buf[q + 3] & 0x0f) << 8) | buf[q + 4];
        q += 5 + esInfo;
      }
      return video;
    }
  }
  return 'unknown';
}

/**
 * 从主播放列表的 CODECS 判断：'video' 有视频、'hevc' 只有 H.265 视频、'audio' 只有音频、'unknown' 未声明
 */
function codecsKind(codecs) {
  if (!codecs) return 'unknown';
  const list = codecs.split(',').map((c) => c.trim().toLowerCase());
  const videos = list.filter((c) => /^(avc|hvc|hev|av01|vp0?9|mp4v)/.test(c));
  if (!videos.length)
    return list.some((c) => /^(mp4a|ac-3|ec-3|opus)/.test(c))
      ? 'audio'
      : 'unknown';
  return videos.every((c) => /^(hvc|hev)/.test(c)) ? 'hevc' : 'video';
}

/**
 * 从主播放列表里挑一个子列表：优先有视频、浏览器能放（非 H.265）、分辨率最高的。
 * @returns {{ uri: string, height: number, kind: string } | null}
 */
function pickVariant(masterText) {
  const lines = masterText.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = (
      lines.slice(i + 1).find((l) => l.trim() && !l.trim().startsWith('#')) ||
      ''
    ).trim();
    if (!uri) continue;
    const height = parseInt(
      (line.match(/RESOLUTION=\d+x(\d+)/i) || [])[1] || '0',
      10
    );
    const kind = codecsKind((line.match(/CODECS="([^"]+)"/i) || [])[1]);
    variants.push({ uri, height, kind });
  }
  if (!variants.length) return null;
  const rank = (v) => ({ video: 3, unknown: 2, hevc: 1, audio: 0 }[v.kind]);
  variants.sort((a, b) => rank(b) - rank(a) || b.height - a.height);
  return variants[0];
}

// 地址本身就表明是纯音频 / 广播的线路
const AUDIO_URL_RE =
  /\/audio\/|[_-]audio\.m3u8|\/radio\/|satellitepull\.cnr\.cn|ls\.qingting\.fm|\/fm\d/i;

module.exports = { probeTsVideo, codecsKind, pickVariant, AUDIO_URL_RE };
