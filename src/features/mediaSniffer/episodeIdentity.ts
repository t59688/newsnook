/** Common CMS coordinates: content id / playback line / episode. No domain-specific rules. */
export function episodeIdentity(value: string): { content: string; episode: number } | undefined {
  try {
    const path = new URL(value).pathname
    const match = /\/(?:vodplay|play)\/([^/]+?)[-_]\d+[-_](\d+)(?:\.html?)?\/?$/i.exec(path)
    return match ? { content: match[1], episode: Number(match[2]) } : undefined
  } catch { return undefined }
}
