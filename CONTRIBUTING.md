# Contributing

Use Node.js 22+, Python 3.14, JDK 17+, and Android SDK 35. Run `npm ci` before
editing. The bridge has no runtime npm dependencies.

```sh
npm run format
npm test
python -m unittest discover -s tests -p 'test_*.py'
npm run test:ui
npm run check:public
```

The UI check needs Chrome; set `CHROME_BIN` if it is installed outside the default
location. Check Android with `gradlew.bat testDebugUnitTest assembleDebug lintDebug`
on Windows or `sh gradlew testDebugUnitTest assembleDebug lintDebug` elsewhere.

`npm run screenshots` runs the UI checks and captures the README images in English
and Korean. It uses fictional data in an isolated browser and never connects to a
live bridge. Keep documentation screenshots free of real sessions or credentials.
The media fixtures are original generated files in `docs/examples`. To recreate
them, install FFmpeg and run `npm run examples:media` before capturing screenshots.

Keep Korean and English entries together in `app/src/main/assets/i18n.js`. Return
stable error codes from the bridge and native transport; translate them at the UI.
Never translate chat content, session names, IDs, or API fields.

Use fake sessions for send tests. Reading real sessions is useful for compatibility
checks, but do not send test instructions to agents doing real work. Keep credentials,
conversation dumps, screenshots, and local device addresses out of commits.

Describe what changed, why, and which checks passed. Session format changes need a
small fixture that reproduces the issue without private conversation content.
