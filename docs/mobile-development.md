# Mobile development

## Fast iteration (default during `bun run dev`)

1. Start the stack: `bun run dev` or `bun run dev:desktop`.
2. Enable **Mobile access** (Tailscale Serve) in Settings → Connections.
3. Scan the QR code on your phone.

The Tailscale URL is reverse-proxied to the live Vite dev server. After you change UI code, **pull to refresh** on the phone — no rebuild or reinstall.

Loopback browsers still redirect to Vite directly (`http://127.0.0.1:<web-port>`).

## Production-like testing

To test the installed PWA or a bundled client (service worker, precache, production assets):

```bash
cd apps/web && bun run build
cd ../server && bun run build
```

Restart the server without `VITE_DEV_SERVER_URL` / dev mode, then refresh or reinstall the app from the Tailscale URL.

You can also use `cd apps/web && bun run preview` for a local production preview.

## Troubleshooting stale UI

| Symptom                                              | Likely cause                                                   | Fix                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Phone shows old UI during dev                        | Server not in dev mode, or Vite not running                    | Run `bun run dev`; confirm Settings shows **Live dev**                             |
| Browser on `localhost:<web-port>` differs from phone | Expected — only Tailscale goes through the server proxy in dev | Compare the same Tailscale URL on both                                             |
| Production install stuck on old UI                   | Service worker cache                                           | Force-close app, reopen; or delete home-screen app and scan QR again after rebuild |
| “Update available” banner                            | New service worker waiting                                     | Tap **Reload** on the banner                                                       |

## Environment signal

`GET /.well-known/t3/environment` includes optional `webClient`:

- `vite-dev-proxy` — live Vite behind the server (dev)
- `static-bundle` — bundled `dist/client` (production)

Settings → Mobile access shows matching guidance.
