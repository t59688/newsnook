# Source Watch (local-only)

## User contract

- Off by default. The watch list is a global list of stable source IDs, independent of presets.
- Only explicitly watched sources are fetched. Unwatching removes its cursor and cancels
  the native scheduled job if the last native-supported watch is removed.
- First successful scan seeds a cursor and sends no notifications for historical entries.
- Later entries are deduplicated by source and canonicalized article URL.
- No Cloudflare, FCM, Google Play services, account, or paid backend is required.

## Boundaries

- `features/sourceWatch/store.ts`: local watch rules, seen cursors, event inbox.
  This key is intentionally excluded from the blocking native startup-storage mirror.
- `features/sourceWatch/runtime.ts`: React foreground, shared source transport + parser,
  two concurrent fetches, timeout, no fetching for zero watched sources.
- `features/sourceWatch/native.ts`: Capacitor boundary; native events are acknowledged
  only after they have been merged into the local inbox.
- `SourceWatchJobService`: Android JobScheduler, independent from the WebView,
  periodic network work, RSS/Atom pull parsing, conditional GET and cursor storage.
  The service never scrapes arbitrary HTML or runs a persistent foreground service.
- `SourceWatchPlugin`: dynamic notification permission and Android notification channel;
  explicit Intent routes to the in-app article reader.

## Scope limitation

Native background polling is limited to direct HTTPS XML RSS/Atom GET sources.
Custom POST feeds, RSSHub dynamic endpoints and special HTML adapters such as
Anthropic are checked only in the app foreground. Native device execution is
subject to Doze/battery optimization; there is no guaranteed real-time delivery.
Background notifications require POST_NOTIFICATIONS permission on Android 13+.
The inbox remains usable without that permission.

## Verification

- `node --import tsx --test scripts/source-watch.test.ts`
- `node node_modules/typescript/bin/tsc -b --pretty false`
- `npm run lint` (existing repository warnings may remain)
- Android: `gradlew :app:compileCloudDebugJavaWithJavac --offline`
- Physical device: turn on one RSS source, verify first baseline, publish a test
  item, exercise JobScheduler with Doze / denied notifications / app force-stop.
  Force-stop explicitly prevents periodic jobs until app relaunch.

## Settings UI and layout regression

The Source Watch workspace is an opaque `SettingsShell`, not a second normal
flex item appended to the MeScreen. This is required because App keeps the
underlying tab and its bottom navigation mounted while a settings route is open.
It uses the current theme tokens and the existing SettingsShell back/safe-area
contract. The three adjacent views are: inbox, source discovery, and reminders.

- Visual review: 360x780, 390x844, and 768x1024 for empty inbox, source list,
  reminder settings, and bottom sheet. Day/night schemes checked separately.
- UI actions: follow, choose silent delivery, cancel sheet, back with Escape.
- `node --import tsx --test scripts/source-watch-ui.test.ts` guards the
  fullscreen shell and the truthful background-ready source label.

## Discoverability and notification delivery (2026-11-10)

- The top feed toolbar always contains a bell to open the global watch inbox.
  Its count is the number of unread watch events across all presets; a small dot
  also appears on the Me tab, and the Me settings entry displays the unread count.
- The bell and read/unread count are live subscribers to a local numeric snapshot,
  not tied to the selected feed or preset.
- A newly discovered foreground article triggers an in-app banner **only** for
  instant-alert watch rules and outside quiet hours. The same happens for newly
  imported Android background events after the app resumes. Already persisted
  unread entries do not repeatedly show banners at each startup.
- Opening an article from a banner, the watch inbox, or another NewsNook feed
  marks its matching watch event as read. Native notification deep links
  reconcile pending events before marking an opened article read.
- Android system notifications are emitted by JobScheduler only for new items
  in supported direct HTTPS RSS/Atom feeds, with Android permission and the
  NewsNook watch channel enabled. Special HTML parsers (e.g., Anthropic)
  remain foreground-only. There is intentionally no system notification for
  old articles in the first scan, or for silent inbox-only watch rules.
- Settings > Watch updates > Notification settings allows requesting permission,
  reading status and emitting a **real test notification**; the test opens the
  watch inbox and never inserts a fake article. A link to Android app notification
  settings is offered when notifications are disabled.
- Use `node --import tsx --test scripts/source-watch-notifications.test.tsx`
  to test alert eligibility, event delivery, live bell markup, and read-state
  persistence. Real device testing is still required for Android Doze, lock
  screen / heads-up display, notification permission and channel behavior.

### Notification smoke test on Android 14

The debug app was installed on an API 34 emulator. App permission was initially
`POST_NOTIFICATIONS: granted=false`. On granting permission through the watch
settings UI, `sendTestNotification` posted a `newsnook-source-watch` notification
(importance DEFAULT, native bell icon), visible in the notification shade and
`dumpsys notification`. The notification opens `newsnook://watch/inbox` and a
warm-activity test confirmed that it switches even an already-open settings tab
back to the inbox. The notification is a diagnostic only: it never writes a
fake update into the news inbox.

A second UI-only "预览应用内横幅" setting displays the actual foreground banner
without network requests or creating unread events. It also works on web.

## Inbox feed parity

