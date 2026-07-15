# Issue #780 native desktop notifications validation

Status: in progress. Automated gates pass. macOS event derivation reached the native service, but banner/click and permission-policy smokes remain blocked by the shared Electron development bundle.

## Focused tests

| Command                                                                                                                                                                                                                                                                                                                            | Result                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `vp test run apps/web/src/desktopNotifications.logic.test.ts apps/web/src/components/settings/SettingsPanels.logic.test.ts packages/contracts/src/settings.test.ts packages/client-runtime/src/state/shell-sync.test.ts apps/desktop/src/window/DesktopWindow.test.ts apps/desktop/src/notifications/DesktopNotifications.test.ts` | Pass: 6 files, 44 tests                                     |
| `vp test apps/web/src/desktopNotifications.logic.test.ts apps/web/src/desktopNotifications.subscription.test.ts apps/desktop/src/notifications apps/desktop/src/window/DesktopWindow.test.ts apps/desktop/src/ipc/methods/desktopNotifications.test.ts packages/contracts/src/settings.test.ts`                                    | Pass: 5 files, 37 tests after direct atom-subscription fix  |
| `vp run --filter @t3tools/contracts --filter @t3tools/client-runtime --filter @t3tools/web --filter @t3tools/desktop typecheck`                                                                                                                                                                                                    | Pass; only existing Effect suggestions outside feature code |

Covered bootstrap baseline, settled completion/failure, approval/input rising edges, stable-state dedupe, reconnect/reseed baseline, archived/removed/partial suppression, opt-in default/restore, focus suppression, unsupported/failed native delivery, generic silent copy, close retention, and exact one-shot click target.

## Repository gates

| Command            | Result                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp test`          | Pass: 586 files and 4,620 tests; 2 files and 7 tests skipped by suite                                                                       |
| `vp check`         | Pass: 2,117 files formatted; 0 errors; 9 existing React warnings in `ChatMarkdown.tsx` and `CommandPalette.tsx`                             |
| `vp run typecheck` | Pass: 15 tasks; 0 errors; existing Effect suggestions in `relay/discovery.ts`, `DesktopBackendPool.test.ts`, and `DesktopWslEnvironment.ts` |
| `git diff --check` | Pass                                                                                                                                        |

## macOS smoke matrix

Isolated desktop command:

`T3CODE_DEV_INSTANCE=notifications-smoke T3CODE_HOME=/tmp/t3code-notifications-smoke T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=1 node scripts/dev-runner.ts dev:desktop`

Project `d27b9d7f-976a-4f3b-96b4-090d9567764a`; thread `401f0d2c-6d70-4791-a3a4-3661f044ac0b`.

| Scenario                                         | Status  | Evidence                                                                                                                                                                                                      |
| ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completed turn while unfocused/minimized/closed  | Partial | Minimized window; direct atom subscription observed the settled `running -> ready/no turn -> completed` sequence and invoked `desktop.notifications.show` once. Native banner not observable in this harness. |
| Approval required while unfocused                | Partial | Supervised `rm -f` of the smoke-only `/tmp` file produced `PENDING APPROVAL`; `approval-required` derived once and reached the native service.                                                                |
| User input required while unfocused              | Partial | Plan-mode Red/Blue question produced `user-input-required` once and reached the native service before resolution.                                                                                             |
| Failed turn while unfocused                      | Partial | Temporary custom model `invalid-notification-smoke-model` returned provider HTTP 400; settled failed turn reached the native service. Model was removed and GPT-5.4 restored.                                 |
| Focused-window suppression                       | Pending | Automated service test passes; live status could not be distinguished from macOS bundle-level suppression.                                                                                                    |
| Notification click restores/focuses exact thread | Pending | Exact one-shot target is covered by desktop and renderer tests; no clickable macOS banner was exposed.                                                                                                        |
| Disabled-setting suppression                     | Pending | Schema, restore-default, subscription gating, and desktop recheck tests pass; live toggle cycle not completed.                                                                                                |
| Denied-permission non-fatal handling             | Pending | Unsupported, synchronous failure, and asynchronous native failure tests pass; live macOS denial cycle not completed.                                                                                          |

Native service evidence is in `/tmp/t3code-notifications-smoke/dev/logs/desktop.trace.ndjson` under successful `desktop.notifications.show` spans. macOS reports Electron notifications enabled with temporary alerts, Notification Center, lock screen, badge, and sound settings; feature delivery sets `silent: true`.

The host and smoke app both use `com.github.Electron`. The host remains the foreground Electron application during collaborative automation, so macOS applies bundle-level foreground suppression even after the smoke window is minimized. Temporarily allowing notifications during screen sharing did not expose a banner. The accessibility service then lost the System Settings window, preventing the remaining toggle and permission cycles. Do not mark these rows passed until they run from a packaged app with an independent bundle or with manual focus outside Electron.

Configuration screenshot: `assets/issue-780-settings-enabled.png`.

## Known limits

- No notification is possible after the desktop process fully exits.
- Native macOS delivery can reject unsigned development builds or suppress a development bundle already foregrounded by another Electron process. Finish the banner/click/permission matrix from a packaged build with an independent bundle.
- Sounds, pets, overlays, tray/menu-bar UI, remote push, daemon behavior, and mobile changes are absent.
