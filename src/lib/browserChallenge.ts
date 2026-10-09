export type BrowserChallengeKind = 'cloudflare'

export interface BrowserChallengeResponse {
  status: number
  body?: string
  headers?: Record<string, string>
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return ''
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value
  }
  return ''
}

/**
 * Detect browser challenges rather than treating every 403 as one.
 *
 * Cloudflare managed/interstitial challenges intentionally return an HTTP error
 * to non-browser clients and then execute JavaScript in a real browser to mint
 * the clearance session. Authorization 403s must not enter this fallback.
 */
export function detectBrowserChallenge(
  response: BrowserChallengeResponse,
): BrowserChallengeKind | null {
  if (response.status !== 403 && response.status !== 429 && response.status !== 503) return null

  // `cf-mitigated: challenge` is Cloudflare's authoritative response signal.
  // In particular, managed rate-limit challenges can use 429 rather than 403,
  // and API clients may receive a terse/plain response body with no HTML markers.
  if (headerValue(response.headers, 'cf-mitigated').toLowerCase().includes('challenge')) {
    return 'cloudflare'
  }

  const body = (response.body ?? '').slice(0, 128_000).toLowerCase()
  const server = headerValue(response.headers, 'server').toLowerCase()
  const cfRay = headerValue(response.headers, 'cf-ray')

  const hasChallengeMarkup =
    body.includes('/cdn-cgi/challenge-platform') ||
    body.includes('cf-chl-') ||
    body.includes('challenge-form') ||
    body.includes('cf-turnstile')
  const hasInterstitialCopy =
    body.includes('<title>just a moment') ||
    body.includes('enable javascript and cookies to continue') ||
    body.includes('performing security verification')
  const cloudflareHeader = server.includes('cloudflare') || Boolean(cfRay)
  const cloudflareBody = body.includes('cloudflare') || body.includes('cdn-cgi')

  if (hasChallengeMarkup && (cloudflareHeader || cloudflareBody)) return 'cloudflare'
  if (hasInterstitialCopy && (cloudflareHeader || cloudflareBody)) return 'cloudflare'
  return null
}
