# Notifications

The PC bridge detects session changes and sends FCM data messages. Android shows
input requests and execution errors with sound/vibration, and completed responses
silently. Android's notification settings control each channel. Opening an alert
opens its session; an alert for the chat currently on screen is suppressed.

## Firebase setup

Each bridge operator supplies their own Firebase project and credentials. They are
not included in the source or APK. Phones using that bridge receive its client
configuration, so you do not need a separate Firebase project for each phone.
Firebase is optional; session monitoring and messaging work without it.

1. Create or choose your own Firebase project. Register the Android package
   `dev.rapina.herdrpocket`. Google Analytics is not required.
2. Download the Android app's `google-services.json` into `.local/` on the bridge PC.
3. Enable the Firebase Cloud Messaging API (HTTP v1). Create a dedicated service
   account with the **Firebase Cloud Messaging API Admin** role in that project.
   Store its JSON key at `.local/firebase-service-account.json`.
4. Run `npm run check:push`, then restart the bridge. On Windows:

   ```powershell
   & ./scripts/stop-bridge.ps1
   & ./scripts/start-bridge.ps1
   ```

5. In the phone app's connection settings, tap **Enable notifications** and allow
   Android's notification permission.

Both files must belong to the same Firebase project. They stay outside source
control and source exports. Keep the service account key on the PC; it is never
sent to the phone. To use files elsewhere, set `POCKET_FIREBASE_CLIENT_CONFIG` and
`POCKET_FIREBASE_SERVICE_ACCOUNT` in the bridge's environment.

The app receives its client configuration through the authenticated HTTPS bridge
connection and initializes Firebase locally. Changing configuration does not
require rebuilding the APK. Google Play services and an internet connection are
needed for FCM; opening the conversation still requires access to the bridge.

Reference: [Android FCM setup](https://firebase.google.com/docs/cloud-messaging/android/get-started),
[HTTP v1 authorization](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

## Delivery behavior

- The bridge polls while at least one phone is registered, with eight seconds
  between completed polls. A first observation establishes a silent baseline.
- A new blocked state or changed question creates an input alert. Explicit error
  states create an error alert. A new visible assistant response followed by an
  idle/done state creates a completion alert. Intermediate work is silent.
- Unknown states, failed session matching, and network failures do not become
  execution-error alerts. Gaps longer than 15 minutes establish a fresh baseline.
- The bridge persists routes, registrations, and pending events in
  `.local/push-state.json`. Retries back off. Events expire after 15 minutes;
  resumed work supersedes queued alerts. Android deduplicates by session and time.
- FCM carries only random session/event IDs, an event kind, and its timestamp.
  Conversation text, project names, machine names, paths, and bridge credentials
  are excluded. The phone uses locally cached project names for notification titles.
- Alerts are grouped, with one current notification per session. Replacement
  sessions cannot reuse an old alert's route. Offline navigation retries on resume.
- Registration refreshes after token changes and periodically on app resume.
  Android JobScheduler retries failed registration. Disabling notifications stops
  local display, attempts bridge deregistration, and deletes the FCM token.

The bridge PC must stay awake and connected. FCM delivery may be delayed or lost;
Android notification permission, channel settings, and force-stopping the app also
affect delivery. This is not a monitoring service with guaranteed delivery.

## Verification

`npm test` covers event transitions, restart persistence, stale routes, retries,
invalid tokens, authenticated endpoints, and FCM payload contents. `npm run test:ui`
covers settings and navigation, including reconnecting after an offline tap.

The debug APK contains `PushFixtureReceiver`, protected by Android's signature-level
`DUMP` permission. `scripts/phone-notification-check.mjs` uses ADB to exercise local
display, channels, deduplication, foreground suppression, and the notification's
PendingIntent. The receiver is absent from release builds. This fixture verifies
Android behavior without claiming a real FCM delivery. Verify a real FCM delivery
separately after configuring Firebase, including with the phone screen off.
