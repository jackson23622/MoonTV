import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import TopNav from './TopNav';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  /** 内容从页面最顶端开始（首页大图轮播），导航浮在其上 */
  overlayHeader?: boolean;
}

const PageLayout = ({
  children,
  activePath = '/',
  overlayHeader = false,
}: PageLayoutProps) => {
  const showBack = activePath.startsWith('/play');
  return (
    <div className='min-h-screen w-full'>
      <TopNav
        activePath={activePath}
        overlay={overlayHeader}
        showBack={showBack}
      />
      <MobileHeader showBackButton={showBack} overlay={overlayHeader} />

      <main
        className={`min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-16 ${
          overlayHeader
            ? ''
            : 'pt-[calc(3rem+env(safe-area-inset-top))] md:pt-14'
        }`}
      >
        {children}
      </main>

      <MobileBottomNav activePath={activePath} />
    </div>
  );
};

export default PageLayout;
