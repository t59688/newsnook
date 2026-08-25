/**
 * DLNA 投屏浮层：设备搜索列表与连接后的电视遥控器（进度/音量/播放暂停）。
 */

import { useEffect, useState } from 'react'
import {
  Cast,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Tv2,
  Volume2,
  X,
} from 'lucide-react'

import type {
  DlnaCastDevice,
  DlnaCastSession,
  DlnaCastStatus,
} from '../../lib/dlnaCast'
import { formatTime } from './playback'

export function CastOverlay({
  open,
  devices,
  searching,
  connectingId,
  error,
  session,
  status,
  fallbackDuration,
  onClose,
  onRefresh,
  onConnect,
  onControl,
  onStop,
}: {
  open: boolean
  devices: DlnaCastDevice[]
  searching: boolean
  connectingId: string | null
  error: string | null
  session: DlnaCastSession | null
  status: DlnaCastStatus | null
  fallbackDuration: number
  onClose: () => void
  onRefresh: () => void
  onConnect: (device: DlnaCastDevice) => void
  onControl: (action: 'play' | 'pause' | 'seek' | 'volume', value?: number) => void
  onStop: () => void
}) {
  const [seekDraft, setSeekDraft] = useState<number | null>(null)
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setSeekDraft(null)
      setVolumeDraft(null)
    }
  }, [open])

  if (!open) return null

  const total = Math.max(0, status?.duration || fallbackDuration || 0)
  const remoteCurrent = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, status?.current || 0))
  const seekValue = seekDraft ?? remoteCurrent
  const volumeValue = volumeDraft ?? status?.volume ?? 0
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

  const commitSeek = (value: number) => {
    setSeekDraft(null)
    onControl('seek', value)
  }
  const commitVolume = (value: number) => {
    setVolumeDraft(null)
    onControl('volume', value)
  }

  return (
    <div
      data-theme="dark"
      data-no-page-tap=""
      className="fixed inset-0 z-[140] flex items-end justify-center bg-black/65 backdrop-blur-sm md:items-center md:p-4"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={session ? '投屏遥控器' : '选择投屏设备'}
        className="w-full max-w-md overflow-hidden rounded-t-3xl border border-haze bg-ink-raised text-paper shadow-2xl md:rounded-3xl"
        style={{ paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-haze/60 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper/10 text-paper">
            <Cast size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[16px] font-medium">
              {session ? session.deviceName : '投屏到设备'}
            </h3>
            <p className="mt-0.5 text-[11px] text-paper/55">
              {session ? stateLabel : '搜索同一局域网内的电视和播放器'}
            </p>
          </div>
          {!session && (
            <button
              type="button"
              aria-label="重新搜索"
              disabled={searching}
              onClick={onRefresh}
              className="flex size-9 items-center justify-center rounded-full text-paper/80 active:bg-paper/10 disabled:opacity-40"
            >
              <RefreshCw size={17} className={searching ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-paper/80 active:bg-paper/10"
          >
            <X size={19} />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded-xl border border-cinnabar/30 bg-cinnabar/10 px-3 py-2 text-[12px] leading-relaxed text-cinnabar-soft">
            {error}
          </div>
        )}

        {!session ? (
          <div className="max-h-[58vh] overflow-y-auto overscroll-contain px-3 py-3">
            {searching && devices.length === 0 && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-paper/60">
                <LoaderCircle size={22} className="animate-spin" />
                <span className="text-[12px]">正在搜索局域网投屏设备…</span>
              </div>
            )}

            {!searching && devices.length === 0 && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 text-center text-paper/55">
                <Tv2 size={28} strokeWidth={1.5} />
                <p className="text-[12px] leading-relaxed">
                  未发现可投屏设备。请确认手机和电视连接同一局域网，并在电视上开启投屏或 DLNA。
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              {devices.map((device) => {
                const connecting = connectingId === device.id
                const details = [device.manufacturer, device.model]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <button
                    key={device.id}
                    type="button"
                    disabled={Boolean(connectingId)}
                    onClick={() => onConnect(device)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors active:bg-paper/10 disabled:opacity-50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-paper/10">
                      <Tv2 size={20} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{device.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-paper/50">
                        {details || device.address}
                      </span>
                    </span>
                    {connecting ? (
                      <LoaderCircle size={18} className="animate-spin text-paper/70" />
                    ) : (
                      <Cast size={17} className="text-paper/45" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="px-5 py-5">
            <div className="mb-4 rounded-2xl border border-paper/10 bg-paper/5 px-3.5 py-3">
              <div className="text-[12px] font-medium text-paper/90">
                {session.mode === 'direct' ? '电视独立播放' : '兼容模式'}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-paper/55">
                {session.mode === 'direct'
                  ? '电视已直接连接视频源。手机可以熄屏、退出应用或关机，不影响电视继续播放。'
                  : '当前视频需要手机兼容中转。可以熄屏或退出应用，请保持手机开机并连接当前 Wi-Fi。'}
              </p>
            </div>

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
                <span>{formatTime(seekValue)}</span>
                <span>{formatTime(total)}</span>
              </div>

              <div className="mt-4 flex items-center justify-center gap-5">
                <button
                  type="button"
                  aria-label="后退 15 秒"
                  onClick={() => onControl('seek', Math.max(0, remoteCurrent - 15))}
                  className="flex size-12 items-center justify-center rounded-full bg-paper/10 text-paper active:bg-paper/15"
                >
                  <SkipBack size={20} />
                </button>
                <button
                  type="button"
                  aria-label={status?.state === 'playing' ? '暂停电视播放' : '继续电视播放'}
                  onClick={() => onControl(status?.state === 'playing' ? 'pause' : 'play')}
                  className="flex size-16 items-center justify-center rounded-full bg-paper text-ink-deep active:scale-95"
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
                  onClick={() => onControl('seek', Math.min(total || remoteCurrent + 15, remoteCurrent + 15))}
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
              onClick={onStop}
              className="mt-4 w-full rounded-2xl border border-paper/15 py-3 text-[13px] font-medium text-paper/80 active:bg-paper/10"
            >
              结束投屏
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
