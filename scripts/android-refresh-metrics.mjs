function currentVotes(source) {
  const table = source.match(/^[ \t]*mVotesByDisplay:[ \t]*\r?\n((?:[ \t]{4,}[^\r\n]+\r?\n?)*)/m)?.[1] ?? ''
  const globalVotes = new Map()
  const displayVotes = new Map()
  let displayId
  for (const line of table.split(/\r?\n/)) {
    const id = line.match(/^\s*(-?\d+):\s*$/)
    if (id) {
      displayId = Number(id[1])
      continue
    }
    const vote = line.trim().match(/^(PRIORITY_\w+)\s*->/)
    if (vote && displayId === -1) globalVotes.set(vote[1], line.trim())
    if (vote && displayId === 0) displayVotes.set(vote[1], line.trim())
  }
  return new Map([...globalVotes, ...displayVotes])
}

const readNumber = (source, pattern) => {
  const match = source.match(pattern)
  return match ? Number(match[1]) : null
}

export function readDisplayMetrics(source) {
  const devices = source.split(/\r?\n/).filter(line => line.includes('DisplayDeviceInfo{'))
  const internal = devices.find(line => line.includes('FLAG_DEFAULT_DISPLAY'))
    ?? devices.find(line => /\btype INTERNAL\b|uniqueId="local:/.test(line))
    ?? devices[0] ?? ''
  const modes = [...internal.matchAll(/\{id=(\d+)\b[^}]*?\bfps=([\d.]+)/g)]
  const supportedRates = internal.match(/\bsupportedRefreshRates\s*\[([^\]]+)\]/)?.[1]
    .split(',').map(Number).filter(Number.isFinite) ?? []
  const modeId = internal.match(/\bmodeId\s+(\d+)/)?.[1]
  const activeMode = modes.find(mode => mode[1] === modeId)
  const physicalRate = readNumber(source, /^\s*mActiveSfDisplayMode=[^\r\n]*?\bvsyncRate=([\d.]+)/m)
    ?? (activeMode ? Number(activeMode[2]) : null)
  const renderRate = readNumber(internal, /\brenderFrameRate\s*(?:[=:]\s*)?([\d.]+)/)
    ?? readNumber(source, /^\s*mActiveRenderFrameRate=([\d.]+)/m)
  const votes = currentVotes(source)
  const miuiVote = votes.get('PRIORITY_MIUI_REFRESH_RATE') ?? ''
  return {
    physicalRate,
    renderRate,
    maximumRate: Math.max(0, ...supportedRates, ...modes.map(mode => Number(mode[2]))),
    miuiMaxRate: readNumber(miuiVote, /\b(?:mMaxRefreshRate|maxRefreshRate|max)\s*=\s*([\d.]+)/),
    votes: [...votes.values()],
  }
}
