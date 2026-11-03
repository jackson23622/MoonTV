/* eslint-disable */
// 线路「台名与内容是否对应」的判别：
//   1. 地址里常带有台标识（cctv5、hunanws、cetv1…），与频道名矛盾的线路是贴错台名的
//   2. 同一地址在不同仓库里挂在不同台名下：能从地址认出是哪个台的只留给那个台，认不出的全部丢弃
//   3. 占位画面（暂无信号、维护中）的分片地址
// 纯 JS、无依赖。
const { matchKey } = require('./channel-rules');

const WS_PINYIN = {
  hunan: '湖南',
  zhejiang: '浙江',
  jiangsu: '江苏',
  dongfang: '东方',
  beijing: '北京',
  tianjin: '天津',
  shandong: '山东',
  guangdong: '广东',
  shenzhen: '深圳',
  anhui: '安徽',
  hubei: '湖北',
  henan: '河南',
  hebei: '河北',
  jiangxi: '江西',
  sichuan: '四川',
  chongqing: '重庆',
  yunnan: '云南',
  guizhou: '贵州',
  guangxi: '广西',
  hainan: '海南',
  dongnan: '东南',
  fujian: '东南',
  liaoning: '辽宁',
  jilin: '吉林',
  heilongjiang: '黑龙江',
  neimenggu: '内蒙古',
  ningxia: '宁夏',
  qinghai: '青海',
  xinjiang: '新疆',
  xizang: '西藏',
  gansu: '甘肃',
  xiamen: '厦门',
  shanxi: '山西',
  shaanxi: '陕西',
  shan3xi: '陕西',
  bingtuan: '兵团',
};
const WS_RE = new RegExp(
  `(?:^|[^a-z])(${Object.keys(WS_PINYIN).join(
    '|'
  )})[-_]?(?:ws|weishi|stv|satellite)(?![a-z])`,
  'g'
);
// 台号后允许跟清晰度 / 编码后缀（cctv1hd、cctv5phd、cctv13h265）
const CCTV_RE =
  /(?:^|[^a-z0-9])cctv[-_]?(4k|8k|\d{1,2})(\+|plus|p)?(?![0-9])(?=$|[^a-z]|f?hd|uhd|sd|h26[45]|hevc)/g;
const CETV_RE = /(?:^|[^a-z0-9])cetv[-_]?(\d)(?![0-9])/g;
const PLACEHOLDER_RE =
  /(?:^|[^a-z])(no_?signal|offline|unavailable|maintain|maintenance|weihu|tingbo|blank|placeholder)(?![a-z])/i;

/** 只看路径和参数（域名里常带省份 / cctv 字样，与具体频道无关） */
function urlTail(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname + u.search).toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

function uniq(matches) {
  return Array.from(new Set(matches));
}

/** 从地址里认出的台标识：{ cctv: 'CCTV5+' | null, ws: '湖南' | null }；同一地址出现多个不同标识时视为认不出 */
function urlIdentity(url) {
  const tail = urlTail(url);
  const cctv = uniq(
    Array.from(tail.matchAll(CCTV_RE)).map(
      (m) => 'CCTV' + m[1].toUpperCase() + (m[2] ? '+' : '')
    )
  );
  const cetv = uniq(
    Array.from(tail.matchAll(CETV_RE)).map((m) => 'CETV' + m[1])
  );
  const ws = uniq(Array.from(tail.matchAll(WS_RE)).map((m) => WS_PINYIN[m[1]]));
  const ids = [...cctv, ...cetv];
  return {
    cctv: ids.length === 1 ? ids[0] : null,
    ws: ws.length === 1 ? ws[0] : null,
    ambiguous: ids.length > 1 || ws.length > 1,
  };
}

/** 频道自身的标识 */
function channelIdentity(name) {
  const k = matchKey(name);
  if (/^(CCTV(\d{1,2}|4K|8K)\+?|CETV\d)$/.test(k)) return { cctv: k, ws: null };
  const ws = String(name).match(/^(.+?)卫视/);
  if (ws && !/香港|凤凰|澳|星空|华娱/.test(ws[1]))
    return { cctv: null, ws: ws[1] };
  return { cctv: null, ws: null };
}

/** 线路地址与频道名矛盾时返回原因，否则 null */
function identityConflict(name, url) {
  const ch = channelIdentity(name);
  if (!ch.cctv && !ch.ws) return null; // 地方台等命名多样，不做判断
  const u = urlIdentity(url);
  if (ch.cctv) {
    if (u.cctv && u.cctv !== ch.cctv) return '台名与地址不符';
    if (u.ws) return '台名与地址不符';
  } else {
    // 「山东教育卫视」这类以省名开头的卫视，地址里的 shandongws 不算矛盾
    if (u.ws && !ch.ws.startsWith(u.ws)) return '台名与地址不符';
    if (u.cctv) return '台名与地址不符';
  }
  return null;
}

/** 地址能确认属于这个频道（用于多个台名共用一个地址时裁决） */
function identityConfirms(name, url) {
  const ch = channelIdentity(name);
  const u = urlIdentity(url);
  return (!!ch.cctv && u.cctv === ch.cctv) || (!!ch.ws && u.ws === ch.ws);
}

function isPlaceholderUrl(url) {
  return PLACEHOLDER_RE.test(urlTail(url));
}

/** 比较线路是否同一条流：去掉协议，保留路径与参数 */
function streamKey(url) {
  return String(url || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/#.*$/, '');
}

module.exports = {
  urlIdentity,
  channelIdentity,
  identityConflict,
  identityConfirms,
  isPlaceholderUrl,
  streamKey,
};
