<p align="center">
  <img src="https://raw.githubusercontent.com/JoseRFelix/salchi/main/assets/salchi/salchi-icon-1024.png" alt="Salchi app icon" width="128" height="128" />
</p>

# Salchi

Salchi is a minimal web GUI for coding agents (currently OpenAI/Codex, Claude, Cursor, and OpenCode, more coming soon).

## Why Salchi Over t3code?

Salchi is built on top of the excellent t3code project, and I am grateful for
the work that made this editor possible.

Compared with using t3code directly, Salchi focuses on two things:

- A mobile-optimized PWA for checking in on coding-agent sessions away from your
  main machine.
- A web editor you can run from your own VPS or Mac, then access from desktop or
  mobile while keeping the agent runtime on the machine with your projects.

That makes Salchi useful when you want:

- Private remote access through `npx salchi`, the desktop app, or Tailscale Serve
  without exposing your editor to the public internet.
- One web surface for many providers, including Claude, OpenAI/Codex, Cursor,
  and OpenCode.
- PWA push notifications for agent activity. On mobile, install Salchi to the
  Home Screen first so notifications can work.
- Bring-your-own-subscription provider access instead of a resold-token model.
- Salchi-first mobile, PWA, provider, and remote-access polish on top of the
  t3code editor base.

I plan to keep the editor mostly up to date with t3code upstream while keeping
Salchi focused on the workflows and polish that matter here.

## Installation

> [!WARNING]
> Salchi currently supports OpenAI/Codex, Claude, Cursor, and OpenCode.
> Install and authenticate at least one provider before use:
>
> - OpenAI/Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install and authenticate the Cursor agent CLI
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Run without installing

```bash
npx salchi
```

### Run over Tailscale on macOS

To expose a headless Salchi server to devices on your Tailnet and keep macOS awake while it is running:

```bash
tailscale status

caffeinate -ims npx salchi serve --tailscale-serve --port 4888 /path/to/project
```

Salchi prints a pairing URL like:

```text
https://your-mac.your-tailnet.ts.net/pair#token=...
```

Open that URL from another device signed into the same Tailnet.

Use a non-default Tailscale HTTPS port with:

```bash
caffeinate -ims npx salchi serve \
  --tailscale-serve \
  --tailscale-serve-port 8443 \
  --port 4888 \
  /path/to/project
```

Stop the Tailscale Serve route afterward with:

```bash
tailscale serve --https=443 off
```

`caffeinate` keeps macOS awake while Salchi is running, but it will not reliably keep a Mac awake with the lid closed. Keep the lid open, or use clamshell mode with power connected and an external display, keyboard, and mouse.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/JoseRFelix/salchi/releases).

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
