/** 应用内展示用的直接依赖与原生组件许可清单（非完整传递依赖树） */

export interface OssLicenseEntry {
  name: string
  license: string
  note?: string
  url?: string
}

export const APP_LICENSE = {
  name: 'NewsNook（有所闻）',
  license: 'AGPL-3.0',
  url: 'https://github.com/t59688/newsnook/blob/main/LICENSE',
  notice: 'Copyright 2026 t59688',
} as const

export const RUNTIME_OSS_LICENSES: OssLicenseEntry[] = [
  { name: 'React', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'React DOM', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'Capacitor', license: 'MIT', url: 'https://github.com/ionic-team/capacitor' },
  {
    name: '@capacitor-community/media',
    license: 'MIT',
    url: 'https://github.com/capacitor-community/media',
  },
  {
    name: '@mozilla/readability',
    license: 'Apache-2.0',
    url: 'https://github.com/mozilla/readability',
  },
  {
    name: 'DOMPurify',
    license: 'MPL-2.0 OR Apache-2.0',
    url: 'https://github.com/cure53/DOMPurify',
  },
  { name: 'linkedom', license: 'ISC', url: 'https://github.com/WebReflection/linkedom' },
  {
    name: 'fast-xml-parser',
    license: 'MIT',
    url: 'https://github.com/NaturalIntelligence/fast-xml-parser',
  },
  { name: 'marked', license: 'MIT', url: 'https://github.com/markedjs/marked' },
  { name: 'hls.js', license: 'Apache-2.0', url: 'https://github.com/video-dev/hls.js' },
  { name: 'opencc-js', license: 'Apache-2.0', url: 'https://github.com/nk2028/opencc-js' },
  { name: 'anime.js', license: 'MIT', url: 'https://github.com/juliangarnier/anime' },
  { name: 'lucide-react', license: 'ISC', url: 'https://github.com/lucide-icons/lucide' },
  { name: 'Tailwind CSS', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss' },
]

export const NATIVE_OSS_LICENSES: OssLicenseEntry[] = [
  {
    name: 'AndroidX',
    license: 'Apache-2.0',
    url: 'https://developer.android.com/jetpack/androidx',
    note: 'Android 壳层依赖',
  },
  {
    name: 'OkHttp',
    license: 'Apache-2.0',
    url: 'https://github.com/square/okhttp',
    note: '原生 HTTP',
  },
  {
    name: 'Bergamot Translator',
    license: 'MPL-2.0',
    url: 'https://github.com/browsermt/bergamot-translator',
    note: '离线翻译引擎',
  },
]
