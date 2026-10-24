#!/usr/bin/env node
/* eslint-disable */
// 每日自动换源：
//   1. 候选 = 当前 config.json + GitHub 上每日检测的公开源列表
//   2. 剔除成人源、依赖第三方中转代理的源
//   3. 实测搜索、m3u8 可播放性、插播广告情况
//   4. 写回 config.json（保留已有源的 key，避免播放记录/收藏失效）
// 用法：node scripts/update-sources.js [--dry-run]

const fs = require('fs');
const path = require('path');
const { filterM3U8Ads } = require('../src/lib/m3u8-adfilter');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const REPORT_PATH = path.join(ROOT, '.github', 'source-report.md');
const DRY_RUN = process.argv.includes('--dry-run');

const UPSTREAM_LISTS = [
  'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/LunaTV-config.json',
];
const TEST_QUERIES = ['庆余年', '流浪地球', '斗罗大陆'];
const TIMEOUT_MS = 12000;
const MIN_SOURCES = 6; // 可用源少于此数视为检测环境异常，不写入
const MAX_SOURCES = 25;

const ADULT_PATTERNS = [
  /🔞/, /成人/, /福利/, /伦理/, /黄/, /色/, /AV/i, /麻豆/, /番号/, /91/, /杏吧/,
  /奶/, /鸡/, /辣椒/, /桃花/, /黑料/, /精品资源/, /白嫖/, /乐播/, /玉兔/, /滴滴/,
  /豆豆/, /鲨鱼/, /大地资源/, /森林资源/, /souav/i, /jkun/i, /155/, /CK-?资源/i,
  /细胞/, /香蕉/, /老色/, /大奶/, /美少女/, /奥斯卡/,
];
// 不依赖他人的中转代理（不稳定、可能被篡改内容）
const PROXY_PATTERNS = [/[?&]url=https?:/i, /pz\.v88\.qzz\.io/i];

function hostOf(api) {
  try {
    return new URL(api).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}
function cleanName(name) {
  return String(name || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, '')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .trim();
}
function slugFromHost(host) {
  const parts = host.split('.');
  const main = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return main.replace(/[^a-z0-9]/g, '') || 'src';
}
function isAdult(name, api) {
  return ADULT_PATTERNS.some((re) => re.test(name || '')) || /(av|porn|sex|xxx)/i.test(hostOf(api) || '');
}

async function fetchText(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { text: await res.text(), url: res.url };
  } finally {
    clearTimeout(t);
  }
}

