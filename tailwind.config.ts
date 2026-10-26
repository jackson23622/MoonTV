import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      screens: {
        'mobile-landscape': {
          raw: '(orientation: landscape) and (max-height: 700px)',
        },
      },
      fontFamily: {
        // Apple 系统字体：SF Pro（Apple 设备）/ 苹方，其它平台回落到系统无衬线
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Helvetica Neue"',
          ...defaultTheme.fontFamily.sans,
        ],
        primary: ['-apple-system', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        // Apple TV 风格设计 token（值见 globals.css，深浅色自动切换）
        atv: {
          bg: 'rgb(var(--atv-bg) / <alpha-value>)',
          elevated: 'rgb(var(--atv-elevated) / <alpha-value>)',
          elevated2: 'rgb(var(--atv-elevated-2) / <alpha-value>)',
          label: 'rgb(var(--atv-label) / <alpha-value>)',
          secondary: 'rgb(var(--atv-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--atv-tertiary) / <alpha-value>)',
          separator: 'rgb(var(--atv-separator) / <alpha-value>)',
          fill: 'rgb(var(--atv-fill) / <alpha-value>)',
          thumb: 'rgb(var(--atv-thumb) / <alpha-value>)',
          accent: 'rgb(var(--atv-accent) / <alpha-value>)',
          green: 'rgb(var(--atv-green) / <alpha-value>)',
          red: 'rgb(var(--atv-red) / <alpha-value>)',
        },
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        dark: '#222222',
      },
      keyframes: {
        flicker: {
          '0%, 19.999%, 22%, 62.999%, 64%, 64.999%, 70%, 100%': {
            opacity: '0.99',
            filter:
              'drop-shadow(0 0 1px rgba(252, 211, 77)) drop-shadow(0 0 15px rgba(245, 158, 11)) drop-shadow(0 0 1px rgba(252, 211, 77))',
          },
          '20%, 21.999%, 63%, 63.999%, 65%, 69.999%': {
            opacity: '0.4',
            filter: 'none',
          },
        },
        shimmer: {
          '0%': {
            backgroundPosition: '-700px 0',
          },
          '100%': {
            backgroundPosition: '700px 0',
          },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        flicker: 'flicker 3s linear infinite',
        shimmer: 'shimmer 1.3s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-in-out',
        'slide-down': 'slideDown 0.3s ease-in-out',
      },
      boxShadow: {
        // tvOS 焦点浮起
        lift: '0 18px 40px -12px rgb(0 0 0 / 0.55), 0 6px 16px -6px rgb(0 0 0 / 0.4)',
        card: '0 2px 8px -2px rgb(0 0 0 / 0.35)',
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        spring: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
} satisfies Config;

export default config;
