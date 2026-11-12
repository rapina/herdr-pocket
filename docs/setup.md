# Setup

[Back to README](../README.md)

## Bridge

Install Node.js 22+ and Herdr (`hc`) on the bridge PC. Register your
machines in Herdr. Each agent machine needs Python; compressed Codex transcripts
require Python 3.14's zstd support. The startup helpers target Windows. The bridge
can also run with `npm start` where `hc` and Python are available.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-bridge.ps1
```

The bridge binds to `127.0.0.1:47831`. The first launch creates `.local/config.json`.

To keep the bridge running, run `scripts/install-startup.ps1`. It registers a
scheduled task named `Wired Bridge` that starts the bridge at Windows sign-in and
restarts it within a minute if it stops. With the task installed, `start-bridge.ps1`
starts the bridge through the task, so closing the terminal does not stop it.

`scripts/stop-bridge.ps1` stops the bridge, but the task starts it again within a
minute. Use `stop-bridge.ps1 -Disable` to keep it stopped; `start-bridge.ps1`
re-enables the task. Remove the task with
`Unregister-ScheduledTask -TaskName 'Wired Bridge'`.

### Connect from Android

Put an HTTPS reverse proxy on the bridge PC and forward its root to
`http://127.0.0.1:47831`, preserving paths and the `Authorization` header. The phone
must be able to reach it over your LAN, VPN, or another configured network route.
The certificate must be trusted by Android and match the address you enter.

In the app's connection settings, enter the HTTPS origin and the config's `token`.
Replace the example `https://bridge.example.com:9443` with your own bridge address.
Example addresses in this guide are placeholders; no shared bridge is provided.
Hostnames, IPv4, and IPv6 addresses are accepted, with an optional port.
Paths, query strings, and fragments are not.
Keep access restricted to your devices and never commit or share the token.

### Tailscale example (optional)

Install Tailscale on the PC and phone and connect both to the same tailnet. On the PC:

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' serve --bg --https=9443 http://127.0.0.1:47831
```

Check existing Serve settings before using port 9443. Use private Serve. Enter its
HTTPS URL in the app, such as `https://my-pc.example.ts.net:9443`, along with the
bridge token. To stop serving, run `tailscale serve --https=9443 off`.

### Notifications (optional)

To receive notifications, configure your own Firebase project on the bridge using
the [notification guide](notifications.md). Session monitoring and messaging work
without Firebase. No Firebase configuration or credentials are bundled with the app.

### Cursor CLI

Install the Pocket hooks on each machine running Cursor CLI:

```sh
node scripts/install-cursor.mjs my-herdr-machine
```

Omit the machine name for the bridge PC. Start or restart Cursor CLI inside a
Herdr terminal after installation. Existing hooks are preserved and backed up.
Pocket shows its conversation, tool activity, working timer, and completion status.
Messages can be sent while Cursor is idle or finished. Delivery is confirmed by
Cursor accepting a new prompt; uncertain sends are never retried automatically.

Cursor editor chats and Cursor approval menus are not supported in this version.
The integration uses [Cursor hooks](https://cursor.com/docs/hooks), verified with
Cursor CLI 2026.11.05 on Windows. It does not change permissions or answer approvals.

## Build and install

Install JDK 17+ and Android SDK 35, then set `ANDROID_HOME` to the SDK directory.

```powershell
.\gradlew.bat assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.rapina.herdrpocket/.MainActivity
```

On macOS or Linux use `sh gradlew assembleDebug`. Debug builds enable WebView
inspection. `assembleRelease` produces an unsigned release APK with debugging
disabled; configure your own signing before distribution.
