import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  Cloud,
  KeyRound,
  Laptop,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TabletSmartphone,
} from 'lucide-react'

/* 可选云同步 —— 严格复刻 features/account, features/sync 与 packages/contracts：
 * 1. 业务写本地，Outbox 影子比对异步上传，断网不影响任何阅读
 * 2. 严格同步边界：配置与 Secret 同步，正文/已读/稍后读/阅读进度永不出机
 * 3. 冲突不覆盖：首次同步或冲突时提供「保留本机 / 使用云端 / 智能合并」三选一 + 自动快照
 * 4. Secret 走 Android Keystore 加密存储，日志零明文。 */

const SYNC_ITEMS = [
  '自建订阅源与启用开关',
  '分类顺序、显隐与自定义分类',
  '场景预设与快照布局',
  '跨设备通用应用偏好',
  '密钥（API Key / 代理凭据，Keystore 加密）',
]

const LOCAL_ITEMS = [
  '文章全文与 Readability 离线缓存',
  '稍后读 · 已读标记 · 最近足迹',
  '毫秒级阅读进度与位置折算',
  '墨水屏 / 投屏等设备专用硬件开关',
]

const DEVICES = [
  { Icon: Smartphone, name: 'Pixel 9 Pro (当前设备)', last: '刚刚同步', current: true },
  { Icon: TabletSmartphone, name: '小米平板 7 (阅读器模式)', last: '3 分钟前' },
  { Icon: Laptop, name: 'Web 浏览器 · Chrome', last: '昨天 22:10' },
]

