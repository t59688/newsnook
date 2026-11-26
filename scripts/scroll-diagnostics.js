/** Opt-in input-cancellation probe used by scroll-lifecycle tests and DevTools. */
const eventRecords = []
const limit = 200
const originalPreventDefault = Event.prototype.preventDefault
const remember = (entry) => {
  eventRecords.push(entry)
  if (eventRecords.length > limit) eventRecords.shift()
}

function observedPreventDefault() {
  if (this.type === 'touchmove' || this.type === 'pointermove') {
    remember({ type: 'preventDefault', prevented: true, stack: new Error().stack || '' })
  }
  return originalPreventDefault.call(this)
}

function onMove(event) {
  remember({ type: event.type, prevented: event.defaultPrevented })
}

Event.prototype.preventDefault = observedPreventDefault
document.addEventListener('touchmove', onMove)
document.addEventListener('pointermove', onMove)

window.__newsnookScrollProbe = {
  snapshot() {
    return { records: eventRecords.slice() }
  },
  stop() {
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('pointermove', onMove)
    Event.prototype.preventDefault = originalPreventDefault
    delete window.__newsnookScrollProbe
  },
}
