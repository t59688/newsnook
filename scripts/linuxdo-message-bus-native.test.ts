import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
// @ts-expect-error Android environment loader is a project .mjs build utility.
import { loadAndroidEnv } from './android-env.mjs'

const env = loadAndroidEnv(process.cwd())
const dir = mkdtempSync(join(tmpdir(), 'newsnook-message-bus-'))
const source = resolve('android/app/src/main/java/com/aizeek/newsnook/LinuxDoMessageBusPolicy.java')
const test = join(dir, 'LinuxDoMessageBusPolicyTest.java')
writeFileSync(test, `package com.aizeek.newsnook;
public class LinuxDoMessageBusPolicyTest {
  static void check(boolean condition) { if (!condition) throw new AssertionError(); }
  public static void main(String[] args) {
    String path = "/message-bus/36e69dfcde554325925cae9376e35a99/poll?dlp=t";
    check(LinuxDoMessageBusPolicy.allows("https://ping.ldstatic.com" + path, "POST"));
    for (String base : new String[]{"http://ping.ldstatic.com", "https://ping.ldstatic.com.evil.example", "https://evil.example", "https://ping.ldstatic.com:443", "https://user@ping.ldstatic.com"})
      check(!LinuxDoMessageBusPolicy.allows(base + path, "POST"));
    check(!LinuxDoMessageBusPolicy.allows("https://ping.ldstatic.com" + path, "GET"));
    check(!LinuxDoMessageBusPolicy.allows("https://ping.ldstatic.com/session/current.json", "POST"));
    check(!LinuxDoMessageBusPolicy.allows("https://ping.ldstatic.com" + path + "&other=1", "POST"));
    String key = "0123456789abcdef0123456789abcdef";
    check(key.equals(LinuxDoMessageBusPolicy.sharedSessionKey("<meta name='shared_session_key' content='" + key + "'>")));
    check(key.equals(LinuxDoMessageBusPolicy.sharedSessionKey("<META content=\\"" + key + "\\" name=\\"shared_session_key\\">")));
    check(LinuxDoMessageBusPolicy.sharedSessionKey("<meta name='csrf-token' content='" + key + "'>").isEmpty());
    check(LinuxDoMessageBusPolicy.sharedSessionKey("<html>challenge</html>").isEmpty());
    check("alice".equals(LinuxDoMessageBusPolicy.sessionIdentity("cf_clearance=old; _t=alice; _forum_session=one")));
    check("alice".equals(LinuxDoMessageBusPolicy.sessionIdentity("cf_clearance=new; _t=alice; _forum_session=two")));
    check("".equals(LinuxDoMessageBusPolicy.sessionIdentity("cf_clearance=guest; _forum_session=three")));
    check(LinuxDoMessageBusPolicy.sharedSessionKey("<meta name='shared_session_key' content='invalid&#10;key'>").isEmpty());
    System.out.println("linuxdo-message-bus-native: ok");
  }
}`)
const extension = process.platform === 'win32' ? '.exe' : ''
execFileSync(join(env.JAVA_HOME, 'bin', 'javac' + extension), ['-d', dir, source, test], { env, stdio: 'pipe' })
console.log(execFileSync(join(env.JAVA_HOME, 'bin', 'java' + extension), ['-cp', dir, 'com.aizeek.newsnook.LinuxDoMessageBusPolicyTest'], { env, encoding: 'utf8' }).trim())
const plugin = readFileSync(resolve('android/app/src/main/java/com/aizeek/newsnook/LinuxDoSessionPlugin.java'), 'utf8')
const poll = plugin.slice(plugin.indexOf('private void sendMessageBusPoll'), plugin.indexOf('private void performNativeRequest'))
assert.doesNotMatch(poll, /\.header\("(?:Cookie|X-CSRF-Token|User-Api-Key)"/)
assert.match(poll, /\.header\("X-Shared-Session-Key", sharedKey\)/)
assert.match(poll, /sessionCookie\.equals/)
