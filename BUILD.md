# BUILD.md — Personal Desktop Build with GitHub Auto-Updates

This guide walks through building T3 Code as a personal desktop app (`.dmg` on macOS) wired to **your own GitHub repository** for auto-updates. The app will check your repo's Releases on startup and let you download/install updates from inside the app.

> **Replace `OWNER/REPO` everywhere below with your GitHub `username/repo-name`** (e.g. `bnpne/ottawa` or wherever your fork lives).

---

## How auto-update works here

- `electron-updater` is wired into the desktop app (`apps/desktop/src/updates/DesktopUpdates.ts`).
- At **build time**, the `T3CODE_DESKTOP_UPDATE_REPOSITORY` env var is baked into the artifact's `app-update.yml` via `scripts/build-desktop-artifact.ts:514` → `resolveGitHubPublishConfig`.
- At **runtime**, the app checks `https://github.com/OWNER/REPO/releases/latest` for a `latest-mac.yml` (or `latest.yml` / `latest-linux.yml`).
- Update UX is manual: a rocket icon appears in the UI; click once to download, click again to restart & install. No silent auto-install.
- Required Release assets:
  - the installer (`.dmg`, `.exe`, or `.AppImage`)
  - macOS also needs the `.zip` (Squirrel.Mac uses it for the update payload)
  - `latest-mac.yml` / `latest.yml` / `latest-linux.yml` (channel metadata)
  - `*.blockmap` (differential downloads)

---

## Prerequisites

1. Bun `^1.3.11`, Node `^24.13.1` (`bun --version`, `node --version`).
2. A GitHub repo you own (fork or otherwise) to host releases — call it `OWNER/REPO`.
3. `gh` CLI installed and authenticated (`gh auth status`). Used to create the GitHub Release and upload assets.
4. (macOS only, optional but recommended) Apple Developer ID certificate if you want updates to install without a Gatekeeper prompt. See "macOS signing caveat" below.

---

## 1. One-time setup

### Make sure your repo has a `main` remote

```bash
# from inside the repo root
git remote -v
# expect: origin  git@github.com:OWNER/REPO.git ...
```

If you forked from `pingdotgg/t3code`, add your fork as a remote and push:

```bash
git remote add personal git@github.com:OWNER/REPO.git
git push personal HEAD:main
```

### Install dependencies

```bash
bun install
```

---

## 2. Build the `.dmg` (Apple Silicon)

The build command bakes your repo into the artifact's auto-update config.

```bash
export T3CODE_DESKTOP_UPDATE_REPOSITORY="OWNER/REPO"

# Apple Silicon
bun dist:desktop:dmg:arm64

# OR Intel Mac
bun dist:desktop:dmg:x64

# OR both archs in one DMG (universal)
bun dist:desktop:dmg
```

Other targets if you ever need them:

```bash
bun dist:desktop:linux        # Linux x64 AppImage
bun dist:desktop:win          # Windows NSIS installer
```

Artifacts land in `./release/`. For an arm64 build at version `0.0.24` you should see:

```
release/
├── T3-Code-0.0.24-arm64.dmg
├── T3-Code-0.0.24-arm64.dmg.blockmap
├── T3-Code-0.0.24-arm64-mac.zip
├── T3-Code-0.0.24-arm64-mac.zip.blockmap
└── latest-mac.yml
```

All of those need to go into the GitHub Release.

> The version comes from `apps/server/package.json` `version` field. Bump it there (e.g. `0.0.25`) before each new build so the updater sees a newer version.

---

## 3. Create the GitHub Release

The version tag must match the version inside the build. With `version = 0.0.24`:

```bash
export VERSION="0.0.24"

git tag "v${VERSION}"
git push origin "v${VERSION}"

gh release create "v${VERSION}" \
  --repo OWNER/REPO \
  --title "v${VERSION}" \
  --notes "Personal build" \
  ./release/T3-Code-${VERSION}-arm64.dmg \
  ./release/T3-Code-${VERSION}-arm64.dmg.blockmap \
  ./release/T3-Code-${VERSION}-arm64-mac.zip \
  ./release/T3-Code-${VERSION}-arm64-mac.zip.blockmap \
  ./release/latest-mac.yml
```

> **Important:** the release tag must be in the `vX.Y.Z` format and must **not** be marked as a prerelease, otherwise the `latest` channel won't pick it up. (Tags with suffixes like `-nightly.*` go to the `nightly` channel — keep things on plain `vX.Y.Z` unless you want that.)

