# Media Sniffer Iframe Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保留已加载 iframe 中的静态 HLS/渐进式媒体 URL，并让播放目标获得足够的单目标探测时间。

**Architecture:** 以“已加载的 iframe 文档 + 强媒体格式 + 当前嗅探会话”为可信边界，允许 inline script 声明的媒体地址不依赖该地址已产生网络请求。原生桥与 TypeScript Graph 镜像同一规则；Target Planner 优先给一个播放目标完整预算，失败后再尝试下一个目标。

**Tech Stack:** React/TypeScript、Android WebView/Capacitor、现有 media-sniffer tests、Gradle Cloud Debug APK。

**Spec:** `docs/superpowers/specs/2026-08-20-media-sniffer-universal-hardening-design.md`

## Global Constraints

- 不新增生产依赖。
- 不写死 `huarenok`、`huavod` 或 CDN 域名。
- 保留 iframe nonce 与已加载文档校验，不能把任意 `postMessage` URL 当成媒体。
- 保留现有 `network`/`fromServiceWorker` 高可信路径。

### Task 1: Session admission regression

**Files:**
- Modify: `scripts/media-sniffer.test.ts`
- Modify: `src/features/mediaSniffer/graph.ts`

- [ ] **Step 1: Write failing tests** for an iframe static HLS URL whose iframe document URL is in the observed network set, while the HLS URL itself is not.
- [ ] **Step 2: Run** `npm run test:media-sniffer` and confirm the new assertion fails at `admitSessionObservation`.
- [ ] **Step 3: Implement** a shared semantic rule in the graph admission helper: permit strong static media from a verified loaded iframe document, but continue rejecting iframe-only media from an unverified frame.
- [ ] **Step 4: Run** the focused media test and then the full media test.

### Task 2: Native bridge parity

**Files:**
- Modify: `android/app/src/main/java/com/aizeek/newsnook/MediaSnifferPlugin.java`

- [ ] **Step 1: Add the failing native-facing fixture assertion** through the shared TypeScript behavior contract.
- [ ] **Step 2: Update `keepTrustedObservations`** to use the iframe document URL as the trust anchor for strong static media.
- [ ] **Step 3: Keep nonce/session filtering and exact network URL trust unchanged for non-static iframe events.
- [ ] **Step 4: Compile Cloud Debug Java and run media tests.

### Task 3: Target budget regression

**Files:**
- Modify: `scripts/media-sniffer.test.ts`
- Modify: `src/features/mediaSniffer/targetPlanner.ts`
- Modify: `src/features/mediaSniffer/service.ts`

- [ ] **Step 1: Change the existing two-target expectation** so the first target receives the full budget and the fallback target is marked with the remaining-policy budget.
- [ ] **Step 2: Run the test and confirm the old equal-split implementation fails.
- [ ] **Step 3: Implement sequential fallback budgeting without exceeding the global discovery budget.
- [ ] **Step 4: Verify target planning and descriptor discovery tests.

### Task 4: Verification

**Files:**
- No additional production files.

- [ ] **Step 1:** Run `npm run test:media-sniffer`.
- [ ] **Step 2:** Run `npm run lint`.
- [ ] **Step 3:** Run `android/gradlew.bat :app:assembleCloudDebug`.
- [ ] **Step 4:** Report APK path, test status, and any live-device verification still pending.
