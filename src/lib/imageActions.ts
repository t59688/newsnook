import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Media } from '@capacitor-community/media'

const ALBUM_NAME = '有所闻'
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'

export type ImageActionResult = 'saved' | 'shared' | 'cancelled'

interface PreparedImage {
  /** file:// URI，供 Share / Media 使用 */
  fileUri: string
  /** data URI，供 Media.savePhoto 兜底 */
  dataUri: string
  fileName: string
  mime: string
}

function extensionFromUrl(url: string, mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  try {
    const path = new URL(url).pathname.toLowerCase()
    const match = path.match(/\.(png|jpe?g|webp|gif)(?:$|\?)/i)
    if (match) return match[1].toLowerCase().replace('jpeg', 'jpg')
  } catch {
    /* ignore */
  }
  return 'jpg'
}

function mimeFromExtension(ext: string): string {
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/jpeg'
  }
}

async function fetchImageBytes(url: string): Promise<{ base64: string; mime: string }> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'blob',
      readTimeout: 30000,
      connectTimeout: 15000,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`下载失败 HTTP ${response.status}`)
    }
    const raw = typeof response.data === 'string' ? response.data : ''
    const base64 = raw.replace(/^data:[^;]+;base64,/, '')
    if (!base64) throw new Error('图片数据为空')
    const headerMime =
      response.headers?.['Content-Type'] ||
      response.headers?.['content-type'] ||
      ''
    const mime = headerMime.split(';')[0].trim() || mimeFromExtension(extensionFromUrl(url, headerMime))
    return { base64, mime }
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`)
  const blob = await response.blob()
  const mime = blob.type || mimeFromExtension(extensionFromUrl(url, blob.type))
  const base64 = await blobToBase64(blob)
  return { base64, mime }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.replace(/^data:[^;]+;base64,/, ''))
    }
    reader.readAsDataURL(blob)
  })
}

async function prepareBlobImage(blob: Blob, fileName: string): Promise<PreparedImage> {
  const mime = blob.type || 'image/png'
  const base64 = await blobToBase64(blob)
  const dataUri = `data:${mime};base64,${base64}`

  if (!Capacitor.isNativePlatform()) {
    return { fileUri: dataUri, dataUri, fileName, mime }
  }

  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  })
  const { uri } = await Filesystem.getUri({
    path: fileName,
    directory: Directory.Cache,
  })
  return { fileUri: uri, dataUri, fileName, mime }
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /cancel/i.test(error.message))
}

async function prepareImage(url: string): Promise<PreparedImage> {
  const { base64, mime } = await fetchImageBytes(url)
  const ext = extensionFromUrl(url, mime)
  const fileName = `newsnook-${Date.now()}.${ext}`
  const dataUri = `data:${mime};base64,${base64}`

  if (!Capacitor.isNativePlatform()) {
    return { fileUri: dataUri, dataUri, fileName, mime }
  }

  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  })
  const { uri } = await Filesystem.getUri({
    path: fileName,
    directory: Directory.Cache,
  })
  return { fileUri: uri, dataUri, fileName, mime }
}

async function ensureAndroidAlbumId(): Promise<string> {
  const { path: albumsPath } = await Media.getAlbumsPath()
  const matchAlbum = (albums: { name: string; identifier: string }[]) =>
    albums.find((album) => album.name === ALBUM_NAME && album.identifier.startsWith(albumsPath))

  let albums = (await Media.getAlbums()).albums
  let album = matchAlbum(albums)
  if (!album) {
    await Media.createAlbum({ name: ALBUM_NAME })
    albums = (await Media.getAlbums()).albums
    album = matchAlbum(albums)
  }
  if (!album) throw new Error('无法创建相册 有所闻')
  return album.identifier
}

/** 保存到系统相册（Android：有所闻 相册；Web：触发下载） */
export async function saveImageToGallery(url: string): Promise<void> {
  const prepared = await prepareImage(url)

  if (!Capacitor.isNativePlatform()) {
    const anchor = document.createElement('a')
    anchor.href = prepared.dataUri
    anchor.download = prepared.fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return
  }

  const albumIdentifier =
    Capacitor.getPlatform() === 'android' ? await ensureAndroidAlbumId() : undefined

  await Media.savePhoto({
    path: prepared.dataUri,
    albumIdentifier,
    fileName: prepared.fileName.replace(/\.[^.]+$/, ''),
  })
}

/** 调起系统分享面板 */
export async function shareImage(url: string, title = '分享图片'): Promise<void> {
  const prepared = await prepareImage(url)

  if (!Capacitor.isNativePlatform()) {
    const binary = atob(prepared.dataUri.split(',')[1] || '')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const file = new File([bytes], prepared.fileName, { type: prepared.mime })
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
      const payload = { files: [file], title }
      if (navigator.canShare(payload)) {
        await navigator.share(payload)
        return
      }
    }
    throw new Error('当前浏览器不支持分享文件')
  }

  await Share.share({
    title,
    dialogTitle: title,
    files: [prepared.fileUri],
  })
}

/** 保存本地生成的图片（Web：下载；Android：写入相册） */
export async function saveImageBlob(
  blob: Blob,
  fileName = `newsnook-${Date.now()}.png`,
): Promise<ImageActionResult> {
  const prepared = await prepareBlobImage(blob, fileName)

  if (!Capacitor.isNativePlatform()) {
    const anchor = document.createElement('a')
    anchor.href = prepared.dataUri
    anchor.download = prepared.fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return 'saved'
  }

  const albumIdentifier =
    Capacitor.getPlatform() === 'android' ? await ensureAndroidAlbumId() : undefined

  await Media.savePhoto({
    path: prepared.dataUri,
    albumIdentifier,
    fileName: prepared.fileName.replace(/\.[^.]+$/, ''),
  })
  return 'saved'
}

/** 分享本地生成的图片 */
export async function shareImageBlob(
  blob: Blob,
  fileName = `newsnook-${Date.now()}.png`,
  title = '分享图片',
): Promise<ImageActionResult> {
  const prepared = await prepareBlobImage(blob, fileName)

  if (!Capacitor.isNativePlatform()) {
    const binary = atob(prepared.dataUri.split(',')[1] || '')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const file = new File([bytes], prepared.fileName, { type: prepared.mime })
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
      const payload = { files: [file], title }
      if (navigator.canShare(payload)) {
        try {
          await navigator.share(payload)
          return 'shared'
        } catch (error) {
          if (isCancellation(error)) return 'cancelled'
          throw error
        }
      }
    }
    throw new Error('当前浏览器不支持分享文件')
  }

  try {
    await Share.share({
      title,
      dialogTitle: title,
      files: [prepared.fileUri],
    })
    return 'shared'
  } catch (error) {
    if (isCancellation(error)) return 'cancelled'
    throw error
  }
}
