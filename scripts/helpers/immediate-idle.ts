// Browser storage schedules writes during idle time. Flush them before test assertions.
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: Object.assign(new EventTarget(), {
    requestIdleCallback: (callback: () => void) => { callback(); return 0 },
    setTimeout,
    clearTimeout,
  }),
})
