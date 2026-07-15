# Mobile app-store screenshot harness

The mobile showcase is a deterministic, offline set of app-store scenes. It uses the real thread,
composer, terminal, diff, project-list, typography, theme, and responsive layout components, but it
does not require a running T3 server or a real coding session. The route is only compiled into the
Metro bundle when `EXPO_PUBLIC_SHOWCASE=1`; normal development and release bundles do not expose it.

## Capture the default matrix

From the repository root:

```bash
pnpm screenshots:mobile
```

The command starts a showcase-enabled Metro server, builds the debug apps once per selected
platform, boots each configured simulator/emulator, normalizes dark mode and status bars, opens each
scene, and writes PNGs to `artifacts/app-store/screenshots/`. Devices started by the runner and Metro
are stopped afterward.

Captures wait for an explicit rendered-scene marker rather than a fixed bundle-loading delay. On
Android the runner retries the scene deep link until React Navigation is ready; on iOS the showcase
route records readiness in the simulator app container. This prevents launcher and bundling screens
from being captured on cold starts.

A full capture regenerates the selected native project with Expo's clean development prebuild before
building it. This keeps CocoaPods, Swift packages, Gradle settings, and the installed JavaScript
dependencies in sync. Use `--skip-build` for repeated captures after that first build.

The harness uses its own Metro port (`8199` by default), so an ordinary mobile server or another
worktree on port 8081 cannot accidentally provide the bundle being photographed.

On iOS the runner passes Metro and scene selection as simulator launch arguments. This avoids the
custom-URL confirmation sheet introduced by newer simulator runtimes and needs no UI automation or
Accessibility permission. It discovers the Mac's LAN IPv4 address, prewarms the platform bundle,
and disables development-menu overlays before each capture.

The default matrix is:

- `iphone-6.9`: iPhone 17 Pro Max
- `ipad-13`: iPad Pro 13-inch (M5)
- `pixel`: Pixel 10 Pro Android AVD

Edit [`scripts/mobile-showcase.config.ts`](../../scripts/mobile-showcase.config.ts) to change simulator or
AVD names, light/dark appearance, scenes, output directory, capture delay, Android ABI, or viewport.
The names are exact on purpose: the harness fails clearly instead of silently capturing a different
screen class after an SDK update.

## Fast iteration

Capture one scene or device:

```bash
pnpm screenshots:mobile --device iphone-6.9 --scene thread
pnpm screenshots:mobile --platform android --scene review
```

Reuse already built/booted apps and leave everything open for visual iteration:

```bash
pnpm screenshots:mobile --device ipad-13 --skip-build --keep-running
```

Run Metro separately when editing the fixture or scene design:

```bash
pnpm --filter @t3tools/mobile showcase
pnpm screenshots:mobile --skip-build --skip-metro --device iphone-6.9
```

List the configured matrix and all flags:

```bash
pnpm screenshots:mobile --list
```

## Customize the showcase content

- Fixture project, threads, conversation, terminal output, and patch:
  [`showcaseData.ts`](../../apps/mobile/src/features/showcase/showcaseData.ts)
- Responsive scene composition:
  [`ShowcaseRouteScreen.tsx`](../../apps/mobile/src/features/showcase/ShowcaseRouteScreen.tsx)
- Device/capture matrix: [`mobile-showcase.config.ts`](../../scripts/mobile-showcase.config.ts)

The fixture clock is fixed, so timestamps and relative-time labels remain identical across devices
and capture runs. The same data constants feed iPhone, iPad, and Android. Tablet captures
intentionally add the project and thread sidebar around the same thread, terminal, or review content
used on phones.

## Local prerequisites

- iOS: Xcode command-line tools, the configured iOS simulator runtimes, and installed CocoaPods.
- Android: `ANDROID_HOME` (or the default macOS SDK path), `adb`, `emulator`, and the configured AVD.

For store submission, keep the generated PNGs unscaled. Pick simulator device classes and Android
viewport dimensions in the config that match the exact upload slots you intend to fill.
