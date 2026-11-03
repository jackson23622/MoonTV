/* eslint-disable */
// 电视订阅的台标：来自台标库（tv/*.png），只下载本站收录频道用到的那些，存到 public/tv/logos/
const fs = require('fs');
const path = require('path');
const { matchKey, matchCandidates } = require('../src/lib/channel-rules');

// 你自己的 fork 优先（定时同步、不受上游停更影响），上游镜像兜底
const LOGO_REPOS = ['jackson23622/live'];
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

module.exports = {
  buildLogoIndex,
  findLogo,
  syncLogos,
};
