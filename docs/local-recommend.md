# 本地推荐（backendless）

> 与代码同步入口：`src/lib/recommend.ts`、`src/lib/articleId.ts`（信源归属）、`src/App.tsx`（接线）、`src/sources/categories.ts` / `preferences/*`、`scripts/recommend.test.ts`。  
> 改权重、阈值或行为时，请同步更新本文与上述测试。

## 1. 这是什么、不是什么

NewsNook 是 **backendless** 阅读工具：无账号、无自建推荐后端、不上传阅读画像。

「本地推荐」是对用户 **已订阅源** 的本地列表缓存做 **可解释的个性化重排**，不是：

- 云端协同过滤 / 热度榜 / 「大家在看」
- 向未订阅源拉取内容
- 把业务逻辑放到服务端

产品表述用「按本机已读习惯排序」，避免平台化推荐话术。这与 AGENTS 中「不要引入热度排序强推 / 账号体系」的约束对齐：能力落在本机启发式排序，而非内容平台。

## 2. 用户可见效果

| 能力 | 行为 |
|---|---|
| 动态栏位 | 「推荐」不是常驻分类，也没有独立预设：**每个预设**（含自定义）在预设内阅读量达标后，分类轨最前自动出现「推荐」栏 |
| 何时出现 | 预设候选池内累计已读 + 稍后读条目数达到 `RECOMMEND_MIN_SCOPED_DOCS`（阈值收在 `lib/recommend.ts`，UI 不感知数值）；未达标时轨道与以前完全一样 |
| 默认焦点 | 出现后**绝不自动切换**：进入软件、切换预设或当前分类失效时，默认选中仍是第一个普通分类（推荐插入后视觉上是第二个）；推荐只能手动点选或滑到 |
| 候选范围 | **严格**为该预设启用的全部信源：可见分类信源并集，综合贡献频道启用列表；不引入未订阅源，池为空（如空白预设）时推荐不亮起 |
| 预设隔离 | 就绪判定与画像都按预设候选池裁剪：在 A 预设读的池外内容，不会点亮或影响 B 预设的推荐 |
| 列表内容 | 重排后的未读条目；**已读**与**稍后读**不会出现在推荐列表（稍后读有专页） |
| 冷启动 | 池内画像 join 不到元数据时，严格按 **发布时间降序** |
| 有画像后 | 相近主题、常读信源更容易靠前，并经信源打散避免单源刷屏 |
| 何时重算 | **进入**「推荐」分类时构建一次画像；停留期间 **下拉刷新** 用新候选重排，画像不因单次已读立刻重算（避免读完返回列表跳动） |
| 条数上限 | 最多 **120** 条 |
| 保留名 | 「推荐」是动态栏位保留名：自建分类的名称与短名都不得使用（新建 / 编辑界面拦截并给中文提示，模型层兜底拒绝） |
| 升级兼容 | 旧数据中的 `recommend` 分类 id 与 `builtin-foryou` 预设归一化时自动剔除 / 回落到默认预设，不需要手工迁移 |

## 3. 原理（信号 → 就绪 → 画像 → 打分 → 打散）

全部在客户端纯函数中完成，**零网络、零上传、零新生产依赖**。

### 3.1 信号

| 信号 | 来源 | 作用 |
|---|---|---|
| 已读 | `readIds`（id 集合） | 就绪判定按 id 首段归属信源（`sourceIdOfArticleId`）；画像用与本机各池 join 出的元数据 |
| 稍后读 | 稍后读列表 | 同上，且文档权重更高；列表排除 |
| 候选池 | 预设启用信源的本地 feed 列表条目 | 被重排的对象 |

条目 id 规则为 `<sourceId>:<链接哈希>`（`lib/articleId.ts`），因此就绪判定无需先 join 元数据。画像元数据按可信度从高到低 join——稍后读 → 正文缓存阅读历史（`listCachedArticles(60)`）→ 当前可用列表（`availableArticles`），同 id 取先出现的元数据。

接线见 `App.tsx`：`recommendationScopeSourceIds` 算出候选池 → `isRecommendationReady` 决定是否亮起 → 进入 `recommend` 时 `collectReadArticles` + `scopeSignalsToSources` + `buildReadingProfile`，再对当前 `articles` 调用 `rankRecommendations`。

### 3.2 就绪（`isRecommendationReady`）

统计能归属到候选池信源的**去重**条目数（稍后读 + 已读），达到 `RECOMMEND_MIN_SCOPED_DOCS`（当前 **5**）即亮起；空候选池永远不亮。阈值只存在于 `lib/recommend.ts`，UI 只消费布尔结果。

### 3.3 画像（`buildReadingProfile`）

画像输入先经 `scopeSignalsToSources` 裁剪到候选池，预设之间互不串味。

