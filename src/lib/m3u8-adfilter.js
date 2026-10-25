/* eslint-disable */
// M3U8 去广告：按 #EXT-X-DISCONTINUITY 把媒体播放列表切成若干段，
// 识别出与正片"指纹"不同的短段（采集站插入的赌博/推广切片）并整段删除。
// 纯 JS（CommonJS），播放页和 scripts/update-sources.js 共用。

const AD_MAX_BLOCK_SECONDS = 120; // 超过该时长的段视为正片，不删
const SHORT_BLOCK_SECONDS = 25; // 极短且出现在片头/片中的段，结合指纹判断

function segmentFingerprint(uri) {
  // 去掉查询串，取目录 + 文件名"形状"（数字统一为 0，保留长度与扩展名）
  const clean = uri.split('?')[0].split('#')[0];
  const slash = clean.lastIndexOf('/');
  const dir = slash >= 0 ? clean.slice(0, slash) : '';
  const file = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = file.lastIndexOf('.');
  const ext = dot >= 0 ? file.slice(dot + 1).toLowerCase() : '';
  const base = dot >= 0 ? file.slice(0, dot) : file;
  return dir + '|' + ext + '|' + base.length;
}

function parseBlocks(lines) {
  // 返回 { header: string[], blocks: Block[], footer: string[] }
  // Block = { segments: {tags: string[], uri: string, duration: number}[], keyAtStart: string|null }
  const header = [];
  const footer = [];
  const blocks = [];
  let current = null;
  let pendingTags = [];
  let currentKey = null;
  let seenSegment = false;

  const startBlock = () => {
    current = { segments: [], keyAtStart: currentKey };
    blocks.push(current);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (
      line.startsWith('#EXT-X-DISCONTINUITY') &&
      !line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE')
    ) {
      if (current && current.segments.length) startBlock();
      continue;
    }
    if (line.startsWith('#EXT-X-ENDLIST')) {
      footer.push(line);
      continue;
    }
    if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
      if (line.startsWith('#EXT-X-KEY')) currentKey = line;
      if (!seenSegment && !current) {
        header.push(line);
        continue;
      }
      pendingTags.push(line);
      continue;
    }
    if (line.startsWith('#')) {
      const isSegmentTag =
        line.startsWith('#EXTINF') ||
        line.startsWith('#EXT-X-BYTERANGE') ||
        line.startsWith('#EXT-X-PROGRAM-DATE-TIME') ||
        line.startsWith('#EXT-X-GAP') ||
        line.startsWith('#EXT-X-BITRATE');
      if (!seenSegment && !isSegmentTag) {
        header.push(line);
      } else {
        pendingTags.push(line);
      }
      continue;
    }

    // URI 行
    seenSegment = true;
    if (!current) startBlock();
    const inf = pendingTags.find((t) => t.startsWith('#EXTINF'));
    const duration = inf ? parseFloat(inf.slice(8)) || 0 : 0;
    current.segments.push({ tags: pendingTags, uri: line, duration });
    pendingTags = [];
  }

  return { header, blocks: blocks.filter((b) => b.segments.length), footer };
}

function blockStats(block) {
  let duration = 0;
  const fps = new Map();
  for (const s of block.segments) {
    duration += s.duration;
    const fp = segmentFingerprint(s.uri);
    fps.set(fp, (fps.get(fp) || 0) + s.duration);
  }
  let main = null;
  let best = -1;
  for (const [fp, d] of fps) {
    if (d > best) {
      best = d;
      main = fp;
    }
  }
  return { duration, fingerprint: main };
}

/**
 * 过滤广告。返回 { content, removedBlocks, removedSeconds }。
 * 主播放列表（含 #EXT-X-STREAM-INF）原样返回。
 */
function filterM3U8Ads(m3u8) {
  if (!m3u8 || typeof m3u8 !== 'string') {
    return { content: m3u8 || '', removedBlocks: 0, removedSeconds: 0 };
  }
  if (m3u8.includes('#EXT-X-STREAM-INF') || !m3u8.includes('#EXTINF')) {
    return { content: m3u8, removedBlocks: 0, removedSeconds: 0 };
  }

  const { header, blocks, footer } = parseBlocks(m3u8.split(/\r?\n/));
  if (blocks.length <= 1) {
    return { content: m3u8, removedBlocks: 0, removedSeconds: 0 };
  }

  const stats = blocks.map(blockStats);

  // 正片指纹 = 按时长累计最多的指纹
  const byFp = new Map();
  stats.forEach((s) =>
    byFp.set(s.fingerprint, (byFp.get(s.fingerprint) || 0) + s.duration)
  );
  let mainFp = null;
  let mainDur = -1;
  for (const [fp, d] of byFp) {
    if (d > mainDur) {
      mainDur = d;
      mainFp = fp;
    }
  }
  const mainDir = mainFp ? mainFp.split('|')[0] : '';

  const keep = stats.map((s) => {
    if (s.duration > AD_MAX_BLOCK_SECONDS) return true;
    if (s.fingerprint === mainFp) return true;
    // 同目录但文件名形状不同、且很短：多为插播
    const sameDir = s.fingerprint && s.fingerprint.split('|')[0] === mainDir;
    if (sameDir && s.duration > SHORT_BLOCK_SECONDS) return true;
    return false;
  });

  // 保险：若删掉的比保留的还多，说明判断失误，原样返回
  const keptDur = stats.reduce((a, s, i) => a + (keep[i] ? s.duration : 0), 0);
  const removedDur = stats.reduce(
    (a, s, i) => a + (keep[i] ? 0 : s.duration),
    0
  );
  if (keptDur === 0 || removedDur > keptDur) {
    return { content: m3u8, removedBlocks: 0, removedSeconds: 0 };
  }

  const out = [...header];
  let lastKey = header.filter((l) => l.startsWith('#EXT-X-KEY')).pop() || null;
  let first = true;
  let removedBlocks = 0;
  blocks.forEach((block, i) => {
    if (!keep[i]) {
      removedBlocks++;
      return;
    }
    if (!first) out.push('#EXT-X-DISCONTINUITY');
    first = false;
    // 保证密钥状态正确：被删段里切换过 KEY 时，补回本段开始时的 KEY
    if (block.keyAtStart && block.keyAtStart !== lastKey) {
      const ownKeyFirst = block.segments[0].tags.some((t) =>
        t.startsWith('#EXT-X-KEY')
      );
      if (!ownKeyFirst) out.push(block.keyAtStart);
      lastKey = block.keyAtStart;
    }
    for (const seg of block.segments) {
      for (const t of seg.tags) {
        if (t.startsWith('#EXT-X-KEY')) lastKey = t;
        out.push(t);
      }
      out.push(seg.uri);
    }
  });
  out.push(...footer);

  return {
    content: out.join('\n') + '\n',
    removedBlocks,
    removedSeconds: Math.round(removedDur * 10) / 10,
  };
}

module.exports = { filterM3U8Ads, segmentFingerprint };
