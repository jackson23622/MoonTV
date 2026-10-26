#!/usr/bin/env node
/* eslint-disable */
// 电视订阅自动更新：从 jackson23622/live 拉取频道并检测可播放性，
// 生成电视客户端（OrionTV 等）订阅 public/tv/live.m3u、live.txt 与台标（public/tv/logos/）
// 用法：node scripts/update-live.js [--dry-run]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, '.github', 'live-report.md');
// 电视客户端（OrionTV 等）订阅：允许 http 线路，每个频道一条最优线路
const TV_M3U_PATH = path.join(ROOT, 'public', 'tv', 'live.m3u');
const TV_TXT_PATH = path.join(ROOT, 'public', 'tv', 'live.txt');
const DRY_RUN = process.argv.includes('--dry-run');

const SITE_ORIGIN = 'https://bde4.dpdns.org';
const LIVE_REPO =
  'https://raw.githubusercontent.com/jackson23622/live/main/tv/m3u/';
// 频道只取 jackson23622/live（demo.m3u 为空模板、Invalid/ 为已失效源，不收）
const SOURCES = ['index', 'itv', 'ipv6'].map((f) => ({
  name: `jackson23622/live (${f}.m3u)`,
  url: LIVE_REPO + f + '.m3u',
  chinaVerified: true,
  curated: true,
}));

const TIMEOUT_MS = 8000;
const LOGO_DIR = path.join(ROOT, 'public', 'tv', 'logos');
const MIN_CHANNELS = 5; // 低于此数视为检测环境异常，保留上一版数据
const TV_CONCURRENCY = 32;

