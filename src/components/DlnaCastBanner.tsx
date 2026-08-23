import { useEffect, useState } from 'react'
import {
  Cast,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react'

import {
  controlActiveDlnaCast,
  refreshActiveDlnaCast,
  restoreActiveDlnaCast,
  stopActiveDlnaCast,
  useDlnaCastSession,
} from '../features/cast/session'
import { isDlnaCastAvailable } from '../lib/dlnaCast'

function formatCastTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function DlnaCastBanner() {
  const { session, status, error } = useDlnaCastSession()
  const [open, setOpen] = useState(false)
  const [seekDraft, setSeekDraft] = useState<number | null>(null)
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)

  useEffect(() => {
    if (!isDlnaCastAvailable()) return
    void restoreActiveDlnaCast()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void restoreActiveDlnaCast()
        void refreshActiveDlnaCast()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (!session) return
    void refreshActiveDlnaCast()
    const timer = window.setInterval(() => void refreshActiveDlnaCast(), 1500)
    return () => window.clearInterval(timer)
  }, [session?.id])

  useEffect(() => {
    if (!open) {
      setSeekDraft(null)
      setVolumeDraft(null)
    }
  }, [open])

  if (!session) return null

  const direct = session.mode === 'direct'
  const modeLabel = direct ? '电视独立播放' : '兼容模式'
  const stateLabel =
    status?.state === 'playing'
      ? '播放中'
      : status?.state === 'paused'
        ? '已暂停'
        : status?.state === 'transitioning'
          ? '加载中'
          : status?.state === 'stopped'
            ? '已停止'
            : '已连接'
  const total = Math.max(0, status?.duration || 0)
  const remoteCurrent = Math.max(
    0,
    Math.min(total || Number.MAX_SAFE_INTEGER, status?.current || 0),
  )
  const seekValue = seekDraft ?? remoteCurrent
  const volumeValue = volumeDraft ?? status?.volume ?? 0

  const commitSeek = (value: number) => {
    setSeekDraft(null)
    void controlActiveDlnaCast('seek', value)
  }
  const commitVolume = (value: number) => {
    setVolumeDraft(null)
    void controlActiveDlnaCast('volume', value)
  }

  return (
    <>
      <div
        data-theme="dark"
        className="fixed left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center rounded-full border border-haze bg-ink-raised/95 p-1 text-paper shadow-xl shadow-black/30 backdrop-blur-md"
        style={{ bottom: 'calc(var(--sab, 0px) + 72px)' }}
      >
        <button
          type="button"
          aria-label={`正在投屏到 ${session.deviceName}，打开遥控器`}
          onClick={() => setOpen(true)}
          className="flex min-w-0 items-center gap-2.5 rounded-full py-1.5 pl-2 pr-2 text-left active:bg-paper/5"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cinnabar/15 text-cinnabar-soft">
            <Cast size={14} strokeWidth={2.2} />
          </span>
          <span className="min-w-0">
            <span className="block max-w-44 truncate text-[12px] font-medium leading-tight">
              {session.deviceName}
            </span>
            <span className="mt-0.5 block text-[10px] leading-tight text-paper/55">
              {modeLabel} · {stateLabel}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={status?.state === 'playing' ? '暂停电视播放' : '继续电视播放'}
          onClick={() => void controlActiveDlnaCast(
            status?.state === 'playing' ? 'pause' : 'play',
          )}
          className="mr-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-paper/10 transition-transform active:scale-95 active:bg-paper/15"
        >
          {status?.state === 'playing' ? (
            <Pause size={14} />
          ) : (
            <Play size={14} className="ml-0.5" />
          )}
        </button>
      </div>

      {open && (
        <div
          data-theme="dark"
          data-no-page-tap=""
          className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 backdrop-blur-sm md:items-center md:p-4"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="投屏遥控器"
            className="w-full max-w-md overflow-hidden rounded-t-3xl border border-haze bg-ink-raised text-paper shadow-2xl md:rounded-3xl"
            style={{ paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-haze/60 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper/10">
                <Cast size={18} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[16px] font-medium">{session.deviceName}</h3>
                <p className="mt-0.5 text-[11px] text-paper/55">
                  {modeLabel} · {stateLabel}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭遥控器"
                onClick={() => setOpen(false)}
                className="flex size-9 items-center justify-center rounded-full text-paper/80 active:bg-paper/10"
              >
                <X size={19} />
              </button>
            </div>

            <div className="px-5 py-5">
              <div className="mb-4 rounded-2xl border border-paper/10 bg-paper/5 px-3.5 py-3">
                <div className="text-[12px] font-medium text-paper/90">{modeLabel}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-paper/55">
                  {direct
                    ? '电视已直接连接视频源。手机可以熄屏、退出应用或关机，不影响电视继续播放。'
                    : '当前视频需要手机兼容中转。可以熄屏或退出应用，请保持手机开机并连接当前 Wi-Fi。'}
                </p>
              </div>

              {error && (
                <div className="mb-3 rounded-xl border border-cinnabar/30 bg-cinnabar/10 px-3 py-2 text-[12px] leading-relaxed text-cinnabar-soft">
                  {error}
                </div>
              )}

              <div className="rounded-2xl bg-black/25 px-4 py-4">
                <input
                  type="range"
                  min={0}
                  max={total || 0}
                  step={1}
                  disabled={!total}
                  value={Number.isFinite(seekValue) ? seekValue : 0}
                  aria-label="电视播放进度"
                  className="ink-seek h-6 w-full appearance-none bg-transparent"
                  onChange={(event) => setSeekDraft(Number(event.currentTarget.value))}
                  onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
                  onKeyUp={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      commitSeek(Number(event.currentTarget.value))
                    }
                  }}
                />
                <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-paper/55">
                  <span>{formatCastTime(seekValue)}</span>
                  <span>{formatCastTime(total)}</span>
                </div>

                <div className="mt-4 flex items-center justify-center gap-5">
                  <button
                    type="button"
                    aria-label="后退 15 秒"
                    onClick={() => void controlActiveDlnaCast('seek', Math.max(0, remoteCurrent - 15))}
                    className="flex size-12 items-center justify-center rounded-full bg-paper/10 text-paper active:bg-paper/15"
                  >
                    <SkipBack size={20} />
                  </button>
                  <button
                    type="button"
                    aria-label={status?.state === 'playing' ? '暂停电视播放' : '继续电视播放'}
                    onClick={() => void controlActiveDlnaCast(
                      status?.state === 'playing' ? 'pause' : 'play',
                    )}
                    className="flex size-16 items-center justify-center rounded-full bg-paper text-ink-deep transition-transform active:scale-95"
                  >
                    {status?.state === 'playing' ? (
                      <Pause size={25} fill="currentColor" fillOpacity={0.2} />
                    ) : (
                      <Play size={26} className="ml-1" fill="currentColor" fillOpacity={0.2} />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="前进 15 秒"
                    onClick={() => void controlActiveDlnaCast(
                      'seek',
                      Math.min(total || remoteCurrent + 15, remoteCurrent + 15),
                    )}
                    className="flex size-12 items-center justify-center rounded-full bg-paper/10 text-paper active:bg-paper/15"
                  >
                    <SkipForward size={20} />
                  </button>
                </div>

                {status?.volume != null && (
                  <div className="mt-5 flex items-center gap-3">
                    <Volume2 size={17} className="shrink-0 text-paper/60" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={Math.max(0, Math.min(1, volumeValue))}
                      aria-label="电视音量"
                      className="ink-seek h-6 min-w-0 flex-1 appearance-none bg-transparent"
                      onChange={(event) => setVolumeDraft(Number(event.currentTarget.value))}
                      onPointerUp={(event) => commitVolume(Number(event.currentTarget.value))}
                      onKeyUp={(event) => {
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                          commitVolume(Number(event.currentTarget.value))
                        }
                      }}
                    />
                    <span className="w-9 text-right font-mono text-[11px] text-paper/55">
                      {Math.round(volumeValue * 100)}%
                    </span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  void stopActiveDlnaCast()
                    .catch(() => undefined)
                    .finally(() => setOpen(false))
                }}
                className="mt-4 w-full rounded-2xl border border-paper/15 py-3 text-[13px] font-medium text-paper/80 active:bg-paper/10"
              >
                结束投屏
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
