import { createElement, lazy, type ComponentProps, type ComponentType } from 'react'

/** Keep page code out of startup, but render warmed pages without a Suspense flash. */
export function lazyScreen<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let component: T | undefined
  let pending: Promise<{ default: T }> | undefined
  const preload = () => {
    pending ??= load().then(module => {
      component = module.default
      return module
    }).catch(error => {
      pending = undefined
      throw error
    })
    return pending
  }
  const Lazy = lazy(preload)
  let Render: ComponentType<any> | undefined
  function Screen(props: ComponentProps<T>) {
    // Keep the element type stable if the first visit happened before warming.
    Render ??= component ?? Lazy
    return createElement(Render, props)
  }
  return Object.assign(Screen, { preload })
}
