import { Capacitor } from '@capacitor/core'

import { nativeProxiedRequest, decodeBase64ToArrayBuffer } from '../../proxy/nativeHttp'
import { md5Hex } from '../../../lib/hash'
import type { ZhihuApiClient } from '../api/client'
import { asRecord } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import type { ZhihuSessionService } from '../session/service'

const OSS_HOST = 'https://zhihu-pics-upload.zhimg.com'
const OSS_RESOURCE_PREFIX = '/zhihu-pics/v2-'
const OSS_USER_AGENT = 'aliyun-sdk-js/6.8.0 Chrome 99.0.4844.84 on Windows 10 64-bit'
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

interface UploadToken {
  accessId: string
  accessKey: string
  accessToken: string
}

export interface UploadedZhihuImage {
  imageId: string
  url: string
  originalUrl: string
  watermarkUrl?: string
  watermarkMode?: string
  width: number
  height: number
  mediaType: string
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bytesAsLatin1(bytes: Uint8Array): string {
  let output = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return output
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesAsLatin1(bytes))
}

function responseText(base64: string): string {
  return new TextDecoder().decode(decodeBase64ToArrayBuffer(base64))
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
  return bytesToBase64(signature)
}

function singlePutSignSource(
  mediaType: string,
  date: string,
  token: UploadToken,
  imageHash: string,
): string {
  return [
    'PUT',
    '',
    mediaType,
    date,
    `x-oss-date:${date}`,
    `x-oss-security-token:${token.accessToken}`,
    `x-oss-user-agent:${OSS_USER_AGENT}`,
    `${OSS_RESOURCE_PREFIX}${imageHash}`,
  ].join('\n')
}

function multipartSignSource(
  method: 'POST' | 'PUT',
  contentType: string,
  date: string,
  token: UploadToken,
  imageHash: string,
  subResource: string,
): string {
  return [
    method,
    '',
    contentType,
    date,
    `x-oss-date:${date}`,
    `x-oss-security-token:${token.accessToken}`,
    `x-oss-user-agent:${OSS_USER_AGENT}`,
    `${OSS_RESOURCE_PREFIX}${imageHash}?${subResource}`,
  ].join('\n')
}

function ossHeaders(date: string, token: UploadToken, authorization: string): Record<string, string> {
  return {
    'x-oss-date': date,
    'x-oss-user-agent': OSS_USER_AGENT,
    'x-oss-security-token': token.accessToken,
    Authorization: authorization,
  }
}

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      const result = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return result
    } catch {
      // Android WebView fallback below.
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      const result = { width: image.naturalWidth || 0, height: image.naturalHeight || 0 }
      URL.revokeObjectURL(url)
      resolve(result)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: 0, height: 0 })
    }
    image.src = url
  })
}

function decodeApplyResponse(raw: unknown): { imageId: string; state: number; token?: UploadToken } {
  const root = asRecord(raw)
  const file = asRecord(root?.upload_file ?? root?.uploadFile)
  const tokenRaw = asRecord(root?.upload_token ?? root?.uploadToken)
  const imageId = stringValue(file?.image_id ?? file?.imageId)
  const state = numberValue(file?.state)
  if (!imageId || state === undefined) throw new ZhihuApiError('invalid-response', '知乎图片申请响应缺少 image_id/state')
  let token: UploadToken | undefined
  if (tokenRaw) {
    const accessId = stringValue(tokenRaw.access_id ?? tokenRaw.accessId)
    const accessKey = stringValue(tokenRaw.access_key ?? tokenRaw.accessKey)
    const accessToken = stringValue(tokenRaw.access_token ?? tokenRaw.accessToken)
    if (accessId && accessKey && accessToken) token = { accessId, accessKey, accessToken }
  }
  return { imageId, state, token }
}

async function ossSinglePut(hash: string, bytes: Uint8Array, mediaType: string, token: UploadToken): Promise<void> {
  const date = new Date().toUTCString()
  const signature = await hmacSha1Base64(token.accessKey, singlePutSignSource(mediaType, date, token, hash))
  const response = await nativeProxiedRequest({
    url: `${OSS_HOST}/v2-${hash}`,
    method: 'PUT',
    headers: { ...ossHeaders(date, token, `OSS ${token.accessId}:${signature}`), 'Content-Type': mediaType },
    dataBase64: bytesToBase64(bytes),
    followRedirects: false,
    connectTimeout: 15_000,
    readTimeout: 60_000,
  })
  if (response.status < 200 || response.status >= 300) throw new Error(`知乎图片 OSS 上传失败（${response.status}）`)
}

