import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workspace = readFileSync('src/features/linuxdo/ui/LinuxDoWorkspace.tsx', 'utf8')
const native = readFileSync('src/features/linuxdo/session/native.ts', 'utf8')
const android = readFileSync('android/app/src/main/java/com/aizeek/newsnook/LinuxDoSessionPlugin.java', 'utf8')

assert.match(workspace, /data-linuxdo-feed-error[\s\S]*?needsVerification \? verifyAndReload\(\) : load\(false\)/,
  'an error above cached topics must provide the verification action, not retry alone')
assert.match(workspace, /aria-label=\{needsVerification \? '打开安全验证'/,
  'verification action should be accessible to screen readers')
assert.match(workspace, /return await verifyLinuxDoChallenge\(\)/,
  'verification should use the dedicated challenge flow')
assert.doesNotMatch(workspace, /const verify = async[\s\S]*?api\.setSession\(next\)/,
  'challenge recovery must not overwrite the active account session')
assert.match(native, /verifyChallenge\(options: \{ url: string \}\): Promise<\{ completed: boolean \}>/)
assert.match(android, /public void verifyChallenge\(PluginCall call\)/)
assert.match(android, /CookieManager\.getInstance\(\)\.flush\(\);[\s\S]*?result\.put\("completed", true\)/,
  'challenge completion should commit first-party cookies before the blocked request retries')
assert.match(android, /if \(challengeOnly\) \{[\s\S]*?verificationCall\.resolve\(result\)/,
  'challenge completion must be separate from login snapshot navigation')
const { retryAfterVerification } = await import('../src/features/linuxdo/ui/feedModel')
const calls: string[] = []
assert.equal(await retryAfterVerification(async () => { calls.push('verify'); return true }, async () => { calls.push('reload') }), true)
assert.deepEqual(calls, ['verify', 'reload'])
assert.equal(await retryAfterVerification(async () => false, async () => { throw new Error('cancel must not reload') }), false)
console.log('linuxdo-feed-challenge: ok')
