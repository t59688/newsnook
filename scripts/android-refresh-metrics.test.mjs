import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readDisplayMetrics } from './android-refresh-metrics.mjs'

const display = `
  DisplayDeviceInfo{"内置屏幕": uniqueId="local:123", modeId 2, renderFrameRate 120.00001, supportedModes [{id=1, fps=60, alternativeRefreshRates=[120]}, {id=2, fps=120, alternativeRefreshRates=[60]}], type INTERNAL}
    mActiveSfDisplayMode=DisplayMode{id=1, vsyncRate=120.00001}
    mActiveRenderFrameRate=120.00001
    mIgnorePreferredRefreshRate: true
  Display mode history:
    mVotes:
      PRIORITY_MIUI_REFRESH_RATE -> RenderVote{ mMaxRefreshRate=60.0 }
`

test('reads the live internal display and ignores historical and unrelated votes', () => {
  const metrics = readDisplayMetrics(display + `
  mVotesByDisplay:
    -1:
      PRIORITY_MIUI_REFRESH_RATE -> RenderVote{ mMaxRefreshRate=120.0 }
    0:
      PRIORITY_APP_REQUEST_BASE_MODE_REFRESH_RATE -> RequestedRefreshRateVote{ refreshRate=120.00001 }
    2:
      PRIORITY_MIUI_REFRESH_RATE -> RenderVote{ mMaxRefreshRate=60.0 }
  SensorObserver
`)
  assert.equal(metrics.renderRate, 120.00001)
  assert.equal(metrics.physicalRate, 120.00001)
  assert.equal(metrics.maximumRate, 120)
  assert.equal(metrics.miuiMaxRate, 120)
  assert.equal(metrics.votes.length, 2)
})

test('prefers a display-specific vote and falls back to the selected mode for physical Hz', () => {
  const metrics = readDisplayMetrics(display.replace(/^.*mActiveSfDisplayMode=.*$/m, '') + `
  mVotesByDisplay:
    -1:
      PRIORITY_MIUI_REFRESH_RATE -> RenderVote{ mMaxRefreshRate=120.0 }
    0:
      PRIORITY_MIUI_REFRESH_RATE -> RenderVote{ mMaxRefreshRate=60.0 }
`)
  assert.equal(metrics.physicalRate, 120)
  assert.equal(metrics.miuiMaxRate, 60)
})

test('does not infer a cap when the current vote table is absent', () => {
  assert.equal(readDisplayMetrics(display).miuiMaxRate, null)
})

test('keeps panel and render rates separate when only supported refresh rates are dumped', () => {
  const metrics = readDisplayMetrics(`
  DisplayDeviceInfo{"Built-in Screen": uniqueId="local:123", renderFrameRate=60, supportedRefreshRates [60, 120]}
    mActiveSfDisplayMode=DisplayMode{id=1, vsyncRate=120}
`)
  assert.equal(metrics.physicalRate, 120)
  assert.equal(metrics.renderRate, 60)
  assert.equal(metrics.maximumRate, 120)
})
