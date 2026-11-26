import { memo } from 'react'
import { hashId } from '../../lib/demo'

interface CoverProps {
  seed: string
  label: string
  className?: string
  aspect?: 'video' | 'poster' | 'square' | 'standard'
  subtitle?: string
}

/* 纯矢量自适应编辑封面与影视海报：
 * 100% 纯内联 SVG 与 CSS 渐变，零外部网络请求，永不出现图片挂起与破损！
 * 依据 seed 确定性生成金石朱印 / 瑞士网格 / 极简包豪斯 / 4K 影视海报装帧。 */
export const Cover = memo(function Cover({
  seed,
  label,
  className = '',
  aspect = 'standard',
  subtitle,
}: CoverProps) {
  const h = hashId(seed)
  const motifIndex = h % 6

  // 6 组古典墨色与赛博霓虹高反差渐变底色
  const GRADIENTS = [
    { start: '#12161f', end: '#090b10', accent: '#38bdf8', tag: '科幻未来', genre: '4K 蓝光' },
    { start: '#1c1214', end: '#0d0708', accent: '#f43f5e', tag: '悬疑特写', genre: '院线同步' },
    { start: '#0e1713', end: '#060d09', accent: '#10b981', tag: '自然史诗', genre: '杜比全景声' },
    { start: '#1c160c', end: '#0e0a05', accent: '#f59e0b', tag: '史诗动作', genre: 'IMAX 增强' },
    { start: '#18111e', end: '#0c0710', accent: '#a855f7', tag: '黑色迷宫', genre: '原盘修复' },
    { start: '#141416', end: '#080809', accent: '#e2e8f0', tag: '纪实探索', genre: '1080P 高清' },
  ]
  const g = GRADIENTS[h % GRADIENTS.length]

  if (aspect === 'poster') {
    return (
      <span
        className={`relative block w-full select-none overflow-hidden ${className}`}
        style={{
          background: `linear-gradient(165deg, ${g.start} 0%, #050608 100%)`,
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 160 240"
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full opacity-90"
        >
          <defs>
            <radialGradient id={`pg-${seed}`} cx="50%" cy="25%" r="70%">
              <stop offset="0%" stopColor={g.accent} stopOpacity="0.4" />
              <stop offset="60%" stopColor={g.accent} stopOpacity="0.08" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`pl-${seed}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={g.accent} stopOpacity="0.6" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 背景光斑 */}
          <rect width="160" height="240" fill={`url(#pg-${seed})`} />

          {/* 影视胶片齿孔与纵深透视几何 */}
          {motifIndex % 2 === 0 ? (
            <g opacity="0.32" stroke={g.accent} strokeWidth="0.8">
              {/* 顶部胶片齿孔 */}
              {[12, 32, 52, 72, 92, 112, 132].map((x) => (
                <rect key={x} x={x} y="8" width="10" height="6" rx="1.5" fill={g.accent} opacity="0.4" />
              ))}
              {/* 聚焦光环与广角透视 */}
              <circle cx="80" cy="95" r="42" fill="none" strokeWidth="1" />
              <circle cx="80" cy="95" r="58" fill="none" strokeDasharray="3 4" strokeWidth="0.8" opacity="0.6" />
              <line x1="80" y1="20" x2="80" y2="170" strokeDasharray="2 3" opacity="0.5" />
              <line x1="15" y1="95" x2="145" y2="95" strokeDasharray="2 3" opacity="0.5" />
              <polygon points="80,55 115,120 45,120" fill="none" strokeWidth="1.2" opacity="0.7" />
            </g>
          ) : (
            <g opacity="0.35">
              {/* 现代电影构图对角切线与暗部层次 */}
              <line x1="0" y1="40" x2="160" y2="150" stroke={g.accent} strokeWidth="1.2" />
              <line x1="0" y1="150" x2="160" y2="40" stroke={g.accent} strokeWidth="0.8" strokeDasharray="4 4" />
              <rect x="25" y="65" width="110" height="65" rx="4" fill="none" stroke={g.accent} strokeWidth="1" />
              <circle cx="80" cy="97" r="18" fill={g.accent} opacity="0.25" />
              <polygon points="74,88 92,97 74,106" fill={g.accent} opacity="0.8" />
            </g>
          )}

          {/* 底部电影光栅条 */}
          <line x1="16" y1="180" x2="144" y2="180" stroke={g.accent} strokeWidth="0.8" opacity="0.4" />
        </svg>

        {/* 海报排版装帧 */}
        <span className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2.5 text-paper">
          {/* 顶部标头 */}
          <span className="flex items-center justify-between font-mono text-[8px] tracking-[0.1em] text-paper-faint">
            <span className="rounded bg-black/60 px-1 py-0.2 font-bold text-cinnabar-soft border border-cinnabar/30">
              {g.genre}
            </span>
            <span className="opacity-75">{g.tag}</span>
          </span>

          {/* 底部剧名与状态 */}
          <span className="space-y-0.5">
            <span className="block truncate font-display text-[12px] font-bold tracking-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
              {label}
            </span>
            {subtitle ? (
              <span className="block truncate font-mono text-[8.5px] text-paper-faint">
                {subtitle}
              </span>
            ) : (
              <span className="flex items-center justify-between font-mono text-[8px] text-paper-faint">
                <span className="text-[#38bdf8] font-bold">1080P 嗅探就绪</span>
                <span className="opacity-70">免转码直连</span>
              </span>
            )}
          </span>
        </span>
      </span>
    )
  }

  return (
    <span
      className={`relative block w-full select-none overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(135deg, ${g.start} 0%, ${g.end} 100%)`,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 240 160"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full opacity-85"
      >
        <defs>
          <radialGradient id={`g-${seed}`} cx="75%" cy="30%" r="65%">
            <stop offset="0%" stopColor={g.accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={g.accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="240" height="160" fill={`url(#g-${seed})`} />

        {/* 纹样 1：瑞士排印网格 */}
        {motifIndex === 0 && (
          <g opacity="0.28" stroke={g.accent} strokeWidth="0.8">
            <line x1="24" y1="20" x2="216" y2="20" />
            <line x1="24" y1="140" x2="216" y2="140" />
            <line x1="24" y1="20" x2="24" y2="140" />
            <line x1="216" y1="20" x2="216" y2="140" />
            <line x1="88" y1="20" x2="88" y2="140" strokeDasharray="2 3" />
            <line x1="152" y1="20" x2="152" y2="140" strokeDasharray="2 3" />
          </g>
        )}

        {/* 纹样 2：等高同心环线 */}
        {motifIndex === 1 && (
          <g opacity="0.22" fill="none" stroke={g.accent} strokeWidth="1">
            <ellipse cx="170" cy="80" rx="35" ry="35" />
            <ellipse cx="170" cy="80" rx="55" ry="55" strokeDasharray="3 4" />
            <ellipse cx="170" cy="80" rx="75" ry="75" opacity="0.5" />
          </g>
        )}

        {/* 纹样 3：包豪斯几何切角 */}
        {motifIndex === 2 && (
          <g opacity="0.25">
            <rect x="140" y="30" width="70" height="70" fill={g.accent} opacity="0.18" />
            <circle cx="175" cy="65" r="24" fill={g.accent} opacity="0.32" />
            <line x1="20" y1="120" x2="220" y2="120" stroke={g.accent} strokeWidth="1" />
          </g>
        )}

        {/* 纹样 4：点阵矩阵 */}
        {motifIndex === 3 && (
          <g opacity="0.25" fill={g.accent}>
            {[30, 50, 70, 90, 110, 130].map((y) =>
              [140, 160, 180, 200].map((x) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />
              )),
            )}
          </g>
        )}

        {/* 纹样 5：建筑微结构 */}
        {motifIndex === 4 && (
          <g opacity="0.22" stroke={g.accent} strokeWidth="1">
            <polyline points="130,130 160,40 190,130" fill="none" />
            <polyline points="150,130 175,55 200,130" fill="none" opacity="0.6" />
          </g>
        )}

        {/* 纹样 6：金石朱印角标 */}
        {motifIndex === 5 && (
          <g opacity="0.3">
            <rect x="165" y="35" width="46" height="46" rx="6" fill="none" stroke={g.accent} strokeWidth="1.5" />
            <rect x="171" y="41" width="34" height="34" rx="3" fill={g.accent} opacity="0.15" />
          </g>
        )}
      </svg>

      {/* 封面排印层：微型刊印标签与标头 */}
      <span className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 text-paper">
        <span className="flex items-center justify-between font-mono text-[8.5px] tracking-[0.14em] uppercase text-paper-faint">
          <span className="flex items-center gap-1 text-cinnabar-soft font-bold">
            <span className="inline-block h-1 w-1 rounded-full bg-cinnabar" />
            {label}
          </span>
          <span className="opacity-60">{g.tag}</span>
        </span>

        <span className="flex items-end justify-between font-mono text-[8px] text-paper-faint/70">
          <span>{subtitle || 'VOL. 2026'}</span>
          <span className="rounded bg-black/40 px-1 py-0.2 font-mono">100% 离线</span>
        </span>
      </span>
    </span>
  )
})
