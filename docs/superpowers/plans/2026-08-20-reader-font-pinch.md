# Reader Pinch Font Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In non-e-ink article reader, two-finger pinch continuously adjusts `typography.fontScale` with a HUD, committing to the same preference used by Settings.

**Architecture:** Pure math in `src/lib/readerFontPinch.ts`; pointer/touch state machine in `src/hooks/useReaderFontPinch.ts`; `ReaderScreen` mounts the hook on the scroll container when enabled, previews via `--reader-font-size` without writing storage each frame, and commits through existing `onTypographyChange`.

**Tech Stack:** React 19 + TypeScript, Capacitor Android WebView, existing preferences / CSS variables, `npx tsx` script tests (`node:assert/strict`).

## Global Constraints

- Only non-e-ink scrolling reader (`einkMode === false`); do not change e-ink menu pinch behavior.
- `fontScale` continuous in **0.8–1.4**; no snap to `FONT_SCALE_OPTIONS`.
- Persist only on pinch end via `onTypographyChange({ fontScale })`; never write localStorage every move frame.
- Do not steal ImageLightbox or InkVideoPlayer pinch; disable body pinch while lightbox is open (and while comments drawer is open as cheap extra guard).
- User-facing HUD copy is Chinese: `字号 ${N}%`.
- Base size formula stays `(15.5 * fontScale).toFixed(2) + 'px'` for `--reader-font-size`.
- No new production dependencies.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/readerFontPinch.ts` | Clamp range, distance→scale, HUD string, apply CSS var helper |
| `scripts/reader-font-pinch.test.ts` | Unit tests for pure helpers |
| `src/hooks/useReaderFontPinch.ts` | Two-finger gesture on a target element; preview + commit callbacks; HUD visibility |
| `src/screens/ReaderScreen.tsx` | Wire hook to `rootRef`, enabled flags, HUD UI |
| `package.json` | Add `test:reader-font-pinch` script |

---

### Task 1: Pure pinch math + tests

**Files:**
- Create: `src/lib/readerFontPinch.ts`
- Create: `scripts/reader-font-pinch.test.ts`
- Modify: `package.json` (add script)

**Interfaces:**
- Produces:
  - `READER_FONT_SCALE_MIN = 0.8`
  - `READER_FONT_SCALE_MAX = 1.4`
  - `READER_BASE_FONT_PX = 15.5`
  - `clampReaderFontScale(value: number): number`
  - `pinchFontScale(fromScale: number, fromDistance: number, distance: number): number`
  - `formatFontScaleHud(scale: number): string` → `字号 ${Math.round(scale * 100)}%`
  - `readerFontSizeCss(scale: number): string` → e.g. `"17.05px"`

- [ ] **Step 1: Write the failing test**

Create `scripts/reader-font-pinch.test.ts`:

```typescript
import assert from 'node:assert/strict'

import {
  READER_FONT_SCALE_MAX,
  READER_FONT_SCALE_MIN,
  clampReaderFontScale,
  formatFontScaleHud,
  pinchFontScale,
  readerFontSizeCss,
} from '../src/lib/readerFontPinch.ts'

assert.equal(clampReaderFontScale(0.5), READER_FONT_SCALE_MIN)
assert.equal(clampReaderFontScale(2), READER_FONT_SCALE_MAX)
assert.equal(clampReaderFontScale(1.1), 1.1)
assert.equal(clampReaderFontScale(Number.NaN), 1)

assert.equal(pinchFontScale(1, 100, 110), 1.1)
assert.equal(pinchFontScale(1, 100, 80), 0.8)
assert.equal(pinchFontScale(1, 100, 200), READER_FONT_SCALE_MAX)
assert.equal(pinchFontScale(1, 0, 100), 1)
assert.equal(pinchFontScale(1.1, 50, 50), 1.1)

assert.equal(formatFontScaleHud(1), '字号 100%')
assert.equal(formatFontScaleHud(1.104), '字号 110%')
assert.equal(formatFontScaleHud(0.88), '字号 88%')

assert.equal(readerFontSizeCss(1), '15.50px')
assert.equal(readerFontSizeCss(1.1), '17.05px')

console.log('reader-font-pinch: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/reader-font-pinch.test.ts`

Expected: FAIL (module not found / cannot resolve `readerFontPinch`)

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/readerFontPinch.ts`:

```typescript
export const READER_FONT_SCALE_MIN = 0.8
export const READER_FONT_SCALE_MAX = 1.4
export const READER_BASE_FONT_PX = 15.5

export function clampReaderFontScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(READER_FONT_SCALE_MAX, Math.max(READER_FONT_SCALE_MIN, value))
}

export function pinchFontScale(
  fromScale: number,
  fromDistance: number,
  distance: number,
): number {
  if (fromDistance <= 0 || !Number.isFinite(distance) || !Number.isFinite(fromScale)) {
    return clampReaderFontScale(fromScale)
  }
  return clampReaderFontScale(fromScale * (distance / fromDistance))
}

