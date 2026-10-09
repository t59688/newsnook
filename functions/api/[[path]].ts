import { findSource, offsetPageRequest, userAgentFor, type NewsSource } from '../../src/sources/registry.ts'

export interface EventContext<Env = unknown, Params extends string = any, Data = Record<string, unknown>> {
  request: Request
  functionPath: string
  waitUntil: (promise: Promise<unknown>) => void
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>
  env: Env
  params: Record<Params, string | string[]>
  data: Data
}

export type PagesFunction<
  Env = unknown,
  Params extends string = any,
  Data = Record<string, unknown>,
> = (context: EventContext<Env, Params, Data>) => Response | Promise<Response>

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BILIBILI_PAGE_HOST_RE = /(?:^|\.)bilibili\.com$/i
const BILIBILI_ASSET_HOST_RE = /(?:^|\.)(?:hdslb\.com|bilivideo\.com)$/i

function corsHeaders(): Headers {
  const headers = new Headers()
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, User-Agent, Authorization, Accept, Accept-Language')
  headers.set('Access-Control-Max-Age', '86400')
  return headers
}

function feedRequestHeaders(
  source: NewsSource,
  method: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': userAgentFor(source),
    Accept:
      'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/json, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(source.requestHeaders ?? {}),
  }
  if (method === 'POST') {
    headers['Content-Type'] = source.requestBodyType === 'json'
      ? 'application/json; charset=UTF-8'
      : 'application/x-www-form-urlencoded; charset=UTF-8'
  }
  return headers
}

function encodeFormBody(form?: Record<string, string | number>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form ?? {})) {
    params.set(key, String(value))
  }
  return params.toString()
}

