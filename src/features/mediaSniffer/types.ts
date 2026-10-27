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

export interface MediaObservation {
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
  /** Source/line label declared by a CMS player, not a verified resolution. */
  sourceLabel?: string
  bodyText?: string
  codecs?: string
  fromIframe?: boolean
  fromServiceWorker?: boolean
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

export interface MediaAsset {
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
  quality?: string
  groupId?: string
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

export interface MediaResourceDescriptor {
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
  /** Quality/line label declared by the source player, distinct from verified resolution. */
  sourceLabel?: string
  /** True when the URL has strong advertising/preroll markers. */
  isAd?: boolean
}

export interface MediaDescriptor extends MediaResourceDescriptor {
  /** All playable candidates discovered on the page, including the selected one. */
  resources?: MediaResourceDescriptor[]
}
