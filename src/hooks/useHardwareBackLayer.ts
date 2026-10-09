import { useEffect, useRef } from 'react'

import {
  registerHardwareBackLayer,
  type HardwareBackLayerHandler,
} from '../lib/hardwareBackStack'

/**
 * Registers a visible transient layer for Android/system back handling.
 * The latest handler is always called without re-registering on every render.
 */
export function useHardwareBackLayer(
  active: boolean,
  handler: HardwareBackLayerHandler,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!active) return
    return registerHardwareBackLayer(() => handlerRef.current())
  }, [active])
}
