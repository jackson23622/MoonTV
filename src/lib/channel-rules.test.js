/* eslint-disable */
const { classifyChannel } = require('./channel-rules');

const c = (name, extra = {}) =>
  classifyChannel({
    name,
    group: '',
    url: 'http://example.com/live.m3u8',
    ...extra,
  });

describe('频道剔除规则', () => {
  test.each([
    ['CCTV-1', '央视频道'],
    ['CCTV-风云足球', '央视频道'],
    ['湖南卫视', '卫视频道'],
    ['金鹰卡通', '少儿频道'],
    ['浙江少儿', '少儿频道'],
    ['TVBS新聞台', '港澳台'],
    ['东森新闻', '港澳台'],
    ['TVB翡翠台', '港澳台'],
    ['广州新闻综合', '地方频道'],
  ])('保留正规台：%s → %s', (name, group) => {
    expect(c(name)?.group).toBe(group);
  });

  test.each([
    ['CGTN英语'],
    ['塞尔维亚语'],
    ['VOA美国之音'],
    ['Bloomberg TV Asia'],
    ['GOOD TV CH1 綜合台'],
    ['大愛1'],
    ['人间卫视'],
    ['周星驰电影'],
    ['亮剑'],
    ['海绵宝宝'],
    ['虎牙王者荣耀 𝟙'],
    ['咪咕直播 𝟙𝟘'],
    ['电影•3解说'],
    ['测试视频 7.1.4 12声道'],
  ])('剔除：%s', (name) => {
    expect(c(name)).toBeNull();
  });

  test('剔除景区镜头与平台解析地址', () => {
    expect(c('安徽黄山飞来石', { group: '直播中国' })).toBeNull();
    expect(
      c('哆啦A梦', { url: 'https://live.iill.top/huya/11601963' })
    ).toBeNull();
  });

  test('地方台只留省级台和大城市台', () => {
    expect(c('浙江新闻')?.group).toBe('地方频道');
    expect(c('苏州新闻综合')?.group).toBe('地方频道');
    expect(c('北京纪实')).not.toBeNull();
    expect(c('中国蓝新闻')).not.toBeNull();
    for (const n of [
      '苍南新闻综合',
      '嵊州综合',
      '吉林市新闻综合',
      '广东 Ⅰ 韶关综合台',
      '杭州余杭综合',
      '西安乐购购物',
      '安徽导视',
      '句容党建',
    ])
      expect(c(n)).toBeNull();
  });

  test('同一频道不同写法合并', () => {
    expect(c('广州电视台新闻')?.key).toBe(c('广州新闻')?.key);
    expect(c('之江纪录')?.name).toBe('浙江之江纪录');
  });

  test('英文名映射为中文名', () => {
    expect(c('EBC News (東森新聞台) (1080p)')?.name).toBe('東森新聞台');
    expect(c('Golden Eagle Cartoon (576p)')?.name).toBe('金鹰卡通');
    expect(c('Hunan TV')?.name).toBe('湖南卫视');
  });
});
