# Third-party notices

Herdr Pocket source is licensed under MIT. Bundled Gradle wrapper files
(`gradlew`, `gradlew.bat`, and `gradle/wrapper/gradle-wrapper.jar`) are from Gradle
8.11.1 and retain their Apache License 2.0 terms. See
[licenses/Apache-2.0.txt](licenses/Apache-2.0.txt).

Mermaid 12.3.0 is bundled in `app/src/main/assets/vendor/mermaid.min.js` under MIT.
See [its license](licenses/Mermaid-MIT.txt) and
[dependency notices](licenses/Mermaid-dependencies.txt). The bundle also retains
its upstream license comments. Run `npm ci` and `npm run vendor:mermaid` to refresh
the pinned bundle and notices.

Prettier is a development dependency under MIT. Its license is included in the
installed package. Android build tools and Gradle distributions are downloaded by
the build and are governed by their own licenses.

The Android build includes Firebase Cloud Messaging 26.0.1 and its dependencies.
Firebase's Android SDK is Apache-2.0; Google Play services components are governed
by their published SDK terms. Gradle resolves these artifacts from Google's Maven
repository. See [Firebase Android SDK](https://github.com/firebase/firebase-android-sdk)
and [Google Play services terms](https://developers.google.com/android/guides/overview).

Herdr, Tailscale, Codex, and Claude Code are separately installed tools. This project
does not bundle them and is not an official client of their vendors.
