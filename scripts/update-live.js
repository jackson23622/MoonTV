#!/usr/bin/env node
/* eslint-disable */
// 直播源自动更新：从 GitHub 上持续维护的 IPTV 仓库拉取频道，
// 检测网页可播放性（https + m3u8 + 跨域），生成 public/live/channels.json
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
const SOURCES = [
  {
    name: 'vbskycn/iptv',
    chinaVerified: true,
    url: 'https://raw.githubusercontent.com/vbskycn/iptv/refs/heads/master/tv/iptv4.m3u',
  },
  {
    name: 'zhi35/iptv',
    chinaVerified: true,
    url: 'https://raw.githubusercontent.com/zhi35/iptv/master/iptv.m3u',
  },
  {
    name: 'iptv-org/iptv (cn)',
    url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u',
  },
  {
    name: 'iptv-org/iptv (hk)',
    url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/hk.m3u',
    group: '港澳台',
  },
  {
    name: 'iptv-org/iptv (tw)',
    url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u',
    group: '港澳台',
  },
  {
    name: 'best-fan/iptv-sources',
    chinaVerified: true,
    url: 'https://raw.githubusercontent.com/best-fan/iptv-sources/main/cn_all_status.m3u8',
  },
  // 每日检测可用性，含台湾新闻台（TVBS、東森、三立、中天、民视等）
  {
    name: 'big-mouth-cn/tv',
    chinaVerified: true,
    url: 'https://raw.githubusercontent.com/big-mouth-cn/tv/main/iptv-ok.m3u',
  },
  // 中文频道全集（含台湾、香港、新加坡等地中文台）
  {
    name: 'iptv-org/iptv (中文)',
    url: 'https://raw.githubusercontent.com/iptv-org/iptv/gh-pages/languages/zho.m3u',
  },
  // 少儿分类：只收中文频道（tvg-id 为中/港/台/澳/新 或名称含中文）
  {
    name: 'iptv-org/iptv (少儿)',
    url: 'https://raw.githubusercontent.com/iptv-org/iptv/gh-pages/categories/kids.m3u',
    group: '少儿频道',
    chineseOnly: true,
  },
];

const TIMEOUT_MS = 8000;
const CONCURRENCY = 24;
const MAX_URLS_PER_CHANNEL = 4;
const MIN_CHANNELS = 30; // 低于此数视为检测环境异常，保留上一版数据
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
} = require('../src/lib/channel-rules');
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
    const seg = r.body
      .split(/\r?\n/)
      .find((l) => l.trim() && !l.startsWith('#'));
    if (!seg) return { state: 'blocked', reason: '无分片' };
    const segUrl = new URL(seg.trim(), base).toString();
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
  for (const it of items) {
    const n = normalize(it);
    if (!n) continue;
    const original = it.url.trim();
    if (!/^https?:\/\//i.test(original) || /^https?:\/\/\[/.test(original))
      continue;
    if (/youtube\.com|youtu\.be/i.test(original) || RESTREAM_RE.test(original))
      continue;
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
      });
    // 网页：https（http 尝试升级）
    const url = original.startsWith('http://')
      ? 'https://' + original.slice(7)
      : original;
    if (!ch.urls.has(url)) ch.urls.set(url, it.heightHint || 0);
  }

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

  const byChannel = new Map();
  const reasons = {};
  for (const r of results) {
    if (!byChannel.has(r.ch.key))
      byChannel.set(r.ch.key, { ok: [], maybe: [] });
    const b = byChannel.get(r.ch.key);
    if (r.state === 'ok')
      b.ok.push({
        url: r.url,
        height: r.height || r.ch.urls.get(r.url) || 0,
        video: r.video,
      });
    else {
      if (r.state === 'unreachable') b.maybe.push(r.url);
      reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    }
  }

  // 有已验证线路的频道才收录；连不上（可能是境外检测被地区限制）的线路作为备用排在后面
  const groups = new Map();
  let verifiedChannels = 0;
  let verifiedUrls = 0;
  for (const ch of channels.values()) {
    const b = byChannel.get(ch.key);
    if (!b || !b.ok.length) continue;
    verifiedChannels++;
    verifiedUrls += b.ok.length;
    // 高清线路优先
    // 网页：H.264 线路优先（所有浏览器都能放），H.265 排后面作备用；同编码按清晰度
    b.ok.sort(
      (x, y) =>
        Number(x.video === 'hevc') - Number(y.video === 'hevc') ||
        y.height - x.height
    );
    const urls = [...b.ok.map((o) => o.url), ...b.maybe].slice(
      0,
      MAX_URLS_PER_CHANNEL
    );
    if (!groups.has(ch.group)) groups.set(ch.group, []);
    const entry = { name: ch.name, urls };
    if (b.ok[0].height) entry.height = b.ok[0].height;
    if (b.ok[0].height >= HD_HEIGHT) entry.hd = true;
    if (ch.logo) entry.logo = ch.logo;
    groups.get(ch.group).push(entry);
  }
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
    const pick = b.ok[0] || b.china[0];
    if (!pick) continue;
    if (b.ok[0]) tvVerified++;
    if (!tvGroups.has(ch.group)) tvGroups.set(ch.group, []);
    tvGroups.get(ch.group).push({
      name: ch.name,
      url: pick.url,
      logo: ch.tvLogo || ch.logo,
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

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const report =
    `# 直播源检测报告\n\n更新时间：${now}（北京时间）\n\n` +
    `收录 ${verifiedChannels} 个频道 / 合并后共 ${channels.size} 个；已验证线路 ${verifiedUrls} 条 / 候选 ${tasks.length} 条。\n\n` +
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

  console.log(`收录 ${verifiedChannels} 个频道，已验证线路 ${verifiedUrls} 条`);
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
  if (verifiedChannels < MIN_CHANNELS) {
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

module.exports = { parseM3U, normalize, cleanName, checkStream, toSimp };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