export function SyncDemo() {
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'synced'>('idle')
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [conflictResolved, setConflictResolved] = useState<string | null>(null)

  const triggerSync = () => {
    if (syncState === 'syncing') return
    setSyncState('syncing')
    setTimeout(() => {
      setSyncState('synced')
    }, 1200)
  }

  const resolveConflict = (choice: string) => {
    setConflictResolved(choice)
    setShowConflictModal(false)
    setSyncState('synced')
    setTimeout(() => setConflictResolved(null), 3500)
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-haze bg-ink">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-haze/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Cloud size={15} strokeWidth={1.8} className="text-cinnabar" />
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-paper-muted">
            账户与可选云同步
          </span>
          <span className="flex items-center gap-1 rounded-full bg-paper/5 px-2 py-0.5 font-mono text-[9px] text-paper-faint">
            <KeyRound size={10} /> Keystore 加密
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowConflictModal(true)}
            className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[9.5px] text-amber-400 hover:bg-amber-500/20"
          >
            <AlertTriangle size={11} />
            <span>模拟冲突三选一</span>
          </button>

          <button
            type="button"
            onClick={triggerSync}
            className="pressable flex items-center gap-1.5 rounded-full border border-cinnabar/70 bg-cinnabar/15 px-3 py-1 font-mono text-[10px] font-semibold text-cinnabar-soft hover:bg-cinnabar/25"
          >
            {syncState === 'syncing' ? (
              <LoaderCircle size={11} strokeWidth={2.4} className="animate-spin" />
            ) : syncState === 'synced' ? (
              <Check size={11} strokeWidth={2.6} />
            ) : (
              <RefreshCw size={11} strokeWidth={2} />
            )}
            <span>
              {syncState === 'syncing'
                ? 'Outbox 增量上传中'
                : syncState === 'synced'
                  ? '已完成同步'
                  : '立即同步'}
            </span>
          </button>
        </div>
      </div>

      {conflictResolved && (
        <div className="bg-cinnabar/15 px-4 py-1.5 font-mono text-[10.5px] text-cinnabar-soft flex items-center gap-2 border-b border-cinnabar/30">
          <Check size={12} strokeWidth={2.5} />
          <span>冲突解决决策已生效：已选择【{conflictResolved}】，并生成自动安全快照备份。</span>
        </div>
      )}

      {/* 同步边界对比表格 */}
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="rounded-xl border border-cinnabar/30 bg-cinnabar/5 p-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-cinnabar/20">
            <span className="font-mono text-[11px] font-bold text-cinnabar-soft flex items-center gap-1.5">
              <Cloud size={13} />
              云端同步项（换机即还原）
            </span>
            <span className="font-mono text-[9px] text-cinnabar-soft/80">Outbox 增量比对</span>
          </div>
          <ul className="mt-2.5 space-y-2">
            {SYNC_ITEMS.map((s) => (
              <li key={s} className="flex items-start gap-2 text-[12px] text-paper/90 leading-tight">
                <Check size={12} strokeWidth={2.4} className="mt-0.5 shrink-0 text-cinnabar" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-haze/60 bg-ink-raised/30 p-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-haze/40">
            <span className="font-mono text-[11px] font-bold text-paper-muted flex items-center gap-1.5">
              <ShieldCheck size={13} />
              严格保留在本机（隐私与阅读核心）
            </span>
            <span className="font-mono text-[9px] text-paper-faint">永不上传</span>
          </div>
          <ul className="mt-2.5 space-y-2">
            {LOCAL_ITEMS.map((s) => (
              <li key={s} className="flex items-start gap-2 text-[12px] text-paper-muted leading-tight">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-paper-faint/60" aria-hidden />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 设备列表 */}
      <div className="border-t border-haze/50 bg-ink-raised/20 px-5 py-3">
        <div className="font-mono text-[10px] text-paper-faint mb-2">已连接的设备：</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {DEVICES.map(({ Icon, name, last, current }) => (
            <div
              key={name}
              className={`flex items-center gap-2.5 rounded-xl border p-2 text-[11.5px] ${
                current ? 'border-cinnabar/40 bg-cinnabar/10 text-paper' : 'border-haze/50 bg-ink text-paper-muted'
              }`}
            >
              <Icon size={14} strokeWidth={1.8} className={current ? 'text-cinnabar' : 'text-paper-faint'} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{name}</div>
                <div className="font-mono text-[9px] text-paper-faint">{last}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 冲突三选一对话框模拟 */}
      <AnimatePresence>
        {showConflictModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          >
            <div className="w-full max-w-md rounded-2xl border border-amber-500/50 bg-ink-raised p-5 text-left">
              <div className="flex items-center gap-2 text-amber-400 font-mono text-[12px] font-bold">
                <AlertTriangle size={16} />
                <span>检测到多端配置冲突 · 需要你决定</span>
              </div>
              <p className="mt-2 text-[12.5px] text-paper-muted leading-relaxed">
                云端版本与本机有分歧（例如两台手机各自调整了分类或新增了源）。有所闻绝不静默覆盖，请选择合并策略：
              </p>

              <div className="mt-3.5 space-y-2 font-mono text-[11px]">
                <button
                  type="button"
                  onClick={() => resolveConflict('保留本机')}
                  className="w-full rounded-xl border border-haze p-2.5 text-left hover:border-paper-faint/50 hover:bg-paper/5 text-paper flex items-center justify-between"
                >
                  <span>1. 保留本机设置（以当前设备为准覆盖云端）</span>
                  <span>→</span>
                </button>
                <button
                  type="button"
                  onClick={() => resolveConflict('使用云端')}
                  className="w-full rounded-xl border border-haze p-2.5 text-left hover:border-paper-faint/50 hover:bg-paper/5 text-paper flex items-center justify-between"
                >
                  <span>2. 使用云端版本（拉取其他设备的最新布局）</span>
                  <span>→</span>
                </button>
                <button
                  type="button"
                  onClick={() => resolveConflict('智能三方合并')}
                  className="w-full rounded-xl border border-cinnabar bg-cinnabar/15 p-2.5 text-left font-bold text-cinnabar-soft flex items-center justify-between"
                >
                  <span>3. 智能三方合并（推荐：双方新增订阅合并，自动备份）</span>
                  <span>✓ 推荐</span>
                </button>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowConflictModal(false)}
                  className="font-mono text-[10px] text-paper-faint hover:text-paper"
                >
                  取消
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="border-t border-haze/60 px-4 py-2 font-mono text-[10px] text-paper-faint flex items-center justify-between">
        <span>不强制登录 · 云端宕机/未登录不影响订阅浏览与站内全文</span>
        <span>符合 Local-first 铁律</span>
      </div>
    </div>
  )
}
