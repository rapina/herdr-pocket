# Architecture

The Android app bundles a local HTML/CSS/JavaScript UI. `MainActivity.java` owns
HTTPS requests and encrypted connection settings. It never loads remote pages.

The interface uses a dark blue-black base, yellow working/action accents, cyan
completion accents, and coral input/error accents. Notched panels and thin borders
carry the Cyberpunk 2077-inspired direction without adding labels or decorative
text. Conversation text stays neutral for reading. Compact refresh icons keep a
44-pixel touch target; motion respects the system's reduced-motion preference.

Scripts load in this order, using classic scripts for Android's local asset URL:

| File                 | Responsibility                                            |
| -------------------- | --------------------------------------------------------- |
| `i18n.js`            | Korean and English messages, language preference          |
| `ui.js`              | DOM helpers, icons, motion, haptics                       |
| `transport.js`       | Native RPC requests and error status                      |
| `media.js`           | Image viewer, media controls, playback cleanup            |
| `message-content.js` | Mermaid fences, lazy rendering, and source display        |
| `app.js`             | Session state, list and conversation views, local outbox  |
| `delivery.js`        | Message submission and receipt reconciliation             |
| `interaction.js`     | Pending questions, choices, and explicit submission       |
| `notifications.js`   | Notification settings, foreground context, and navigation |
| `bootstrap.js`       | Events, refresh timers, startup                           |

The Node bridge calls `hc` with argument arrays. It groups terminals by machine and
runs the Python session reader through Herdr. The reader opens Codex's session DB
read-only and reads Codex or Claude Code transcripts on the machine that owns them.
It parses only the end of a transcript, growing the window until it holds one page
of messages and the start of the current turn, so long sessions open as fast as
short ones. History cursors are byte offsets into the transcript.

Cursor CLI uses `cursor_bridge.py`, installed into the user's Cursor hooks. Its
SQLite binding records the Herdr terminal generation, Cursor process ID and start
time, and conversation ID. The reader checks live process ancestry before exposing
that session. Cursor transcripts supply visible messages; hooks supply turn status
and tool activity. A delayed session-start hook cannot reset an active turn.
Cursor sends require an idle or completed session and a new matching prompt
generation for delivery confirmation. Hook commands always return an empty object.
Reader code travels through stdin to avoid Windows command-line length limits.

Complete Mermaid fences render through the bundled classic script, loaded only
when a diagram approaches the viewport. Rendering is serial; unchanged messages
retain their diagrams across refreshes. Each diagram keeps expandable source, and
copying a message preserves its original text. Invalid or oversized diagrams show
the source. Other complete fences display as literal code with preserved spacing;
double-asterisk emphasis becomes bold outside fences. HTTP(S) URLs and Markdown
links render as DOM anchors. Native code validates the URL again and opens the
system's web-link handler; remote pages never enter the app's WebView. Inline code
and complete or incomplete code fences remain literal. Local media links match the
attachment's normalized path: images open the viewer, audio/video links scroll to
their controls, and other local paths copy to the clipboard. Message copying keeps
the original Markdown. Other Markdown stays plain text.

`bridge/media.mjs` finds local media references in visible messages and issues
opaque IDs bound to the matched session, terminal generation, and working folder.
`media_reader.py` runs through `hc exec` on that session's machine. It resolves the
path (relative paths from the working folder, `~/` from the home folder), checks the
file signature, and transfers up to 128 MiB. Any local path that appears in a visible
message is allowed, including temporary folders such as Claude's scratchpad on
Windows and macOS. Network shares, SVG, HTML, and external URLs are excluded. The bridge
accepts two concurrent transfers, keeps at most eight cached files / 256 MiB, and
expires cached files after a minute. The first request transfers the complete file
to the bridge; subsequent HTTP byte ranges support playback seeking. No transcoding
is performed, so codec support depends on the phone.

`MediaProxy.java` uses [WebView request interception](<https://developer.android.com/reference/android/webkit/WebViewClient#shouldInterceptRequest(android.webkit.WebView,%20android.webkit.WebResourceRequest)>)
to serve the reserved `https://pocket-media.invalid/<id>` URLs. Native code adds the
bridge authorization header and streams response bytes without exposing the token
to JavaScript. Images load near the viewport; audio/video use explicit playback.
Unchanged messages retain their players during polling. Leaving a conversation or
backgrounding the app pauses playback. Video fullscreen uses WebChromeClient;
images have a separate viewer with an actual-size mode.

`ConnectionStore.java` owns the encrypted bridge connection independently of the
WebView. `PushManager` initializes Firebase from private preferences, registers
the installation, and posts native notifications. `PocketMessagingService` receives
FCM data; `PushRegistrationJob` retries device registration. Notification taps resolve
an opaque session key through the bridge before opening a chat.

`bridge/push.mjs` monitors snapshots, persists event state, and sends minimal FCM
payloads. Registration and routing endpoints use the existing bridge authentication.
State files are flushed to disk before they replace the old copy. If a crash still
leaves the push state or receipts unreadable, the bridge moves the file aside as
`*.corrupt-<time>` and starts with empty state; phones then need to turn
notifications off and on again to register.
See [notification setup and delivery rules](notifications.md).

Codex sessions require a unique current title and project match. The known
`[ ! ] Action Required |` title prefix is removed before matching. A terminal's
launch folder alone never selects a transcript. Claude Code uses process ancestry.
Persistent `quad.session` labels also require a matching current Codex title and
project. A reused terminal with only a folder title cannot inherit its old chat.
Unresolved identities block sending; a temporary lookup failure preserves the last
conversation with a stale notice.

Only user text and visible assistant messages become chat bubbles. Tool calls
produce short activity labels, not raw commands or output. Reasoning, system
instructions, and subagent messages are excluded. Session file formats are internal
to the agent tools and may require compatibility updates.

Sending creates an outbox item and clears the input immediately. Receipt polling
waits until the POST finishes. A missing receipt or network timeout means delivery
is unknown; it must not restore the draft or retry the POST. Explicit rejection
before delivery can restore the draft. A late receipt or transcript echo reconciles
the original item. The bridge saves receipt IDs before invoking `hc send` and
deduplicates retries. `sent` means terminal delivery, not agent completion.
An explicit Herdr `started: false` result remains `unknown`, including older saved
receipts with that result. It does not prove whether the pasted text was consumed,
so the bridge never resends it automatically.

Blocked Codex and Claude Code sessions can expose a numbered single-choice dialog.
`bridge/interaction.mjs` reads only the current screen, separates the dialog from
earlier output, and requires a visible cursor and confirmation footer. It does not
turn arbitrary terminal output into chat. Authentication, free-text and multi-select
dialogs are not actionable through this parser.

The client submits a prompt fingerprint and an option ID. The server rechecks the
session, terminal generation, blocked state, prompt content and cursor before
translating the selection to `hc keys` navigation and Enter. Receipt IDs deduplicate
retries; a prompt fingerprint also blocks a second submission with another ID.
There is no generic key endpoint or forced text submission. Herdr does not provide
an atomic prompt-and-key comparison, so avoid operating the same dialog on desktop
while submitting from the phone.