async function ossMultipart(hash: string, bytes: Uint8Array, token: UploadToken): Promise<void> {
  const initDate = new Date().toUTCString()
  const initSub = 'uploads'
  const initSignature = await hmacSha1Base64(token.accessKey, multipartSignSource('POST', '', initDate, token, hash, initSub))
  const init = await nativeProxiedRequest({
    url: `${OSS_HOST}/v2-${hash}?uploads`,
    method: 'POST',
    headers: ossHeaders(initDate, token, `OSS ${token.accessId}:${initSignature}`),
    omitContentType: true,
    data: '',
    followRedirects: false,
    readTimeout: 30_000,
  })
  if (init.status < 200 || init.status >= 300) throw new Error(`知乎 GIF 分片初始化失败（${init.status}）`)
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(responseText(init.data))?.[1]
  if (!uploadId) throw new Error('知乎 GIF 分片初始化没有返回 UploadId')

  const etags: Array<{ partNumber: number; etag: string }> = []
  const partSize = 1024 * 1024
  for (let offset = 0, partNumber = 1; offset < bytes.length; offset += partSize, partNumber += 1) {
    const part = bytes.subarray(offset, Math.min(bytes.length, offset + partSize))
    const sub = `partNumber=${partNumber}&uploadId=${uploadId}`
    const date = new Date().toUTCString()
    const signature = await hmacSha1Base64(token.accessKey, multipartSignSource('PUT', 'application/octet-stream', date, token, hash, sub))
    const response = await nativeProxiedRequest({
      url: `${OSS_HOST}/v2-${hash}?${sub}`,
      method: 'PUT',
      headers: { ...ossHeaders(date, token, `OSS ${token.accessId}:${signature}`), 'Content-Type': 'application/octet-stream' },
      dataBase64: bytesToBase64(part),
      followRedirects: false,
      readTimeout: 60_000,
    })
    if (response.status < 200 || response.status >= 300) throw new Error(`知乎 GIF 分片 ${partNumber} 上传失败（${response.status}）`)
    const etag = response.headers.etag ?? response.headers.ETag ?? response.headers.Etag
    if (!etag) throw new Error(`知乎 GIF 分片 ${partNumber} 没有返回 ETag`)
    etags.push({ partNumber, etag })
  }

  const completeBody = `<CompleteMultipartUpload>${etags.map((item) => `<Part><PartNumber>${item.partNumber}</PartNumber><ETag>${item.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
  const completeSub = `uploadId=${uploadId}`
  const completeDate = new Date().toUTCString()
  const completeSignature = await hmacSha1Base64(token.accessKey, multipartSignSource('POST', 'application/xml', completeDate, token, hash, completeSub))
  const complete = await nativeProxiedRequest({
    url: `${OSS_HOST}/v2-${hash}?${completeSub}`,
    method: 'POST',
    headers: { ...ossHeaders(completeDate, token, `OSS ${token.accessId}:${completeSignature}`), 'Content-Type': 'application/xml' },
    data: completeBody,
    followRedirects: false,
    readTimeout: 30_000,
  })
  if (complete.status < 200 || complete.status >= 300) throw new Error(`知乎 GIF 分片合并失败（${complete.status}）`)
}

function statusImage(raw: unknown): { status?: string; src?: string; original?: string; watermark?: string; watermarkSrc?: string } {
  const root = asRecord(raw)
  return {
    status: stringValue(root?.status),
    src: stringValue(root?.src),
    original: stringValue(root?.original_src ?? root?.originalSrc),
    watermark: stringValue(root?.watermark),
    watermarkSrc: stringValue(root?.watermark_src ?? root?.watermarkSrc),
  }
}

export class ZhihuImageUploadService {
  private readonly api: ZhihuApiClient
  private readonly session: ZhihuSessionService

  constructor(api: ZhihuApiClient, session: ZhihuSessionService) {
    this.api = api
    this.session = session
  }

  async upload(file: File, source: 'article' | 'pin', signal?: AbortSignal): Promise<UploadedZhihuImage> {
    if (!Capacitor.isNativePlatform()) throw new Error('知乎图片上传需要 Android 原生二进制 HTTP 通道')
    if (!IMAGE_TYPES.has(file.type)) throw new Error('仅支持 PNG / JPEG / GIF / WebP 图片')
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('图片必须大于 0 且不超过 20 MB')
    const generation = this.session.getSnapshot().generation
    const bytes = new Uint8Array(await file.arrayBuffer())
    this.session.assertGeneration(generation)
    const hash = md5Hex(bytesAsLatin1(bytes))
    const dimensions = await imageDimensions(file)
    // 参考实现这里使用 account HttpClient 直连 api.zhihu.com/images，而不是 postSigned。
    // 显式 signing:none，避免 transport 的默认 Web ZSE 签名污染图片协议。
    const rawApply = await this.api.requestRawJson(
      'image.upload',
      'https://api.zhihu.com/images',
      'POST',
      JSON.stringify({ image_hash: hash, source }),
      { 'Content-Type': 'application/json' },
      signal,
      { signing: 'none' },
    )
    const apply = decodeApplyResponse(rawApply)
    this.session.assertGeneration(generation)

    if (apply.state === 2) {
      if (!apply.token) throw new Error('知乎要求上传图片，但没有返回临时 OSS 凭据')
      if (file.type === 'image/gif') await ossMultipart(hash, bytes, apply.token)
      else await ossSinglePut(hash, bytes, file.type, apply.token)
      this.session.assertGeneration(generation)
      await this.api.requestRawJson(
        'image.status.set',
        `https://api.zhihu.com/images/${encodeURIComponent(apply.imageId)}/uploading_status`,
        'PUT',
        JSON.stringify({ upload_result: 'success' }),
        { 'Content-Type': 'application/json' },
        signal,
        { signing: 'none' },
      )
    }

    let latest: ReturnType<typeof statusImage> = {}
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const raw = await this.api.getJsonWithHeaders(
        'image.status.get',
        `https://api.zhihu.com/images/${encodeURIComponent(apply.imageId)}`,
        {},
        signal,
        { signing: 'none' },
      )
      latest = statusImage(raw)
      if (latest.status === 'success') break
      if (attempt < 9) await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000))
    }
    this.session.assertGeneration(generation)
    if (latest.status !== 'success') throw new Error('知乎图片处理超时；本机草稿和原图已保留，可稍后重试')
    const url = latest.src ?? latest.watermarkSrc ?? latest.original ?? `${OSS_HOST}/v2-${hash}`
    return {
      imageId: apply.imageId,
      url,
      originalUrl: latest.original ?? url,
      watermarkUrl: latest.watermarkSrc,
      watermarkMode: latest.watermark,
      width: dimensions.width,
      height: dimensions.height,
      mediaType: file.type,
    }
  }
}
