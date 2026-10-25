/* eslint-disable */
// 直播频道的台标与节目单：
//   台标 —— 来自 fanmingming/live 台标库（tv/*.png），只下载本站收录频道用到的那些，存到 public/tv/logos/
//   节目单 —— 来自 fanmingming/live 的 e.xml（XMLTV，每 2 小时更新），抽取本站频道前后约两天的节目，
//            生成 public/live/epg.json（几百 KB 的静态文件，网页直接读，不占边缘函数 CPU）
const fs = require('fs');
const path = require('path');
const { matchKey, matchCandidates } = require('../src/lib/channel-rules');

// 你自己的 fork 优先（定时同步、不受上游停更影响），上游镜像兜底
const LOGO_REPOS = ['jackson23622/live', 'fanmingming/live'];
const EPG_URLS = [
  'https://raw.githubusercontent.com/jackson23622/live/main/e.xml',
  'https://live.fanmingming.cn/e.xml',
  'https://raw.githubusercontent.com/fanmingming/live/main/e.xml',
];
const EPG_BEFORE_SEC = 6 * 3600; // 保留 6 小时前开始的节目（正在播的长节目）
const EPG_AFTER_SEC = 48 * 3600; // 保留未来 48 小时（检测每 6 小时一次，留足余量）

// ---------- 台标 ----------

/** 台标库文件名 → 按频道 key 建索引（同 key 优先 png） */
function buildLogoIndex(fileNames) {
  const index = new Map();
  for (const file of fileNames) {
    const m = file.match(/^(.+)\.(png|jpe?g|webp)$/i);
    if (!m) continue;
    // 拼音命名（guangdong.png 等）与中文命名重复，只认中文 / 台标式命名
    if (/^[a-z][a-z0-9_]*$/.test(m[1])) continue;
    const key = matchKey(m[1]);
    const prev = index.get(key);
    if (!prev || (!/\.png$/i.test(prev) && /\.png$/i.test(file)))
      index.set(key, file);
  }
  return index;
}

function findLogo(index, name) {
  for (const k of matchCandidates(name)) if (index.has(k)) return index.get(k);
  return null;
}

async function listLogoFiles() {
  for (const repo of LOGO_REPOS) {
    try {
      const api = `https://api.github.com/repos/${repo}/git/trees/main?recursive=1`;
      const headers = { 'User-Agent': 'moontv-live-updater' };
      if (process.env.GITHUB_TOKEN)
        headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
      let res = await fetch(api, {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 401 || res.status === 403) {
        // token 不适用于该仓库时匿名重试（公开仓库，每小时 60 次额度足够）
        delete headers.Authorization;
        res = await fetch(api, { headers, signal: AbortSignal.timeout(30000) });
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const tree = (await res.json()).tree || [];
      const files = tree
        .filter((t) => t.type === 'blob' && /^tv\/[^/]+$/.test(t.path))
        .map((t) => t.path.slice(3));
      if (files.length) return { repo, files };
    } catch (e) {
      console.warn(`台标库 ${repo} 读取失败：${e.message}`);
    }
    // API 不可用时：git 部分克隆，只取目录树、不下载文件内容
    try {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'logos-'));
      const { execFileSync } = require('child_process');
      execFileSync(
        'git',
        [
          'clone',
          '--depth=1',
          '--filter=blob:none',
          '--no-checkout',
          '-q',
          `https://github.com/${repo}.git`,
          dir,
        ],
        { stdio: 'ignore', timeout: 120000 }
      );
      const files = execFileSync(
        'git',
        [
          '-C',
          dir,
          '-c',
          'core.quotepath=off',
          'ls-tree',
          '--name-only',
          'HEAD',
          'tv/',
        ],
        { encoding: 'utf8' }
      )
        .split('\n')
        .filter((p) => /^tv\/[^/]+\.\w+$/.test(p))
        .map((p) => p.slice(3));
      fs.rmSync(dir, { recursive: true, force: true });
      if (files.length) return { repo, files };
    } catch (e) {
      console.warn(`台标库 ${repo} git 读取失败：${e.message}`);
    }
  }
  return { repo: null, files: [] };
}

/**
 * 为频道配台标：已下载过的直接复用；缺的从台标库下载。返回 Map<频道名, 站内路径>
 * 台标放在 /tv/logos/：电视客户端无法登录，/tv/ 不经过登录校验
 */
