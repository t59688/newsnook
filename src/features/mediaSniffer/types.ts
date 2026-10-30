export type MediaFormat =
  | 'progressive'
  | 'hls'
  | 'dash'
  | 'video-track'
  | 'audio-track'
  | 'segment'
  | 'blob'
  | 'unknown'

export type PlayableMediaFormat = 'progressive' | 'hls' | 'dash'

export type MediaObservationSource =
  | 'network'
  | 'dom'
  | 'fetch'
  | 'xhr'
  | 'performance'
  | 'mse'
  | 'static'

export type MediaTitleSource = 'player' | 'structured' | 'page' | 'filename' | 'generated'

/** Display-only metadata. Playback URLs and request context remain untouched. */
export interface MediaMetadata {
  title?: string
  titleSource?: MediaTitleSource
  pageTitle?: string
  fileName?: string
  playerSource?: string
  fromIframe?: boolean
  contentId?: string
  isAd?: boolean
}

export interface MediaObservation extends MediaMetadata {
  url?: string
  pageUrl: string
  source: MediaObservationSource
  mimeType?: string
  method?: string
  requestHeaders?: Record<string, string>
  statusCode?: number
  timestamp?: number
  drmKeySystem?: string
  mseMimeType?: string
  mediaKind?: 'video' | 'audio'
  hasAudio?: boolean
  hasVideo?: boolean
  width?: number
  height?: number
  bitrate?: number
  quality?: string
  bodyText?: string
  codecs?: string
  fromIframe?: boolean
  fromServiceWorker?: boolean
  /** Set only after native nonce + loaded-frame/network provenance verification. */
  provenanceVerified?: boolean
  sessionNonce?: string
  assetGroup?: string
  /** Runtime MSE/player correlation identifier. Native/JS may provide it. */
  mediaSessionId?: string
  /** Optional segment-base metadata used when synthesising DASH. */
  initializationRange?: string
  indexRange?: string
}

export interface RequestContext {
  origin: string
  headers: Record<string, string>
}

export interface MediaAssetTrack {
  id: string
  url: string
  role: 'video' | 'audio' | 'subtitle' | 'manifest'
  mimeType?: string
  codecs?: string
  width?: number
  height?: number
  bitrate?: number
  language?: string
  quality?: string
  initializationRange?: string
  indexRange?: string
  requestContext: RequestContext
}

export interface MediaAsset extends MediaMetadata {
  id: string
  pageUrl: string
  score: number
  drm: boolean
  drmKeySystems: string[]
  manifest?: MediaAssetTrack
  videos: MediaAssetTrack[]
  audios: MediaAssetTrack[]
  subtitles: MediaAssetTrack[]
  syntheticMpd?: string
  /** URL/path signals indicate a preroll or other advertising media. */
  isAd?: boolean
}

export interface MediaTrack {
  kind: 'video' | 'audio' | 'subtitle'
  url?: string
  bandwidth?: number
  width?: number
  height?: number
  codecs?: string
  language?: string
  groupId?: string
  subtitleGroupId?: string
  id?: string
  label?: string
  quality?: string
}

export interface MediaCandidate {
  originalUrl: string
  fingerprint: string
  pageUrl: string
  format: MediaFormat
  mediaKind: 'video' | 'audio' | 'unknown'
  mimeType?: string
  hasAudio?: boolean
  hasVideo?: boolean
  width?: number
  height?: number
  bitrate?: number
  score: number
  sources: MediaObservationSource[]
  requestHeaders?: Record<string, string>
}

export interface MediaResourceDescriptor extends MediaMetadata {
  type: PlayableMediaFormat
  url: string
  pageUrl: string
  score: number
  mimeType?: string
  hasAudio?: boolean
  videoTracks: MediaTrack[]
  audioTracks: MediaTrack[]
  subtitles: MediaTrack[]
  drm: boolean
  drmKeySystems: string[]
  requestHeaders?: Record<string, string>
  /** All URLs required by a synthetic/segmented asset, for native header setup. */
  relatedUrls?: string[]
  /** Exact origins used by the asset's tracks and manifest. */
  origins?: string[]
  /** Stable graph id used by the resource picker. */
  id?: string
  /** True when the URL has strong advertising/preroll markers. */
  isAd?: boolean
}

export interface MediaDescriptor extends MediaResourceDescriptor {
  /** All playable candidates discovered on the page, including the selected one. */
  resources?: MediaResourceDescriptor[]
}
