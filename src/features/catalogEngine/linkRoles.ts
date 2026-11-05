/** Catalog entries are documents, never poster files or player controls. */
export function isCatalogContentUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && !/\.(?:avif|webp|png|jpe?g|gif|svg|ico|bmp|tiff?|mp4|m4v|webm|mov|mkv|flv|m3u8|mpd|m4s|ts|mp3|m4a|aac|ogg|opus|css|js|woff2?)(?:$)/i.test(url.pathname)
  } catch { return false }
}

/** Exact control labels only; a real headline mentioning 1080P remains a headline. */
export function isPlaybackControlTitle(value: string): boolean {
  const label = value.trim().replace(/[\s\u00a0[\]【】()（）·|_-]+/g, '')
  if (!label || label.length > 32) return false
  return /^(?:(?:[248]K|[1-9]\d{2,3}[pPiI]|(?:full)?HD|HD中字|SD|UHD|蓝光|超清|高清|标清|流畅|原画|超高清|抢先|正片|预告片|自动)(?:画质|播放|线路|中字|版)?)+$/i.test(label)
    || /^(?:播放)?(?:线路|片源|云播|播放器|备用线路)[一二三四五六七八九十\dA-Za-z]*$/.test(label)
    || /^第[零一二三四五六七八九十百\d]+[集期话章]$/.test(label)
    || /^(?:立即播放|在线播放|点击播放|播放地址|切换线路|下一集|上一集|播放|play|watch)$/i.test(label)
}

export const PLAYBACK_CONTROL_CONTAINERS = '.playlist, .play-list, .playlists, .stui-content__playlist, .myui-content__playlist, .module-play-list, .play-source, .play-sources, .player-controls, [data-player-controls], [role="tablist"]'

export function isPlaybackControlAnchor(anchor: Element): boolean {
  const label = anchor.getAttribute('title') || anchor.getAttribute('aria-label') || anchor.textContent || ''
  return isPlaybackControlTitle(label) || Boolean(anchor.closest(PLAYBACK_CONTROL_CONTAINERS))
}
