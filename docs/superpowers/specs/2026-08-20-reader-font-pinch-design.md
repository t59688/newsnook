# 阅读页捏合调节正文字号

> 日期：2026-08-20  
> 状态：已设计，待实现  
> 范围：普通滚动阅读页双指捏合调 `typography.fontScale`，与设置页同步；不含墨水屏分页模式

## 1. 背景

用户希望在文章阅读页用双指捏合直接调节正文字号，且与「设置 → 阅读字体」中的字号偏好双向同步。现有字号已落在本地偏好 `prefs.typography.fontScale`（基准 15.5px，允许范围 0.8–1.4），设置页分段选项与墨水屏菜单加减共用同一字段；滚动阅读尚无捏合入口。

## 2. 目标与非目标

### 目标

- 非墨水屏滚动阅读中，双指捏合连续调节正文字号。
- 捏合过程有 HUD（如「字号 110%」），松手后短时淡出。
- 松手将 `fontScale` 写入本地偏好，设置页 / 「我的」摘要立即反映；非整档时显示「自定义」。
- 与图片大图捏合、视频播放器捏合在作用元素与生命周期上隔离，避免互相抢手势。

### 非目标

- 不改墨水屏分页阅读的捏合行为（继续用现有菜单 ± 字号）。
- 不引入整页浏览器缩放（视觉 viewport / 系统 pinch-zoom 页面）。
- 不强制吸附到「小 / 较小 / 标准 / 较大 / 大」离散档；连续值落在 clamp 范围内即可。
- 不改行高、段距、字体族。

## 3. 行为规格

| 项 | 约定 |
|---|---|
| 启用条件 | `einkMode === false`，正文已 `ready`，未打开 ImageLightbox，视频未处于独占捏合交互 |
| 手势 | 双指距离增大 → 放大字号；减小 → 缩小 |
| 数值 | `fontScale' = clamp(fontScale0 * (distance / distance0), 0.8, 1.4)` |
| 跟手 | 捏合中更新预览字号（同一 CSS 变量链路 `--reader-font-size`） |
| 持久化 | 第二指抬起 / 捏合结束时调用 `onTypographyChange({ fontScale })` |
| HUD | 文案 `字号 ${Math.round(fontScale * 100)}%`；捏合中可见；结束后约 0.8–1.2s 淡出 |
| 单指滚动 | 不拦截 |
| 侧滑返回 | 已判定为 pinch 时不启动 / 忽略边缘返回 |

## 4. 架构

```text
ReaderScreen (!einkMode)
  └─ useReaderFontPinch(scrollEl, { fontScale, enabled, onCommit })
        ├─ readerFontPinch 纯函数（距离比、clamp、文案）
        ├─ 预览 fontScale → 临时驱动 CSS 或经父级回调
        └─ onCommit → App 已有 onTypographyChange → updateTypography → 持久化
                         └─ usePreferences 写 --reader-font-size
```

| 单元 | 职责 |
|---|---|
| `src/lib/readerFontPinch.ts` | 纯函数：`pinchFontScale`、`formatFontScaleHud`、常量范围 |
| `src/hooks/useReaderFontPinch.ts` | pointer/touch 双指状态机；HUD 显隐；松手 commit |
| `src/screens/ReaderScreen.tsx` | 挂载 hook（`enabled` 含 lightbox/视频互斥）；渲染 HUD |
| 既有 | `updateTypography` / `TypographyScreen` / `FONT_SCALE_OPTIONS` 不变 |

推荐预览策略：捏合中由 hook 回调 `onPreview(scale)`，`ReaderScreen` 用本地 state 覆盖展示用 scale，并同步写 `--reader-font-size`（或复用 `usePreferences` 同源公式）；松手 `onCommit` 写入偏好后清掉仅预览态。避免每帧写 localStorage。

## 5. 手势冲突

| 场景 | 处理 |
|---|---|
| ImageLightbox | lightbox 打开时 `enabled=false`；大图自有捏合 |
| InkVideoPlayer | 播放器层自有捏合；正文 hook 不监听播放器节点；全屏/独占手势时 `enabled=false` |
| 跟贴抽屉等遮罩 | 遮罩打开时可不启用（可选，优先 lightbox/视频） |
| 浏览器默认页面缩放 | 仅在已进入 pinch 时对 `touchmove` `preventDefault` |

作用时间与 DOM 目标本就不重叠；`enabled` 互斥为防御性加固。

## 6. 测试

`scripts/reader-font-pinch.test.ts`（tsx / node:assert）：

- 距离比放大 / 缩小
- 上下边界 clamp 到 0.8 / 1.4
- HUD 文案四舍五入百分比
- （可选）无效距离保护

## 7. 验收

1. 滚动阅读双指捏合，正文即时变大变小，出现「字号 N%」浮层，松手后淡出。  
2. 打开「设置 → 阅读字体」，字号与刚才一致（非整档为自定义）。  
3. 在设置改字号后再回阅读页，捏合以新值为起点。  
4. 打开大图捏合缩放图片，关闭后正文捏合仍正常；视频内捏合不误调字号。  
5. 墨水屏模式行为与现网一致（无正文捏合字号）。  
6. `npm run test:reader-font-pinch` 通过。

## 8. 风险

- Android WebView 上 `touch-action` / `preventDefault` 时机不当可能导致滚动卡顿 → 仅 pinch 确认后才 preventDefault。  
- 每帧若误写存储会抖 → 预览与 commit 分离。  
- 与侧滑返回竞态 → pinch 活跃时抑制边缘手势。
