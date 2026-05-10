React performance scan artifacts for the project grouping selector fix.

- `before-react-scan-project-grouping.webm`: before the fix, captured with React Scan injected before React mounts.
- `after-react-scan-project-grouping.webm`: after the fix, captured with the same authenticated navigation flow.

Capture flow:

1. Start the web dev server with React Scan injected through Playwright `addInitScript`.
2. Pair against a clean local server home.
3. Open `/`, navigate to `/settings/general`, then return to `/`.

The fix stabilizes the project grouping settings selector shared by Sidebar, ChatView, root event routing, and new-thread creation so unrelated parent renders reuse the same grouping object instead of invalidating downstream memoized project derivations.
