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

const GROUP_ORDER = [
  '央视频道',
  '卫视频道',
  '少儿频道',
  '港澳台',
  '地方频道',
  '体育频道',
  '电影频道',
  '纪录频道',
  '直播中国',
  '其他频道',
];
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
      const attr = (k) =>
        (line.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || '';
      const name = line.slice(line.lastIndexOf(',') + 1).trim();
      const hint =
        name.match(/\((\d{3,4})p\)/i) || line.match(/v-h="(\d{3,4})"/);
      info = {
        name,
        logo: attr('tvg-logo'),
        group: source.group || attr('group-title'),
        tvgName: attr('tvg-name'),
        tvgId: attr('tvg-id'),
        heightHint: hint ? parseInt(hint[1], 10) : 0,
      };
    } else if (!line.startsWith('#') && info) {
      const chinese =
        /[\u4e00-\u9fff]/.test(info.name) ||
        /\.(cn|tw|hk|mo|sg)@/i.test(info.tvgId);
      if (!source.chineseOnly || chinese)
        out.push({
          ...info,
          url: line,
          source: source.name,
          chinaVerified: !!source.chinaVerified,
        });
      info = null;
    }
  }
  return out;
}

function cleanName(name) {
  return name
    .replace(/[\[【(（][^\]】)）]*[\]】)）]/g, '')
    .replace(
      /(超高清|高清|超清|标清|HD|FHD|UHD|1080[Pp]?|720[Pp]?|50FPS|HEVC|H265|IPV[46]|频道$)/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const PROVINCE_EN = {
  anhui: '安徽',
  beijing: '北京',
  chongqing: '重庆',
  southeast: '东南',
  fujian: '东南',
  gansu: '甘肃',
  guangdong: '广东',
  guangxi: '广西',
  guizhou: '贵州',
  hainan: '海南',
  hebei: '河北',
  heilongjiang: '黑龙江',
  henan: '河南',
  hubei: '湖北',
  hunan: '湖南',
  jiangsu: '江苏',
  jiangxi: '江西',
  jilin: '吉林',
  liaoning: '辽宁',
  'nei monggol': '内蒙古',
  'inner mongolia': '内蒙古',
  ningxia: '宁夏',
  qinghai: '青海',
  shaanxi: '陕西',
  shandong: '山东',
  dragon: '东方',
  shanxi: '山西',
  shenzhen: '深圳',
  sichuan: '四川',
  tianjin: '天津',
  xinjiang: '新疆',
  xizang: '西藏',
  tibet: '西藏',
  yunnan: '云南',
  zhejiang: '浙江',
};
const NAME_ALIAS = {
  黑龙卫视: '黑龙江卫视',
  BRTV北京卫视: '北京卫视',
  内蒙卫视: '内蒙古卫视',
  卡酷动画: '卡酷少儿',
  卡酷卡通: '卡酷少儿',
  福州电视台少儿频道: '福州少儿',
  福州电视台少儿: '福州少儿',
};
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
// 宗教频道（佛教、基督教等）一律不收
const RELIGION_RE =
  /宗教|佛|禪|禅|法界|慈濟|慈济|大愛|大爱|人間衛視|人间卫视|唯心|華藏|华藏|淨空|净空|弘法|生命電視|基督|福音|教會|教会|聖經|圣经|禱告|祷告|真理台|牧者|天主|伊斯兰|回教|道教|天道|靈修|灵修|GOOD ?TV|CGNTV|God ?Stands|Gospel|3ABN|Hope ?Channel|Daystar|Christian|Church|Bible|Buddh|Dharma|Catholic/i;
// 外语频道
const FOREIGN_RE =
  /韩国|韓國|日本|朝鲜|朝鮮|英语|英語|英文|法语|西语|阿语|俄语|EBS|KBS|NHK|Arirang|English|Korea|Japan|Bloomberg|CNN|BBC|Discovery|Cartoon ?Network|Cartoonito|BabyFirst|ZooMoo|KIX|Thrill|Celestial|Beautiful Life|Taiwan ?Plus/i;
// 名字全是英文但属于中文台的常见台标
const ASCII_CN_OK =
  /^(CCTV|CETV|CHC|TVBS|TVB|HOY|VIUTV|RTHK|NOW|BRTV|BTV|SZTV|STV|CNC|NEWTV|IHOT|SITV|DOX|EBC|FTV|CTS|CTV|PTS|SET|TTV|CTI)/i;
// iptv-org 英文名 → 中文名（台湾台、央视数字付费频道等）
const EN_NAME = {
  'cti variety': '中天综合',
  'cti news': '中天新闻',
  'ebc news': '东森新闻',
  'ebc financial news': '东森财经新闻',
  'ebc foreign movie': '东森洋片',
  'tvbs news': 'TVBS新闻台',
  'set news': '三立新闻',
  ftv: '民视',
  'ftv one': '民视第一台',
  'ftv taiwan': '民视台湾台',
  'ftv news': '民视新闻台',
  cts: '华视',
  'cts news': '华视新闻',
  ttv: '台视',
  'pts 3': '公视3台',
  pts: '公视',
  'dali tv': '大立电视台',
  'taiwan indigenous tv': '原住民族电视台',
  'indigenous tv': '原住民族电视台',
  'tvbs asia': 'TVBS亚洲台',
  'tvbs-asia': 'TVBS亚洲台',
  'chc action': 'CHC动作电影',
  'chc home theater': 'CHC家庭影院',
  'cctv-storm football': 'CCTV风云足球',
  'cctv-storm music': 'CCTV风云音乐',
  'cctv-storm theater': 'CCTV风云剧场',
  'cctv-the first theater': 'CCTV第一剧场',
  'cctv-nostalgia theater': 'CCTV怀旧剧场',
  'cctv-weapon & technology': 'CCTV兵器科技',
  'cctv-world geography': 'CCTV世界地理',
  "cctv-women's fashion": 'CCTV女性时尚',
  'cctv-culture of quality': 'CCTV央视文化精品',
  'cctv-golf & tennis': 'CCTV高尔夫网球',
  'cctv-billiards': 'CCTV央视台球',
  'cctv-health': 'CCTV卫生健康',
};
const EN_DROP = /^(TV BRICS|CCTV\+)/i;

// 繁转简（仅用于频道去重的 key）
const T2S = {
  東: '东',
  聞: '闻',
  視: '视',
  臺: '台',
  華: '华',
  衛: '卫',
  綜: '综',
  藝: '艺',
  電: '电',
  劇: '剧',
  樂: '乐',
  戲: '戏',
  國: '国',
  際: '际',
  財: '财',
  經: '经',
  灣: '湾',
  鳳: '凤',
  龍: '龙',
  親: '亲',
  兒: '儿',
  動: '动',
  畫: '画',
  體: '体',
  運: '运',
  會: '会',
  聯: '联',
  線: '线',
  無: '无',
  緯: '纬',
  來: '来',
  門: '门',
  時: '时',
  間: '间',
  報: '报',
  紀: '纪',
  錄: '录',
  實: '实',
  訊: '讯',
  業: '业',
  頻: '频',
  資: '资',
  寶: '宝',
  環: '环',
  球: '球',
  觀: '观',
  選: '选',
  戰: '战',
  歡: '欢',
  員: '员',
};
function toSimp(str) {
  return str.replace(/[\u4e00-\u9fff]/g, (c) => T2S[c] || c);
}

const KIDS_RE =
  /少儿|少兒|卡通|动漫|動漫|动画|動畫|儿童|兒童|幼幼|亲子|親子|KIDS|CARTOON|CHILDREN|TOON/i;
const CGTN_ALIAS = {
  DOCUMENTARY: '纪录',
  记录: '纪录',
  ENGLISH: '英语',
  SPANISH: '西语',
  FRENCH: '法语',
  ARABIC: '阿语',
  RUSSIAN: '俄语',
};
const HKTW_RE =
  /TVB|翡翠台|明珠台|无线新闻|無線新聞|凤凰|鳳凰|澳视|澳視|中天|TVBS|三立|台视|台視|中视|中視|华视|華視|民视|民視|东森|東森|寰宇|ViuTV|有线新闻|香港卫视|香港電台|RTHK|港台电视|港台電視|八大|纬来|緯來|公视|公視|原住民/i;

function normalize(item) {
  let raw = (item.name || item.tvgName || '').trim();
  if (!raw) return null;
  if (/❌|✖|失效/.test(raw)) return null;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw) || /更新/.test(raw)) return null;
  if (
    /(广播|电台|Radio|FM\b|之声)/i.test(raw) ||
    /qingting\.fm/i.test(item.url)
  )
    return null;
  if (/春晚/.test(item.group) || /春晚/.test(raw)) return null;
  raw = raw.replace(/^[^\p{L}\p{N}]+/u, '');
  // 「CTi Variety (中天綜合台)」这类英文名带中文括注：用中文名
  const zhInParen = raw.match(
    /[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[)）]/
  );
  if (zhInParen && !/[\u4e00-\u9fff]/.test(raw.replace(zhInParen[0], '')))
    raw = zhInParen[1];
  if (RELIGION_RE.test(raw) || RELIGION_RE.test(item.tvgName || ''))
    return null;
  if (FOREIGN_RE.test(raw)) return null;
  // CGTN 外语台（含拼错的「CGNT」及以台址识别）
  if (
    /^CG(TN|NT)/i.test(raw.replace(/\s/g, '')) ||
    /cgtn\.com/i.test(item.url || '')
  )
    return null;

  const compact = raw.replace(/\s/g, '');
  const cctv = compact.match(/^CCTV-?(\d{1,2}|4K|8K)(\+)?/i);
  if (cctv) {
    const num = cctv[1].toUpperCase() + (cctv[2] ? '+' : '');
    return { key: 'CCTV-' + num, name: 'CCTV-' + num, group: '央视频道' };
  }
  // CGTN 为外语国际频道，不收
  if (/^CGTN/i.test(compact)) return null;

  for (const [re, zh] of KIDS_EN) {
    if (re.test(raw)) return { key: zh, name: zh, group: '少儿频道' };
  }

  // 英文省级卫视名（iptv-org）：Hunan TV → 湖南卫视
  const en = cleanName(raw).match(/^([A-Za-z ]+?)\s+(TV|Satellite TV)$/i);
  if (en && PROVINCE_EN[en[1].toLowerCase()]) {
    const name = PROVINCE_EN[en[1].toLowerCase()] + '卫视';
    return { key: name, name, group: '卫视频道' };
  }

  let name = cleanName(raw)
    .replace(/\s*(备用|備用|测试|測試)\s*\d*$/, '')
    .trim();
  if (!name || EN_DROP.test(name)) return null;
  const enKey = name.toLowerCase().replace(/\s+sd$/, '');
  if (EN_NAME[enKey]) name = EN_NAME[enKey];
  const rthk = name.match(/^RTHK\s*TV\s*(\d+)$/i);
  if (rthk) name = '港台电视' + rthk[1];
  // 只保留中文频道
  if (
    !/[\u4e00-\u9fff]/.test(name) &&
    !ASCII_CN_OK.test(name.replace(/\s/g, ''))
  )
    return null;
  let key = toSimp(name)
    .replace(/[\s\-_·]/g, '')
    .toUpperCase()
    .replace(/(频道|台)$/, '');
  const alias =
    NAME_ALIAS[key] || NAME_ALIAS[key + '频道'] || NAME_ALIAS[key + '台'];
  if (alias) {
    name = alias;
    key = alias;
  }
  if (/卫视/.test(name) && !/香港卫视/.test(name))
    return { key, name, group: '卫视频道' };

  const g = item.group || '';
  let group = '其他频道';
  if (
    g === '少儿频道' ||
    KIDS_RE.test(name) ||
    /少儿|儿童|卡通|动画|KIDS|ANIMATION/i.test(g)
  )
    group = '少儿频道';
  else if (/港澳台|香港|台湾|台灣|澳门|澳門/.test(g) || HKTW_RE.test(name))
    group = '港澳台';
  else if (/直播中国|景区|景点|慢直播/.test(g)) group = '直播中国';
  else if (/体育|運動|运动|NBA|足球|SPORT/i.test(g + name)) group = '体育频道';
  else if (/电影|影院|MOVIE/i.test(g)) group = '电影频道';
  else if (/纪录|紀錄|纪实|DOCU/i.test(g + name)) group = '纪录频道';
  else if (/地方|新闻|综合|都市|公共|生活|经济|影视|频道/.test(g + name))
    group = '地方频道';
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
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    };
    if (range) headers.Range = 'bytes=0-2047';
    const res = await fetch(url, {
      headers,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const acao = res.headers.get('access-control-allow-origin');
    const corsOk =
      acao === '*' || (acao && acao.replace(/\/$/, '') === SITE_ORIGIN);
    let body = '';
    if (range) {
      try {
        await res.arrayBuffer();
      } catch {}
    } else {
      body = await res.text();
    }
    return { status: res.status, ok: res.ok, corsOk, body, finalUrl: res.url };
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
      for (const m of r.body.matchAll(/RESOLUTION=\d+x(\d+)/gi))
        height = Math.max(height, parseInt(m[1], 10));
      const variant = r.body
        .split(/\r?\n/)
        .find((l) => l.trim() && !l.startsWith('#'));
      if (!variant) return { state: 'blocked', reason: '空播放列表' };
      const vUrl = new URL(variant.trim(), base).toString();
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
    if (!height) {
      const hint = url.match(/(2160|1080|720|576|540|480)p?(?![0-9])/i);
      if (hint) height = parseInt(hint[1], 10);
    }
    return { state: 'ok', height };
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

function sortChannels(group, list) {
  if (group === '央视频道') {
    const n = (c) => {
      const m = c.name.match(/CCTV-(\d+)/);
      if (m) return parseInt(m[1], 10) + (c.name.includes('+') ? 0.5 : 0);
      return /4K|8K/.test(c.name) ? 50 : 100;
    };
    return list.sort(
      (a, b) => n(a) - n(b) || a.name.localeCompare(b.name, 'zh')
    );
  }
  if (group === '少儿频道') {
    const rank = (c) => (c.name === 'CCTV-14' ? 0 : c.hd ? 1 : 2);
    return list.sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-Hans-CN')
    );
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
    if (/youtube\.com|youtu\.be/i.test(original)) continue;
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
      b.ok.push({ url: r.url, height: r.height || r.ch.urls.get(r.url) || 0 });
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
    else if (r.state === 'unreachable' && meta.chinaVerified)
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
