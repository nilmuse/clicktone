# Changelog

## 3.1.1

- Fix packed-consumer checks for npm 12's package-name-keyed JSON output while retaining npm 10/11 support.
- Run Node 24 verification with the same `npm@latest` toolchain used for publishing.
- Publish the capabilities listed under 3.1.0 below. The 3.1.0 GitHub Release did not reach npm because its consumer check failed before publication.

## 3.1.0

- Cancel pending playback on stop, destroy, replay replacement, and context recovery. Settle stopped one-shot promises independently of native `ended` events.
- Resolve URL, DOM, descriptor, and options inputs consistently; suppress events after destruction and release instance lifecycle subscriptions.
- Add shared cache controls: `setCacheLimit()`, `clearCache()`, `cacheStats`, and instance `unload()`. Automatic eviction is opt-in.
- Add per-instance `maxVoices` and `voiceCount`. At the limit, a ready source displaces the oldest started voice.
- Add opt-in source `fallback` for loading and decoding failures, including per-play overrides and loop recovery.
- Add browser integration tests and packed-consumer checks, including the minimum supported Node version. Test tooling is excluded from the npm package.

Existing browser audio unlocking and mobile recovery heuristics remain in place. See the README for cancellation, events, and option defaults.
