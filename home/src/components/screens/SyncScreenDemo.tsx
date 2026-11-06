import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Cloud,
  HardDrive,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

/* 可选账户与云同步真机界面 —— 严格复刻 src/screens/settings/AccountSyncScreen.tsx：
 * 头部返回导航 + 账户与硬件凭据卡片 + Outbox 影子增量对账 +
 * 严格划分云端同步项 vs 本地独占项 + 真实三方冲突仲裁弹窗。 */
export function SyncScreenDemo() {
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle')
  const [showConflict, setShowConflict] = useState(false)
  const [resolution, setResolution] = useState<string | null>(null)

  const triggerSync = () => {
    if (syncStatus === 'syncing') return
    setSyncStatus('syncing')
    setTimeout(() => setSyncStatus('synced'), 900)
  }

  const resolve = (strategy: string) => {
    setResolution(strategy)
    setShowConflict(false)
    setSyncStatus('synced')
    setTimeout(() => setResolution(null), 3000)
  }

  return (
    <div className="relative flex h-full flex-col bg-ink text-paper select-none">
      {/* 沉浸式顶栏 */}
      <header className="relative z-20 shrink-0 border-b border-haze/40 bg-ink/95 backdrop-blur-xl">
        <PhoneStatusBar />
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="返回"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-paper/8 hover:text-paper"
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
            <span className="font-display text-[14px] font-semibold text-paper">
              账户与云同步
            </span>
          </div>

          <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowConflict(true)}
            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] text-amber-400 hover:bg-amber-500/20"
          >
            冲突仲裁
          </button>
          <button
            type="button"
            onClick={triggerSync}
            className="flex items-center gap-1 rounded-full border border-cinnabar/60 bg-cinnabar/15 px-2.5 py-0.5 font-mono text-[9.5px] text-cinnabar-soft font-semibold hover:bg-cinnabar/25 active:scale-95"
          >
            {syncStatus === 'syncing' ? (
              <LoaderCircle size={10} className="animate-spin" />
            ) : (
              <Check size={10} strokeWidth={2.5} />
            )}
            <span>{syncStatus === 'syncing' ? '比对中' : syncStatus === 'synced' ? '已对账' : '立即同步'}</span>
          </button>
        </div>
        </div>
      </header>

      {resolution && (
        <div className="border-b border-cinnabar/30 bg-cinnabar/10 px-3 py-1 font-mono text-[9.5px] text-cinnabar-soft flex items-center gap-1">
          <Check size={11} strokeWidth={2.5} />
          <span>冲突决策生效：【{resolution}】，已生成本地快照</span>
        </div>
      )}

      {/* 滚动视口 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-3">
        {/* 账户与 Keystore 硬件加密卡片 */}
        <div className="rounded-2xl border border-haze/80 bg-ink-raised/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cinnabar/20 text-cinnabar-soft font-mono font-bold text-[12px]">
                NN
              </div>
              <div>
                <div className="font-display text-[12.5px] font-semibold text-paper">
                  user@newsnook.local
                </div>
                <div className="flex items-center gap-1 font-mono text-[8.5px] text-paper-faint">
                  <KeyRound size={9} className="text-cinnabar-soft" />
                  <span>Keystore 硬件加密保护</span>
                </div>
              </div>
            </div>
            <span className="rounded-full bg-cinnabar/20 px-2 py-0.5 font-mono text-[8.5px] font-bold text-cinnabar-soft">
              已就绪
            </span>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-haze/40 font-mono text-[9px] text-paper-faint">
            <span>最后同步：刚刚</span>
            <span>Outbox 待传：0 队列</span>
          </div>
        </div>

        {/* 互联设备列表 */}
        <div className="space-y-1">
          <div className="font-mono text-[9.5px] text-paper-faint px-0.5">已授权设备（3 台）：</div>
          <div className="grid grid-cols-3 gap-1.5 font-mono text-[9px]">
            <div className="rounded-lg border border-cinnabar/40 bg-cinnabar/10 p-2 text-center text-cinnabar-soft font-bold">
              <Smartphone size={12} className="mx-auto mb-1" />
              <span>当前手机</span>
            </div>
            <div className="rounded-lg border border-haze bg-ink-raised/40 p-2 text-center text-paper-muted">
              <HardDrive size={12} className="mx-auto mb-1" />
              <span>Xiaomi Pad</span>
            </div>
            <div className="rounded-lg border border-haze bg-ink-raised/40 p-2 text-center text-paper-muted">
              <Cloud size={12} className="mx-auto mb-1" />
              <span>MacBook</span>
            </div>
          </div>
        </div>

        {/* 严格同步范畴划分 */}
        <div className="rounded-xl border border-cinnabar/30 bg-cinnabar/5 p-2.5 space-y-1.5 text-[10.5px]">
          <div className="font-mono text-[10px] font-bold text-cinnabar-soft flex items-center gap-1">
            <Cloud size={12} />
            <span>云端同步域（换设备无感恢复）：</span>
          </div>
          <ul className="space-y-1 font-mono text-[9px] text-paper/90 pl-3">
            <li>• 自建订阅源与 153 个内置源启闭状态</li>
            <li>• 分类排序、显隐配置与 8 套场景预设</li>
            <li>• 端侧密钥（Android Keystore 硬件隔离）</li>
          </ul>
        </div>

        <div className="rounded-xl border border-haze/60 bg-ink-raised/40 p-2.5 space-y-1.5 text-[10.5px]">
          <div className="font-mono text-[10px] font-bold text-paper-muted flex items-center gap-1">
            <ShieldCheck size={12} />
            <span>严格本机保留（绝不上云）：</span>
          </div>
          <ul className="space-y-1 font-mono text-[9px] text-paper-faint pl-3">
            <li>• 全部文章正文内容与 Readability 离线缓存</li>
            <li>• 稍后读、已读记录、阅读足迹与毫秒进度</li>
            <li>• 墨水屏设备专用硬件开关</li>
          </ul>
        </div>
      </div>

      {/* 冲突三选一对话框 */}
      <AnimatePresence>
        {showConflict && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3">
            <div className="w-full rounded-2xl border border-amber-500/50 bg-ink-raised p-4 space-y-2 text-left shadow-2xl">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-amber-400">
                <AlertTriangle size={14} />
                <span>检测到多端配置差异 · 仲裁策略</span>
              </div>
              <p className="text-[10px] text-paper-muted leading-tight">
                云端存在其他设备更新的配置。NewsNook 绝不静默覆盖：
              </p>
              <div className="space-y-1.5 font-mono text-[9px] pt-1">
                <button
                  type="button"
                  onClick={() => resolve('保留本机')}
                  className="w-full rounded-lg border border-haze p-2 text-left hover:bg-paper/5 text-paper"
                >
                  1. 保留本机设置（以当前设备为主覆盖云端）
                </button>
                <button
                  type="button"
                  onClick={() => resolve('使用云端')}
                  className="w-full rounded-lg border border-haze p-2 text-left hover:bg-paper/5 text-paper"
                >
                  2. 使用云端版本（拉取其他设备的最新布局）
                </button>
                <button
                  type="button"
                  onClick={() => resolve('智能三方合并')}
                  className="w-full rounded-lg border border-cinnabar bg-cinnabar/15 p-2 text-left font-bold text-cinnabar-soft"
                >
                  3. 智能三方合并（双方新增自动合并，生成快照）
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
