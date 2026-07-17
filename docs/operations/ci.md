# CI quality gates

- `.github/workflows/ci.yml` runs `vp check` (lint + typecheck), `vpr typecheck`, and `vp run test` on pull requests and pushes to `main`.
- `.github/workflows/release.yml` builds macOS (`arm64` and `x64`), Linux (`x64`), and Windows (`x64`) desktop artifacts from a single `v*.*.*` tag and publishes one GitHub release. It also builds an Android APK and attaches it to the same release.
- `.github/workflows/android.yml` builds a standalone Android APK (manual dispatch or `android-*` tags) and publishes/updates a GitHub Release with the APK on every successful build:
  - Manual builds update the rolling `android-latest` prerelease (same asset names overwrite).
  - Tag builds publish a prerelease for that `android-*` tag.
- The release workflow auto-enables signing only when platform credentials are present. macOS passkey builds additionally require `APPLE_TEAM_ID` and the `MACOS_PROVISIONING_PROFILE` secret; Windows uses Azure Trusted Signing. Without the core signing credentials, it still releases unsigned artifacts.
- See [Release Checklist](./release.md) for the full release/signing setup checklist.
