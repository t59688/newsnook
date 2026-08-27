import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  loadEnabledSources,
  loadPreferences,
  loadPresetsState,
  savePresetsState,
} from '../lib/storage'
import {
  activatePreset,
  applySnapshotToPrefs,
  buildFreshInstallPresetsState,
  buildMigratedPresetsState,
  createBlankUserPreset,
  deleteUserPreset,
  ensureValidActivePreset,
  listResolvedBuiltins,
  normalizePresetsState,
  renameUserPreset,
  resolvePreset,
  restoreBuiltinFactory,
  saveAsUserPreset,
  snapshotFromRuntime,
  snapshotsEqual,
  updateActiveSnapshot,
  type LayoutPreset,
  type LayoutSnapshot,
  type PresetsState,
} from '../sources/presets'
import { normalizePreferences, type Preferences } from '../sources/preferences'
import { SOURCES } from '../sources/registry'

const DEFAULT_ENABLED = SOURCES.filter((source) => source.enabled).map((source) => source.id)

function bootstrapPresetsState(): PresetsState {
  const normalized = normalizePresetsState(loadPresetsState())
  if (normalized) return normalized

  const rawPrefs = loadPreferences()
  const rawEnabled = loadEnabledSources()
  const hadRuntime = rawPrefs != null || rawEnabled !== undefined

  if (hadRuntime) {
    return buildMigratedPresetsState(
      normalizePreferences(rawPrefs),
      rawEnabled ?? DEFAULT_ENABLED,
    )
  }

  return buildFreshInstallPresetsState()
}

export interface UsePresetsArgs {
  prefs: Preferences
  enabledIds: string[]
  updatePrefs: (updater: (prev: Preferences) => Preferences) => void
  setEnabledIds: (ids: string[] | ((prev: string[]) => string[])) => void
}

export interface UsePresetsApi {
  state: PresetsState
  builtins: readonly LayoutPreset[]
  activePreset: LayoutPreset | undefined
  applyPreset: (id: string) => void
  saveAs: (name: string, description?: string) => string
  createBlank: (name: string) => string
  restoreFactory: (id?: string) => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  /**
   * 云同步专用入口：整包替换预设。
   * 远端下发的运行时（偏好 + 启用信源）与预设在同一批里写回，
   * 所以要跳过一次「按运行时回写活动快照」，否则刚收到的预设会被本机快照覆盖。
   */
  replaceFromSync: (next: PresetsState) => void
}

export function usePresets({
  prefs,
  enabledIds,
  updatePrefs,
  setEnabledIds,
}: UsePresetsArgs): UsePresetsApi {
  const [state, setState] = useState<PresetsState>(() => {
    const initial = ensureValidActivePreset(bootstrapPresetsState())
    savePresetsState(initial)
    return initial
  })

  const stateRef = useRef(state)
  stateRef.current = state

  const skipSync = useRef(true)

  useEffect(() => {
    savePresetsState(state)
  }, [state])

  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false
      return
    }

    const snapshot = snapshotFromRuntime(prefs, enabledIds)
    setState((prev) => {
      const ensured = ensureValidActivePreset(prev)
      const current = resolvePreset(ensured, ensured.activePresetId)
      if (current && snapshotsEqual(current.snapshot, snapshot)) {
        return ensured === prev ? prev : ensured
      }
      return updateActiveSnapshot(ensured, snapshot)
    })
  }, [prefs, enabledIds])

  const pushRuntime = useCallback(
    (snapshot: LayoutSnapshot) => {
      updatePrefs((prev) => applySnapshotToPrefs(prev, snapshot))
      setEnabledIds(snapshot.enabledSourceIds)
    },
    [setEnabledIds, updatePrefs],
  )

  const activePreset = useMemo(() => resolvePreset(state, state.activePresetId), [state])
  const builtins = useMemo(() => listResolvedBuiltins(state), [state])

  const applyPreset = useCallback(
    (id: string) => {
      const result = activatePreset(stateRef.current, id)
      if (!result) return
      setState(result.state)
      pushRuntime(result.snapshot)
    },
    [pushRuntime],
  )

  const saveAs = useCallback(
    (name: string, description?: string) => {
      const current = resolvePreset(stateRef.current, stateRef.current.activePresetId)
      const snapshot = snapshotFromRuntime(prefs, enabledIds)
      const { state: next, preset } = saveAsUserPreset(
        stateRef.current,
        snapshot,
        name,
        description,
        current?.builtin ? current.id : undefined,
      )
      setState(next)
      return preset.id
    },
    [enabledIds, prefs],
  )

  const createBlank = useCallback(
    (name: string) => {
      const { state: next, preset } = createBlankUserPreset(stateRef.current, name)
      setState(next)
      pushRuntime(preset.snapshot)
      return preset.id
    },
    [pushRuntime],
  )

  const restoreFactory = useCallback(
    (id?: string) => {
      const targetId = id ?? stateRef.current.activePresetId
      const result = restoreBuiltinFactory(stateRef.current, targetId)
      if (!result) return
      setState(result.state)
      if (result.applied) pushRuntime(result.snapshot)
    },
    [pushRuntime],
  )

  const rename = useCallback((id: string, name: string) => {
    setState(renameUserPreset(stateRef.current, id, name))
  }, [])

  const replaceFromSync = useCallback((next: PresetsState) => {
    skipSync.current = true
    setState(ensureValidActivePreset(next))
  }, [])

  const remove = useCallback(
    (id: string) => {
      const prev = stateRef.current
      const next = ensureValidActivePreset(deleteUserPreset(prev, id))
      setState(next)
      if (next.activePresetId !== prev.activePresetId) {
        const active = resolvePreset(next, next.activePresetId)
        if (active) pushRuntime(active.snapshot)
      }
    },
    [pushRuntime],
  )

  return {
    state,
    builtins,
    activePreset,
    applyPreset,
    saveAs,
    createBlank,
    restoreFactory,
    rename,
    remove,
    replaceFromSync,
  }
}