export function formatFontScaleHud(scale: number): string {
  return `字号 ${Math.round(clampReaderFontScale(scale) * 100)}%`
}

export function readerFontSizeCss(scale: number): string {
  return `${(READER_BASE_FONT_PX * clampReaderFontScale(scale)).toFixed(2)}px`
}

export function applyReaderFontSizeVar(scale: number): void {
  document.documentElement.style.setProperty('--reader-font-size', readerFontSizeCss(scale))
}
```

- [ ] **Step 4: Register npm script and re-run tests**

In `package.json` scripts, add:

```json
"test:reader-font-pinch": "npx tsx scripts/reader-font-pinch.test.ts"
```

Run: `npm run test:reader-font-pinch`

Expected: `reader-font-pinch: ok`

- [ ] **Step 5: Commit**

```bash
git add src/lib/readerFontPinch.ts scripts/reader-font-pinch.test.ts package.json
git commit -m "feat(reader): add pinch font-scale math helpers"
```

---

### Task 2: `useReaderFontPinch` hook

**Files:**
- Create: `src/hooks/useReaderFontPinch.ts`
- Test: extend `scripts/reader-font-pinch.test.ts` only if exporting extra pure helpers; hook itself is exercised via manual/reader wiring (DOM listeners). Prefer keeping hook thin and logic in Task 1.

**Interfaces:**
- Consumes: `pinchFontScale`, `formatFontScaleHud`, `applyReaderFontSizeVar` from Task 1
- Produces:

```typescript
export interface UseReaderFontPinchOptions {
  /** Scroll/prose container that receives touches */
  targetRef: RefObject<HTMLElement | null>
  /** Committed preference scale (from prefs) */
  fontScale: number
  enabled: boolean
  onCommit: (next: number) => void
}

export interface UseReaderFontPinchResult {
  /** Non-null while HUD should show */
  hudLabel: string | null
  /** True while two-finger pinch is active */
  pinching: boolean
}
```

- [ ] **Step 1: Implement the hook**

Create `src/hooks/useReaderFontPinch.ts` with this behavior:

1. Track active pointers in a `Map<number, { x: number; y: number }>` (Pointer Events preferred; also handle `touch*` if needed for older WebView — Pointer Events are fine on Chrome 69+ target).
2. When `enabled` is false: clear state, remove listeners, hide HUD.
3. On second pointer down: record `startDistance`, `startScale = fontScale` (or current preview if already pinching — use committed `fontScale` at pinch start).
4. On move with 2 pointers: `next = pinchFontScale(startScale, startDistance, currentDistance)`; call `applyReaderFontSizeVar(next)`; set `hudLabel = formatFontScaleHud(next)`; keep `previewRef.current = next`.
5. On pointer up / cancel when going from 2 → &lt;2 fingers: if a preview exists and differs from `fontScale` by &gt; 0.001, call `onCommit(preview)`; start a ~1000ms timeout to clear `hudLabel`; do **not** clear `--reader-font-size` (prefs update will re-apply via `usePreferences`).
6. Only call `event.preventDefault()` on `pointermove`/`touchmove` when already in an active two-finger pinch (after second finger down).
7. Attach listeners to `targetRef.current` with `{ passive: false }` for move when pinching is possible; re-bind when `enabled` or element identity changes.
8. Cleanup on unmount: clear timeout, remove listeners.

Skeleton (complete in implementation — do not leave stubs):

```typescript
import { useEffect, useRef, useState, type RefObject } from 'react'

import {
  applyReaderFontSizeVar,
  formatFontScaleHud,
  pinchFontScale,
} from '../lib/readerFontPinch'

const HUD_HOLD_MS = 1000

export interface UseReaderFontPinchOptions {
  targetRef: RefObject<HTMLElement | null>
  fontScale: number
  enabled: boolean
  onCommit: (next: number) => void
}

export function useReaderFontPinch({
  targetRef,
  fontScale,
  enabled,
  onCommit,
}: UseReaderFontPinchOptions): { hudLabel: string | null; pinching: boolean } {
  const [hudLabel, setHudLabel] = useState<string | null>(null)
  const [pinching, setPinching] = useState(false)
  // ... refs for pointers, startDistance, startScale, preview, hud timer, onCommit
  // ... useEffect for listeners when enabled
  return { hudLabel, pinching }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}
```

Use `pointerdown` / `pointermove` / `pointerup` / `pointercancel` / `lostpointercapture` on the target. Call `element.setPointerCapture?.(id)` optionally only if it does not break scrolling for single finger — **prefer not capturing** so single-finger scroll stays native; track by `pointerId` in the map from events that bubble on the element.

- [ ] **Step 2: Sanity-check TypeScript**

Run: `npx tsc -b --pretty false`

Expected: no errors from the new hook file.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useReaderFontPinch.ts
git commit -m "feat(reader): add useReaderFontPinch gesture hook"
```

