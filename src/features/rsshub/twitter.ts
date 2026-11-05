/** Twitter / X removed native RSS; recognize public profiles without fetching a blocked HTML page. */
const PROFILE_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'])
export const TWITTER_RESERVED_PATHS = new Set(['home', 'explore', 'search', 'notifications', 'messages', 'i', 'settings', 'intent', 'share', 'hashtag', 'compose', 'login', 'signup', 'tos', 'privacy', 'about', 'account', 'download', 'help', 'jobs', 'terms', 'safety', 'business', 'developers', 'premium'])

export function twitterProfileRssHubRoute(input: string): { handle: string; routePath: string } | null {
  let url: URL
  try { url = new URL(input) } catch { return null }
  if (!PROFILE_HOSTS.has(url.hostname.toLowerCase()) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 1 || !/^[A-Za-z0-9_]{1,15}$/.test(parts[0]) || TWITTER_RESERVED_PATHS.has(parts[0].toLowerCase())) return null
  return { handle: parts[0], routePath: `/twitter/user/${parts[0]}` }
}
