import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Rss, Search, Eye, Check, Sparkles, X, FileUp } from 'lucide-react'

/* RSS 订阅商店 —— 严格复刻 features/rssCatalog & feedDiscovery：
 * 1. 34,270 个源本地离线检索（别名归一、编辑距离容错、零网络秒出）
 * 2. 在线发现（Feedly API 与网址直接嗅探）
 * 3. 检测与预览（先试读 5 篇验证可用性再决定是否订阅）
 * 4. OPML 导入导出与 RSSHub 路由支持。 */

const RESULTS = [
  {
    name: '晚点 LatePost',
    cat: '商业媒体',
    feeds: 2,
    online: true,
    previewItems: [
      '独家｜字节 AI 硬件团队拆分独立融资，估值超 300 亿元',
      '汽车降价战打入第三年：主机厂的供应商正在承压',
      '外贸新三样的出海隐忧与供应链重塑',
      '晚点早知道：美股科技七巨头季报综述',
      '对话人形机器人创业者：为什么具身智能需要先落工厂',
    ],
  },
  {
    name: '知识分子',
    cat: '科学综合',
    feeds: 1,
    online: true,
    previewItems: [
      '为什么传染病数学模型越来越复杂，却越来越不确定？',
      '室温超导最新预印本解读：抗磁性与电阻测量的真实困境',
      '对谈深海科考首席科学家：万米海沟里的微生物基因库',
      '临床试验数据透明度调查：谁在隐瞒试验终点',
      '科学史札记：麦克斯韦方程组诞生的最初十年',
    ],
  },
  {
    name: 'The Verge',
    cat: '消费数码',
    feeds: 3,
    online: true,
    previewItems: [
      'Google Pixel 9 Pro Review: Compact flagship with AI core',
      'Apple Vision Pro one year later: enterprise vs consumer',
      'The battle for open-source AI weights heats up',
      'Framework Laptop 16 upgrade test: modular power',
      'Why USB-C cables are still so confusing in 2026',
    ],
  },
  {
    name: '果壳 · 科学人',
    cat: '科学综合',
    feeds: 1,
    online: false,
    previewItems: [
      '猫咪瞳孔放大究竟在想什么？',
      '冬眠机制如果应用在长途太空旅行，人体会发生什么变化',
      '真菌网络的地下互联网假说与争议',
      '塑料降解酶的工业化尝试',
      '为什么我们总觉得时间过得越来越快',
    ],
  },
]