---

### Task 3: Wire into `ReaderScreen` + HUD

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`

**Interfaces:**
- Consumes: `useReaderFontPinch` from Task 2; existing `fontScale`, `onTypographyChange`, `rootRef`, `lightbox`, `commentsOpen`, `einkMode`, `loadState`

- [ ] **Step 1: Mount hook**

Near other hooks in `ReaderScreen` (after refs exist):

```typescript
const pinchEnabled =
  !einkMode && loadState === 'ready' && !lightbox && !commentsOpen

const { hudLabel } = useReaderFontPinch({
  targetRef: rootRef,
  fontScale,
  enabled: pinchEnabled,
  onCommit: (next) => onTypographyChange?.({ fontScale: next }),
})
```

Import `useReaderFontPinch` from `../hooks/useReaderFontPinch`.

Note: `rootRef` is already the scroll container (`overflow-y-auto`). Do not attach to `proseRef` only — title area should also participate.

- [ ] **Step 2: Render HUD**

Inside the reader shell (sibling above chrome is fine; use `pointer-events-none`), when `hudLabel` is non-null:

```tsx
{hudLabel && (
  <div
    className="pointer-events-none absolute left-1/2 top-[40%] z-30 -translate-x-1/2 rounded-full border border-haze bg-ink/92 px-3.5 py-1.5 font-mono text-[12px] text-paper shadow-lg backdrop-blur-md"
    role="status"
    aria-live="polite"
  >
    {hudLabel}
  </div>
)}
```

Place it inside the outer `relative` reader root (same level as existing floating pills), not inside the scrolling content, so it stays fixed on screen while scrolling.

- [ ] **Step 3: Confirm edge-swipe / lightbox non-conflict**

- Existing Reader edge-back only tracks `touches.length === 1` — no code change required for two-finger.
- `pinchEnabled` already false when `lightbox` is set — ImageLightbox keeps its own pinch.
- Video gestures stay on the player node; body listeners on `rootRef` still receive bubbling touches that start on video — **mitigation:** in the hook `pointerdown` handler, if `event.target` is inside `video, .ink-video-player, [data-no-font-pinch]` (use a data attribute if player root already has a stable class), ignore that pointer / do not start pinch. Add `data-no-font-pinch` on `InkVideoPlayer` outer root **or** check `closest('video')` / known player wrapper class from `InkVideoPlayer.tsx`. Prefer `closest('[data-no-font-pinch]')` and set the attribute on the player root in the same commit if missing.

- [ ] **Step 4: Manual verification checklist (document in commit body if useful)**

On device or emulator:
1. Pinch prose → HUD + size change; release → Settings shows matching scale / 自定义.
2. Open image lightbox → pinch zooms image only.
3. Play inline video → pinch does not change body font (or only when fingers are outside player).
4. Enable e-ink → no body pinch HUD.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ReaderScreen.tsx src/components/InkVideoPlayer.tsx
git commit -m "feat(reader): pinch-to-adjust body font size with HUD"
```

(Only include `InkVideoPlayer.tsx` if you added `data-no-font-pinch`.)

---

### Task 4: Sync preview with prefs + regression test pass

**Files:**
- Possibly modify: `src/hooks/useReaderFontPinch.ts` / `ReaderScreen.tsx` if prefs re-apply fights preview
- Modify: none if already correct

**Problem to verify:** `usePreferences` re-applies typography whenever `prefs` changes. During pinch, before commit, prefs are stale — preview CSS var is correct. After commit, `update` → `applyTypography` should match preview. If React batches and briefly flashes, ensure commit uses the same `clampReaderFontScale` path.

- [ ] **Step 1: After commit, if prefs `fontScale` prop updates while HUD still visible, hook must use new `fontScale` as next pinch baseline** (already true if startScale captured at pinch begin only).

- [ ] **Step 2: Run tests**

```bash
npm run test:reader-font-pinch
npx tsc -b --pretty false
```

Expected: both pass / exit 0.

- [ ] **Step 3: Commit only if fixes were needed**

```bash
git add -u
git commit -m "fix(reader): stabilize font pinch preview against prefs apply"
```

Skip empty commit if nothing changed.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Continuous 0.8–1.4 pinch | Task 1–2 |
| HUD `字号 N%` + fade | Task 2–3 |
| Commit via `onTypographyChange` | Task 3 |
| Sync with Settings | Task 3–4 (existing prefs path) |
| Skip e-ink | Task 3 `pinchEnabled` |
| Lightbox / video isolation | Task 3 |
| Unit tests + npm script | Task 1 |
| No per-frame storage writes | Task 2 design |

## Self-review notes

- No TBD placeholders in steps.
- Signatures consistent: `pinchFontScale` / `formatFontScaleHud` / `useReaderFontPinch` / `onCommit(next: number)`.
- Edge swipe already single-touch only — documented, no forced change.
