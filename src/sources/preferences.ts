/**
 * 用户偏好：叠加在静态分类注册表之上的一层覆盖（聚合入口）。
 *
 * 注册表（categories.ts / registry.ts）始终是默认值来源，这里只保存「用户改过什么」，
 * 因此后续增删分类或信源时，旧偏好不会失效，也不需要写迁移脚本。
 * 实现按边界拆在 preferences/ 子模块：
 * - preferences/model.ts         类型、默认值、选项表与共享校验
 * - preferences/normalize.ts     持久化数据归一化（normalizePreferences）
 * - preferences/categoryPrefs.ts 分类顺序/显隐/信源覆盖查询与更新、自建分类
 * - preferences/customSources.ts 自定义订阅源增删改与 OPML 批量导入
 * - preferences/settings.ts      主题/排版/墨水屏/预存/代理等 setter
 */

export {
  DEFAULT_HIDDEN_CATEGORY_IDS,
  DEFAULT_PREFERENCES,
  DEFAULT_PRESTORE_PREFS,
  DEFAULT_TYPOGRAPHY,
  FOLLOWS_ENABLED_SOURCES,
  FONT_FAMILY_OPTIONS,
  FONT_SCALE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  PARAGRAPH_GAP_OPTIONS,
  PRESTORE_PER_SOURCE_OPTIONS,
  type FontFamilyId,
  type Preferences,
  type PrestorePrefs,
  type TypographyPrefs,
} from './preferences/model'

export { normalizePreferences } from './preferences/normalize'

export {
  addCustomCategory,
  allRegisteredCategories,
  allRegisteredSources,
  categorySourceIds,
  deleteCustomCategory,
  describeSources,
  hasSourceOverride,
  isCategoryVisible,
  isCustomCategory,
  moveCategory,
  orderedCategories,
  reorderCategories,
  resetCategoryLayout,
  resetCategorySources,
  resolveCategory,
  setCategoryOrder,
  settingsCategories,
  sourceIdsForCategoryWithPrefs,
  sourceUsageByOtherCategories,
  toggleCategorySource,
  toggleCategoryVisible,
  updateCustomCategory,
  visibleCategories,
} from './preferences/categoryPrefs'

export {
  addCustomSource,
  batchImportSourcesAndCategories,
  deleteCustomSource,
  deleteCustomSources,
  updateCustomSource,
} from './preferences/customSources'

export {
  resetProxyPrefs,
  resetTypography,
  selectThemeScheme,
  setAutoRefreshOnCategorySwitch,
  setCustomSchemeColors,
  setEinkMode,
  setPrestoreEnabled,
  setPrestorePerSourceLimit,
  setThemeMode,
  setThemeScheme,
  setWifiOnlyAutoLoadMedia,
  updateProxyPrefs,
  updateTypography,
} from './preferences/settings'