The "新动态" tab renders watched articles through `WatchArticleFeed`, which
uses the **same** `ArticleRow` / `LeadStory` components and editorial wrappers
as the main home feed, rather than a separate `.sw-story` card implementation.
It inherits the user's `homeFeedLayout` preference (`classic` or `cards`),
article cover/recovery logic, translation settings, read state, saved state,
and prestored/offline indicators. Results remain sorted by discovery time;
article metadata shows the publisher's actual timestamp when provided.

The watch-specific inbox controls (all/unread filter, mark-all-read, unread
count, cross-preset event store) stay outside the shared article renderer.
Only 40 events are mounted initially; loading more adds batches of 40 without
fetching any unmonitored source. `SourceWatchScreen` owns read-state updates.

Native background RSS notifications initially contain only a title and URL.
The next foreground import reuses the existing parser for only the imported
watched source to hydrate cover, summary and real publication time, preserving
notification deduplication and existing read/unread state.

UI regression: `scripts/source-watch-feed-ui.test.tsx`, plus the updated
`settings-paper-ui.test.tsx` test accounting for the Source Watch shortcut.
Viewport review: 360x780, 390x844 and 768x1024; classic list, mobile/desktop
cards, light/dark themes, image-led story, unread-only and mark-all-read.

### Image fallback on the shared hero

The shared homepage `LeadStory` now paints the existing
`EditorialCoverPlaceholder` behind its asynchronous photo, on both phone
and desktop. While a preview image is pending or an upstream host returns an
unrecoverable image, the feature shows the app's native editorial cover
instead of an empty hero rectangle. Once the image loads, `InkImage` covers
it normally. The cover is local SVG artwork; no additional network requests
are introduced. Verified against the 36kr watched-feed image failure on an
Android 14 emulator after reinstalling the debug APK.


## Actual Android notification delivery fix (2026-11-10)

Root cause was two independent delivery gaps, not a broken notification channel:

1. `SourceWatchPlugin.syncRules` compared the stored schedule signature with
   the requested rules but did not check whether the OS JobScheduler entry
   still existed. After the OS lost a job, unchanged rules never rescheduled
   it. The plugin now checks `getPendingJob(JOB_ID)`, recreates missing jobs,
   replaces changed job constraints atomically, and only persists the schedule
   signature after a successful `JobScheduler.schedule` result.
2. Foreground WebView parsing persisted genuine new watch events and triggered
   the in-app banner, but never posted Android notifications. On Android,
   new events now pass through `notifyNativeWatchUpdates`, which filters for
   enabled instant-alert sources and quiet hours, batches multiple articles
   into one notification per source, and calls the same native notification
   dispatcher as the background JobService.

The native dispatcher persists recent notification keys (`notified:<sourceId>`)
under a bounded source-local cursor. Foreground and JobScheduler use the same
lock and keys: repeated scans and races do not re-notify the same articles.
Removing a watched source also clears its notification cursor. A failed system
post does not mark an article as notified. System notification deep links still
open the real article. Status details now show whether the Android job is
scheduled, the last background run, checked feeds, new articles, successful
notification groups and failed feeds. HTTP 304 is a successful unchanged feed,
not a failed request; HTTP errors are counted in failure diagnostics.

### Device verification

On an API 34 Android emulator with the existing five user-selected native RSS
watch rules (30-minute schedule), `adb shell cmd jobscheduler get-job-state
com.aizeek.newsnook.debug 235347` initially reported no such job despite
valid persisted rules. Opening the updated Debug app recovered the job without
changing any rules. The same command then reported the periodic job as active.

A forced **real RSS poll** (`adb shell cmd jobscheduler run -f
com.aizeek.newsnook.debug 235347`) returned 3 non-empty RSS feeds, detected 4
new 36kr articles and delivered 1 Android system notification titled
"36 氪 · 4 篇新内容" with a genuine article headline. Verified via Android's
notification shade and `dumpsys notification --noredact`. A repeat poll
reported 0 new and 0 newly notified articles. Tapping the first real alert
opened the intended NewsNook article reader. The debug test never fabricated
an article or added a fake unread event.

`JobScheduler` is opportunistic: Android may defer background runs under Doze
or power restrictions; force-stopping the app prevents background execution
until the user opens it again. These OS constraints are distinct from the
previously broken scheduling and foreground notification pipeline.

The notification deep-link handler also suppresses a duplicate in-app banner
while the user is navigating to the article from the Android notification
shade. Foreground-only events continue to use the normal banner behavior.

## Interval selection: 5 / 10 / 15 / 30 / 60 minutes

User-selectable intervals are exactly 5, 10, 15, 30 and 60 minutes;
legacy 120-minute preferences migrate to 60. Short intervals use two
alternating, persisted Android one-off JobScheduler IDs, each with
`setMinimumLatency()` equal to the selected interval. Before a 5/10-minute
job finishes it schedules the alternate job ID, so the running job is not
stopped and there is no process-dependent gap between jobs. For 15/30/60,
Android's standard persistent periodic JobScheduler API is used. Switching
cadences replaces old constraints and cancels the obsolete alternate ID.
Only explicitly followed, native-supported HTTPS RSS/Atom sources are
included. With no followed sources both jobs are canceled.

**Cadence is best effort, not an exact alarm:** JobScheduler may delay
one-off or periodic work due to Doze, standby buckets, connectivity, quotas
and manufacturer battery limits. A normal app exit or recent-app dismissal
usually leaves persisted jobs registered; an explicit force-stop prevents
background execution until the app is relaunched. No always-on foreground
service, exact-alarm privilege, paid backend, or push provider is introduced.
