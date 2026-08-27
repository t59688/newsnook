import type { ProductTourStepDefinition } from './types'

/** 组件侧用 data-tour 属性锚定引导目标，避免依赖易碎的样式类选择器 */
export function tourSelector(target: string): string {
  return `[data-tour="${target}"]`
}

/**
 * 引导步骤（顺序即播放顺序）：
 * 先在「速闻」讲清分类、预设切换、列表与底栏，再切到「我的」讲收藏、
 * 自定义订阅、翻译、预设管理与其余设置。
 * 「速闻」步骤按当前 DOM 可见性过滤（桌面端底栏 / 分类轨道 / 预设胶囊隐藏时自动跳过），
 * 「我的」步骤在切 Tab 后才挂载，由服务的 waitForElement 等待。
 */
export const PRODUCT_TOUR_STEPS: ProductTourStepDefinition[] = [
  {
    id: 'welcome',
    tab: 'today',
    selector: null,
    title: '欢迎使用有所闻',
    description:
      '一件本地阅读工具：无需账号也能使用、无推荐算法，读什么由你决定。花半分钟认识常用功能，右上角可随时跳过。',
  },
  {
    id: 'category-rail',
    tab: 'today',
    selector: tourSelector('category-rail'),
    title: '分类频道',
    description:
      '点选或在列表上左右横滑即可切换分类。每个分类聚合哪些信源，可在「我的 · 分类与自动刷新」里调整。',
    side: 'bottom',
  },
  {
    id: 'preset-switcher',
    tab: 'today',
    selector: tourSelector('preset-switcher'),
    title: '切换场景预设',
    description:
      '点右上角这枚胶囊，可在工作、通勤、深度阅读等场景间一键切换，每套预设决定首页展示哪些分类与信源。新建和调整预设稍后在「我的」里介绍。',
    side: 'bottom',
  },
  {
    id: 'feed-list',
    tab: 'today',
    selector: tourSelector('feed-list'),
    title: '速闻列表',
    description:
      '点开条目即可在应用内读全文，不跳浏览器；下拉列表刷新，读过的条目会淡化标记为已读。',
    side: 'top',
  },
  {
    id: 'tab-bar',
    tab: 'today',
    selector: tourSelector('tab-bar'),
    title: '底栏导航',
    description:
      '「速闻」看更新，「我的」管收藏与设置；在速闻页双击「速闻」可快速刷新。稍后读有内容时，「我的」会带角标。',
    side: 'top',
  },
  {
    id: 'me-reading',
    tab: 'me',
    selector: tourSelector('me-reading'),
    title: '稍后读与足迹',
    description:
      '阅读器里收藏的「稍后读」会自动缓存正文，离线也能读；最近阅读与不联网的本地搜索也在这里。',
    side: 'bottom',
  },
  {
    id: 'me-custom-sources',
    tab: 'me',
    selector: tourSelector('me-custom-sources'),
    title: '自定义订阅',
    description:
      '内置源之外，粘贴地址即可添加 RSS / Atom 订阅，部分站点还能直接解析网页目录；OPML 支持批量导入导出，方便从其他阅读器迁移。',
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
    id: 'me-presets',
    tab: 'me',
    selector: tourSelector('me-presets'),
    title: '管理场景预设',
    description:
      '首页右上角切换的预设在这里维护：可以调整内置场景，也能把常用的分类与信源组合保存成自己的预设。',
    side: 'bottom',
  },
  {
    id: 'me-settings',
    tab: 'me',
    selector: tourSelector('me-settings'),
    title: '更多设置',
    description:
      '分类、字体、外观、网络代理与离线存储也都在这里调整。想再看一遍本引导，去「关于有所闻」。',
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
): ProductTourStepDefinition[] {
  return definitions.filter((step) => {
    if (!step.selector) return true
    if (step.tab !== 'today') return true
    return isVisible(step.selector)
  })
}