async function syncLogos(names, logoDir) {
  const result = new Map();
  const { repo, files } = await listLogoFiles();
  if (!repo) return result;
  const index = buildLogoIndex(files);
  fs.mkdirSync(logoDir, { recursive: true });
  let downloaded = 0;
  for (const name of names) {
    const file = findLogo(index, name);
    if (!file) continue;
    // 本地文件名用哈希（纯 ASCII），避免中文路径在各环境下的编码差异
    const ext = (file.match(/\.(\w+)$/) || [, 'png'])[1].toLowerCase();
    const localName =
      require('crypto')
        .createHash('sha1')
        .update(file)
        .digest('hex')
        .slice(0, 12) +
      '.' +
      ext;
    const local = path.join(logoDir, localName);
    if (!fs.existsSync(local)) {
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${repo}/main/tv/${encodeURIComponent(
            file
          )}`,
          { signal: AbortSignal.timeout(20000) }
        );
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100 || buf.length > 512 * 1024) continue;
        fs.writeFileSync(local, buf);
        downloaded++;
      } catch {
        continue;
      }
    }
    result.set(name, '/tv/logos/' + localName);
  }
  console.log(
    `台标：${result.size}/${names.length} 个频道有台标（新下载 ${downloaded} 个，来自 ${repo}）`
  );
  return result;
}

// ---------- 节目单 ----------

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&')
    .trim();
}

/** XMLTV 时间「20261020114900 +0800」→ Unix 秒 */
function parseXmltvTime(t) {
  const m = String(t || '').match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/
  );
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s = '00', tz = '+0800'] = m;
  const off =
    (tz[0] === '-' ? -1 : 1) *
    (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10));
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) / 1000 - off * 60;
}

/**
 * 从 XMLTV 抽取指定频道的节目。
 * names：本站频道名；返回 { 频道名: [[开始秒, 结束秒, 标题], ...] }（按开始时间排序、去重叠）
 */
function extractEpg(xml, names, nowSec) {
  const from = nowSec - EPG_BEFORE_SEC;
  const to = nowSec + EPG_AFTER_SEC;
  // 1) 节目单里的频道：key（由 id 与 display-name 得出）→ id
  const keyToId = new Map();
  const addKey = (k, id) => k && !keyToId.has(k) && keyToId.set(k, id);
  const chRe = /<channel\s+id="([^"]*)"\s*>([\s\S]*?)<\/channel>/g;
  let m;
  while ((m = chRe.exec(xml))) {
    const id = decodeXml(m[1]);
    addKey(matchKey(id), id);
    const dnRe = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
    let d;
    while ((d = dnRe.exec(m[2]))) addKey(matchKey(decodeXml(d[1])), id);
  }
  // 没有 <channel> 声明、只在 <programme channel="…"> 里出现的频道
  const attrRe = /<programme\b[^>]*?\bchannel="([^"]*)"/g;
  while ((m = attrRe.exec(xml))) {
    const id = decodeXml(m[1]);
    addKey(matchKey(id), id);
  }
  // 2) 每个本站频道取第一个命中的候选（正名优先，别名 / 回退在后），一个节目单频道可供多个本站频道使用
  const idToNames = new Map();
  for (const name of names) {
    const hit = matchCandidates(name).find((k) => keyToId.has(k));
    if (!hit) continue;
    const id = keyToId.get(hit);
    if (!idToNames.has(id)) idToNames.set(id, []);
    idToNames.get(id).push(name);
  }

  const out = {};
  const prRe = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
  while ((m = prRe.exec(xml))) {
    const attrs = m[1];
    const id = decodeXml((attrs.match(/channel="([^"]*)"/) || [])[1] || '');
    const targets = idToNames.get(id);
    if (!targets) continue;
    const start = parseXmltvTime((attrs.match(/start="([^"]*)"/) || [])[1]);
    const stop = parseXmltvTime((attrs.match(/stop="([^"]*)"/) || [])[1]);
    if (!(start < stop) || stop < from || start > to) continue;
    const title = decodeXml(
      (m[2].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || ''
    );
    if (!title) continue;
    for (const name of targets)
      (out[name] = out[name] || []).push([start, stop, title]);
  }
  // 排序、去掉重叠（同一时间段节目单偶有重复条目）
  for (const name of Object.keys(out)) {
    const list = out[name].sort((a, b) => a[0] - b[0]);
    const clean = [];
    for (const p of list) {
      const last = clean[clean.length - 1];
      if (last && p[0] < last[1]) {
        if (p[0] === last[0]) continue;
        last[1] = p[0];
      }
      clean.push(p);
    }
    out[name] = clean;
  }
  return out;
}

async function buildEpg(names, nowSec = Math.floor(Date.now() / 1000)) {
  for (const url of EPG_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const xml = await res.text();
      if (!xml.includes('<programme')) throw new Error('不是 XMLTV');
      const ch = extractEpg(xml, names, nowSec);
      const n = Object.keys(ch).length;
      console.log(`节目单：${n}/${names.length} 个频道有节目（${url}）`);
      if (n) return { url, ch };
    } catch (e) {
      console.warn(`节目单 ${url} 获取失败：${e.message}`);
    }
  }
  return { url: null, ch: {} };
}

module.exports = {
  buildLogoIndex,
  findLogo,
  syncLogos,
  parseXmltvTime,
  extractEpg,
  buildEpg,
};
