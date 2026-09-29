import { LinuxDoApiError } from '../types'
import type { LinuxDoTimingBatch } from './readTracker'

export const READ_SYNC_BUILD = 'readsync-20260929-r4-visible-challenge'
export interface ReadSyncFailure {
  error: unknown
  batch: LinuxDoTimingBatch
  retrying: boolean
}

/** Safe to copy into a bug report: never serialize arbitrary error/bridge objects. */
export function readSyncDiagnostic(failure: ReadSyncFailure): string {
  const error = failure.error instanceof LinuxDoApiError ? failure.error : undefined
  const detail = error?.diagnostics
  return JSON.stringify({
    build: READ_SYNC_BUILD, kind: error?.kind ?? 'unknown', status: error?.status,
    request: detail ? {
      stage: detail.stage, method: detail.method, path: detail.path,
      status: detail.status, transport: detail.transport, responsePath: detail.responsePath,
      contentType: detail.contentType, cfMitigated: detail.cfMitigated, cfRay: detail.cfRay,
    } : undefined,
    topicId: failure.batch.topicId,
    postNumbers: Object.keys(failure.batch.timings).map(Number), retrying: failure.retrying,
  }, null, 2)
}
