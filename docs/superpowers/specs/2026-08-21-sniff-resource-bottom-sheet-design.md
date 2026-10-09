# 嗅探资源列表：底部抽屉 UI

> 日期：2026-08-21  
> 状态：已实现  
> 范围：`InkVideoPlayer` 内 `MediaResourceOverlay` 展示形态；不改嗅探/选源业务逻辑

## 1. 背景

当前「嗅探 N」浮动胶囊旁用右下角小浮层列资源，与应用内其它选择 UI（如 `OptionPickerDialog` 底部上浮）不一致。用户要求改为底部抽屉，并明确胶囊与面板的显隐关系。

## 2. 目标与非目标

### 目标

| # | 目标 |
|---|---|
| G1 | 点胶囊 → 底部升起资源列表；胶囊在面板打开期间隐藏 |
| G2 | 关面板（遮罩 / Escape；若播放器已接返回键则一并关闭）→ 胶囊重新出现 |
| G3 | 点某一资源 → 切源播放 → **立即关面板** → 胶囊出现 |
| G4 | 视觉与交互对齐 `OptionPickerDialog`：遮罩、顶栏把手、圆角顶、安全区底边距 |

### 非目标

- 不抽通用 `BottomSheet` 组件（仅此一处急需）
- 不改资源嗅探、排序、广告标记、选源播放管线
- 不做跟贴式侧滑全屏抽屉
- 不改沉浸/全屏下「不显示嗅探入口」的既有规则

## 3. 交互

```text
关闭态：右下角胶囊「嗅探 N」（非 immersive）
   │ 点胶囊
   ▼
打开态：胶囊隐藏 + 底部抽屉（标题「已嗅探到 N 个资源」+ 列表）
   ├─ 点遮罩 / Escape → 关面板 → 胶囊
   └─ 点列表项 → onSelect(resource) → 关面板 → 胶囊
```

## 4. UI 规格

- **壳**：`fixed inset-0 z-[…]` 遮罩 `bg-black/60 backdrop-blur-sm`；面板 `items-end`，`rounded-t-3xl border border-haze bg-ink-raised`；顶栏居中把手；`paddingBottom: calc(var(--sab) + …)`。
- **宽屏**：与 `OptionPickerDialog` 一致——`md:items-center md:rounded-2xl`，不必另做侧栏。
- **列表行**：沿用现有序号圆标、类型标签（HLS/DASH/MP4）、广告角标、分辨率、截断 URL；文案与信息架构不变。
- **胶囊**：位置/样式可保持现状；仅 `open === true` 时不渲染（或 `hidden`），避免与抽屉叠两层入口。

## 5. 实现边界

| 文件 | 职责 |
|---|---|
| `src/components/InkVideoPlayer.tsx` | 改写 `MediaResourceOverlay`：底部抽屉 + 胶囊显隐；选中后先 `onSelect` 再关（或由父级关，保证关） |
| 可选：极少量 `index.css` | 仅当需要与预设抽屉一致的 `translateY` 入场动画时追加；优先内联短 keyframes 或复用已有类 |

父级现有 `open` / `onToggle` / `onSelect` 契约可保留；选中时 Overlay 内关面板或父级在 `onSelect` 后把 `open` 设为 `false`，二选一，行为须满足 G3。

## 6. 验收

1. 有 ≥1 个资源且非沉浸：可见胶囊；点开后胶囊消失、底部列表出现。
2. 点遮罩关闭后胶囊回来；列表不再残留。
3. 点某一资源：播放源切换，面板关闭，胶囊回来。
4. 全屏/immersive：仍不显示胶囊与面板（既有行为）。
5. 门控 / 嗅探逻辑 / `test:origin-player-live-sniff` 等业务测无强制变更；若有 UI 源码断言可补一条「底部抽屉 / OptionPicker 同款壳」。

## 7. 验证清单

1. 仍满足无后端 / 站内播放主路径。  
2. 只碰 Overlay 展示相关代码。  
3. 用户可见文案保持中文既有句式。  