export function StoreDemo() {
  const [q, setQ] = useState('')
  const [added, setAdded] = useState<string[]>(['晚点 LatePost'])
  const [previewTarget, setPreviewTarget] = useState<(typeof RESULTS)[number] | null>(null)
  const [opmlToast, setOpmlToast] = useState(false)

  const list = RESULTS.filter(
    (r) =>
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      r.cat.includes(q) ||
      q === '',
  )

  return (
    <div className="relative overflow-hidden rounded-2xl border border-haze bg-ink">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-haze/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Rss size={14} strokeWidth={1.8} className="text-cinnabar" />
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-paper-muted">
            RSS 订阅商店
          </span>
          <span className="rounded-full border border-cinnabar/30 bg-cinnabar/10 px-2 py-0.5 font-mono text-[9px] text-cinnabar-soft font-semibold">
            本地 34,270 源离线库
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpmlToast(true)
            setTimeout(() => setOpmlToast(false), 2000)
          }}
          className="flex items-center gap-1 rounded-full border border-haze px-2.5 py-1 font-mono text-[9.5px] text-paper-muted hover:text-paper"
        >
          <FileUp size={11} />
          {opmlToast ? '✓ 已导出 OPML 树状树' : 'OPML 导入/导出'}
        </button>
      </div>

      {/* 搜索框 */}
      <div className="p-3.5 bg-ink-raised/20 border-b border-haze/40">
        <label className="flex min-h-9 items-center gap-2 rounded-xl border border-haze bg-ink px-3 focus-within:border-cinnabar/60">
          <Search size={14} strokeWidth={1.8} className="shrink-0 text-paper-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索 34,270+ 源：支持别名、拼音、网站名、网址探测…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-paper outline-none placeholder:text-paper-faint/60"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="text-paper-faint hover:text-paper">
              <X size={12} />
            </button>
          )}
        </label>
      </div>

      {/* 列表 */}
      <ul className="divide-y divide-haze/40 max-h-[300px] overflow-y-auto scroll-hidden">
        {list.map((r) => {
          const isAdded = added.includes(r.name)
          return (
            <li key={r.name} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper/5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-paper">{r.name}</span>
                  <span className="rounded bg-ink-raised px-1.5 py-0.2 font-mono text-[9px] text-paper-muted">
                    {r.cat}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[9.5px] text-paper-faint">
                  <span>{r.feeds} 个可用频道</span>
                  <span>·</span>
                  <span className="text-cinnabar-soft">支持试读与全文解析</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewTarget(r)}
                  className="pressable flex h-7 items-center gap-1 rounded-full border border-haze px-2.5 font-mono text-[10px] text-paper-muted hover:text-paper hover:border-paper-faint/50"
                >
                  <Eye size={11} strokeWidth={1.8} />
                  试读 5 篇
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAdded((prev) => (isAdded ? prev.filter((n) => n !== r.name) : [...prev, r.name]))
                  }
                  className={`pressable flex h-7 items-center gap-1 rounded-full border px-2.5 font-mono text-[10px] transition-colors ${
                    isAdded
                      ? 'border-cinnabar bg-cinnabar/15 text-cinnabar-soft font-medium'
                      : 'border-cinnabar bg-cinnabar text-ink-deep font-bold hover:bg-cinnabar-soft'
                  }`}
                >
                  {isAdded ? <Check size={11} strokeWidth={2.5} /> : <Plus size={11} strokeWidth={2.5} />}
                  {isAdded ? '已订阅' : '添加订阅'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {/* 试读弹窗模拟 */}
      <AnimatePresence>
        {previewTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex flex-col bg-ink/95 backdrop-blur-md p-4"
          >
            <div className="flex items-center justify-between pb-2 border-b border-haze/60">
              <div className="flex items-center gap-2">
                <Sparkles size={13} className="text-cinnabar" />
                <span className="font-mono text-[11px] font-bold text-paper">
                  「{previewTarget.name}」上游连通性检测 · 最新 5 篇试读
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTarget(null)}
                className="p-1 text-paper-muted hover:text-paper"
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-2.5 flex-1 space-y-2 overflow-y-auto scroll-hidden">
              {previewTarget.previewItems.map((item, i) => (
                <div key={i} className="rounded-xl border border-haze/60 bg-ink-raised/50 p-2.5 text-[11px]">
                  <div className="text-paper line-clamp-1">{item}</div>
                  <div className="mt-1 font-mono text-[9px] text-paper-faint flex items-center justify-between">
                    <span>状态: 200 OK · XML 直连直出</span>
                    <span className="text-cinnabar-soft">Readability 可解析</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 pt-2 border-t border-haze/60 flex items-center justify-between">
              <span className="font-mono text-[9.5px] text-paper-faint">
                探测耗时: 142ms · 格式: Atom 1.0
              </span>
              <button
                type="button"
                onClick={() => {
                  setAdded((prev) => [...new Set([...prev, previewTarget.name])])
                  setPreviewTarget(null)
                }}
                className="rounded-full bg-cinnabar px-3.5 py-1 font-mono text-[10.5px] font-bold text-ink-deep"
              >
                试读满意，加入订阅
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="border-t border-haze/60 px-4 py-2 font-mono text-[10px] text-paper-muted flex items-center justify-between">
        <span>支持 RSSHub 路由匹配 · 自建源与官方源同权</span>
        <span>目录极低频静默更新</span>
      </div>
    </div>
  )
}
