export interface ZhihuRequest {
  operation: string
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: string
  bodyBase64?: string
  headers?: Record<string, string>
  signing?: 'web-zse96' | 'none'
  accountId?: string
  generation: number
  retry: 'safe-read' | 'never'
}

export interface ZhihuResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface ZhihuTransport {
  request(input: ZhihuRequest, signal?: AbortSignal): Promise<ZhihuResponse>
}
