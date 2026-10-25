#!/usr/bin/env node
/* eslint-disable */
// 直播源自动更新：从 GitHub 上持续维护的 IPTV 仓库拉取频道，
// 检测网页可播放性（直连 / 经本站边缘代理 / 仅国内），生成 public/live/channels.json，
// 并生成台标（public/tv/logos/）与节目单（public/live/epg.json）
// 用法：node scripts/update-live.js [--dry-run]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'public', 'live', 'channels.json');
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
const CONCURRENCY = 24;
const MAX_URLS_PER_CHANNEL = 6;
const MAX_CN_URLS = 3; // 每频道最多带 3 条「境外测不通、国内直连可看」的线路
// 允许收录「只有国内线路」的分组：港澳台的国内线路基本不可用，其余都收（主要在国内直连观看）
const CN_ONLY_EXCLUDE = ['港澳台']; // 港澳台的国内线路基本不可用
const EPG_PATH = path.join(ROOT, 'public', 'live', 'epg.json');
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
  toProxyUrl,
  matchKey,
} = require('../src/lib/channel-rules');
const { syncLogos, buildEpg } = require('./live-assets');
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

// Cloudflare 边缘函数不能请求 IP 字面地址；非标准端口需较新的兼容日期，排在后面
function proxyable(url) {
  try {
    const u = new URL(url);
    if (
      /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) ||
      u.hostname.startsWith('[')
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
function standardPort(url) {
  try {
    const p = new URL(url).port;
    return !p || p === '80' || p === '443';
  } catch {
    return false;
  }
}

/**
 * 给一个频道排好网页线路（纯函数，便于测试）：
 *   d 直连：https + 跨域，境外已验证 —— 不经本站，国内外都能直连
 *   c 国内：境外连不上的 https 直链（多为仅限国内 IP）—— 国内直连观看时通常最快
 *   p 代理：境外已验证但是 http 或不允许跨域 —— 经本站边缘函数转发，国内访问绕境外最慢，作兜底
 * 以国内直连观看为主，所以顺序是 直连 → 国内 → 代理。
 * H.265 线路多数浏览器黑屏，排最后；同类按清晰度从高到低。
 */
function rankWebLines({ direct = [], proxy = [], china = [] }) {
  // 清晰度优先，同清晰度时被更多仓库标为该频道的排前
  const byHeight = (a, b) =>
    (b.height || 0) - (a.height || 0) || (b.votes || 1) - (a.votes || 1);
  const isHevc = (x) => x.video === 'hevc';
  const d = direct.filter((x) => !isHevc(x)).sort(byHeight);
  const p = proxy
    .filter((x) => !isHevc(x))
    .sort(
      (a, b) =>
        Number(standardPort(b.url)) - Number(standardPort(a.url)) ||
        byHeight(a, b)
    );
  const c = china.slice(0, MAX_CN_URLS);
  const hevc = [...direct.filter(isHevc), ...proxy.filter(isHevc)].sort(
    byHeight
  );
  const out = [];
  const seen = new Set();
  const add = (x, kind) => {
    const key = x.url.replace(/^https?:\/\//, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...x, kind, url: kind === 'p' ? toProxyUrl(x.url) : x.url });
  };
  d.forEach((x) => add(x, 'd'));
  c.forEach((x) => add(x, 'c'));
  p.forEach((x) => add(x, 'p'));
  hevc.forEach((x) => add(x, x.direct ? 'd' : 'p'));
  return out.slice(0, MAX_URLS_PER_CHANNEL);
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
    const acao = res.headers.get('access-control-allow-origin');
    const corsOk =
      acao === '*' || (acao && acao.replace(/\/$/, '') === SITE_ORIGIN);
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
      corsOk,
      body,
      bytes,
      finalUrl: res.url,
    };
  } finally {
    clearTimeout(t);
  }
}

// mode='web'：网页播放，要求 https + 允许跨域；mode='tv'：电视客户端，http 可用、不检查跨域
// 返回 'ok' | 'blocked'(确定不可用) | 'unreachable'(连不上，可能是境外检测被地区限制)
async function checkStream(url, mode = 'web') {
  const web = mode === 'web';
  try {
    if (web && !url.startsWith('https://'))
      return { state: 'blocked', reason: '非 https' };
    if (AUDIO_URL_RE.test(url))
      return { state: 'blocked', reason: '纯音频（黑屏）' };
    let r = await req(url);
    if ([404, 410].includes(r.status))
      return { state: 'blocked', reason: 'HTTP ' + r.status };
    if (!r.ok) return { state: 'unreachable', reason: 'HTTP ' + r.status };
    if (!r.body.includes('#EXTM3U'))
      return { state: 'blocked', reason: '不是 m3u8' };
    if (web && !r.corsOk) return { state: 'blocked', reason: '不允许跨域' };

    let base = r.finalUrl || url;
    let height = 0;
    if (r.body.includes('#EXT-X-STREAM-INF')) {
      const variant = pickVariant(r.body);
      if (!variant) return { state: 'blocked', reason: '空播放列表' };
      if (variant.kind === 'audio')
        return { state: 'blocked', reason: '纯音频（黑屏）' };
      height = variant.height;
      const vUrl = new URL(variant.uri, base).toString();
      if (web && !vUrl.startsWith('https://'))
        return { state: 'blocked', reason: '分片非 https' };
      r = await req(vUrl);
      if (!r.ok || !r.body.includes('#EXTINF'))
        return { state: 'unreachable', reason: '子列表不可用' };
      if (web && !r.corsOk)
        return { state: 'blocked', reason: '子列表不允许跨域' };
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
    if (web && !segUrl.startsWith('https://'))
      return { state: 'blocked', reason: '分片非 https' };
    const s = await req(segUrl, { range: true });
    if (!s.ok) return { state: 'unreachable', reason: '分片 HTTP ' + s.status };
    if (web && !s.corsOk) return { state: 'blocked', reason: '分片不允许跨域' };
    // 读分片里的 PMT：只有音频的线路会黑屏，H.265 在多数浏览器里也是黑屏
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

  // 按频道合并，收集候选地址（http 尝试升级为 https；跳过 IPv6 字面地址）
  const channels = new Map();
  const reasons = {};
  const owners = new Map(); // 同一条流 → 挂在哪些频道下
  for (const it of items) {
    const n = normalize(it);
    if (!n) continue;
    const original = it.url.trim().replace(/#.*$/, '');
    if (!/^https?:\/\//i.test(original)) continue;
    // IPv6 字面地址：网页与边缘代理都无法使用，只放进电视订阅（家宽开 IPv6 的电视可看）
    const ipv6Only = /^https?:\/\/\[/.test(original);
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
        logo: '',
        tvLogo: '',
        urls: new Map(),
        tvUrls: new Map(),
      });
    const ch = channels.get(n.key);
    if (!ch.logo && it.logo && it.logo.startsWith('https://'))
      ch.logo = it.logo;
    if (!ch.tvLogo && /^https?:\/\//.test(it.logo || '')) ch.tvLogo = it.logo;
    // 电视：原始地址（http 也可）
    if (!ch.tvUrls.has(original))
      ch.tvUrls.set(original, {
        height: it.heightHint || 0,
        chinaVerified: it.chinaVerified,
        sources: new Set(),
      });
    const meta = ch.tvUrls.get(original);
    meta.chinaVerified = meta.chinaVerified || it.chinaVerified;
    meta.sources.add(it.source);
    if (ipv6Only) continue;
    // 网页：https（http 尝试升级）
    const url = original.startsWith('http://')
      ? 'https://' + original.slice(7)
      : original;
    if (!ch.urls.has(url)) ch.urls.set(url, it.heightHint || 0);
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
        ch.urls.delete(url.replace(/^http:\/\//, 'https://'));
        const why = keep.length ? '同一台的重复台名' : '多个台名共用同一地址';
        reasons[why] = (reasons[why] || 0) + 1;
      }
    }
  }
  for (const [key, ch] of channels)
    if (!ch.tvUrls.size && !ch.urls.size) channels.delete(key);
  // 每条线路被几个仓库标为该频道（多源一致更可信）
  const votesOf = (ch, url) =>
    (
      ch.tvUrls.get(url) ||
      ch.tvUrls.get(url.replace(/^https:\/\//, 'http://')) ||
      {}
    ).sources?.size || 1;

  const tasks = [];
  for (const ch of channels.values())
    for (const url of ch.urls.keys()) tasks.push({ ch, url });
  const tvTasks = [];
  for (const ch of channels.values())
    for (const url of ch.tvUrls.keys()) tvTasks.push({ ch, url });
  console.log(
    `频道 ${channels.size} 个，网页候选 ${tasks.length} 条、电视候选 ${tvTasks.length} 条，开始检测…`
  );

  const results = await mapLimit(tasks, CONCURRENCY, async (t) => ({
    ...t,
    ...(await checkStream(t.url, 'web')),
  }));
  const tvResults = await mapLimit(tvTasks, TV_CONCURRENCY, async (t) => ({
    ...t,
    ...(await checkStream(t.url, 'tv')),
  }));

  // 每个频道三类线路：直连（网页检测通过）、代理（电视检测通过、可由边缘函数转发）、国内（境外连不上的 https 直链）
  const lines = new Map();
  const bucket = (key) => {
    if (!lines.has(key)) lines.set(key, { direct: [], proxy: [], china: [] });
    return lines.get(key);
  };
  for (const r of results) {
    const b = bucket(r.ch.key);
    if (r.state === 'ok')
      b.direct.push({
        url: r.url,
        height: r.height || r.ch.urls.get(r.url) || 0,
        video: r.video,
        direct: true,
        votes: votesOf(r.ch, r.url),
      });
    else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  }
  for (const r of tvResults) {
    const b = bucket(r.ch.key);
    const meta = r.ch.tvUrls.get(r.url);
    if (r.state === 'ok' && proxyable(r.url))
      b.proxy.push({
        url: r.url,
        height: r.height || meta.height || 0,
        video: r.video,
        votes: meta.sources.size,
      });
    else if (r.state === 'blocked' && /非直播|死流|占位/.test(r.reason))
      reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    else if (
      r.state === 'unreachable' &&
      r.url.startsWith('https://') &&
      DIRECT_STREAM_RE.test(new URL(r.url).pathname)
    )
      b.china.push({
        url: r.url,
        height: meta.height || 0,
        trusted: meta.chinaVerified,
        votes: meta.sources.size,
      });
  }

  const groups = new Map();
  const stat = { direct: 0, proxy: 0, cn: 0, lines: 0 };
  for (const ch of channels.values()) {
    const b = lines.get(ch.key);
    if (!b) continue;
    // 国内检测仓库给的线路排前面
    b.china.sort(
      (x, y) =>
        Number(!!y.trusted) - Number(!!x.trusted) ||
        (y.votes || 1) - (x.votes || 1)
    );
    const ranked = rankWebLines(b);
    const verified = ranked.filter((x) => x.kind !== 'c');
    const cnOnly = !verified.length;
    if (cnOnly) {
      // 只有国内线路：港澳台不收，且至少一条来自国内检测过的仓库
      if (CN_ONLY_EXCLUDE.includes(ch.group) || !b.china.some((x) => x.trusted))
        continue;
      stat.cn++;
    } else if (verified[0].kind === 'd') stat.direct++;
    else stat.proxy++;
    stat.lines += ranked.length;

    const best = verified[0] || ranked[0];
    const entry = { name: ch.name, urls: ranked.map((x) => x.url) };
    // 每条线路的类型（d 直连 / p 代理 / c 国内），网页据此标注线路
    entry.kinds = ranked.map((x) => x.kind).join('');
    if (best.height) entry.height = best.height;
    if (!cnOnly && best.height >= HD_HEIGHT) entry.hd = true;
    if (cnOnly) entry.cn = true;
    if (ch.logo) entry.logo = ch.logo;
    if (!groups.has(ch.group)) groups.set(ch.group, []);
    groups.get(ch.group).push(entry);
  }
  const verifiedChannels = stat.direct + stat.proxy;
  const verifiedUrls = stat.lines;

  // 台标：统一用 fanmingming 台标库（风格一致），没有的再用订阅里的 https 台标
  const allNames = Array.from(channels.values()).map((c) => c.name);
  const logoMap = DRY_RUN ? new Map() : await syncLogos(allNames, LOGO_DIR);
  for (const list of groups.values())
    for (const e of list) if (logoMap.has(e.name)) e.logo = logoMap.get(e.name);
  // CCTV-14 是少儿频道，同时放进少儿分组置顶
  const cctv14 = (groups.get('央视频道') || []).find(
    (c) => c.name === 'CCTV-14'
  );
  if (cctv14) {
    if (!groups.has('少儿频道')) groups.set('少儿频道', []);
    groups.get('少儿频道').unshift({ ...cctv14 });
  }

  const data = {
    updatedAt: new Date().toISOString(),
    sources: sourceStats.map(({ name, url }) => ({ name, url })),
    groups: GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({
      name: g,
      channels: sortChannels(g, groups.get(g)),
    })),
  };

  // ---------- 电视订阅 ----------
  // 每频道一条线路：已验证线路取最高清；没有已验证线路时，取国内检测过的仓库（境外连不上多为地区限制）里的第一条
  const tvBy = new Map();
  for (const r of tvResults) {
    if (!tvBy.has(r.ch.key)) tvBy.set(r.ch.key, { ok: [], china: [] });
    const b = tvBy.get(r.ch.key);
    const meta = r.ch.tvUrls.get(r.url);
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
        : ch.tvLogo || ch.logo,
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

  // 节目单：只给网页收录的频道
  const webNames = data.groups.flatMap((g) => g.channels.map((c) => c.name));
  const epg = DRY_RUN ? { url: null, ch: {} } : await buildEpg(webNames);
  const epgCount = Object.keys(epg.ch).length;
  const logoCount = data.groups.reduce(
    (a, g) => a + g.channels.filter((c) => c.logo).length,
    0
  );

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const report =
    `# 直播源检测报告\n\n更新时间：${now}（北京时间）\n\n` +
    `网页收录 ${verifiedChannels + stat.cn} 个频道（直连 ${
      stat.direct
    }、经本站代理 ${stat.proxy}、仅国内线路 ${stat.cn}）/ 合并后共 ${
      channels.size
    } 个；网页线路 ${verifiedUrls} 条 / 候选 ${
      tasks.length + tvTasks.length
    } 条。\n\n` +
    `台标 ${logoCount} 个频道；节目单 ${epgCount} 个频道${
      epg.url ? `（[e.xml](${epg.url})）` : '（获取失败）'
    }。\n\n` +
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
    data.groups.map((g) => `| ${g.name} | ${g.channels.length} |`).join('\n') +
    `\n\n## 少儿频道\n\n` +
    ((
      data.groups.find((g) => g.name === '少儿频道') || { channels: [] }
    ).channels
      .map(
        (c) =>
          `- ${c.name}${
            c.hd
              ? '（高清 ' + c.height + 'p）'
              : c.height
              ? '（' + c.height + 'p）'
              : ''
          }`
      )
      .join('\n') || '（本次没有可在网页播放的少儿频道）') +
    `\n\n## 电视订阅（OrionTV）\n\n共 ${tvCount} 个频道，其中境外已验证 ${tvVerified} 个，其余为国内检测仓库提供、境外无法验证的线路。\n\n` +
    tvOrdered.map((g) => `- ${g.name}：${g.channels.length}`).join('\n') +
    `\n\n港澳台：${twList.join('、') || '无'}` +
    `\n\n## 未通过原因\n\n| 原因 | 线路数 |\n|---|---|\n` +
    Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`)
      .join('\n') +
    '\n';

  console.log(
    `网页收录 ${verifiedChannels + stat.cn} 个频道（直连 ${stat.direct}、代理 ${
      stat.proxy
    }、仅国内 ${stat.cn}），线路 ${verifiedUrls} 条`
  );
  if (DRY_RUN) {
    console.log(report);
    return;
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report);
  if (epgCount) {
    fs.mkdirSync(path.dirname(EPG_PATH), { recursive: true });
    fs.writeFileSync(
      EPG_PATH,
      JSON.stringify({ updatedAt: new Date().toISOString(), ch: epg.ch })
    );
    console.log(`节目单已生成：${epgCount} 个频道`);
  }
  if (tvCount >= MIN_CHANNELS) {
    fs.mkdirSync(path.dirname(TV_M3U_PATH), { recursive: true });
    fs.writeFileSync(TV_M3U_PATH, tvM3u);
    fs.writeFileSync(TV_TXT_PATH, tvTxt);
    console.log(`电视订阅已生成：${tvCount} 个频道`);
  } else {
    console.error(`电视可用频道仅 ${tvCount} 个，保留上一版电视订阅`);
  }
  if (verifiedChannels + stat.cn < MIN_CHANNELS) {
    console.error(
      `可用频道仅 ${verifiedChannels} 个，低于 ${MIN_CHANNELS}，保留上一版 channels.json`
    );
    return;
  }
  const prev = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
    : null;
  if (prev && JSON.stringify(prev.groups) === JSON.stringify(data.groups)) {
    console.log('频道与线路无变化');
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(data));
  console.log('channels.json 已更新');
}

module.exports = {
  parseM3U,
  normalize,
  cleanName,
  checkStream,
  toSimp,
  rankWebLines,
  proxyable,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
