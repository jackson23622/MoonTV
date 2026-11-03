// 图片占位符：骨架屏微光（颜色取自 globals.css 的 --skeleton-* 变量，随深浅色切换）
const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <div
    className={`w-full ${aspectRatio} rounded-xl`}
    style={{
      background:
        'linear-gradient(90deg, var(--skeleton-color) 25%, var(--skeleton-highlight) 50%, var(--skeleton-color) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shine 1.6s ease-in-out infinite',
    }}
  />
);

export { ImagePlaceholder };
