/**
 * 功能引导（Product Tour）稳定边界。
 *
 * 步骤定义与过滤逻辑保持纯函数（steps.ts），driver.js 只在
 * ProductTourService 内出现，方便单测与后续替换实现。
 */

/** 引导会落到的底栏 Tab；跨 Tab 步骤由服务在跳转前切换 */
export type TourTab = 'today' | 'me'

export interface ProductTourStepDefinition {
  /** 步骤稳定标识，测试与日志用 */
  id: string
  /** 步骤所在 Tab */
  tab: TourTab
  /** `[data-tour="…"]` 目标选择器；null 表示无高亮目标的居中卡片 */
  selector: string | null
  title: string
  description: string
  /** 弹层相对高亮区域的方位，缺省交给 driver 自适应 */
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

export interface StartProductTourOptions {
  /** 切换底栏 Tab；进入「我的」步骤前由服务调用 */
  setTab: (tab: TourTab) => void
  /** 墨水屏或系统减弱动效时关闭过渡动画 */
  reduced?: boolean
  /** 完成或跳过后回调（此时已标记为看过） */
  onFinish?: () => void
}
