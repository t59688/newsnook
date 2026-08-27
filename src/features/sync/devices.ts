/**
 * 设备列表与撤销。撤销只切断那台设备继续同步的能力，
 * 它本机已有的订阅与配置照旧可用，云端已上传的数据也不会被删。
 */

import type { DeviceListResponse, DeviceSummary } from '@newsnook/contracts'

import type { CloudFetch } from './transport'
import { DEVICE_HEADER } from './transport'

export async function listDevices(
  fetchCloud: CloudFetch,
  currentDeviceId: string,
): Promise<DeviceSummary[]> {
  const response = await fetchCloud('/api/v1/devices', {
    headers: { [DEVICE_HEADER]: currentDeviceId },
  })
  if (!response.ok) throw new Error(`设备列表读取失败（${response.status}）`)
  const body = (await response.json()) as DeviceListResponse
  return body.devices
}

export async function revokeDevice(fetchCloud: CloudFetch, deviceId: string): Promise<void> {
  const response = await fetchCloud(`/api/v1/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: 'POST',
    body: {},
  })
  if (!response.ok) throw new Error(`撤销失败（${response.status}）`)
}

export function describeDevice(device: DeviceSummary, now = Date.now()): string {
  const platform = device.platform === 'android' ? 'Android' : device.platform === 'web' ? '网页' : '其它'
  if (device.revokedAt) return `${platform} · 已撤销`
  const idle = Math.max(0, now - device.lastSeenAt)
  const minutes = Math.floor(idle / 60_000)
  if (minutes < 5) return `${platform} · 刚刚活跃`
  if (minutes < 60) return `${platform} · ${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${platform} · ${hours} 小时前`
  return `${platform} · ${Math.floor(hours / 24)} 天前`
}
