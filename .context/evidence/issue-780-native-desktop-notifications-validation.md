# Issue #780 native desktop notifications validation

Status: in progress. Automated gates passed; real macOS smoke pending.

## Focused tests

| Command                                                                                                                                                                                                                                                                                                                            | Result                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `vp test run apps/web/src/desktopNotifications.logic.test.ts apps/web/src/components/settings/SettingsPanels.logic.test.ts packages/contracts/src/settings.test.ts packages/client-runtime/src/state/shell-sync.test.ts apps/desktop/src/window/DesktopWindow.test.ts apps/desktop/src/notifications/DesktopNotifications.test.ts` | Pass: 6 files, 44 tests                                     |
| `vp run --filter @t3tools/contracts --filter @t3tools/client-runtime --filter @t3tools/web --filter @t3tools/desktop typecheck`                                                                                                                                                                                                    | Pass; only existing Effect suggestions outside feature code |

Covered bootstrap baseline, settled completion/failure, approval/input rising edges, stable-state dedupe, reconnect/reseed baseline, archived/removed/partial suppression, opt-in default/restore, focus suppression, unsupported/failed native delivery, generic silent copy, close retention, and exact one-shot click target.

## Repository gates

| Command            | Result                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp test`          | Pass: 585 files and 4,619 tests; 2 files and 7 tests skipped by suite                                                                       |
| `vp check`         | Pass: 2,113 files formatted; 0 errors; 9 existing React warnings in `ChatMarkdown.tsx` and `CommandPalette.tsx`                             |
| `vp run typecheck` | Pass: 15 tasks; 0 errors; existing Effect suggestions in `relay/discovery.ts`, `DesktopBackendPool.test.ts`, and `DesktopWslEnvironment.ts` |
| `git diff --check` | Pass                                                                                                                                        |

## macOS smoke matrix

Pending. Do not treat this section as passed until each row has direct evidence.

| Scenario                                         | Status  | Evidence |
| ------------------------------------------------ | ------- | -------- |
| Completed turn while unfocused/minimized/closed  | Pending |          |
| Approval required while unfocused                | Pending |          |
| User input required while unfocused              | Pending |          |
| Failed turn while unfocused                      | Pending |          |
| Focused-window suppression                       | Pending |          |
| Notification click restores/focuses exact thread | Pending |          |
| Disabled-setting suppression                     | Pending |          |
| Denied-permission non-fatal handling             | Pending |          |

## Known limits

- No notification is possible after the desktop process fully exits.
- Native macOS delivery can reject unsigned development builds; smoke must use a deliverable accepted by Notification Center or record the limitation without overstating completion.
- Sounds, pets, overlays, tray/menu-bar UI, remote push, daemon behavior, and mobile changes are absent.
