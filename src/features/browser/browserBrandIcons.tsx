import type { ReactNode } from 'react'
import { normalizeBrowserHost } from './browserHistory'

/**
 * Built-in vector icons for common search engines and default shortcuts.
 * Resolves 0ms locally with zero network requests or tracking.
 */

function renderGoogleSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M23 12.245c0-.905-.075-1.565-.236-2.25h-10.54v4.083h6.186c-.124 1.014-.797 2.542-2.294 3.569l-.021.136 3.332 2.53.23.022C21.779 18.417 23 15.593 23 12.245z" fill="#4285F4"/>
      <path d="M12.225 23c3.03 0 5.574-.978 7.433-2.665l-3.542-2.688c-.948.648-2.22 1.1-3.891 1.1a6.745 6.745 0 01-6.386-4.572l-.132.011-3.465 2.628-.045.124C4.043 20.531 7.835 23 12.225 23z" fill="#34A853"/>
      <path d="M5.84 14.175A6.65 6.65 0 015.463 12c0-.758.138-1.491.361-2.175l-.006-.147-3.508-2.67-.115.054A10.831 10.831 0 001 12c0 1.772.436 3.447 1.197 4.938l3.642-2.763z" fill="#FBBC05"/>
      <path d="M12.225 5.253c2.108 0 3.529.892 4.34 1.638l3.167-3.031C17.787 2.088 15.255 1 12.225 1 7.834 1 4.043 3.469 2.197 7.062l3.63 2.763a6.77 6.77 0 016.398-4.572z" fill="#EB4335"/>
    </svg>
  )
}

function renderBaiduSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.859 11.735c1.017-1.71 4.059-3.083 6.202.286 1.579 2.284 4.284 4.397 4.284 4.397s2.027 1.601.73 4.684c-1.24 2.956-5.64 1.607-6.005 1.49l-.024-.009s-1.746-.568-3.776-.112c-2.026.458-3.773.286-3.773.286l-.045-.001c-.328-.01-2.38-.187-3.001-2.968-.675-3.028 2.365-4.687 2.592-4.968.226-.288 1.802-1.37 2.816-3.085zm.986 1.738v2.032h-1.64s-1.64.138-2.213 2.014c-.2 1.252.177 1.99.242 2.148.067.157.596 1.073 1.927 1.342h3.078v-7.514l-1.394-.022zm3.588 2.191l-1.44.024v3.956s.064.985 1.44 1.344h3.541v-5.3h-1.528v3.979h-1.46s-.466-.068-.553-.447v-3.556zM9.82 16.715v3.06H8.58s-.863-.045-1.126-1.049c-.136-.445.02-.959.088-1.16.063-.203.353-.671.951-.85H9.82zm9.525-9.036c2.086 0 2.646 2.06 2.646 2.742 0 .688.284 3.597-2.309 3.655-2.595.057-2.704-1.77-2.704-3.08 0-1.374.277-3.317 2.367-3.317zM4.24 6.08c1.523-.135 2.645 1.55 2.762 2.513.07.625.393 3.486-1.975 4-2.364.515-3.244-2.249-2.984-3.544 0 0 .28-2.797 2.197-2.969zm8.847-1.483c.14-1.31 1.69-3.316 2.931-3.028 1.236.285 2.367 1.944 2.137 3.37-.224 1.428-1.345 3.313-3.095 3.082-1.748-.226-2.143-1.823-1.973-3.424zM9.425 1c1.307 0 2.364 1.519 2.364 3.398 0 1.879-1.057 3.4-2.364 3.4s-2.367-1.521-2.367-3.4C7.058 2.518 8.118 1 9.425 1z" fill="#2932E1"/>
    </svg>
  )
}

function renderBingSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="newsnook-bing-grad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00A4EF"/>
          <stop offset="1" stopColor="#0078D4"/>
        </linearGradient>
      </defs>
      <path d="M4.5 2C4.5 1.45 4.95 1 5.5 1h5c4.7 0 8.5 3.8 8.5 8.5 0 2.7-1.25 5.1-3.2 6.6l-3.5 2.6-6.8 3.3V2z" fill="url(#newsnook-bing-grad)"/>
      <path d="M12.5 16.5l6.5-5c.6-.5 1.5-.1 1.5.7v4.8c0 1.2-.8 2.3-2 2.7l-6 2.3v-5.5z" fill="#28D8FF"/>
    </svg>
  )
}

function renderDuckDuckGoSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#DE5833"/>
      <ellipse cx="12" cy="10.8" rx="5.3" ry="5.6" fill="#FFFFFF"/>
      <circle cx="9.8" cy="9.4" r="1.1" fill="#333333"/>
      <circle cx="10.2" cy="9.1" r="0.4" fill="#FFFFFF"/>
      <path d="M10.8 10.6c.3-1.1 1.9-1.1 2.6 0 1.2.3 2.5.9 2.5 1.7 0 1.3-2.6 1.7-4 1.7-1.4 0-2.8-.4-2.8-1.5 0-.8.8-1.5 1.7-1.9z" fill="#F8A51D"/>
      <path d="M10.2 17.2c1.1.5 2.5.5 3.6 0 .4.8 1.1 1.4 1.8 1.4H8.4c.7 0 1.4-.6 1.8-1.4z" fill="#4B9B48"/>
    </svg>
  )
}

function renderOpenAiSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/>
    </svg>
  )
}

function renderZhihuSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="6" fill="#0F88EB"/>
      <svg x="2" y="2" width="24" height="24" viewBox="0 0 92 91" preserveAspectRatio="xMidYMid meet">
        <path fill="#FFFFFF" d="M53.29 80.035l7.32.002 2.41 8.24 13.128-8.24h15.477v-67.98H53.29v67.978zm7.79-60.598h22.756v53.22h-8.73l-8.718 5.473-1.587-5.46-3.72-.012v-53.22zM46.818 43.162h-16.35c.545-8.467.687-16.12.687-22.955h15.987s.615-7.05-2.68-6.97H16.807c1.09-4.1 2.46-8.332 4.1-12.708 0 0-7.523 0-10.085 6.74-1.06 2.78-4.128 13.48-9.592 24.41 1.84-.2 7.927-.37 11.512-6.94.66-1.84.785-2.08 1.605-4.54h9.02c0 3.28-.374 20.9-.526 22.95H6.51c-3.67 0-4.863 7.38-4.863 7.38H22.14C20.765 66.11 13.385 79.24 0 89.62c6.403 1.828 12.784-.29 15.937-3.094 0 0 7.182-6.53 11.12-21.64L43.92 85.18s2.473-8.402-.388-12.496c-2.37-2.788-8.768-10.33-11.496-13.064l-4.57 3.627c1.363-4.368 2.183-8.61 2.46-12.71H49.19s-.027-7.38-2.372-7.38z"/>
      </svg>
    </svg>
  )
}

function renderLinuxDoSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="newsnook-linuxdo-brand-clip">
          <circle cx="14" cy="14" r="12"/>
        </clipPath>
      </defs>
      <circle cx="14" cy="14" r="12" fill="#F0F0F0"/>
      <g clipPath="url(#newsnook-linuxdo-brand-clip)">
        <rect x="2" y="2" width="24" height="7.2" fill="#1C1C1E"/>
        <rect x="2" y="9.2" width="24" height="9.6" fill="#F0F0F0"/>
        <rect x="2" y="18.8" width="24" height="7.2" fill="#FFB003"/>
      </g>
    </svg>
  )
}

function renderPerplexitySvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#22B8CD" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.785 0v7.272H22.5V17.62h-2.935V24l-7.037-6.194v6.145h-1.091v-6.152L4.392 24v-6.465H1.5V7.188h2.884V0l7.053 6.494V.19h1.09v6.49L19.786 0zm-7.257 9.044v7.319l5.946 5.234V14.44l-5.946-5.397zm-1.099-.08l-5.946 5.398v7.235l5.946-5.234V8.965zm8.136 7.58h1.844V8.349H13.46l6.105 5.54v2.655zm-8.982-8.28H2.59v8.195h1.8v-2.576l6.192-5.62zM5.475 2.476v4.71h5.115l-5.115-4.71zm13.219 0l-5.115 4.71h5.115v-4.71z" fillRule="nonzero"/>
    </svg>
  )
}

function renderSogouSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#FF5000"/>
      <path d="M15.5 8.2c-.8-.7-1.9-1.1-3.2-1.1-2.4 0-4.1 1.5-4.1 3.7 0 3.8 5.7 2.2 5.7 4.7 0 .9-.8 1.4-1.9 1.4-1.3 0-2.6-.6-3.3-1.4l-1.2 1.6c1.1 1.2 2.8 1.8 4.5 1.8 2.7 0 4.4-1.6 4.4-3.8 0-4-5.7-2.4-5.7-4.8 0-.8.7-1.3 1.7-1.3 1.1 0 2.2.5 2.8 1.1l1.3-1.5z" fill="#FFFFFF"/>
    </svg>
  )
}

function renderSo360Svg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#19B955"/>
      <path d="M12 4.5l6 2.5v5c0 4.2-2.8 7.8-6 8.8-3.2-1-6-4.6-6-8.8v-5l6-2.5z" fill="#FFCC00"/>
      <path d="M12 6.2l4.5 1.9v3.8c0 3.2-2.1 5.9-4.5 6.7V6.2z" fill="#FFA500"/>
    </svg>
  )
}

function renderPhindSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#5848BC"/>
      <path d="M7 6.5h4.2c2.8 0 4.8 1.8 4.8 4.5s-2 4.5-4.8 4.5H9.5V18H7V6.5zm2.5 2v5h1.7c1.5 0 2.4-.9 2.4-2.5s-.9-2.5-2.4-2.5H9.5z" fill="#FFFFFF"/>
    </svg>
  )
}

function renderWikipediaSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#F6F6F6" stroke="#D1D5DB" strokeWidth="0.8"/>
      <text x="12" y="16.5" textAnchor="middle" fontFamily="serif" fontSize="13" fontWeight="bold" fill="#333333">W</text>
    </svg>
  )
}

function renderGitHubSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0c6.63 0 12 5.276 12 11.79-.001 5.067-3.29 9.567-8.175 11.187-.6.118-.825-.25-.825-.56 0-.398.015-1.665.015-3.242 0-1.105-.375-1.813-.81-2.181 2.67-.295 5.475-1.297 5.475-5.822 0-1.297-.465-2.344-1.23-3.169.12-.295.54-1.503-.12-3.125 0 0-1.005-.324-3.3 1.209a11.32 11.32 0 00-3-.398c-1.02 0-2.04.133-3 .398-2.295-1.518-3.3-1.209-3.3-1.209-.66 1.622-.24 2.83-.12 3.125-.765.825-1.23 1.887-1.23 3.169 0 4.51 2.79 5.527 5.46 5.822-.345.294-.66.81-.765 1.577-.69.31-2.415.81-3.495-.973-.225-.354-.9-1.223-1.845-1.209-1.005.015-.405.56.015.781.51.28 1.095 1.327 1.23 1.666.24.663 1.02 1.93 4.035 1.385 0 .988.015 1.916.015 2.196 0 .31-.225.664-.825.56C3.303 21.374-.003 16.867 0 11.791 0 5.276 5.37 0 12 0z"/>
    </svg>
  )
}

function renderWeChatSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="6" fill="#07C160"/>
      <svg x="2" y="2" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M9.5 4C5.358 4 2 6.91 2 10.5c0 1.95.992 3.708 2.584 4.887l-.656 2.373a.4.4 0 00.518.484l2.772-1.018C8.04 17.15 8.756 17.2 9.5 17.2c.28 0 .553-.01.824-.033A6.16 6.16 0 0110 15.5c0-3.314 3.134-6 7-6 .347 0 .686.024 1.018.068C17.38 6.427 13.784 4 9.5 4z" fill="#FFFFFF"/>
        <circle cx="6.5" cy="9.2" r="1.1" fill="#07C160"/>
        <circle cx="11.5" cy="9.2" r="1.1" fill="#07C160"/>
        <path d="M17 10.5c-3.314 0-6 2.239-6 5s2.686 5 6 5c.608 0 1.196-.076 1.748-.216l2.124.78a.35.35 0 00.453-.424l-.502-1.815C21.984 17.844 23 16.51 23 15.5c0-2.761-2.686-5-6-5z" fill="#FFFFFF"/>
        <circle cx="14.8" cy="14.3" r="0.95" fill="#07C160"/>
        <circle cx="18.8" cy="14.3" r="0.95" fill="#07C160"/>
      </svg>
    </svg>
  )
}

/**
 * Returns a fast local SVG brand icon if the host/url/name matches a known provider or preset.
 */
export function getBrowserBrandIcon(address: string, name?: string, size: 'small' | 'normal' = 'normal'): ReactNode | null {
  const host = normalizeBrowserHost(address).toLowerCase()
  const label = name?.trim().toLowerCase() ?? ''
  const dimension = size === 'small' ? 20 : 25

  if (host === 'mp.weixin.qq.com' || host === 'weixin.qq.com' || host.endsWith('.weixin.qq.com') || label.includes('微信') || label.includes('公众号')) {
    return renderWeChatSvg(dimension)
  }

  if (host === 'google.com' || host.endsWith('.google.com') || host === 'google.cn' || label.includes('google')) {
    return renderGoogleSvg(dimension)
  }
  if (host === 'baidu.com' || host.endsWith('.baidu.com') || label.includes('百度')) {
    return renderBaiduSvg(dimension)
  }
  if (host === 'bing.com' || host.endsWith('.bing.com') || label === 'bing' || label === '必应') {
    return renderBingSvg(dimension)
  }
  if (host === 'duckduckgo.com' || label === 'duckduckgo') {
    return renderDuckDuckGoSvg(dimension)
  }
  if (host === 'chatgpt.com' || host === 'openai.com' || host.endsWith('.openai.com') || label === 'chatgpt' || label === 'openai') {
    return renderOpenAiSvg(dimension)
  }
  if (host === 'zhihu.com' || host.endsWith('.zhihu.com') || label === '知乎') {
    return renderZhihuSvg(dimension)
  }
  if (host === 'linux.do' || host.endsWith('.linux.do') || label === 'linux.do') {
    return renderLinuxDoSvg(dimension)
  }
  if (host === 'perplexity.ai' || host.endsWith('.perplexity.ai') || label === 'perplexity') {
    return renderPerplexitySvg(dimension)
  }
  if (host === 'sogou.com' || host.endsWith('.sogou.com') || label.includes('搜狗')) {
    return renderSogouSvg(dimension)
  }
  if (host === 'so.com' || host.endsWith('.so.com') || host === '360.cn' || label.includes('360')) {
    return renderSo360Svg(dimension)
  }
  if (host === 'phind.com' || host.endsWith('.phind.com') || label === 'phind') {
    return renderPhindSvg(dimension)
  }
  if (host === 'wikipedia.org' || host.endsWith('.wikipedia.org') || label.includes('维基百科') || label === 'wikipedia') {
    return renderWikipediaSvg(dimension)
  }
  if (host === 'github.com' || host.endsWith('.github.com') || label === 'github') {
    return renderGitHubSvg(dimension)
  }

  return null
}
