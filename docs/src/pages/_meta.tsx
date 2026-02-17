export default {
  index: {
    title: '简介',
    type: 'page',
    display: 'hidden',
    theme: {layout: 'raw'}
  },
  docs: {
    title: '文档',
    type: 'page'
  },
  // learn: {
  //   title: '学习',
  //   type: 'page',
  //   titleChildren: (
  //     <span className="absolute -right-4 -top-3 rotate-6 rounded-sm bg-green-500 px-1 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-white group-[.navbar-home]:bg-green-300 group-[.navbar-home]:text-green-900 dark:bg-green-300 dark:text-green-900">
  //       New!
  //     </span>
  //   ),
  //   theme: {
  //     sidebar: false,
  //     toc: false
  //   },
  //   href: 'https://learn.next-intl.dev'
  // },
  examples: {
    title: '示例',
    type: 'page',
    theme: {
      sidebar: false,
      toc: false
    }
  },
  blog: {
    title: '博客',
    type: 'page',
    theme: {
      sidebar: false,
      toc: false
    }
  }
};
