# Linux.do Feed and Thread Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Linux.do 信息流加载与安全验证回流，并补齐分类/标签导航、回复目标跳转和常见正文渲染能力。

**Architecture:** 保持 `UI -> linuxdo services -> API client -> native HTTP` 的现有依赖方向。把纯数据解码与导航决策放在可测试模块中，React 组件只组合这些结果；安全验证成功后由调用侧显式刷新原信息流。

**Tech Stack:** React 19、TypeScript、Tailwind CSS v4、Capacitor 8、Android WebView、Node `assert` 测试脚本

**Spec:** `docs/superpowers/specs/2026-09-21-linuxdo-feed-thread-parity.md`

## Global Constraints

- 不新增生产依赖。
- 不改变 NewsNook 的 local-first 主阅读链路。
- `src/` 不直接使用 `console.*`。
- 第三方 cooked HTML 继续经过 DOMPurify 与本地安全栅栏。
- 修改集中在 `features/linuxdo`、对应 CSS、Android 会话桥和 Linux.do 测试。

---

### Task 1: 行为回归测试与数据契约

**Files:**
- Modify: `scripts/linuxdo.test.ts`
- Modify: `src/features/linuxdo/types.ts`
- Modify: `src/features/linuxdo/api/decode.ts`

**Interfaces:**
- Consumes: Discourse `reply_to_user`、`reply_to_post_number`、topic/category/tag fixtures
- Produces: `LinuxDoPost.replyToUser`；后续 UI 直接消费

- [ ] **Step 1: 写失败测试**

在 `decodeTopic` fixture 中加入 `reply_to_user`，断言解码后用户名、头像和目标楼层完整；加入安全验证后刷新决策与筛选 scope 的行为断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:linuxdo`
Expected: FAIL，提示 `replyToUser` 或新行为接口不存在。

- [ ] **Step 3: 写最小实现**

增加 `LinuxDoReplyTarget` 与 `replyToUser?: LinuxDoReplyTarget`，在 `decodePost` 中读取 `reply_to_user`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:linuxdo`
Expected: PASS

### Task 2: 安全验证完成后刷新信息流

**Files:**
- Create: `src/features/linuxdo/ui/feedModel.ts`
- Modify: `src/features/linuxdo/ui/LinuxDoWorkspace.tsx`
- Test: `scripts/linuxdo.test.ts`

**Interfaces:**
- Consumes: `onVerify(): Promise<boolean>`
- Produces: `retryAfterVerification(verify, reload): Promise<boolean>`

- [ ] **Step 1: 写失败测试**

断言验证成功时按 `verify -> reload` 顺序调用一次；验证失败时不调用 reload。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:linuxdo`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写最小实现并接线**

将 `FeedView.onVerify` 改为异步布尔返回；按钮在验证成功后执行 `load(true)`，并在过程中显示明确加载态。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:linuxdo`
Expected: PASS

### Task 3: 分类、标签与信息流统计导航

**Files:**
- Create: `src/features/linuxdo/ui/discoveryScope.ts`
- Modify: `src/features/linuxdo/ui/shared.tsx`
- Modify: `src/features/linuxdo/ui/CommunityViews.tsx`
- Modify: `src/features/linuxdo/ui/LinuxDoWorkspace.tsx`
- Test: `scripts/linuxdo.test.ts`

**Interfaces:**
- Produces: `LinuxDoDiscoveryScope = { kind: 'category'; category } | { kind: 'tag'; name }`
- `TopicCard` 新增 `onOpenCategory`、`onOpenTag`，点击 chip 时阻止主题主入口触发。

- [ ] **Step 1: 写失败测试**

用字面 fixture 断言 category/tag scope key 与加载器选择，避免 React 源码字符串断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:linuxdo`
Expected: FAIL，scope 模块不存在。

- [ ] **Step 3: 写最小实现并接线**

将 TopicCard 外层改为语义容器，主内容和 chips 分别可点击；DiscoverView 接收初始 scope 并自动加载对应主题。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:linuxdo`
Expected: PASS

### Task 4: 回复目标指示与主题详情渲染

**Files:**
- Modify: `src/features/linuxdo/ui/ThreadViews.tsx`
- Modify: `src/features/linuxdo/content/sanitize.ts`
- Modify: `src/index.css`
- Test: `scripts/linuxdo.test.ts`

**Interfaces:**
- Consumes: `LinuxDoPost.replyToUser`、`replyToPostNumber`
- Produces: 可点击的回复目标 pill；正文语义 marker 与稳定样式

- [ ] **Step 1: 写失败测试**

加入折叠区、表格、代码块、日期/上传附件等常见 cooked HTML fixture，断言危险属性被移除且必要语义 marker 保留。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:linuxdo`
Expected: FAIL，新增 marker 尚不存在。

- [ ] **Step 3: 写最小实现并接线**

在帖子头右侧展示回复对象并调用现有 `jumpToPost`；为 Discourse 常用结构补 marker 和局部 CSS，继续复用统一链接分发。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:linuxdo`
Expected: PASS

### Task 5: 可辨识加载骨架与端到端验证

**Files:**
- Modify: `src/features/linuxdo/ui/LinuxDoWorkspace.tsx`
- Modify: `src/features/linuxdo/ui/ThreadViews.tsx`
- Modify: `src/features/linuxdo/ui/CommunityViews.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Produces: `.linuxdo-skeleton` shimmer；reduced-motion/eink 安全降级

- [ ] **Step 1: 写失败测试**

扩展 Linux.do 行为测试，断言 loading model 由 `initial | refreshing | more | idle` 映射为稳定文案与可访问状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:linuxdo`
Expected: FAIL，loading model 不存在。

- [ ] **Step 3: 写最小实现并替换低对比 pulse**

新增高对比移动高光骨架，列表、详情和发现页共用；动效关闭时显示静态占位。

- [ ] **Step 4: 执行完整验证**

Run: `npm run test:linuxdo`
Run: `npm run lint`
Run: `npm run build`
Expected: 全部 exit 0。

- [ ] **Step 5: Android 覆盖安装验证**

Run: `npm run android:apk:cloud`
Run: `adb -s emulator-5554 install -r <generated-apk>`
Expected: 安装成功且应用数据保留；信息流、筛选、主题回复跳转可在模拟器中复验。
