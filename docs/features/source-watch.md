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