function firstM3u8(list) {
  for (const item of list) {
    const play = String(item.vod_play_url || '');
    const m = play.match(/https?:\/\/[^\s$#]+?\.m3u8[^\s$#]*/);
    if (m) return m[0];
  }
  return null;
}

async function probeAds(m3u8Url) {
  // 返回 { playable, removedBlocks, removedSeconds }
  try {
    let { text, url } = await fetchText(m3u8Url);
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variant = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
      if (!variant) return { playable: false };
      const next = new URL(variant.trim(), url).toString();
      ({ text } = await fetchText(next));
    }
    if (!text.includes('#EXTINF')) return { playable: false };
    const r = filterM3U8Ads(text);
    return { playable: true, removedBlocks: r.removedBlocks, removedSeconds: r.removedSeconds };
  } catch {
    return { playable: false };
  }
}

async function checkSource(src) {
  const result = { ...src, ok: false, hits: 0, latency: null, playable: false, adBlocks: 0, adSeconds: 0, error: null };
  const sep = src.api.includes('?') ? '&' : '?';
  let sample = null;
  const latencies = [];
  for (const q of TEST_QUERIES) {
    const url = `${src.api}${sep}ac=videolist&wd=${encodeURIComponent(q)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        const { text } = await fetchText(url);
        const data = JSON.parse(text);
        const list = Array.isArray(data.list) ? data.list : [];
        latencies.push(Date.now() - started);
        if (list.length) {
          result.hits++;
          if (!sample) sample = firstM3u8(list);
        }
        break;
      } catch (e) {
        result.error = String(e.message || e).slice(0, 80);
      }
    }
  }
  if (latencies.length) result.latency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  if (result.hits >= 2 && sample) {
    const p = await probeAds(sample);
    result.playable = p.playable;
    result.adBlocks = p.removedBlocks || 0;
    result.adSeconds = p.removedSeconds || 0;
  }
  result.ok = result.hits >= 2 && result.playable;
  if (result.ok) result.error = null;
  else if (!result.error) result.error = result.hits < 2 ? '搜索无结果' : '无可播放 m3u8';
  return result;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const current = config.api_site || {};

  // host -> 现有 key，保持 key 稳定
  const keyByHost = new Map();
  for (const [key, v] of Object.entries(current)) {
    const h = hostOf(v.api);
    if (h) keyByHost.set(h, key);
  }

  const candidates = new Map(); // host -> {key,name,api,detail,origin}
  const add = (key, v, origin) => {
    if (!v || !v.api) return;
    const name = cleanName(v.name);
    if (isAdult(v.name, v.api)) return;
    if (PROXY_PATTERNS.some((re) => re.test(v.api))) return;
    const h = hostOf(v.api);
    if (!h || candidates.has(h)) return;
    candidates.set(h, { key: keyByHost.get(h) || null, name: name || h, api: v.api, detail: v.detail, origin });
  };

  for (const [key, v] of Object.entries(current)) add(key, v, '现有');
  for (const url of UPSTREAM_LISTS) {
    try {
      const { text } = await fetchText(url, 20000);
      const data = JSON.parse(text);
      for (const [key, v] of Object.entries(data.api_site || {})) add(key, v, 'GitHub');
    } catch (e) {
      console.warn('获取上游列表失败:', url, e.message);
    }
  }

  const list = [...candidates.values()];
  console.log(`候选源 ${list.length} 个，开始检测…`);
  const results = await mapLimit(list, 8, checkSource);

  const good = results
    .filter((r) => r.ok)
    .sort((a, b) => a.adBlocks - b.adBlocks || (a.latency || 1e9) - (b.latency || 1e9))
    .slice(0, MAX_SOURCES);

  // 报告
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const rows = results
    .sort((a, b) => Number(b.ok) - Number(a.ok) || (a.latency || 1e9) - (b.latency || 1e9))
    .map(
      (r) =>
        `| ${r.ok ? (good.includes(r) ? '✅ 启用' : '⏸ 备用') : '❌'} | ${r.name} | ${r.origin} | ${r.hits}/${TEST_QUERIES.length} | ${r.latency ?? '-'} | ${r.adBlocks ? `${r.adBlocks} 段 / ${r.adSeconds}s（已可过滤）` : '-'} | ${r.error || ''} |`
    );
  const report =
    `# 资源站检测报告\n\n更新时间：${now}（北京时间）\n\n启用 ${good.length} 个 / 候选 ${results.length} 个。成人源与依赖第三方中转的源已在候选阶段剔除。\n\n` +
    `| 状态 | 名称 | 来源 | 搜索命中 | 平均延迟 ms | 抽检插播广告 | 备注 |\n|---|---|---|---|---|---|---|\n` +
    rows.join('\n') +
    '\n';

  if (good.length < MIN_SOURCES) {
    console.error(`可用源仅 ${good.length} 个，低于 ${MIN_SOURCES}，判定检测环境异常，不修改配置。`);
    if (!DRY_RUN) {
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, report);
    }
    process.exitCode = 0;
    return;
  }

  const usedKeys = new Set();
  const apiSite = {};
  for (const r of good) {
    let key = r.key || slugFromHost(hostOf(r.api));
    while (usedKeys.has(key)) key += '2';
    usedKeys.add(key);
    const entry = { api: r.api, name: r.name };
    if (r.detail) entry.detail = r.detail;
    apiSite[key] = entry;
  }

  const next = { ...config, api_site: apiSite };
  const before = JSON.stringify(config.api_site);
  const after = JSON.stringify(apiSite);
  console.log(`启用 ${good.length} 个源：${good.map((g) => g.name).join('、')}`);

  if (DRY_RUN) {
    console.log(report);
    return;
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report);
  if (before !== after) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log('config.json 已更新');
  } else {
    console.log('源列表无变化');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
