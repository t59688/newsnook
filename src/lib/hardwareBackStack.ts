export type HardwareBackLayerHandler = () => boolean

type HardwareBackLayer = {
  id: number
  handler: HardwareBackLayerHandler
}

const layers: HardwareBackLayer[] = []
let nextLayerId = 1

/**
 * Register a transient UI layer that should get first chance at Android's
 * hardware/system back action.
 *
 * Registration is LIFO: the most recently mounted visible layer is asked first.
 * The returned cleanup only removes this exact registration, so StrictMode
 * mount/unmount cycles and multiple simultaneous overlays cannot overwrite one
 * another.
 */
export function registerHardwareBackLayer(handler: HardwareBackLayerHandler): () => void {
  const layer: HardwareBackLayer = { id: nextLayerId++, handler }
  layers.push(layer)

  let removed = false
  return () => {
    if (removed) return
    removed = true
    const index = layers.findIndex((entry) => entry.id === layer.id)
    if (index >= 0) layers.splice(index, 1)
  }
}

/**
 * Give the topmost registered transient layer the Android back action.
 * Returning true consumes the action; false lets the next registered layer try.
 */
export function dismissTopHardwareBackLayer(): boolean {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index]
    try {
      if (layer.handler()) return true
    } catch {
      // A broken overlay must not let one back press unexpectedly exit the app.
      return true
    }
  }
  return false
}

/** Test-only visibility into the registry contract. */
export function hardwareBackLayerCount(): number {
  return layers.length
}

export function clearHardwareBackLayersForTests(): void {
  layers.splice(0, layers.length)
}
