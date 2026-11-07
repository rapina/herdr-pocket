# Security

Herdr Pocket is a personal remote control for agents running with your account's
permissions. Anyone with access to both the bridge and its token can read sessions
and send instructions to supported agents.

The bridge listens on loopback. Use an HTTPS reverse proxy reachable from the
phone, with access restricted by a private network, VPN, or firewall. Tailscale
Serve is one option. Android accepts HTTPS origins, validates certificates, and
does not follow redirects. The certificate must be trusted by Android and match
the configured hostname or IP address.

The Android connection token is encrypted with Android Keystore. Pending message
text is kept in the app's private WebView storage until reconciled with the session
transcript. Bridge credentials and delivery receipts are stored under `.local/`.
These files are excluded from Git, but remain accessible to your OS account.

Debug APKs enable WebView debugging. Release builds disable it. Android backup is
disabled. Protect or revoke ADB access after testing.

Mermaid renders locally in strict mode with HTML labels disabled and limits of
20,000 source characters and 250 edges. Generated SVG is stripped of active and
external content and displayed as an image. Diagram links and callbacks are not
interactive. CSP allows inline styles for Mermaid's temporary layout calculation;
scripts remain restricted to bundled assets. No conversation text is sent to an
external diagram service.

User-tapped HTTP(S) links open through Android's external web-link handler without
bridge credentials. Both the renderer and native code reject other URL schemes,
embedded credentials, and the reserved media host. The WebView still blocks page
navigation. Local file links use session-bound media previews or copy the path;
they never grant Android access to an agent machine's filesystem.

Media uses authenticated bridge requests. Native code intercepts only the reserved
media host and adds credentials; the token never appears in media URLs. Other HTTP
subresources are blocked. The bridge exposes only media references found in a
matched conversation and checks that its session identity is still current.
The remote reader resolves symlinks, requires files to remain inside that session's
working folder or the current Claude session's temporary scratchpad, excludes hidden
paths, and checks media signatures and size limits. Other sessions' scratchpads are
not accessible through that conversation.
SVG, HTML, network shares, and arbitrary web URLs are not served. Media bytes pass
through Herdr and the bridge, not Firebase. The bridge temporarily caches files under
`.local/media-cache/`; its OS account can read them until cleanup.

Notifications are opt-in. Firebase client settings and sender credentials live in
the bridge's ignored `.local/` directory. Only client settings go to the phone;
the service account key stays on the PC. FCM processes installation tokens, opaque
event/session identifiers, event kinds, and timestamps. It receives no conversation
text or project names. The phone hides notification content on the lock screen
using Android's private visibility setting. Notification titles use its local cache.

For a vulnerability, use GitHub's **Report a vulnerability** option when enabled.
If it is unavailable, open an issue asking for a private reporting channel without
including exploit details, credentials, logs, or conversation content.
