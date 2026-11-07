# Verification

## Automated checks

- Node: authentication, send argument validation, duplicate and concurrent receipts,
  restart recovery, uncertain delivery, terminal projection, session replacement,
  dialog extraction, stale choices, key submission deduplication, notification
  transitions, retries, device retirement, and FCM payload privacy.
- Python: unique session matching, Action Required title prefixes, Claude process
  ancestry, visible chat extraction, pagination, activity, and response timestamps.
- Chrome: touch navigation, scroll/focus preservation, pending messages, delayed
  delivery receipts, temporary session loss, Korean/English labels, and reduced motion.
  Choice checks cover explicit selection, polling stability, duplicate submission,
  and resetting the selection when the question changes.
  Mermaid checks cover flowcharts, sequence diagrams, invalid syntax, viewport
  containment, refresh stability, and copying the original fenced text.
  Notification checks cover settings, offline navigation, and foreground context.
- Android: HTTPS origin validation, debug/release compilation, and debug lint.
- Media: local path parsing, workspace boundaries, file signatures, authenticated
  byte ranges, expired session IDs, concurrent transfer limits, and playback cleanup.

Run commands are in [CONTRIBUTING.md](../CONTRIBUTING.md). The Chrome fixture uses
fictional terminals and never contacts a live bridge. Results and screenshots go to
ignored `artifacts/`.

## Device checks

Use a paired Android device with the debug APK open. Forward its WebView socket:

```powershell
$appPid = (adb shell pidof dev.rapina.herdrpocket).Trim()
adb forward tcp:9333 "localabstract:webview_devtools_remote_$appPid"
node scripts/phone-navigation-check.mjs
node scripts/phone-chat-verify.mjs
adb forward --remove tcp:9333
```

`phone-chat-verify.mjs` reads up to three matched sessions by default, or accepts
terminal addresses as arguments. Both commands only read actual conversations.
Keep their output private. `phone-verify.mjs send` is for a dedicated `pocket-test`
echo terminal only. Never use real working agents for send experiments.

Screenshots use `scripts/phone-shot.mjs`. Set `ADB_PATH` if ADB is outside the SDK
location. On devices with multiple displays, set `ANDROID_DISPLAY_ID` to the
appropriate ID from `adb shell dumpsys SurfaceFlinger --display-id`.

The app has been exercised on an Android foldable's main display at 360 CSS pixels,
including navigation, reconnect, live conversation reads, language switching, and
connection-setting persistence. Local notification fixtures also exercise input and
completion channels, duplicate suppression, foreground suppression, and the
PendingIntent that opens a chat. A separate real FCM check on 2026-11-07 confirmed
input and completion notifications while the phone was non-interactive (Android
reported `Dozing`). Input used the high-importance channel with sound; completion
used the low-importance, silent channel. Both arrived as one notification for the
same session. This was a short screen-off check, not a prolonged idle-mode test.
Cover-screen layout remains outside the tested scope. Sending race conditions use
controlled UI fixtures.

Version 0.9.0 was checked on the phone with actual PNG, H.264 MP4, and WAV files
served by the bridge. Checks covered image touch/actual-size mode, video playback,
seeking/fullscreen, audio playback, player preservation during refresh, and pausing
on background/resume. Playback checks used muted samples. The reader also copied
all three sample formats through Herdr from remote Windows and macOS machines;
their bytes matched the originals. This does not cover every codec or file size.

Version 0.10.0 was tested with a dedicated Windows Cursor CLI session. The bridge
matched its live process, received prompt acknowledgement, showed working/done
states, and read the reply on Android. Existing work sessions received no test
instructions. Cursor editor chats and approval menus remain outside this support.
Nine real Claude scratchpad images previously rejected with HTTP 403 returned
image/png successfully after the fix; the first decoded at 960 pixels wide on
the phone. Other sessions' scratchpads remain rejected by regression tests.
