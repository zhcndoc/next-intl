import {useRouter} from 'next/router';
// import config from '@/config';
import FooterLink from './FooterLink';
import FooterSeparator from './FooterSeparator';
import FooterVersionSelector from './FooterVersionSelector';

export default function Footer() {
  const router = useRouter();

  // Unfortunately, Nextra renders the footer incorrectly here
  const isHidden = router.pathname.startsWith('/examples');
  if (isHidden) return null;

  return (
    <div className="border-t border-slate-200 bg-slate-100 dark:border-t-slate-800 dark:bg-transparent">
      <div className="mx-auto max-w-[90rem] px-4 py-2 md:flex md:justify-between ">
        <div>
          <FooterLink href="/docs">文档</FooterLink>
          <FooterSeparator />
          {/* <FooterLink href="https://learn.next-intl.dev">学习</FooterLink>
          <FooterSeparator /> */}
          <FooterLink href="/examples">示例</FooterLink>
          <FooterSeparator />
          <FooterLink href="/blog">博客</FooterLink>
          <FooterSeparator />
          <FooterVersionSelector />
        </div>
        <div>
          <FooterLink href="https://www.zhcndoc.com" target="_blank">简中文档</FooterLink>
          <span className="inline-flex items-center text-xs">｜</span>
          <FooterLink href="https://beian.miit.gov.cn" rel="noreferrer" target="_blank">沪ICP备2024070610号-3</FooterLink>
        </div>
      </div>
    </div>
  );
}
