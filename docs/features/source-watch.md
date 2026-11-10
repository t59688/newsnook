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
