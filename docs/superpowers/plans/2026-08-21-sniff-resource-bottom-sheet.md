# 嗅探资源底部抽屉 Implementation Plan

> **For agentic workers:** 按任务逐步执行；每步用复选框勾选。

**Goal:** 将 `MediaResourceOverlay` 从右下角浮层改为与 `OptionPickerDialog` 同款的底部抽屉；打开藏胶囊，关闭/选中后胶囊回来。

**Architecture:** 仅改写 `InkVideoPlayer.tsx` 内 `MediaResourceOverlay` 的 JSX/样式。父级已有 `resourceMenuOpen` + `onSelect` 时 `setResourceMenuOpen(false)`，G3 已满足。可选补一条源码级断言。

**Tech Stack:** React、现有 Tailwind token（`haze` / `ink-raised` / `paper`）、`createPortal` 至 `document.body`。

---

### Task 1: 改写 MediaResourceOverlay 为底部抽屉

**Files:**
- Modify: `src/components/InkVideoPlayer.tsx`（`MediaResourceOverlay`）
- Modify: `scripts/origin-player-live-sniff.test.ts` 或新建轻量断言（可选；优先在现有 sniff UI 相关 test 旁加对 Overlay 源码的 match）

- [x] **Step 1:** 关闭态仅渲染胶囊；`open` 时不渲染胶囊。
- [x] **Step 2:** `open` 时渲染全屏遮罩 + 底部面板（把手、标题、列表）；点遮罩调用 `onToggle` 关闭。
- [x] **Step 3:** Escape 关闭；`body` overflow 锁定（对齐 OptionPicker）。
- [x] **Step 4:** 列表项点击仍走 `onSelect`（父级会关菜单）。
- [x] **Step 5:** `npm run test:origin-player-live-sniff`（若加了断言）或至少 oxlint 该文件。

---

### Task 2: 规格状态

- [x] 将 `docs/superpowers/specs/2026-08-21-sniff-resource-bottom-sheet-design.md` 状态改为已实现。
