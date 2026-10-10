interface ProbeResponseMetadata { url?: string }
type ProbePageLoader = (url: string, onResponse: (metadata: ProbeResponseMetadata) => void) => Promise<string>

/** Only a www homepage may try the same host without www after a genuine 404. */
export function apexHomepageFallback(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl)
    if (!/^https?:$/.test(url.protocol) || !url.hostname.startsWith('www.') || url.port ||
      url.username || url.password || url.pathname !== '/' || url.search) return undefined
    const apex = url.hostname.slice(4)
    if (!apex.includes('.')) return undefined
    url.hostname = apex
    url.hash = ''
    return url.href
  } catch { return undefined }
}

/** Preserve the actual fetched URL for CMS discovery, source saving and link resolution. */
export async function fetchProbeEntryPage(
  url: string,
  load: ProbePageLoader,
  signal?: AbortSignal,
): Promise<{ html: string; url: string }> {
  const fetchPage = async (candidate: string) => {
    let resolved = candidate
    const html = await load(candidate, (metadata) => { if (metadata.url) resolved = metadata.url })
    return { html, url: resolved }
  }

  try {
    return await fetchPage(url)
  } catch (error) {
    if (signal?.aborted || !(error instanceof Error) || error.message !== 'HTTP 404') throw error
    const fallback = apexHomepageFallback(url)
    if (!fallback) throw error
    try {
      return await fetchPage(fallback)
    } catch (fallbackError) {
      if (signal?.aborted) throw fallbackError
      if (fallbackError instanceof Error && fallbackError.message === 'HTTP 404') {
        throw new Error('两种域名的请求均返回 HTTP 404；如果浏览器正常，请检查应用代理或站点对非浏览器请求的限制。')
      }
      throw fallbackError
    }
  }
}
