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
const DRY_RUN = process.argv.includes('--dry-run');

const SITE_ORIGIN = 'https://bde4.dpdns.org';
const SOURCES = [
  { name: 'vbskycn/iptv', url: 'https://raw.githubusercontent.com/vbskycn/iptv/refs/heads/master/tv/iptv4.m3u' },
  { name: 'zhi35/iptv', url: 'https://raw.githubusercontent.com/zhi35/iptv/master/iptv.m3u' },
  { name: 'iptv-org/iptv (cn)', url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u' },
  { name: 'iptv-org/iptv (hk)', url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/hk.m3u', group: '港澳台' },
  { name: 'iptv-org/iptv (tw)', url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u', group: '港澳台' },
  { name: 'best-fan/iptv-sources', url: 'https://raw.githubusercontent.com/best-fan/iptv-sources/main/cn_all_status.m3u8' },
  // 中文频道全集（含台湾、香港、新加坡等地中文台）
  { name: 'iptv-org/iptv (中文)', url: 'https://raw.githubusercontent.com/iptv-org/iptv/gh-pages/languages/zho.m3u' },
  // 少儿分类：只收中文频道（tvg-id 为中/港/台/澳/新 或名称含中文）
  { name: 'iptv-org/iptv (少儿)', url: 'https://raw.githubusercontent.com/iptv-org/iptv/gh-pages/categories/kids.m3u', group: '少儿频道', chineseOnly: true },
];

const TIMEOUT_MS = 8000;
const CONCURRENCY = 24;
const MAX_URLS_PER_CHANNEL = 4;
const MIN_CHANNELS = 30; // 低于此数视为检测环境异常，保留上一版数据

const GROUP_ORDER = ['央视频道', '卫视频道', '少儿频道', '港澳台', '地方频道', '体育频道', '电影频道', '纪录频道', '直播中国', '其他频道'];
const HD_HEIGHT = 720;

// ---------- 解析与归类 ----------

function parseM3U(text, source) {
  const out = [];
  if (!text || !text.includes('#EXTINF')) return out;
  let info = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attr = (k) => (line.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || '';
      const name = line.slice(line.lastIndexOf(',') + 1).trim();
      const hint = name.match(/\((\d{3,4})p\)/i);
      info = {
        name,
        logo: attr('tvg-logo'),
        group: source.group || attr('group-title'),
        tvgName: attr('tvg-name'),
        tvgId: attr('tvg-id'),
        heightHint: hint ? parseInt(hint[1], 10) : 0,
      };
    } else if (!line.startsWith('#') && info) {
      const chinese = /[\u4e00-\u9fff]/.test(info.name) || /\.(cn|tw|hk|mo|sg)@/i.test(info.tvgId);
      if (!source.chineseOnly || chinese) out.push({ ...info, url: line, source: source.name });
      info = null;
    }
  }
  return out;
}

function cleanName(name) {
  return name
    .replace(/[\[【(（][^\]】)）]*[\]】)）]/g, '')
    .replace(/(超高清|高清|超清|标清|HD|FHD|UHD|1080[Pp]?|720[Pp]?|50FPS|HEVC|H265|IPV[46]|频道$)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PROVINCE_EN = {
  anhui: '安徽', beijing: '北京', chongqing: '重庆', southeast: '东南', fujian: '东南', gansu: '甘肃',
  guangdong: '广东', guangxi: '广西', guizhou: '贵州', hainan: '海南', hebei: '河北', heilongjiang: '黑龙江',
  henan: '河南', hubei: '湖北', hunan: '湖南', jiangsu: '江苏', jiangxi: '江西', jilin: '吉林',
  liaoning: '辽宁', 'nei monggol': '内蒙古', 'inner mongolia': '内蒙古', ningxia: '宁夏', qinghai: '青海',
  shaanxi: '陕西', shandong: '山东', dragon: '东方', shanxi: '山西', shenzhen: '深圳', sichuan: '四川',
  tianjin: '天津', xinjiang: '新疆', xizang: '西藏', tibet: '西藏', yunnan: '云南', zhejiang: '浙江',
};
const NAME_ALIAS = { 黑龙卫视: '黑龙江卫视', BRTV北京卫视: '北京卫视', 内蒙卫视: '内蒙古卫视', 卡酷动画: '卡酷少儿', 卡酷卡通: '卡酷少儿', 福州电视台少儿频道: '福州少儿', 福州电视台少儿: '福州少儿' };
// iptv-org 英文名的少儿台 → 常用中文名
const KIDS_EN = [
  [/Golden Eagle Cartoon/i, '金鹰卡通'],
  [/Kaku/i, '卡酷少儿'],
  [/You ?Man Cartoon/i, '优漫卡通'],
  [/Jia ?Jia Cartoon/i, '嘉佳卡通'],
  [/Toonmax|Hahaxuandong/i, '哈哈炫动'],
  [/Jiangxi Children/i, '江西少儿'],
  [/Shandong TV Children/i, '山东少儿'],
  [/Sichuan TV Women and Children/i, '四川妇女儿童'],
  [/GOOD TV CH45/i, 'GOOD TV 卡通台'],
];
const KIDS_RE = /少儿|少兒|卡通|动漫|動漫|动画|動畫|儿童|兒童|幼幼|亲子|親子|KIDS|CARTOON|CHILDREN|TOON/i;
const CGTN_ALIAS = { DOCUMENTARY: '纪录', 记录: '纪录', ENGLISH: '英语', SPANISH: '西语', FRENCH: '法语', ARABIC: '阿语', RUSSIAN: '俄语' };
const HKTW_RE = /TVB|翡翠台|明珠台|无线新闻|無線新聞|凤凰|鳳凰|澳视|澳視|中天|TVBS|三立|台视|台視|中视|中視|华视|華視|民视|民視|东森|東森|寰宇|ViuTV|有线新闻|香港卫视|香港電台|RTHK|八大/i;

function normalize(item) {
  let raw = (item.name || item.tvgName || '').trim();
  if (!raw) return null;
  if (/❌|✖|失效/.test(raw)) return null;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw) || /更新/.test(raw)) return null;
  if (/(广播|电台|Radio|FM\b|之声)/i.test(raw) || /qingting\.fm/i.test(item.url)) return null;
  if (/春晚/.test(item.group) || /春晚/.test(raw)) return null;
  raw = raw.replace(/^[^\p{L}\p{N}]+/u, '');

  const compact = raw.replace(/\s/g, '');
  const cctv = compact.match(/^CCTV-?(\d{1,2}|4K|8K)(\+)?/i);
  if (cctv) {
    const num = cctv[1].toUpperCase() + (cctv[2] ? '+' : '');
    return { key: 'CCTV-' + num, name: 'CCTV-' + num, group: '央视频道' };
  }
  const cgtn = compact.match(/^CGTN(.*)$/i);
  if (cgtn) {
    let suffix = cleanName(cgtn[1] || '').replace(/[\s-]/g, '');
    for (const [k, v] of Object.entries(CGTN_ALIAS)) if (suffix.toUpperCase().startsWith(k)) suffix = v;
    const name = 'CGTN' + suffix;
    return { key: name.toUpperCase(), name, group: '央视频道' };
  }

  for (const [re, zh] of KIDS_EN) {
    if (re.test(raw)) return { key: zh, name: zh, group: '少儿频道' };
  }

  // 英文省级卫视名（iptv-org）：Hunan TV → 湖南卫视
  const en = cleanName(raw).match(/^([A-Za-z ]+?)\s+(TV|Satellite TV)$/i);
  if (en && PROVINCE_EN[en[1].toLowerCase()]) {
    const name = PROVINCE_EN[en[1].toLowerCase()] + '卫视';
    return { key: name, name, group: '卫视频道' };
  }

  let name = cleanName(raw);
  if (!name) return null;
  let key = name.replace(/[\s\-_·]/g, '').toUpperCase();
  if (NAME_ALIAS[key]) {
    name = NAME_ALIAS[key];
    key = name;
  }
  if (/卫视/.test(name) && !/香港卫视/.test(name)) return { key, name, group: '卫视频道' };

  const g = item.group || '';
  let group = '其他频道';
  if (g === '少儿频道' || KIDS_RE.test(name) || /少儿|儿童|卡通|动画|KIDS|ANIMATION/i.test(g)) group = '少儿频道';
  else if (/港澳台|香港|台湾|台灣|澳门|澳門/.test(g) || HKTW_RE.test(name)) group = '港澳台';
  else if (/直播中国|景区|景点|慢直播/.test(g)) group = '直播中国';
  else if (/体育|運動|运动|NBA|足球|SPORT/i.test(g + name)) group = '体育频道';
  else if (/电影|影院|MOVIE/i.test(g)) group = '电影频道';
  else if (/纪录|紀錄|纪实|DOCU/i.test(g + name)) group = '纪录频道';
  else if (/地方|新闻|综合|都市|公共|生活|经济|影视|频道/.test(g + name)) group = '地方频道';
  return { key, name, group };
}