1. 吸收文档：稍后读优先（权重 **1.5**），再已读（权重 **1**）；合计上限 **200** 篇。
2. 切词（`tokenize`）：
   - 英文：小写单词，`[a-z][a-z0-9]+`，单 token 最长 24
   - 中文：CJK 连续段上的字符 **bigram**（单字段保留单字）
3. 词面统计：标题 token 权重 **2**，摘要仅取前 **240** 字符且权重 **1**；每篇按自身词量归一后再累加进画像，避免长摘要独占。
4. 信源亲和：按文档权重累加到 `sourceId`，再按最大值归一到 **0..1**。
5. `docCount === 0` 表示冷启动。

### 3.4 打分（有画像时）

对去重且未排除的候选：

\[
\text{score} = 0.55 \cdot \text{content} + 0.2 \cdot \text{source} + 0.25 \cdot \text{freshness}
\]

对应常量：`CONTENT_WEIGHT` / `SOURCE_WEIGHT` / `FRESHNESS_WEIGHT`。

| 分量 | 计算 |
|---|---|
| content | 候选 TF（同标题/摘要权重）× 候选池内 **IDF**（`log(1 + N/(1+df))`），与画像词向量点积后按候选向量 L2 归一，再在池内按最大值归一到 0..1 |
| source | 画像中该 `sourceId` 的亲和度，缺省 0 |
| freshness | \(\exp(-\text{age} / \tau)\)，\(\tau = 36\) 小时（毫秒） |

冷启动：跳过加权，直接按 `publishedAt` 降序，再截断到 limit。

### 3.5 信源打散

按源分组后，贪心轮选：同源每已选中 \(k\) 条，下一条有效分 × **\(0.82^k\)**（`SOURCE_DAMPEN`），减轻单源刷屏。同分时较新优先。

### 3.6 输出

截断到 `RECOMMEND_LIMIT`（默认 120）。测试契约见 `npm run test:recommend`。

## 4. 产品与偏好契约

| 项 | 约定 |
|---|---|
| 分类 id | `recommend`（`RECOMMEND_CATEGORY_ID`）；分类对象为 `RECOMMEND_CATEGORY`，**不进 `CATEGORIES` 注册表** |
| 持久化 | 推荐不写入 `categoryOrder` / `hiddenCategoryIds` / 预设快照；显隐完全由运行时就绪判定决定 |
| 与 `mix` | 同为聚合分类：不参与逐分类选源持久化；候选池函数见 `recommendationScopeSourceIds` |
| 轨道拼装 | `withRecommendCategory`（亮起时插到最前）+ `defaultFeedCategoryId`（默认焦点永远取第一个普通分类） |
| 预设切换 | 若切换时正停留在推荐栏，回到新预设的第一个普通分类（候选池随预设而变，不静默延续） |
| 保留名 | `isReservedCategoryLabel`：`addCustomCategory` / `updateCustomCategory` 对名称与短名均拒绝「推荐」 |
| 归一化 | `normalizePreferences` / `normalizeSnapshot` 自动剔除旧数据中的 `recommend` id；`normalizePresetsState` 将失效的 `builtin-foryou` 回落到默认预设 |

## 5. 与「无推荐算法」约束如何共存

| 平台化做法（不做） | 本实现（做） |
|---|---|
| 上传点击流、服务端模型 | 信号与打分均在本机 |
| 未订阅源 / 热度强推 | 严格限定预设启用信源 |
| 强占首屏、自动跳转 | 达标才出现，且默认焦点永远是普通分类 |
| 黑盒排序无法解释 | 固定权重 + 冷启动时间序 + 打散系数，可测可调 |
| 账号与云同步画像 | 无；备份若含已读/稍后读，仍是用户主动导出的本机数据 |

## 6. 验证

```bash
npm run test:recommend
npm run test:layout-presets
npm run test:custom-category
npm run test:category-order
npm run lint
```

手动：新装（零阅读）任一预设都看不到推荐栏；在预设内读满阈值条数后，分类轨最前出现「推荐」，当前选中分类不跳变；点进推荐可见按已读习惯排序的未读条目；切换预设后焦点回到第一个普通分类；新建/编辑分类时把名称或短名填成「推荐」会被拦截并提示。

## 7. 调参与风险（实现者须知）

- 阈值 `RECOMMEND_MIN_SCOPED_DOCS=5`、权重（0.55 / 0.2 / 0.25）、打散 0.82、τ=36h、limit=120、画像 cap=200 均为保守缺省，**未经大规模用户调参**；改常量请同步本文与测试。
- 就绪判定只依赖 id 首段归属，O(阅读量) 且达阈值即提前返回；进入推荐分类时才扫描正文缓存索引 join 画像元数据，开销与打开「我的」同量级预期，低端机未单独压测。
- 效果依赖本机是否已有可读元数据的已读记录；只有 id、各池都 join 不到标题时，对该条几乎无内容信号（就绪判定不受影响）。
