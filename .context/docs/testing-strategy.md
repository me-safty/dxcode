---
type: doc
name: testing-strategy
description: Automated and manual validation for issue #780
category: testing
generated: "2026-07-15"
status: filled
scaffoldVersion: "2.0.0"
---

# Testing strategy

## Automated

- Pure transition tests cover bootstrap, settled completion/failure, rising approval/input, stable-state deduplication, reconnect/replay/reseed, archived/removed threads, and restarted/partial observations.
- Desktop service tests cover disabled settings, focused windows, unsupported/denied delivery, deduplication, generic payloads, click restore/focus, and pending deep-link consumption.
- Settings tests cover legacy decode defaulting to disabled and restore defaults.
- Focused tests run while changing each layer.
- Required repository gates are `vp test`, `vp check`, and `vp run typecheck`.

## macOS smoke

Use the real desktop build to verify completion, approval/input, failure, focused suppression, click navigation, disabled configuration, and denied permission. Capture configuration and notification evidence. A fully terminated process is explicitly unsupported.