export const onRequest: PagesFunction = async (context) => {
  const { request, params } = context
  const url = new URL(request.url)
  const pathParam = params.path
  const pathSegments = Array.isArray(pathParam) ? pathParam : pathParam ? [pathParam] : []
  const firstSegment = pathSegments[0]

  // 处理 OPTIONS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  try {
    // 1. /api/feed/:id
    if (firstSegment === 'feed') {
      const sourceId = pathSegments[1]
      if (!sourceId) {
        return new Response('Missing source id', { status: 400, headers: corsHeaders() })
      }

      const source = findSource(sourceId)
      if (!source) {
        return new Response(`Unknown source: ${sourceId}`, { status: 404, headers: corsHeaders() })
      }

      const pageRaw = url.searchParams.get('page')
      const page = pageRaw != null && pageRaw !== '' ? Number(pageRaw) : 0
      const paged = Number.isFinite(page)
        ? offsetPageRequest(source, page)
        : { url: source.url, requestForm: source.requestForm, requestJson: source.requestJson }

      const method = (request.method || 'GET').toUpperCase()
      const wantPost = method === 'POST' || source.requestMethod === 'POST'
      let body: string | undefined

      if (wantPost) {
        if (method === 'POST') {
          body = await request.text()
        }
        if (!body) {
          body = source.requestBodyType === 'json'
            ? JSON.stringify(paged.requestJson ?? source.requestJson ?? {})
            : encodeFormBody(paged.requestForm ?? source.requestForm)
        }
      }

      const headers = feedRequestHeaders(source, wantPost ? 'POST' : 'GET')
      const upstream = await fetch(paged.url, {
        method: wantPost ? 'POST' : 'GET',
        headers,
        body,
        redirect: 'follow',
      })

      const respHeaders = corsHeaders()
      const contentType = upstream.headers.get('content-type')
      if (contentType) respHeaders.set('Content-Type', contentType)
      respHeaders.set('Cache-Control', 'no-store')

      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders,
      })
    }

    // 2. /api/page (正文 / 任意页面代理)
    if (firstSegment === 'page') {
      const target = url.searchParams.get('url')
      if (!target) return new Response('Missing url', { status: 400, headers: corsHeaders() })

      const targetUrl = new URL(target)
      const requestedUa = url.searchParams.get('ua')
      const requestedAccept = url.searchParams.get('accept')
      const isNetease =
        target.includes('163.com') || target.includes('netease.com') || target.includes('126.net')
      const isBilibiliPage = BILIBILI_PAGE_HOST_RE.test(targetUrl.hostname)

      const headers: Record<string, string> = {
        'User-Agent': isNetease ? 'NewsApp' : isBilibiliPage ? BROWSER_UA : requestedUa || BROWSER_UA,
        Accept:
          requestedAccept ||
          'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: isBilibiliPage
          ? 'https://www.bilibili.com/'
          : targetUrl.hostname.endsWith('.translate.goog')
            ? 'https://translate.google.com/'
            : `${targetUrl.origin}/`,
      }

      const upstream = await fetch(target, { headers, redirect: 'follow' })
      const respHeaders = corsHeaders()
      respHeaders.set('Content-Type', upstream.headers.get('content-type') || 'text/html; charset=utf-8')
      respHeaders.set('Cache-Control', 'no-store')

      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders,
      })
    }

    // 3. /api/post (Google News 链接解密等 POST 代理)
    if (firstSegment === 'post') {
      const target = url.searchParams.get('url')
      if (!target) return new Response('Missing url', { status: 400, headers: corsHeaders() })

      const requestedUa = url.searchParams.get('ua')
      const body = await request.text()

      const upstream = await fetch(target, {
        method: 'POST',
        headers: {
          'User-Agent': requestedUa || BROWSER_UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: '*/*',
          Referer: 'https://news.google.com/',
        },
        body,
        redirect: 'follow',
      })

      const respHeaders = corsHeaders()
      respHeaders.set('Content-Type', upstream.headers.get('content-type') || 'text/plain; charset=utf-8')
      respHeaders.set('Cache-Control', 'no-store')

      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders,
      })
    }

    // 4. /api/image & /api/media (防盗链图片/视频代理)
    if (firstSegment === 'image' || firstSegment === 'media') {
      const target = url.searchParams.get('url')
      if (!target) return new Response('Missing url', { status: 400, headers: corsHeaders() })

      const targetUrl = new URL(target)
      const isMedia = firstSegment === 'media'
      const requestedUa = url.searchParams.get('ua')
      const isNetease = /(?:^|\.)(?:163\.com|netease\.com|126\.net)$/i.test(targetUrl.hostname)
      const isBilibiliAsset = BILIBILI_ASSET_HOST_RE.test(targetUrl.hostname)
      if (!isMedia && isNetease && targetUrl.protocol === 'http:') targetUrl.protocol = 'https:'
      const isWechatImage =
        !isMedia &&
        /(?:^|\.)(?:mmbiz\.qpic\.cn|mmecoa\.qpic\.cn|qlogo\.cn)$/i.test(targetUrl.hostname)

      const headers: Record<string, string> = {
        'User-Agent': isNetease && !isMedia ? 'NewsApp' : requestedUa || BROWSER_UA,
        Accept: isMedia ? '*/*' : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      }
      if (!isWechatImage) {
        headers.Referer = isNetease
          ? isMedia
            ? 'https://3g.163.com/'
            : 'https://www.163.com/'
          : isBilibiliAsset
            ? 'https://www.bilibili.com/'
            : `${targetUrl.origin}/`
      }

      const upstream = await fetch(targetUrl.href, { headers, redirect: 'follow' })
      const respHeaders = corsHeaders()
      respHeaders.set(
        'Content-Type',
        upstream.headers.get('content-type') || (isMedia ? 'application/octet-stream' : 'image/jpeg'),
      )
      respHeaders.set('Cache-Control', 'public, max-age=3600')

      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders,
      })
    }

    // 5. /api/dev-proxy-prefs
    if (firstSegment === 'dev-proxy-prefs') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders() })
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Internal Server Error', {
      status: 502,
      headers: corsHeaders(),
    })
  }
}
