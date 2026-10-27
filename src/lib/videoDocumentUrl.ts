/** Strong document routes, shared by catalog parsing, cache migration and Reader recovery. */
export function isVideoDocumentUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol)) return false
    return /\/(?:v|watch|videos?|clips?|voddetail|vodplay|dianying|dianshiju|vod\/(?:detail|play)(?:\/id)?)\/[^/]+/i.test(url.pathname)
      || /\/(?:videos?|watch|voddetail|vodplay|clip|play)[-_]\d+(?:[-_]\d+)*(?:\.html?)?(?:\/|$)/i.test(url.pathname)
  } catch { return false }
}
