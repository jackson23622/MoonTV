import {
  buildPhotosUrl,
  isValidDoubanId,
  pickBackdrop,
} from './douban.backdrop';

const img = (url: string, width: number, height: number) => ({
  image: { large: { url, width, height } },
});

describe('pickBackdrop', () => {
  it('跳过竖版海报，取第一张足够清晰的横图', () => {
    expect(
      pickBackdrop({
        photos: [
          img('http://img/poster.jpg', 1000, 1500),
          img('http://img/small.jpg', 800, 450),
          img('http://img/still.jpg', 1920, 800),
          img('http://img/still2.jpg', 2000, 1000),
        ],
      })
    ).toEqual({ url: 'https://img/still.jpg', width: 1920, height: 800 });
  });

  it('都不够清晰时取最宽的横图；太小或没有横图返回 null', () => {
    expect(
      pickBackdrop({
        photos: [
          img('https://a/1.jpg', 700, 400),
          img('https://a/2.jpg', 900, 500),
        ],
      })?.url
    ).toBe('https://a/2.jpg');
    expect(
      pickBackdrop({ photos: [img('https://a/1.jpg', 500, 300)] })
    ).toBeNull();
    expect(
      pickBackdrop({ photos: [img('https://a/p.jpg', 1000, 1400)] })
    ).toBeNull();
    expect(pickBackdrop({})).toBeNull();
    expect(pickBackdrop(null)).toBeNull();
    expect(pickBackdrop({ photos: [null, { image: {} }] })).toBeNull();
  });
});

describe('buildPhotosUrl / isValidDoubanId', () => {
  it('拼接地址并校验 id', () => {
    expect(buildPhotosUrl('tv', '35588177')).toBe(
      'https://m.douban.com/rexxar/api/v2/tv/35588177/photos?start=0&count=12'
    );
    expect(isValidDoubanId('35588177')).toBe(true);
    expect(isValidDoubanId('../x')).toBe(false);
    expect(isValidDoubanId('')).toBe(false);
  });
});