// ---------- 可播放性检测 ----------

async function req(url, { range = false, ms = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const headers = {
      Origin: SITE_ORIGIN,
      Referer: SITE_ORIGIN + '/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    };
    if (range) headers.Range = 'bytes=0-2047';
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    const acao = res.headers.get('access-control-allow-origin');
    const corsOk = acao === '*' || (acao && acao.replace(/\/$/, '') === SITE_ORIGIN);
    let body = '';
    if (range) {
      try { await res.arrayBuffer(); } catch {}
    } else {
      body = await res.text();
    }
    return { status: res.status, ok: res.ok, corsOk, body, finalUrl: res.url };
  } finally {
    clearTimeout(t);
  }
}

// 返回 'ok' | 'blocked'(确定不能在网页播放) | 'unreachable'(可能是地区限制)
async function checkStream(url) {
  try {
    if (!url.startsWith('https://')) return { state: 'blocked', reason: '非 https' };
    let r = await req(url);
    if ([404, 410].includes(r.status)) return { state: 'blocked', reason: 'HTTP ' + r.status };
    if (!r.ok) return { state: 'unreachable', reason: 'HTTP ' + r.status };
    if (!r.body.includes('#EXTM3U')) return { state: 'blocked', reason: '不是 m3u8' };
    if (!r.corsOk) return { state: 'blocked', reason: '不允许跨域' };

    let base = r.finalUrl || url;
    let height = 0;
    if (r.body.includes('#EXT-X-STREAM-INF')) {
      for (const m of r.body.matchAll(/RESOLUTION=\d+x(\d+)/gi)) height = Math.max(height, parseInt(m[1], 10));
      const variant = r.body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
      if (!variant) return { state: 'blocked', reason: '空播放列表' };
      const vUrl = new URL(variant.trim(), base).toString();
      if (!vUrl.startsWith('https://')) return { state: 'blocked', reason: '分片非 https' };
      r = await req(vUrl);
      if (!r.ok || !r.body.includes('#EXTINF')) return { state: 'unreachable', reason: '子列表不可用' };
      if (!r.corsOk) return { state: 'blocked', reason: '子列表不允许跨域' };
      base = r.finalUrl || vUrl;
    }
    const seg = r.body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
    if (!seg) return { state: 'blocked', reason: '无分片' };
    const segUrl = new URL(seg.trim(), base).toString();
    if (!segUrl.startsWith('https://')) return { state: 'blocked', reason: '分片非 https' };
    const s = await req(segUrl, { range: true });
    if (!s.ok) return { state: 'unreachable', reason: '分片 HTTP ' + s.status };
    if (!s.corsOk) return { state: 'blocked', reason: '分片不允许跨域' };
    if (!height) {
      const hint = url.match(/(2160|1080|720|576|540|480)p?(?![0-9])/i);
      if (hint) height = parseInt(hint[1], 10);
    }
    return { state: 'ok', height };
  } catch (e) {
    return { state: 'unreachable', reason: e.name === 'AbortError' ? '超时' : '连接失败' };
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

function sortChannels(group, list) {
  if (group === '央视频道') {
    const n = (c) => {
      const m = c.name.match(/CCTV-(\d+)/);
      if (m) return parseInt(m[1], 10) + (c.name.includes('+') ? 0.5 : 0);
      return /4K|8K/.test(c.name) ? 50 : 100;
    };
    return list.sort((a, b) => n(a) - n(b) || a.name.localeCompare(b.name, 'zh'));
  }
  if (group === '少儿频道') {
    const rank = (c) => (c.name === 'CCTV-14' ? 0 : c.hd ? 1 : 2);
    return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
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
      sourceStats.push({ name: src.name, url: src.url, count: 0, error: e.message });
    }
  }

  // 按频道合并，收集候选地址（http 尝试升级为 https；跳过 IPv6 字面地址）
  const channels = new Map();
  for (const it of items) {
    const n = normalize(it);
    if (!n) continue;
    let url = it.url.trim();
    if (/^https?:\/\/\[/.test(url)) continue;
    if (url.startsWith('http://')) url = 'https://' + url.slice(7);
    if (!url.startsWith('https://')) continue;
    if (!channels.has(n.key)) channels.set(n.key, { ...n, logo: '', urls: new Map() });
    const ch = channels.get(n.key);
    if (!ch.logo && it.logo && it.logo.startsWith('https://')) ch.logo = it.logo;
    if (!ch.urls.has(url)) ch.urls.set(url, it.heightHint || 0);
  }

  const tasks = [];
  for (const ch of channels.values()) for (const url of ch.urls.keys()) tasks.push({ ch, url });
  console.log(`频道 ${channels.size} 个，候选线路 ${tasks.length} 条，开始检测…`);

  const results = await mapLimit(tasks, CONCURRENCY, async (t) => ({ ...t, ...(await checkStream(t.url)) }));

  const byChannel = new Map();
  const reasons = {};
  for (const r of results) {
    if (!byChannel.has(r.ch.key)) byChannel.set(r.ch.key, { ok: [], maybe: [] });
    const b = byChannel.get(r.ch.key);
    if (r.state === 'ok') b.ok.push({ url: r.url, height: r.height || r.ch.urls.get(r.url) || 0 });
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
    b.ok.sort((x, y) => y.height - x.height);
    const urls = [...b.ok.map((o) => o.url), ...b.maybe].slice(0, MAX_URLS_PER_CHANNEL);
    if (!groups.has(ch.group)) groups.set(ch.group, []);
    const entry = { name: ch.name, urls };
    if (b.ok[0].height) entry.height = b.ok[0].height;
    if (b.ok[0].height >= HD_HEIGHT) entry.hd = true;
    if (ch.logo) entry.logo = ch.logo;
    groups.get(ch.group).push(entry);
  }
  // CCTV-14 是少儿频道，同时放进少儿分组置顶
  const cctv14 = (groups.get('央视频道') || []).find((c) => c.name === 'CCTV-14');
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

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const report =
    `# 直播源检测报告\n\n更新时间：${now}（北京时间）\n\n` +
    `收录 ${verifiedChannels} 个频道 / 合并后共 ${channels.size} 个；已验证线路 ${verifiedUrls} 条 / 候选 ${tasks.length} 条。\n\n` +
    `## 上游仓库\n\n| 仓库 | 解析条目 |\n|---|---|\n` +
    sourceStats.map((s) => `| [${s.name}](${s.url}) | ${s.count}${s.error ? '（拉取失败）' : ''} |`).join('\n') +
    `\n\n## 分组\n\n| 分组 | 频道数 |\n|---|---|\n` +
    data.groups.map((g) => `| ${g.name} | ${g.channels.length} |`).join('\n') +
    `\n\n## 少儿频道\n\n` +
    ((data.groups.find((g) => g.name === '少儿频道') || { channels: [] }).channels
      .map((c) => `- ${c.name}${c.hd ? '（高清 ' + c.height + 'p）' : c.height ? '（' + c.height + 'p）' : ''}`)
      .join('\n') || '（本次没有可在网页播放的少儿频道）') +
    `\n\n## 未通过原因\n\n| 原因 | 线路数 |\n|---|---|\n` +
    Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n') +
    '\n';

  console.log(`收录 ${verifiedChannels} 个频道，已验证线路 ${verifiedUrls} 条`);
  if (DRY_RUN) {
    console.log(report);
    return;
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report);
  if (verifiedChannels < MIN_CHANNELS) {
    console.error(`可用频道仅 ${verifiedChannels} 个，低于 ${MIN_CHANNELS}，保留上一版 channels.json`);
    return;
  }
  const prev = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : null;
  if (prev && JSON.stringify(prev.groups) === JSON.stringify(data.groups)) {
    console.log('频道与线路无变化');
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(data));
  console.log('channels.json 已更新');
}

module.exports = { parseM3U, normalize, cleanName, checkStream };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
