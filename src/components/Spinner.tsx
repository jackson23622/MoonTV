/** Apple 风格的活动指示器（8 根辐条依次变暗） */
export default function Spinner({
  size = 20,
  className = '',
  label = '加载中',
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role='status'
      aria-label={label}
      className={`relative inline-block text-atv-secondary ${className}`}
      style={{ width: size, height: size }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <span
          key={i}
          className='absolute left-1/2 top-0 h-[30%] w-[11%] -translate-x-1/2 rounded-full bg-current'
          style={{
            transformOrigin: `50% ${size / 2}px`,
            transform: `translateX(-50%) rotate(${i * 45}deg)`,
            animation: 'atv-spoke 0.8s linear infinite',
            animationDelay: `${(i - 8) * 0.1}s`,
          }}
        />
      ))}
    </span>
  );
}