const {
  GROUP_ORDER,
  HD_HEIGHT,
  RESTREAM_RE,
  DIRECT_STREAM_RE,
  parseM3U,
  cleanName,
  toSimp,
  normalize,
  sortChannels,
  matchKey,
} = require('../src/lib/channel-rules');
const { syncLogos } = require('./live-assets');
const {
  identityConflict,
  identityConfirms,
  isPlaceholderUrl,
  streamKey,
} = require('../src/lib/stream-identity');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 媒体列表的「进度」：媒体序号 + 最后一个分片地址，直播会不断前进 */
function playlistProgress(body) {
  const seq = (body.match(/#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/) || [])[1] || '';
  const segs = body
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'));
  return seq + '|' + (segs[segs.length - 1] || '').trim();
}

const {
  probeTsVideo,
  pickVariant,
  AUDIO_URL_RE,
} = require('../src/lib/ts-probe');

// ---------- 可播放性检测 ----------

async function req(url, { range = false, ms = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const headers = {
      Origin: SITE_ORIGIN,
      Referer: SITE_ORIGIN + '/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    };
    if (range) headers.Range = 'bytes=0-3759'; // 20 个 TS 包，足够读到 PAT/PMT
    const res = await fetch(url, {
      headers,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    let body = '';
    let bytes = null;
    if (range) {
      try {
        bytes = new Uint8Array(await res.arrayBuffer()).subarray(0, 3760);
      } catch {}
    } else {
      body = await res.text();
    }
    return {
      status: res.status,
      ok: res.ok,
      body,
      bytes,
      finalUrl: res.url,
    };
  } finally {
    clearTimeout(t);
  }
}

// 电视客户端检测：http 可用、不检查跨域
// 返回 'ok' | 'blocked'(确定不可用) | 'unreachable'(连不上，可能是境外检测被地区限制)
async function checkStream(url) {
  try {
    if (AUDIO_URL_RE.test(url))
      return { state: 'blocked', reason: '纯音频（黑屏）' };
    let r = await req(url);
    if ([404, 410].includes(r.status))
      return { state: 'blocked', reason: 'HTTP ' + r.status };
    if (!r.ok) return { state: 'unreachable', reason: 'HTTP ' + r.status };
    if (!r.body.includes('#EXTM3U'))
      return { state: 'blocked', reason: '不是 m3u8' };

    let base = r.finalUrl || url;
    let height = 0;
    if (r.body.includes('#EXT-X-STREAM-INF')) {
      const variant = pickVariant(r.body);
      if (!variant) return { state: 'blocked', reason: '空播放列表' };
      if (variant.kind === 'audio')
        return { state: 'blocked', reason: '纯音频（黑屏）' };
      height = variant.height;
      const vUrl = new URL(variant.uri, base).toString();
      r = await req(vUrl);
      if (!r.ok || !r.body.includes('#EXTINF'))
        return { state: 'unreachable', reason: '子列表不可用' };
      base = r.finalUrl || vUrl;
    }
    // 点播片源（循环播放的电影、宣传片）冒充直播
    if (
      /#EXT-X-ENDLIST/.test(r.body) ||
      /#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(r.body)
    )
      return { state: 'blocked', reason: '点播片源（非直播）' };
    const mediaUrl = base;
    const mediaBody = r.body;
    const seg = r.body
      .split(/\r?\n/)
      .find((l) => l.trim() && !l.startsWith('#'));
    if (!seg) return { state: 'blocked', reason: '无分片' };
    const segUrl = new URL(seg.trim(), base).toString();
    if (isPlaceholderUrl(segUrl))
      return { state: 'blocked', reason: '占位画面' };
    const s = await req(segUrl, { range: true });
    if (!s.ok) return { state: 'unreachable', reason: '分片 HTTP ' + s.status };
    // 读分片里的 PMT：只有音频的线路会黑屏
    const video = probeTsVideo(s.bytes);
    if (video === 'none') return { state: 'blocked', reason: '纯音频（黑屏）' };
    if (!height) {
      const hint = url.match(/(2160|1080|720|576|540|480)p?(?![0-9])/i);
      if (hint) height = parseInt(hint[1], 10);
    }
    // 实时性：等一个分片时长再取一次列表，内容没前进的是死流 / 静止画面
    const td = parseFloat(
      (mediaBody.match(/#EXT-X-TARGETDURATION:\s*([\d.]+)/) || [])[1] || '6'
    );
    await sleep(Math.min(Math.max(td, 2) + 2, 14) * 1000);
    try {
      const again = await req(mediaUrl);
      if (
        again.ok &&
        again.body.includes('#EXTINF') &&
        playlistProgress(again.body) === playlistProgress(mediaBody)
      )
        return { state: 'blocked', reason: '直播不更新（死流）' };
    } catch {
      // 第二次取列表失败不判死，避免偶发网络抖动误杀
    }
    return { state: 'ok', height, video };
  } catch (e) {
    return {
      state: 'unreachable',
      reason: e.name === 'AbortError' ? '超时' : '连接失败',
    };
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

// ---------- 主流程 ----------

async function main() {
  const items = [];
  const sourceStats = [];
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(30000) });
      const text = res.ok ? await res.text() : '';
      const parsed = parseM3U(text, src);
      items.push(...parsed);
      sourceStats.push({ name: src.name, url: src.url, count: parsed.length });
    } catch (e) {
      sourceStats.push({
        name: src.name,
        url: src.url,
        count: 0,
        error: e.message,
      });
    }
  }

  // 按频道合并，收集候选地址
  const channels = new Map();
  const reasons = {};
  const owners = new Map(); // 同一条流 → 挂在哪些频道下
  for (const it of items) {
    const n = normalize(it);
    if (!n) continue;
    const original = it.url.trim().replace(/#.*$/, '');
    if (!/^https?:\/\//i.test(original)) continue;
    if (/youtube\.com|youtu\.be/i.test(original) || RESTREAM_RE.test(original))
      continue;
    // 台名与地址矛盾（标着 CCTV-1、地址是 cctv5）或占位画面：不收
    const bad =
      identityConflict(n.name, original) ||
      (isPlaceholderUrl(original) ? '占位画面' : null);
    if (bad) {
      reasons[bad] = (reasons[bad] || 0) + 1;
      continue;
    }
    const sk = streamKey(original);
    if (!owners.has(sk)) owners.set(sk, new Set());
    owners.get(sk).add(n.key);
    if (!channels.has(n.key))
      channels.set(n.key, {
        ...n,
        tvLogo: '',
        tvUrls: new Map(),
      });
    const ch = channels.get(n.key);
    if (!ch.tvLogo && /^https?:\/\//.test(it.logo || '')) ch.tvLogo = it.logo;
    // 原始地址（http 也可）
    if (!ch.tvUrls.has(original))
      ch.tvUrls.set(original, {
        height: it.heightHint || 0,
        chinaVerified: it.chinaVerified,
        sources: new Set(),
      });
    const meta = ch.tvUrls.get(original);
    meta.chinaVerified = meta.chinaVerified || it.chinaVerified;
    meta.sources.add(it.source);
  }

  // 同一条流挂在多个台名下：
  //   地址能认出是哪个台（cctv1、hunanws…）→ 只留给那个台；
  //   台名互相包含（浙江经济 / 浙江经济生活、东方卫视 / 东方卫视4K）→ 同一个台，只留在最短的基础名下；
  //   台名无关（中天新闻 / 中天综合）→ 说不清是哪个台，全部丢弃
  for (const [sk, keys] of owners) {
    if (keys.size < 2) continue;
    const named = Array.from(keys).map((k) => channels.get(k));
    const sample = Array.from(named[0].tvUrls.keys()).find(
      (u) => streamKey(u) === sk
    );
    let keep = named.filter((ch) => identityConfirms(ch.name, sample || sk));
    if (keep.length !== 1) {
      const base = named
        .slice()
        .sort((a, b) => matchKey(a.name).length - matchKey(b.name).length)[0];
      const bk = matchKey(base.name);
      const related = named.every(
        (ch) => ch === base || matchKey(ch.name).includes(bk)
      );
      keep = related ? [base] : [];
    }
    for (const ch of named) {
      if (keep.includes(ch)) continue;
      for (const url of Array.from(ch.tvUrls.keys())) {
        if (streamKey(url) !== sk) continue;
        ch.tvUrls.delete(url);
        const why = keep.length ? '同一台的重复台名' : '多个台名共用同一地址';
        reasons[why] = (reasons[why] || 0) + 1;
      }
    }
  }
  for (const [key, ch] of channels) if (!ch.tvUrls.size) channels.delete(key);
  const tvTasks = [];
  for (const ch of channels.values())
    for (const url of ch.tvUrls.keys()) tvTasks.push({ ch, url });
  console.log(
    `频道 ${channels.size} 个，候选线路 ${tvTasks.length} 条，开始检测…`
  );

  const tvResults = await mapLimit(tvTasks, TV_CONCURRENCY, async (t) => ({
    ...t,
    ...(await checkStream(t.url)),
  }));

  // 台标：统一用台标库（风格一致），没有的再用订阅里的台标
  const allNames = Array.from(channels.values()).map((c) => c.name);
  const logoMap = DRY_RUN ? new Map() : await syncLogos(allNames, LOGO_DIR);

  // ---------- 电视订阅 ----------
  // 每频道一条线路：已验证线路取最高清；没有已验证线路时，取国内检测过的仓库（境外连不上多为地区限制）里的第一条
  const tvBy = new Map();
  for (const r of tvResults) {
    if (!tvBy.has(r.ch.key)) tvBy.set(r.ch.key, { ok: [], china: [] });
    const b = tvBy.get(r.ch.key);
    const meta = r.ch.tvUrls.get(r.url);
    if (r.state !== 'ok') reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    if (r.state === 'ok')
      b.ok.push({ url: r.url, height: r.height || meta.height || 0 });
    else if (
      r.state === 'unreachable' &&
      meta.chinaVerified &&
      DIRECT_STREAM_RE.test(new URL(r.url).pathname)
    )
      b.china.push({ url: r.url, height: meta.height || 0 });
  }
  const tvGroups = new Map();
  let tvVerified = 0;
  for (const ch of channels.values()) {
    const b = tvBy.get(ch.key);
    if (!b) continue;
    b.ok.sort((x, y) => y.height - x.height);
    // 只有央视、卫视允许使用境外无法验证的国内线路兜底；其余频道必须验证能播才收录，保证流畅
    const pick = b.ok[0] || b.china[0];
    if (!pick) continue;
    if (b.ok[0]) tvVerified++;
    if (!tvGroups.has(ch.group)) tvGroups.set(ch.group, []);
    tvGroups.get(ch.group).push({
      name: ch.name,
      url: pick.url,
      logo: logoMap.has(ch.name)
        ? SITE_ORIGIN + logoMap.get(ch.name)
        : ch.tvLogo,
      hd: pick.height >= HD_HEIGHT,
      height: pick.height,
    });
  }
  const tv14 = (tvGroups.get('央视频道') || []).find(
    (c) => c.name === 'CCTV-14'
  );
  if (tv14) {
    if (!tvGroups.has('少儿频道')) tvGroups.set('少儿频道', []);
    // OrionTV 以地址作为频道 id，加片段区分，播放时片段不会发给服务器
    tvGroups.get('少儿频道').unshift({ ...tv14, url: tv14.url + '#kids' });
  }
  const tvOrdered = GROUP_ORDER.filter((g) => tvGroups.has(g)).map((g) => ({
    name: g,
    channels: sortChannels(g, tvGroups.get(g)),
  }));
  const tvCount = tvOrdered.reduce((a, g) => a + g.channels.length, 0);
  const esc = (v) => String(v || '').replace(/"/g, '');
  const tvM3u =
    '#EXTM3U\n' +
    tvOrdered
      .flatMap((g) =>
        g.channels.map(
          (c) =>
            `#EXTINF:-1 tvg-name="${esc(c.name)}"${
              c.logo ? ` tvg-logo="${esc(c.logo)}"` : ''
            } group-title="${g.name}",${c.name}\n${c.url}`
        )
      )
      .join('\n') +
    '\n';
  const tvTxt =
    tvOrdered
      .map(
        (g) =>
          `${g.name},#genre#\n` +
          g.channels.map((c) => `${c.name},${c.url}`).join('\n')
      )
      .join('\n\n') + '\n';
  const twList = (tvGroups.get('港澳台') || []).map((c) => c.name);

  const logoCount = tvOrdered.reduce(
    (a, g) => a + g.channels.filter((c) => c.logo).length,
    0
  );

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const report =
    `# 直播源检测报告（电视订阅）\n\n更新时间：${now}（北京时间）\n\n` +
    `收录 ${tvCount} 个频道（境外已验证 ${tvVerified} 个，其余为国内检测仓库提供、境外无法验证的线路）` +
    ` / 合并后共 ${channels.size} 个；候选线路 ${tvTasks.length} 条；台标 ${logoCount} 个频道。\n\n` +
    `## 上游仓库\n\n| 仓库 | 解析条目 |\n|---|---|\n` +
    sourceStats
      .map(
        (s) =>
          `| [${s.name}](${s.url}) | ${s.count}${
            s.error ? '（拉取失败）' : ''
          } |`
      )
      .join('\n') +
    `\n\n## 分组\n\n| 分组 | 频道数 |\n|---|---|\n` +
    tvOrdered.map((g) => `| ${g.name} | ${g.channels.length} |`).join('\n') +
    `\n\n港澳台：${twList.join('、') || '无'}` +
    `\n\n## 未通过原因\n\n| 原因 | 线路数 |\n|---|---|\n` +
    Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`)
      .join('\n') +
    '\n';

  console.log(`电视订阅收录 ${tvCount} 个频道（境外已验证 ${tvVerified} 个）`);
  if (DRY_RUN) {
    console.log(report);
    return;
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report);
  if (tvCount >= MIN_CHANNELS) {
    fs.mkdirSync(path.dirname(TV_M3U_PATH), { recursive: true });
    fs.writeFileSync(TV_M3U_PATH, tvM3u);
    fs.writeFileSync(TV_TXT_PATH, tvTxt);
    console.log(`电视订阅已生成：${tvCount} 个频道`);
  } else {
    console.error(`电视可用频道仅 ${tvCount} 个，保留上一版电视订阅`);
  }
}

module.exports = {
  parseM3U,
  normalize,
  cleanName,
  checkStream,
  toSimp,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
