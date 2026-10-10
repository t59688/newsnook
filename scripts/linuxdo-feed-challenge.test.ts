import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workspace = readFileSync('src/features/linuxdo/ui/LinuxDoWorkspace.tsx', 'utf8')
const action = readFileSync('src/features/linuxdo/ui/VerificationAction.tsx', 'utf8')
const native = readFileSync('src/features/linuxdo/session/native.ts', 'utf8')
const android = readFileSync('android/app/src/main/java/com/aizeek/newsnook/LinuxDoSessionPlugin.java', 'utf8')

assert.match(workspace, /data-linuxdo-feed-error[\s\S]*?<LinuxDoRequestError/,
  'errors above cached topics must render the shared verification surface')
assert.match(workspace, /LinuxDoRequestError variant="empty"/,
  'empty feed errors must provide the same actionable surface')
assert.match(action, /data-linuxdo-verify/, 'all security challenges must have a visible first-party verification button')
assert.match(action, /if \(await onVerify\(options\) && mountedRef\.current\) await onRetry\(\)/,
  'only a user-completed challenge in a mounted view may retry the original action')
assert.match(workspace, /return await verifyLinuxDoChallenge\(options\?\.url/,
  'workspace verification must use the dedicated first-party challenge flow')
assert.match(native, /verifyChallenge\(options: \{ url: string; readSyncChallenge\?: boolean \}\)/,
  'the first-party challenge API also supports the POST-specific read-sync path')
assert.match(android, /public void verifyChallenge\(PluginCall call\)/)
assert.match(android, /CookieManager\.getInstance\(\)\.flush\(\);[\s\S]*?result\.put\("completed", true\)/,
  'challenge completion commits cookies and never claims a successful request')
assert.match(android, /if \(challengeOnly\) \{[\s\S]*?verificationCall\.resolve\(result\)/,
  'challenge completion must be distinct from account snapshot navigation')

console.log('linuxdo-feed-challenge: ok')
