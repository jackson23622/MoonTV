/* eslint-disable */
// 直播频道剔除 / 归类规则（唯一来源）
// 使用方：scripts/update-live.js（生成电视订阅）、/tv/filter.m3u（清洗任意订阅供电视客户端使用）。
// 规则：只保留中文正规电视台；剔除外语台、宗教台、平台转播、循环台、解说台、景区镜头等。
// 纯 JS、无依赖，可在 Node、浏览器与边缘函数中直接使用。
const GROUP_ORDER = [
  '央视频道',
  '卫视频道',
  'NewTV',
  'iHOT',
  'SiTV',
  '少儿频道',
  '港澳台',
  '地方频道',
  '体育频道',
  '电影频道',
  '纪录频道',
  '其他频道',
];
const HD_HEIGHT = 720;
// 直播平台（虎牙、斗鱼等）二次解析服务：不稳定，且失效后常被劫持跳转到广告站，一律不收
const RESTREAM_RE =
  /\/(huya|douyu|bilibili|youku|iqiyi|yy|kuaishou|douyin)(\/|\.php|\?)|(huya|douyu|bilibili)\.php|live\.iill\.top|live\.metshop\.top|jdshipin\.com/i;
// 境外无法验证时，只放行直接指向视频流文件的地址（不放行会跳转的脚本地址）
const DIRECT_STREAM_RE = /\.(m3u8|flv|ts|mp4)(\?|#|$)/i;

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
          curated: !!source.curated,
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
  /韩国|韓國|日本|朝鲜|朝鮮|英语|英語|英文|外语|外語|法语|西语|阿语|俄语|EBS|KBS|NHK|Arirang|English|Korea|Japan|Bloomberg|CNN|BBC|Discovery|Cartoon ?Network|Cartoonito|BabyFirst|ZooMoo|KIX|Thrill|Celestial|Beautiful Life|Taiwan ?Plus|VOA|美国之音|美國之音|RFA|自由亚洲/i;
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

// ---------- \u53f0\u6807 / \u8282\u76ee\u5355\u5339\u914d ----------
// \u628a\u5404\u5904\u7684\u9891\u9053\u5199\u6cd5\u7edf\u4e00\u6210\u540c\u4e00\u4e2a key\uff1a\u300cCCTV-5+ \u4f53\u80b2\u8d5b\u4e8b\u300d\u300cCCTV5+\u300d\u2192 CCTV5+\uff0c\u300c\u6e56\u5357\u536b\u89c6\u300d\u2192 \u6e56\u5357\u536b\u89c6
function matchKey(name) {
  let s = toSimp(String(name || ''))
    .replace(/\s+/g, '')
    .toUpperCase();
  const cctv = s.match(/^CCTV-?(4K|8K|\d{1,2})(\+)?/);
  if (cctv) return 'CCTV' + cctv[1] + (cctv[2] || '');
  const cetv = s.match(/^(?:CETV|\u4e2d\u56fd\u6559\u80b2)-?(\d)(?:\u53f0)?/);
  if (cetv) return 'CETV' + cetv[1];
  return s.replace(/[-_\u00b7]/g, '').replace(/(\u9891\u9053|\u53f0)$/, '');
}
// \u8282\u76ee\u5355 / \u53f0\u6807\u5e93\u91cc\u7684\u53eb\u6cd5\u4e0e\u672c\u7ad9\u6807\u51c6\u540d\u4e0d\u4e00\u81f4\u65f6\u7684\u522b\u540d\uff08\u672c\u7ad9 key \u2192 \u5019\u9009 key\uff09
const MATCH_ALIAS = {
  卡酷少儿: [
    '\u5361\u9177\u52a8\u753b',
    '\u5317\u4eac\u5361\u9177\u5c11\u513f',
  ],
  北京卫视: ['BRTV\u5317\u4eac\u536b\u89c6'],
  东方卫视: ['\u4e0a\u6d77\u4e1c\u65b9\u536b\u89c6'],
  CCTV5: ['CCTV5\u4f53\u80b2'],
  凤凰香港: ['\u51e4\u51f0\u536b\u89c6\u9999\u6e2f\u53f0'],
  凤凰中文: ['\u51e4\u51f0\u536b\u89c6\u4e2d\u6587\u53f0'],
  凤凰资讯: ['\u51e4\u51f0\u536b\u89c6\u8d44\u8baf\u53f0'],
  浙江之江纪录: ['\u4e4b\u6c5f\u7eaa\u5f55'],
  浙江钱江都市: ['\u94b1\u6c5f\u90fd\u5e02'],
  浙江经济: ['\u6d59\u6c5f\u7ecf\u6d4e\u751f\u6d3b'],
  浙江民生: ['\u6d59\u6c5f\u6c11\u751f\u4f11\u95f2'],
  浙江教科: ['\u6d59\u6c5f\u6559\u79d1\u5f71\u89c6'],
  CHC电影: ['CHC\u9ad8\u6e05\u7535\u5f71'],
};
function matchCandidates(name) {
  const k = matchKey(name);
  const out = [k, ...(MATCH_ALIAS[k] || []).map(matchKey)];
  // CCTV \u6570\u5b57\u4ed8\u8d39\u9891\u9053\uff1a\u53f0\u6807\u5e93 / \u8282\u76ee\u5355\u5e38\u4e0d\u5e26 CCTV \u524d\u7f00\uff08\u300c\u98ce\u4e91\u5267\u573a\u300d\u300c\u592e\u89c6\u53f0\u7403\u300d\u300c\u6587\u5316\u7cbe\u54c1\u300d\uff09
  if (/^CCTV\D/.test(k)) {
    const rest = k.slice(4);
    out.push(rest, rest.replace(/^\u592e\u89c6/, ''));
  }
  // \u300c\u4e1c\u65b9\u536b\u89c64K\u300d\u7b49\u8d85\u9ad8\u6e05\u7248\u672c\uff1a\u6ca1\u6709\u4e13\u5c5e\u53f0\u6807 / \u8282\u76ee\u5355\u65f6\u6cbf\u7528\u666e\u901a\u7248
  const plain = k.replace(/(4K|8K|\u8d85\u9ad8\u6e05)$/, '');
  if (plain !== k && plain && !/^CCTV\d*$/.test(plain)) out.push(plain);
  return Array.from(new Set(out.filter(Boolean)));
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
  /TVB|翡翠台|明珠台|无线新闻|無線新聞|凤凰|鳳凰|澳视|澳視|中天|TVBS|三立|台视|台視|中视|中視|华视|華視|民视|民視|东森|東森|寰宇|ViuTV|有线新闻|香港卫视|香港電台|RTHK|港台电视|港台電視|八大|纬来|緯來|公视|公視|原住民|番薯|美亚|美亞|龙华|龍華|AMC|年代|壹电视|壹電視|非凡|HOY|ViuTV|澳门|澳門/i;

// ---------- 只保留正规电视台 ----------
// 平台转播、循环台、解说台、测试台
const NON_STATION_RE =
  /^(虎牙|斗鱼|B站|咪咕|埋堆堆|快手|抖音|YY|西瓜|爱奇艺|优酷|腾讯)|解说|轮播|輪播|循环|合集|系列|专场|测试|測試|其他$|[\u{1D7D8}-\u{1D7E1}]/u;
// 正规少儿台
const KIDS_STATION_RE =
  /少儿|少兒|儿童|兒童|^(金鹰卡通|卡酷少儿|优漫卡通|嘉佳卡通|炫动卡通|哈哈炫动|CCTV-14)$/;
// 电视台的命名方式（地方台、专业频道）
const STATION_RE =
  /^(CCTV|CETV|CHC)|教科|竞赛|競賽|党建|黨建|梨园|梨園|移民|影院|4K$|卫视|衛視|电视台|電視台|新闻|新聞|综合|綜合|公共|都市|经济|經濟|生活|影视|影視|文旅|旅游|教育|科教|农业|農業|农村|乡村|法治|法制|民生|文体|文艺|文化|娱乐|娛樂|财经|財經|纪实|紀實|纪录|紀錄|购物|購物|体育|體育|休闲|资讯|資訊|导视|城市|国际|综艺|戏曲|戲曲|频道|頻道|一套|二套|三套|[0-9一二三四五六七八九]台|台$|电视$/;

function isStation(name, group) {
  if (NON_STATION_RE.test(name)) return false;
  if (group === '央视频道' || group === '卫视频道') return true;
  if (group === '少儿频道') return KIDS_STATION_RE.test(name);
  if (group === '港澳台') return HKTW_RE.test(name);
  return STATION_RE.test(name);
}

// ---------- 精选：地方台只留省级台和大城市台 ----------
// 完整保留的分组（央视、卫视、少儿、港澳台）
const CORE_GROUPS = ['央视频道', '卫视频道', '少儿频道', '港澳台'];
// 省级行政区 + 省会 / 计划单列市 / 一线城市
const MAJOR_REGION_RE =
  /^(北京|天津|上海|重庆|河北|山西|内蒙古|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆|广州|深圳|杭州|南京|苏州|武汉|成都|西安|厦门|青岛|宁波|大连|长沙|郑州|济南|哈尔滨|长春|沈阳|福州|昆明|南宁|合肥|南昌|石家庄|太原|兰州|西宁|银川|乌鲁木齐|呼和浩特|贵阳|海口|拉萨|东莞|佛山)/;
// 省级台的品牌名（不带地名开头）
const MAJOR_BRAND_RE =
  /^(中国蓝|第一财经|东方|五星体育|南国都市|4K南国都市|之江纪录|CHC|CETV|梨园|BRTV|SITV|纪实人文)/;
// 购物、导视、党建等不适合观看的频道
const LOW_VALUE_RE = /购物|購物|导视|導視|党建|黨建|图文|圖文|置业|测试/;

function isFeatured(name, group) {
  if (CORE_GROUPS.includes(group)) return true;
  if (LOW_VALUE_RE.test(name)) return false;
  const n = toSimp(name).replace(/\s/g, '');
  // 「吉林市…」「广东Ⅰ韶关…」「杭州余杭…」这类是地级市 / 区县台
  if (/^吉林市|Ⅰ|Ⅱ|^杭州(余杭|萧山|临平)/.test(n)) return false;
  return MAJOR_REGION_RE.test(n) || MAJOR_BRAND_RE.test(n);
}

// jackson23622/live 的数据：保留全部中文频道，分组沿用该仓库的分组
function curatedGroup(group) {
  const g = group || '';
  if (/央视/.test(g)) return '央视频道';
  if (/卫视/.test(g)) return '卫视频道';
  if (/^NewTV$/i.test(g)) return 'NewTV';
  if (/^iHOT$/i.test(g)) return 'iHOT';
  if (/^SiTV$/i.test(g)) return 'SiTV';
  if (/地方|频道$/.test(g)) return '地方频道';
  return '其他频道';
}
function normalizeCurated(item) {
  const n = normalizeRaw(item); // 统一台名、剔除外语台
  if (!n) return null;
  const cetv = n.name.match(/^CETV-?(\d)/i);
  if (cetv) {
    n.name = `中国教育${cetv[1]}台`;
    n.key = toSimp(n.name)
      .toUpperCase()
      .replace(/(频道|台)$/, '');
    n.group = '卫视频道';
    return n;
  }
  n.group = /^CCTV/.test(n.name) ? '央视频道' : curatedGroup(item.group);
  return n;
}

function normalize(item) {
  if (item.curated) return normalizeCurated(item);
  const n = normalizeRaw(item);
  if (!n) return null;
  if (n.group === '直播中国') return null; // 景区镜头，不是电视频道
  if (!isStation(n.name, n.group)) return null;
  // CCTV 数字付费频道（风云剧场、兵器科技等）归入央视
  if (/^CCTV/.test(n.name) && n.group !== '少儿频道') n.group = '央视频道';
  if (!isFeatured(n.name, n.group)) return null;
  // 合并同一频道的不同写法：「广州电视台新闻」=「广州新闻」，「之江纪录」=「浙江之江纪录」
  const merged = n.name
    .replace(/^(广州|深圳|杭州|南京|苏州|武汉|成都|哈尔滨|长春)电视台/, '$1')
    .replace(/^之江纪录$/, '浙江之江纪录');
  if (merged !== n.name) {
    n.name = merged;
    n.key = toSimp(merged)
      .replace(/[\s\-_·]/g, '')
      .toUpperCase()
      .replace(/(频道|台)$/, '');
  }
  return n;
}

function normalizeRaw(item) {
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
  // 帧率 / 编码标注（「CCTV2 50 FPS」「安徽卫视 50 FPS」）是同一频道，先去掉，避免台号被读成 25
  raw = raw
    .replace(/\s*\d{2,3}\s*FPS\b/gi, '')
    .replace(/\s*(HEVC|H\.?26[45])\b/gi, '')
    .trim();
  // 「CTi Variety (中天綜合台)」这类英文名带中文括注：用中文名
  const zhInParen = raw.match(
    /[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[)）]/
  );
  if (zhInParen && !/[\u4e00-\u9fff]/.test(raw.replace(zhInParen[0], '')))
    raw = zhInParen[1];
  if (RELIGION_RE.test(raw) || RELIGION_RE.test(item.tvgName || ''))
    return null;
  if (FOREIGN_RE.test(raw)) return null;
  // 以语种命名的外语 / 非汉语频道（如「塞尔维亚语」「德语」「长白朝语」）
  if (
    /(塞尔维亚|德|法|英|俄|西班牙|西|阿拉伯|阿|葡萄牙|日|韩|朝|朝鲜|哈萨克|维吾尔|维|藏|蒙|柯尔克孜|越南|泰|印尼|意大利)(语|語)/.test(
      raw
    )
  )
    return null;
  // CGTN 外语台（含拼错的「CGNT」及以台址识别）
  if (
    /^CG(TN|NT)/i.test(raw.replace(/\s/g, '')) ||
    /cgtn\.com/i.test(item.url || '')
  )
    return null;

  const compact = raw.replace(/\s/g, '');
  const cctv = compact.match(/^CCTV-?(4K|8K|\d{1,2})(\+)?/i);
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

/** 对一个频道条目（name / tvgName / group / url）给出归类；不收录则返回 null */
function classifyChannel(item) {
  if (
    item.url &&
    (RESTREAM_RE.test(item.url) || /youtube\.com|youtu\.be/i.test(item.url))
  )
    return null;
  return normalize(item);
}

module.exports = {
  CORE_GROUPS,
  isFeatured,
  GROUP_ORDER,
  HD_HEIGHT,
  RESTREAM_RE,
  DIRECT_STREAM_RE,
  parseM3U,
  cleanName,
  toSimp,
  normalize,
  classifyChannel,
  isStation,
  sortChannels,
  matchKey,
  matchCandidates,
};