---

## 4. Install the app

Open the `.dmg` from `./release/` and drag T3 Code into Applications.

First launch on macOS will be blocked by Gatekeeper because the build is unsigned. Either:

```bash
# Remove the quarantine flag
xattr -dr com.apple.quarantine "/Applications/T3 Code.app"
```

…or right-click the app → **Open** → confirm the warning once.

---

## 5. Shipping an update

When you want to push an update:

1. Bump version in `apps/server/package.json` (e.g. `0.0.24` → `0.0.25`).
2. Commit and push.
3. Rebuild:
   ```bash
   export T3CODE_DESKTOP_UPDATE_REPOSITORY="OWNER/REPO"
   bun dist:desktop:dmg:arm64
   ```
4. Tag and create the Release:
   ```bash
   export VERSION="0.0.25"
   git tag "v${VERSION}"
   git push origin "v${VERSION}"
   gh release create "v${VERSION}" --repo OWNER/REPO --title "v${VERSION}" --notes "" \
     ./release/T3-Code-${VERSION}-arm64.dmg \
     ./release/T3-Code-${VERSION}-arm64.dmg.blockmap \
     ./release/T3-Code-${VERSION}-arm64-mac.zip \
     ./release/T3-Code-${VERSION}-arm64-mac.zip.blockmap \
     ./release/latest-mac.yml
   ```
5. Open the installed T3 Code app. Within the startup check interval it will detect the update and show the rocket icon in the UI. Click it to download, click again to restart & install.

---

## Private-repo auth

If `OWNER/REPO` is private, the desktop app needs a token to read your releases. Set this in the runtime environment **of the installed app** (not the build):

```bash
# in your shell rc / launchd plist / however you launch the app
export T3CODE_DESKTOP_UPDATE_GITHUB_TOKEN="ghp_xxx"   # or GH_TOKEN=...
```

The app forwards it as `Authorization: Bearer <token>` on updater HTTP calls (see `docs/release.md:111-113`).

---

## macOS signing caveat (read this if updates fail to install)

Unsigned macOS apps can be **installed manually**, but `electron-updater`'s install step uses Squirrel.Mac, which **requires a code-signed app** to apply updates. With no signing:

- The update will download.
- Clicking "install" will fail silently or kick you back to a manual reinstall.

Options:

1. **Just reinstall manually each time** — simplest. Skip auto-install entirely; download the new `.dmg` from your Releases page.
2. **Self-sign with an ad-hoc identity** — not enough; Squirrel.Mac still rejects ad-hoc.
3. **Use a real Developer ID** — needed for true in-app auto-install. If you have an Apple Developer account, set these env vars before building and pass `--signed`:
   ```bash
   export CSC_LINK="$(base64 < /path/to/cert.p12)"
   export CSC_KEY_PASSWORD="..."
   export APPLE_API_KEY="$(cat AuthKey_XXX.p8)"
   export APPLE_API_KEY_ID="XXX"
   export APPLE_API_ISSUER="UUID"
   node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --signed
   ```

For a personal-use build, option (1) is the realistic path: auto-update can still **notify** you and **download** the new version even unsigned — you just finish the install by mounting the DMG yourself.

---

## Quick reference: env vars

| Variable | Where | Purpose |
| --- | --- | --- |
| `T3CODE_DESKTOP_UPDATE_REPOSITORY` | build-time | Baked into `app-update.yml`. Format: `owner/repo`. |
| `T3CODE_DESKTOP_UPDATE_GITHUB_TOKEN` | runtime | Token for private repo updater HTTP. |
| `GH_TOKEN` | runtime | Fallback if `T3CODE_DESKTOP_UPDATE_GITHUB_TOKEN` is not set. |
| `T3CODE_DESKTOP_VERSION` | build-time | Override version baked into artifact. |
| `T3CODE_DESKTOP_OUTPUT_DIR` | build-time | Override output dir (defaults to `release/`). |
| `T3CODE_DESKTOP_VERBOSE` | build-time | Stream subprocess stdout for debugging. |

---

## Build commands cheat sheet

```bash
# Local install only — no installer
bun build:desktop
bun start:desktop

# Build a .dmg for personal use (Apple Silicon)
T3CODE_DESKTOP_UPDATE_REPOSITORY=OWNER/REPO bun dist:desktop:dmg:arm64

# Cut a release
gh release create vX.Y.Z --repo OWNER/REPO ./release/*

# Dev mode (Electron + hot reload, not packaged)
bun dev:desktop
```
