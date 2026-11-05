import type { ProductTourStepDefinition } from './types'

/** 组件侧用 data-tour 属性锚定引导目标，避免依赖易碎的样式类选择器 */
export function tourSelector(target: string): string {
  return `[data-tour="${target}"]`
}

/**
 * 引导步骤（顺序即播放顺序）：
 * 先在「速闻」讲清分类、预设切换、列表与底栏，再切到「我的」讲收藏、
 * 订阅商店、自定义订阅、预设管理、翻译与关于入口。
 * 桌面端对应侧栏入口；「速闻」步骤按当前 DOM 可见性过滤，
 * 「我的」步骤在切 Tab 后才挂载，由服务的 waitForElement 等待。
 */
export const PRODUCT_TOUR_STEPS: ProductTourStepDefinition[] = [
  {
    id: 'welcome',
    tab: 'today',
    selector: null,
    title: '欢迎使用有所闻',
    description:
      '一件本地优先的阅读工具：无需账号也能使用，订阅由你选择；云同步可选。接下来认识常用功能，右上角可随时跳过。',
  },
  {
    id: 'category-rail',
    tab: 'today',
    selector: tourSelector('category-rail'),
    title: '分类频道',
    description:
      '点选分类或左右横滑列表即可切换。在「我的 → 分类与自动刷新」调整信源，也能关闭「推荐」栏；它在积累阅读后出现，只在本机重排已订阅内容。',
    side: 'bottom',
    desktop: {
      selector: tourSelector('desktop-category-rail'),
      description:
        '点左侧频道分类切换信息流。在「偏好与设置 → 分类与自动刷新」调整信源，也能关闭「推荐」栏；它只在本机重排已订阅内容。',
      side: 'right',
    },
  },
  {
    id: 'preset-switcher',
    tab: 'today',
    selector: tourSelector('preset-switcher'),
    title: '切换场景',
    description:
      '点底栏中间的「场景」切换场景预设，也可进入已添加的 CMS 站点。面板中若有「社区入口」，可进入知乎等独立工作区，不会改变新闻订阅布局。',
    side: 'top',
    desktop: {
      selector: tourSelector('desktop-preset-switcher'),
      description:
        '点左侧「场景」切换场景预设，也可进入已添加的 CMS 站点。面板中若有「社区入口」，可进入独立工作区，不会改变新闻订阅布局。',
      side: 'right',
    },
  },
  {
    id: 'feed-list',
    tab: 'today',
    selector: tourSelector('feed-list'),
    title: '速闻列表',
    description:
      '点开条目在应用内阅读正文；下拉列表或点顶栏刷新按钮获取更新。读过的条目会淡化，正文获取失败时可重试或打开原文。',
    side: 'top',
  },
  {
    id: 'tab-bar',
    tab: 'today',
    selector: tourSelector('tab-bar'),
    title: '底栏导航',
    description:
      '「速闻」看更新，中间「场景」切换阅读场景，「我的」管收藏与设置；在速闻页双击「速闻」可快速刷新。稍后读有内容时，「我的」会带角标。',
    side: 'top',
    desktop: {
      selector: tourSelector('desktop-navigation'),
      title: '侧栏导航',
      description:
        '左侧「速闻」看更新，「稍后读」与「最近阅读」回到已保存或读过的内容；「偏好与设置」管理订阅与偏好。',
      side: 'right',
    },
  },
  {
    id: 'me-reading',
    tab: 'me',
    selector: tourSelector('me-reading'),
    title: '稍后读与足迹',
    description:
      '阅读页中收藏的「稍后读」会自动缓存正文，离线也能读；最近阅读与不联网的本地搜索也在这里。',
    side: 'bottom',
  },
  {
    id: 'me-feed-store',
    tab: 'me',
    selector: tourSelector('me-feed-store'),
    title: 'RSS 订阅商店',
    description:
      '输入网站名称、关键词或网址，在线查找订阅源，预览后再订阅；已订阅的来源也能在这里管理。离线时仍可阅读本机缓存。',
    side: 'bottom',
  },
  {
    id: 'me-custom-sources',
    tab: 'me',
    selector: tourSelector('me-custom-sources'),
    title: '自定义订阅',
    description:
      '已有地址时，可直接添加 RSS / Atom / JSON Feed；支持的站点还能解析网页目录。OPML 支持批量导入导出，方便迁移订阅。',
    side: 'bottom',
  },
  {
    id: 'me-presets',
    tab: 'me',
    selector: tourSelector('me-presets'),
    title: '管理场景预设',
    description:
      '「场景」中的场景预设在这里维护：可以调整内置场景，也能把常用的分类与信源组合保存成自己的预设。CMS 站点与社区工作区有各自的入口。',
    side: 'bottom',
  },
  {
    id: 'me-translation',
    tab: 'me',
    selector: tourSelector('me-translation'),
    title: '应用内翻译',
    description:
      '外文源的列表标题与正文都能在应用内直接翻译。在这里选择翻译引擎与目标语言，译文可对照原文显示，也可只看译文。',
    side: 'bottom',
  },
  {
    id: 'me-settings',
    tab: 'me',
    selector: tourSelector('me-about'),
    title: '继续探索',
    description:
      '「我的」里还有字体、外观、朗读、AI、网络与代理，以及离线存储与备份。想重看引导或检查更新，打开这里的「关于有所闻」。',
    side: 'top',
  },
]

/**
 * 计算本次实际可播的步骤：
 * - 无目标的居中卡片始终保留；
 * - 「我的」步骤始终保留（目标屏切 Tab 后才挂载，交给 waitForElement）；
 * - 「速闻」步骤按可见性过滤，目标缺席（桌面布局、聚焦页等）时整步跳过，不阻塞流程。
 */
export function resolveAvailableSteps(
  definitions: ProductTourStepDefinition[],
  isVisible: (selector: string) => boolean,
  layout: 'mobile' | 'desktop' = 'mobile',
): ProductTourStepDefinition[] {
  return definitions
    .map((step) => layout === 'desktop' ? { ...step, ...step.desktop } : step)
    .filter((step) => {
      if (!step.selector) return true
      if (step.tab !== 'today') return true
      return isVisible(step.selector)
    })
}
