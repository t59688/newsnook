# LinuxDo Complete Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 LinuxDo App 发帖页重构成具备完整格式化、插入、分类标签管理、草稿、上传和预览能力的生产级编辑器。

**Architecture:** 将无 UI 的文本选区编辑、标签归一化和校验规则放进 `editor/model.ts`，由独立 React 组件组合工具栏、选择器、插入抽屉和预览；`ThreadViews.tsx` 只保留弹层生命周期、服务调用与草稿编排。所有发帖数据继续走既有 `LinuxDoTopicService`、`LinuxDoDraftService` 和 `LinuxDoUploadService`。

**Tech Stack:** React 19、TypeScript、Tailwind CSS v4、lucide-react、marked、现有 LinuxDo API services

**Spec:** `docs/superpowers/specs/2026-09-21-linuxdo-composer-design.md`

## Global Constraints

- 不新增生产依赖。
- 保持 NewsNook local-first；LinuxDo 草稿与发布只直连 LinuxDo。
- `src/` 不使用 `console.*`。
- 新主题标题最少 6 个 Unicode 字符、正文最少 20 个 Unicode 字符、标签最多 5 个。
- 回复与编辑复用编辑内核，但不提交标题、分类或标签。

---

### Task 1: 可测试的编辑器文本模型

**Files:**
- Create: `src/features/linuxdo/editor/model.ts`
- Modify: `scripts/linuxdo.test.ts`

**Interfaces:**
- Produces: `applyComposerCommand(raw, selection, command)`、`insertComposerSnippet(raw, selection, kind, context?)`、`validateComposer(input)`、`normalizeComposerTag(value)`。
- Consumes: 无 UI 或浏览器全局。

- [x] **Step 1: Write the failing tests**

在 `scripts/linuxdo.test.ts` 中用字面量断言粗体包裹、空选区链接、列表逐行前缀、Details/投票/日期片段、标签归一化和 6/20 字符校验。

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:linuxdo`

Expected: FAIL because `src/features/linuxdo/editor/model.ts` does not exist.

- [x] **Step 3: Write minimal implementation**

实现：

```ts
export type ComposerSelection = { start: number; end: number }
export type ComposerEdit = { value: string; selection: ComposerSelection }
export function applyComposerCommand(raw: string, selection: ComposerSelection, command: ComposerCommand): ComposerEdit
export function insertComposerSnippet(raw: string, selection: ComposerSelection, kind: ComposerSnippetKind, context?: ComposerSnippetContext): ComposerEdit
export function validateComposer(input: ComposerValidationInput): ComposerValidation
export function normalizeComposerTag(value: string): string
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test:linuxdo`

Expected: PASS.

### Task 2: 编辑器组件与本地完整预览

**Files:**
- Create: `src/features/linuxdo/editor/ComposerEditor.tsx`
- Create: `src/features/linuxdo/editor/ComposerSheets.tsx`
- Create: `src/features/linuxdo/editor/preview.ts`
- Modify: `scripts/linuxdo.test.ts`

**Interfaces:**
- Consumes: Task 1 的命令、片段和校验 API。
- Produces: `ComposerEditor`，通过 `value/onChange` 受控；`CategoryPickerSheet`、`TagPickerSheet`、`InsertMenuSheet`；`renderLinuxDoComposerPreview(raw)`。

- [x] **Step 1: Write the failing preview tests**

断言预览会消毒脚本、渲染 GFM 表格，并把 `[details]`、`[spoiler]`、`[poll]` 与图表代码块转换成可辨识的安全预览结构。

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:linuxdo`

Expected: FAIL because the preview renderer does not exist.

- [x] **Step 3: Implement the editor UI**

实现 44px 触控工具栏、横向滚动、选区保持、键盘快捷键、撤销/重做、上传按钮、编辑/预览切换，以及分类、标签和 `+` 菜单的移动端底部抽屉。

- [x] **Step 4: Implement safe preview**

使用现有 `marked` 解析基础 Markdown，先将 Discourse 扩展语法转成预览 HTML，再交给 `sanitizeLinuxDoCooked` 消毒；图表类源码显示为带类型标题的代码卡片。

- [x] **Step 5: Run tests**

Run: `npm run test:linuxdo`

Expected: PASS.

### Task 3: 接入新主题、回复、编辑与草稿

**Files:**
- Modify: `src/features/linuxdo/ui/ThreadViews.tsx`
- Modify: `src/features/linuxdo/types.ts`
- Modify: `src/features/linuxdo/api/decode.ts`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `ComposerEditor`、现有 `linuxDoTopics`、`linuxDoDrafts`、`linuxDoUploads`。
- Produces: 完整的新主题/回复/编辑体验，不改变 `LinuxDoComposer` 的公开 props。

- [x] **Step 1: Add category hierarchy data**

在 `LinuxDoCategory` 增加可选 `parentId`，从 `parent_category_id` 解码，选择器据此展示层级但仍提交原有数值 `category`。

- [x] **Step 2: Replace the MVP form**

将原 textarea 区替换为全高编辑容器；新主题展示标题/分类/标签，回复与编辑显示上下文；上传结果插入编辑器当前选区。

- [x] **Step 3: Preserve draft and submit contracts**

继续保存 `reply/title/categoryId/tags`，保持 900ms 防抖、sequence 冲突提示和成功后清草稿；提交前使用 Task 1 校验。

- [x] **Step 4: Add production styling**

在 `src/index.css` 增加作用域为 `.linuxdo-composer` 的布局、工具栏、选择器、预览和安全区样式；覆盖窄屏、横屏、平板和桌面宽度。

- [x] **Step 5: Run focused verification**

Run: `npm run test:linuxdo && npm run lint && npm run build`

Expected: all commands exit 0.

### Task 4: 视觉与交互验收

**Files:**
- Modify only files from Tasks 1–3 when an issue is found.

**Interfaces:**
- Consumes: production build.
- Produces: 360–430px 宽移动端和桌面弹层均可操作的最终界面。

- [x] **Step 1: Open the app and inspect the composer**

验证标题计数、分类搜索、标签创建、工具栏、插入抽屉、预览和安全区。

- [x] **Step 2: Exercise keyboard and focus flows**

验证 `Ctrl/Cmd+B`、`Ctrl/Cmd+I`、Tab 顺序、Escape/Android 返回键关闭内层抽屉后再关闭编辑器。

- [x] **Step 3: Re-run automated checks after visual fixes**

Run: `npm run test:linuxdo && npm run lint && npm run build`

Expected: all commands exit 0.
