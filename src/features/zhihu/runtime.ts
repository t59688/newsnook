import { getSecureStore, type SecureStore } from '../account/secureStore'
import { ZhihuApiClient } from './api/client'
import { ZhihuCredentialStore } from './session/store'
import { ZhihuSessionService } from './session/service'
import { ZhihuAccountService } from './session/account'
import { createZhihuSafeReadTransport } from './transport/safeRead'
import { createZhihuAndroidTransport } from './transport/android'
import type { ZhihuTransport } from './transport/types'
import { Capacitor } from '@capacitor/core'

export interface ZhihuRuntime {
  session: ZhihuSessionService
  credentials: ZhihuCredentialStore
  api: ZhihuApiClient
  account: ZhihuAccountService
}

export function createZhihuRuntime(options: {
  transport?: ZhihuTransport
  secureStore?: SecureStore
} = {}): ZhihuRuntime {
  const session = new ZhihuSessionService()
  const credentials = new ZhihuCredentialStore(options.secureStore ?? getSecureStore())
  const transport = options.transport ?? (
    Capacitor.isNativePlatform()
      ? createZhihuAndroidTransport(credentials)
      : createZhihuSafeReadTransport()
  )
  const api = new ZhihuApiClient(transport, session)
  const account = new ZhihuAccountService(session, credentials, api)
  return { session, credentials, api, account }
}
