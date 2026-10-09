# 媒体嗅探命中率加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在已有 Classifier Gate / Target Planner 上落地 Untitled-8 的 P1–P4（除 P2-9），提高详情/播放分离站点命中率。

**Architecture:** Planner 改为置信度门控 + 顺序剩余预算 + 播放页预取 iframe；service 产出即停；播放器一次自动换源；Android 延迟点击与魔数；classifier 负规则。

**Tech Stack:** 现有 mediaSniffer TS、Capacitor Android、`scripts/media-sniffer.test.ts`。

## Global Constraints

- 无 CMS 模块名；测试夹具可用通用 playback path / JSON-LD
- `src/` 日志走 `log.sniffer`
- 不引入生产依赖；插件只增不改破坏性签名
- 每 Task 后 `npm run test:media-sniffer`

---

### Task 1: Planner 置信度、多目标、剩余预算、reason

**Files:** `src/features/mediaSniffer/targetPlanner.ts`, `scripts/media-sniffer.test.ts`

- `hasConfidentDirectMedia(obs)`：score ≥ 100 且非 segment
- `planSniffTargets`：不均分；每个 target `budgetMs = totalTimeoutMs`（service 再按剩余截断）
- 无自信媒体时返回最多 2 条 secondary；有 playbackHtml 时优先其 iframe
- 有自信媒体：iframe（若有）+ page，仍顺序不均分

### Task 2: service 预取、产出即停、12s、摘要日志

**Files:** `service.ts`, `resolveBody.ts` timeout 9000→12000

### Task 3: classifier 仿冒扩展名 / rtmp；core 播放变量；apiParser data 包裹

### Task 4: `nextNonAdResource` + InkVideoPlayer 一次自动换源

### Task 5: Android 延迟点击、魔数、URL 前缀头

### Task 6: 测试与 architecture §8.3 补一句
