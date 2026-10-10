/**
 * Pagination is over Discourse's unfiltered historical notification stream.
 * Individual category tabs are client-side views of the rows we've scanned.
 * A page can contain invisible/filtered-out notifications, so items.length is
 * never a safe offset or a substitute for total_rows_notifications.
 */
export interface LinuxDoNotificationPagination {
  scanned: number
  totalRows?: number
  nextOffset?: number
}

export interface LinuxDoNotificationPageProgress {
  scannedRows: number
  totalRows?: number
  nextOffset?: number
}

export const emptyLinuxDoNotificationPagination = (): LinuxDoNotificationPagination => ({ scanned: 0 })

export function advanceLinuxDoNotificationPagination(
  previous: LinuxDoNotificationPagination,
  page: LinuxDoNotificationPageProgress,
  reset = false,
): LinuxDoNotificationPagination {
  const totalRows = page.totalRows ?? (reset ? undefined : previous.totalRows)
  const scanned = Math.min(
    totalRows ?? Number.MAX_SAFE_INTEGER,
    reset ? page.scannedRows : Math.max(previous.scanned, page.scannedRows),
  )
  // Discourse's historical endpoint always supplies the *unfiltered* total.
  // Its "load_more_notifications" URL may still exist after the last page.
  // Keeping our own monotonic cursor also prevents background first-page
  // refreshes and mark-read reconciliation from jumping back to page two.
  const nextOffset = totalRows !== undefined
    ? (scanned < totalRows ? scanned : undefined)
    : (reset || page.scannedRows >= previous.scanned ? page.nextOffset : previous.nextOffset)
  return { scanned, totalRows, nextOffset }
}
