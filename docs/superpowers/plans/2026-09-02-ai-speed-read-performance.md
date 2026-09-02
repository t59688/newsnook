# AI 速读性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 AI 速读流式生成引发的整页重渲染、无效正文分页测量与流读取资源滞留，同时保留关闭面板后继续生成并可恢复的特性。

**Architecture:** 用一个同步外部快照存储承接高频 partial，只有打开的 AI 面板订阅它；阅读器只管理打开/关闭和任务终态。流传输继续使用现有调度器和请求路径，并在所有退出路径确定性释放 reader lock。

**Tech Stack:** React 19、TypeScript、Vite 8、Node assert 测试

**Spec:** `docs/superpowers/specs/2026-09-02-ai-speed-read-performance.md`

## Global Constraints

- 关闭面板不得终止 AI 任务，重开后恢复最新进度。
- 不改变提示词、模型请求、输出、缓存、导出与分享效果。
- 不引入生产依赖，不改变公开 API 或持久化格式。

---

### Task 1: 可恢复的流式快照存储

**Files:**
- Create: `src/features/speedRead/partialStore.ts`
- Modify: `scripts/speed-read.test.ts`

**Interfaces:**
- Produces: `createSpeedReadPartialStore(initial?)`，返回稳定的 `getSnapshot`、`subscribe`、`set`、`reset`。

- [x] **Step 1: Write the failing test**

在 `scripts/speed-read.test.ts` 中验证：无订阅者时更新仍保留最新快照；相同快照不重复通知；退订后不再通知；reset 恢复空快照。

- [x] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/speed-read.test.ts`
Expected: FAIL，模块 `partialStore` 尚不存在。

- [x] **Step 3: Write minimal implementation**

实现一个只保存单个不可变快照和 listener `Set` 的外部存储；逐字段相等时复用当前快照，不广播。

- [x] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/speed-read.test.ts`
Expected: PASS。

### Task 2: 隔离流式面板重渲染

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`
- Modify: `src/components/AiSpeedReadPanel.tsx`

**Interfaces:**
- Consumes: `SpeedReadPartialStore`。
- Produces: 面板打开时订阅 store，关闭时零订阅；Reader 只在任务开始、结束、失败或取消时重渲染。

- [x] **Step 1: Write the failing behavioral assertions**

扩展 store 测试，明确覆盖“关闭面板（退订）期间继续写入、重新读取时拿到最新进度”的恢复语义。

- [x] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/speed-read.test.ts`
Expected: FAIL，恢复语义尚未由 store 提供。

- [x] **Step 3: Write minimal integration**

`ReaderScreen` 的 `onPartial` 只写 store；缓存命中、开始、成功、失败、文章切换同步更新 store。`AiSpeedReadPanel` 使用 `useSyncExternalStore`，关闭时传入空订阅函数，重开时读取当前快照。

- [x] **Step 4: Run focused test**

Run: `npx tsx scripts/speed-read.test.ts`
Expected: PASS。

### Task 3: 删除无效分页工作并释放流资源

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`
- Modify: `src/features/speedRead/streamChat.ts`
- Modify: `scripts/speed-read.test.ts`

**Interfaces:**
- Consumes: 现有 `streamChatCompletion` API。
- Produces: 正文分页键不再依赖 portal 内容；所有流退出路径释放 reader lock。

- [x] **Step 1: Write the failing stream cleanup test**

用受控 `ReadableStream`/fetch response 调用 `streamChatCompletion`，验证成功消费后流不再保持 reader lock。

- [x] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/speed-read.test.ts`
Expected: FAIL，当前实现未显式释放 lock。

- [x] **Step 3: Write minimal implementation**

读取循环放入 `try/finally` 并调用 `reader.releaseLock()`；`measureKey` 删除速读内容长度，仅保留实际正文依赖。

- [x] **Step 4: Run focused and project verification**

Run: `npx tsx scripts/speed-read.test.ts`
Expected: PASS。

Run: `npm run lint`
Expected: exit 0。

Run: `npm run build`
Expected: exit 0。
