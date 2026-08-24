import { onRequest } from './api/[[path]].ts'
import { shareCardResponse, shareImageResponse } from './lib/shareCard.ts'

export interface Env {
  ASSETS?: {
    fetch: (request: Request | string, init?: RequestInit) => Promise<Response>
  }
}

export interface ExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void
  passThroughOnException?: () => void
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // 1. /api/* 请求交由反向代理逻辑处理
    if (url.pathname.startsWith('/api/')) {
      const pathSegments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
      return onRequest({
        request,
        params: { path: pathSegments },
        functionPath: url.pathname,
        waitUntil: ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : () => {},
        next: async () =>
          env.ASSETS
            ? env.ASSETS.fetch(request)
            : new Response('Not Found', { status: 404 }),
        env,
        data: {},
      })
    }

    // 2. /a/<token>/og.png 卡片首图：转发上游首图，抓不到给品牌兜底图
    const cardImage = await shareImageResponse(request, url, env)
    if (cardImage) return cardImage

    // 3. /a/* 分享深链：社交爬虫拿带 Open Graph 标签的卡片，真人继续走 SPA
    const card = await shareCardResponse(request, url)
    if (card) return card

    // 4. 其余静态资源和前端 SPA 页面由 dist 静态资产服务
    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return new Response('Asset binding ASSETS not found', { status: 500 })
  },
}
