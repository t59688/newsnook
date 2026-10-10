import assert from 'node:assert/strict'
import { LinuxDoNotificationService } from '../src/features/linuxdo/notification/service'
import { advanceLinuxDoNotificationPagination, emptyLinuxDoNotificationPagination } from '../src/features/linuxdo/notification/pagination'
import { linuxDoNotificationMatchesFilter } from '../src/features/linuxdo/notification/model'

const calls: number[] = []
const service = new LinuxDoNotificationService({
  getJson: async (url: string) => {
    const parsed = new URL(url)
    const offset = Number(parsed.searchParams.get('offset'))
    calls.push(offset)
    const rows = offset === 0
      ? Array.from({ length: 60 }, (_, i) => ({ id: 1000 - i, notification_type: 5, created_at: '2026-10-01T00:00:00Z', read: true }))
      : [{ id: 100, notification_type: 1, created_at: '2026-09-01T00:00:00Z', read: true }]
    return { notifications: rows, total_rows_notifications: 61, load_more_notifications: `/notifications?offset=${offset + 60}&limit=60` }
  },
} as any)
const first = await service.list()
assert.equal(first.scannedRows, 60)
assert.equal(first.totalRows, 61)
assert.equal(first.nextOffset, 60)
assert.equal(first.items.filter(x => linuxDoNotificationMatchesFilter(x, 'mentions')).length, 0)
const second = await service.list(first.nextOffset)
assert.equal(second.nextOffset, undefined, 'last page must terminate despite a load-more URL')
assert.equal(second.scannedRows, 61)
assert.equal(second.items.filter(x => linuxDoNotificationMatchesFilter(x, 'mentions')).length, 1)
assert.deepEqual(calls, [0, 60])

const page1 = advanceLinuxDoNotificationPagination(emptyLinuxDoNotificationPagination(), first, true)
const page2 = advanceLinuxDoNotificationPagination(page1, second)
assert.deepEqual(page2, { scanned: 61, totalRows: 61, nextOffset: undefined })
const staleRefresh = advanceLinuxDoNotificationPagination(page2, first)
assert.deepEqual(staleRefresh, page2, 'background refresh must not rewind the scanned cursor')
const refreshed = advanceLinuxDoNotificationPagination(page2, first, true)
assert.equal(refreshed.nextOffset, 60, 'explicit refresh restarts pagination')

const noTotal = new LinuxDoNotificationService({ getJson: async () => ({
  notifications: [], load_more_notifications: '/notifications?offset=60&limit=60',
}) } as any)
assert.equal((await noTotal.list()).nextOffset, undefined, 'an empty page cannot loop forever when total is missing')
console.log('linuxdo-notification-pagination: ok')
