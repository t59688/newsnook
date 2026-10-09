/** Web 公开下载入口使用 Stable-only 的根目录兼容对象，避免双通道首发前出现 404。 */
export const ANDROID_APP_DOWNLOAD_URL =
  'https://news-update.aizeek.com/newsnook/latest-cloud.apk'

/** 原生 App 不展示下载自身的提示；桌面与手机浏览器都属于 Web。 */
export function shouldShowWebAppDownloadBanner(isNativePlatform: boolean): boolean {
  return !isNativePlatform
}
