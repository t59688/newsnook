# RSS 目录两阶段建设 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans，在当前会话完成实现与验证。

**Goal:** 独立发现、转换、检查公开来源，再离线更新唯一权威 upstream.json。

**Architecture:** 第一阶段为可复制到任意目录运行的 Python 标准库工具，不导入或读写 NewsNook 的 src、data、package.json。输出带出处、检查历史、明确决策的本地报告。第二阶段为仓库内 TypeScript 桥接器，默认预览，显式 apply 后才原子更新权威文件；种子与发布产物继续沿用现有链路。

**Tech Stack:** Python 3 标准库；现有 TypeScript / tsx 校验链，无新依赖。

**Spec:** 用户指定的两阶段边界及所引用会话最后确认的收录规则。

## Global Constraints

- 不以最近更新时间限制收录。
- 永久失效：最近连续至少 3 次独立检查均 404/410，跨度至少 7 天，并且身份无法再确认；403/429/5xx、超时、TLS、单 RSSHub 实例失败均非永久失效。
- 采集产物、下载、检查历史不提交 Git；仅工具、文档、测试、最终权威目录及派生种子入库。
- 不推送、不发布 R2/APK，不改变客户端阅读、存储或网络行为。

## Review Focus

- 非规范 OPML、无标题 Feed 列表：先提取候选，成功解析 Feed 后才补齐名称。
- 同平台同 ID 不同内容路由保留；不同平台同名身份不盲目合并。
- 检查历史按运行标识去重，实例重试不能凑成三次独立检查。
- 限时、限响应大小、限制并发、续跑；无效 HTML 不能冒充 Feed。
- 导入前完整验证，失败不修改权威文件；不变输入不得增加 revision。

### Task 1: 独立采集与检查

**Files:** `tools/feed-catalog/{catalog.py,test_catalog.py,sources.json,README.md}`

- [x] 先写测试并观察失败：列表/CSV/OPML/Markdown、真实 UID 转换、Feed 格式、永久失效、暂时故障、独立运行。
- [x] 实现发现、声明式 Radar 模板匹配、身份/路由去重、受限网络检查、JSONL 历史与可重复报告。
- [x] 用 unittest 验证；使用公开目录做真实采集，保存到忽略目录 artifacts/feed-catalog。按用户最新要求停止运行，剩余候选由用户续跑；不声称全量检查完成。

### Task 2: 离线权威目录更新

**Files:** `scripts/rss-catalog-merge.ts`、对应测试、`package.json`、目录维护文档。

- [x] 先写测试并观察失败：拒绝未验证候选、稳定 ID、去重、原有条目保护、revision 幂等、错误零写入。
- [x] 实现仅接受报告中的合格新增，不自动删除原有记录；永久失效作为人工审查报告，不凭一次运行清理。
- [x] 使用现有 normalizeUpstreamCatalog 和发布器校验完整结果；默认预览，apply 更新权威目录。真实部分报告仅预览验证，未 apply。
- [x] 容量提升到 32 MiB / 100,000 条，50,001 条发布回归及上限拒绝测试通过；不改变目录结构。
- [ ] 用户自行续跑检查、审阅报告后 apply，再生成种子与本地发布文件。按最新指令，本次不更新权威数据，不发布。
