import { posterCandidates, sharpenDouban } from './poster';

describe('posterCandidates', () => {
  test('豆瓣封面：先直连清晰版，再换子域、本站代理、镜像，最后原规格', () => {
    const c = posterCandidates('https://img2.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg');
    expect(c[0]).toBe('https://img2.doubanio.com/view/photo/m_ratio_poster/public/p1.jpg');
    expect(c).toContain('https://img9.doubanio.com/view/photo/m_ratio_poster/public/p1.jpg');
    expect(c.some((u) => u.startsWith('/api/image-proxy?url='))).toBe(true);
    expect(c.some((u) => u.startsWith('https://img.doubanio.cmliussss.net/'))).toBe(true);
    expect(c[c.length - 1]).toBe('https://img2.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg');
    expect(new Set(c).size).toBe(c.length);
  });

  test('详情页用 l 规格', () => {
    expect(sharpenDouban('https://img1.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg', 'large')).toContain('/l_ratio_poster/');
  });

  test('http 资源站封面先升级 https，再走本站代理', () => {
    const c = posterCandidates('http://pic.example.com/a.jpg');
    expect(c[0]).toBe('https://pic.example.com/a.jpg');
    expect(c[1]).toBe('/api/image-proxy?url=' + encodeURIComponent('http://pic.example.com/a.jpg'));
  });

  test('用户自定义图片代理优先', () => {
    const c = posterCandidates('https://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg', 'card', (u) => 'https://my.proxy/?u=' + u);
    expect(c[0].startsWith('https://my.proxy/')).toBe(true);
  });

  test('空值', () => {
    expect(posterCandidates('')).toEqual([]);
  });
});
