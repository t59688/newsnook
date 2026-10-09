# WebView 兼容性：Chrome 69+ 支持

> 日期：2026-08-19
> 状态：已实施
> 范围：构建产出 CSS 降级、JS polyfill、WebView 版本检测
> 不改：Tailwind v4 源码写法、运行时双 CSS 切换

## 1. 背景

Tailwind CSS v4 官方最低要求 Chrome 111，依赖 `@layer`、`@property`、`oklch()`、`color-mix()` 等现代 CSS 特性。在 Android System WebView Chrome 69 内核上表现为黑屏。

产品需兼容 Chrome 69+（部分墨水屏设备、低版本 AOSP 系统），低于 69 的给出明确提示。

## 2. 策略

构建时全面降级，运行时检测提示。不引入双 CSS 文件。

## 3. 构建时 CSS 降级（`unlayerCssPlugin`）

| 处理 | Chrome 要求 | 做法 |
|---|---|---|
| `@layer` | 99+ | postcss 剥离（已有） |
| `@property` | 85+ | postcss 移除声明；并无条件注入 `--tw-border-style` 等变量兜底（见下） |
| `:where()` | 88+ | lightningcss 不降级；构建后 unwrap 为内层选择器（`scripts/webview-css-compat.ts`） |
| `oklch()` | 111+ | lightningcss `targets: chrome 69` 自动降级为 rgb |
| `color-mix()` | 111+ | postcss 转 rgb + lightningcss 兜底 |
| `in oklab` 渐变 | 111+ | postcss 移除 + lightningcss 兜底 |
| vendor prefix | 各异 | lightningcss 自动补全 |
| flex `gap` | 84+ | `data-no-flex-gap` + margin fallback |
| `content-visibility` | 85+ | 功能类先用 `display:none` 作 Chrome 69–84 基线；`@supports` 下渐进增强为 `content-visibility:hidden` |

**为何必须补 `:where` / 变量兜底：** Tailwind v4 的 `divide-y` / `divide-haze` 依赖 `:where(...)` 与 `--tw-border-style`。剥离 `@property` 后，若 WebView 不匹配 Tailwind 自带的复杂 `@supports` 回退，边框色与 `border-style` 为空，列表分隔线在 Android 上消失而桌面 Chrome 仍正常。

## 4. JS 构建目标

`build.target` 从 `chrome80` 降至 `chrome69`，Vite/Oxc 自动转译可选链 `?.`、空值合并 `??` 等语法。

## 5. 运行时 polyfill（`index.html`）

| API | Chrome 版本 |
|---|---|
| `globalThis` | 71+ |
| `Object.hasOwn` | 93+ |
| `Array.prototype.at` | 92+ |
| `String.prototype.at` | 92+ |
| `crypto.randomUUID` | 92+ |
| `structuredClone` | 98+ |
| `queueMicrotask` | 71+ |
| `String.prototype.replaceAll` | 85+ |
| `Array.prototype.findLast/findLastIndex` | 97+ |
| `Promise.allSettled` | 76+ |
| `Object.groupBy` | 117+ |

## 6. WebView 版本检测

启动时解析 UA 中 `Chrome/(\d+)`，低于 69 替换 DOM 为纯内联样式的中文提示页，阻断后续脚本加载。

## 7. 各版本预期表现

| Chrome 版本 | 预期 |
|---|---|
| < 69 | 中文提示页，不进入应用 |
| 69–84 | 可运行；`@property` 动画退化为跳变；部分 `backdrop-filter` 不生效；长内容模态隔离走 `display:none` 回退 |
| 85–110 | 几乎完全正常 |
| 111+ | 完整体验 |

## 8. 验证方法

1. `npm run build` 后检查 `dist/assets/*.css` 不含 `oklch`、`@layer`、`@property`、`:where(`
2. `npm run test:webview-css-compat`
3. 检查构建 CSS 的 `.content-parked`：基线规则必须有 `display:none`，且 `@supports (content-visibility:hidden)` 内再恢复 `display:flex` + `content-visibility:hidden`
4. Chrome DevTools 设备模拟切换旧版 UA 验证检测逻辑
5. 实机 WebView 69 设备验证可打开；信息流列表项之间应有 `divide-haze` 细线，风格引导切换不应重新触发长列表重绘卡顿
