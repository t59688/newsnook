# 分类按正文语言拆栏（中文 / 外刊）

> 日期：2026-09-07  
> 状态：已实现  
> 范围：`CATEGORIES` 注册表、7 个内置场景预设快照、门户默认可见轨、相关测试与用户手册  
> 不改：翻译引擎、综合频道的数据模型（`mix` 仍保留给用户自开）、云同步协议、自建源  
> 信源入座真源：[`2026-09-07-locale-split-preset-review.md`](./2026-09-07-locale-split-preset-review.md)

## 1. 问题

多数人不会配翻译。当前默认「全景门户」把中英信源混在同一分类（科技、商业、国际、娱乐等），再加「综合」收边角料，首屏既无所适从，又像外刊墙。

## 2. 已确认决策

| 项 | 选择 |
|---|---|
| 拆栏单位 | 注册表成对分类：主题中文栏 + `·外刊` 栏，不是运行时幽灵拆轨 |
| 混源 | 任一内置分类的 `sourceIds` **不得**中英混排 |
| 判定 | 正文能否无翻译直读：`bbc-zh*` / `dw-top` / 端传媒 → 中文；`scmp-*` / `sinocism` / `gnews-*` → 外刊 |
| 外刊露出 | 默认可见，但**整组中文栏在前、整组外刊栏在后**（不是每个主题立刻跟一条外刊） |
| 综合 | 内置 7 预设**全部隐藏 `mix`**，`enabledSourceIds` 为空；分类管理仍可自开 |
| 入座 | 从 135 源全库重筛，不必每源都进预设；NBA/CBA/跑步/古玩/政务/精选不进任何内置预设 |
| 并栏 | 能并入主题栏的不开新轨（足球→体育，手机/数码→极客科技，汽车→科技） |
| 旧用户 | 只改出厂内置快照；有 `builtinOverrides` / 自建预设的不强制改写 |

## 3. 分类注册表

### 3.1 新增外刊栏

轨道名：`短名·外刊`（不要 `(CN)` / `(外刊)` 开发腔）。

| 新 id | 标签 | 从哪拆 |
|---|---|---|
| `ent-world` | 娱乐·外刊 | `ent` |
| `sports-world` | 体育·外刊 | `sports` |
| `tech-world` | 科技·外刊 | `tech` |
| `science-world` | 科普·外刊 | `science` |
| `finance-world` | 商业·外刊 | `finance` |
| `intl-world` | 国际·外刊 | `intl` |
| `health-world` | 健康·外刊 | `health` |
| `ai-media-world` | 业界·外刊 | `ai-media` |
| `ai-depth-world` | 深读·外刊 | `ai-depth` |
| `ai-community-world` | 社区·外刊 | `ai-community` |
| `tech-depth-world` | 科技深度·外刊 | `tech-depth` |

不拆：纯中文单源栏（游戏、教育、博客、旅游、独家…）；纯外刊专栏（OpenAI、Claude、实验室、ACX、Marginalian、ALDaily）。`fun` 当前无外刊源，不建 `fun-world`。

`mix` 保留在 `CATEGORIES`，caption 不变。

### 3.2 注册表 `sourceIds` 纯度

`CATEGORIES` 里每个主题栏只挂对应语言的源（与审查表 locale 一致）。原先混在 `tech` / `finance` / `intl` 等里的英文源改挂对应 `*-world`。`uncoveredSourceIds()` 仍须为空：每个内置源至少落入一个分类（含默认隐藏栏）。

同一 `sourceId` 不得同时出现在两个非 `mix` 内置分类（现有 `duplicateSourcesAcrossCategories` 约束保持）。

### 3.3 门户默认可见轨

`PORTAL_VISIBLE_CATEGORY_IDS` / `DEFAULT_HIDDEN_CATEGORY_IDS` 与全景门户可见栏对齐：

热点 → 独家 → 娱乐 → 体育 → 科技 → 商业 → 国际 → 健康 → 科普 → 轻松一刻 → 娱乐·外刊 → 体育·外刊 → 科技·外刊 → 商业·外刊 → 国际·外刊 → 健康·外刊 → 科普·外刊

`mix` 进入默认隐藏。新装 `categoryOrder` 用上述顺序；其余分类（AI 六栏、游戏、网易冷门细分等）仍隐藏，由其它预设打开。

## 4. 内置预设

快照内容以审查表各节表格为准，实现时按表填写 `categoryOrder` / `hiddenCategoryIds` / `categorySources`。

共同约束：

- `enabledSourceIds: []`（无综合独占源）
- `hiddenCategoryIds` 含 `mix` 及所有未出现在该预设 `categoryOrder` 的分类
- 主题栏信源互斥；中文栏整组在前

| 预设 | 可见栏起点 |
|---|---|
| 全景门户 | 热点（无综合） |
| 极客与 AI | 业界 → … → 科技深度（中文）再外刊与 OpenAI/Claude/实验室 |
| 深度智识 | 无业游民 → 国际 → 科技 → 科普 → 外刊块 |
| 商业创投 | 商业（无综合） |
| 全球视野 | 国际（无综合） |
| 慢读知性 | 全中文（教育/博客在列） |
| 摸鱼消遣 | 轻松…旅游…最后娱乐·外刊 |

## 5. 迁移与兼容

- **新装 / 恢复出厂内置**：直接用新快照。
- **未改过的内置激活项**：下次加载走新的 `BUILTIN_PRESETS`（覆盖层不存在时）。
- **已有 `builtinOverrides` 或用户预设**：不自动拆栏、不删综合；用户可「恢复出厂」拿到新轨。
- **未知分类 id**：`normalizeSnapshot` 已丢弃不在注册表的 id；新 `*-world` 加入注册表后，旧快照不会自动出现这些栏，除非出厂/恢复。
- **云同步**：不改协议。同步的是用户快照；出厂常量不上传。

不写一次性「把旧 mix 源打散到主题栏」的迁移脚本，避免覆盖用户刻意留在综合里的选择。

## 6. 测试与文档

- `scripts/layout-presets.test.ts`：按审查表更新可见栏、`categorySources` 断言；断言 7 预设均不含 `mix`、`enabledSourceIds` 为空、无跨栏重复、无中英混源。
- `uncoveredSourceIds()` 相关测试保持空数组。
- `docs/user-guide.md` 场景预设表：注明中文栏在前、外刊分栏、默认无综合。
- `docs/architecture.md` 仅在分类/预设入口描述变化时改一句，不扩写。

## 7. 非目标

- 不改翻译默认配置、不强迫打开翻译。
- 不删除 6 个未进预设的网易细分（仍在注册表，频道页可开）。
- 不把「综合」从产品里移除。
- 不改列表排序算法。
