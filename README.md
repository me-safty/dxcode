# T3 Code (Ian Henriques' fork)

T3 Code is a minimal web/desktop GUI for coding agents — it gives you a single
interface in front of CLI agents like Codex, Claude, Cursor, and OpenCode, with
threaded conversations, a sidebar of projects, git/worktree integration, and a
GitHub PR workflow.

This is my fork. It tracks upstream but adds the features below.

## What's different in this fork

I've been working on my own fork and it's diverged enough that it's
worth switching over. The main additions:

- **Per-conversation cost tracking.** Each thread shows its running cost next to
  the title (hidden until it crosses a cent, so new threads stay clean). Claude
  reports its actual cost through the SDK; Codex only gives token counts, so I
  estimate from a pricing table and prefix it with `est.`. If it doesn't recognize
  the model, it shows nothing rather than a wrong number.

- **Conversation forking.** Fork any chat from its sidebar row or the button next
  to the send box. The fork opens a fresh draft that carries over the model,
  reasoning effort, runtime/interaction mode, and worktree; nothing's persisted
  until you send, and forks are labelled `(fork, est. $X.XX)` in the cost readout.
  It also won't let you delete a thread that an unsent fork still depends on.

- **VS Code theme import.** It reads your installed VS Code themes — both
  built-in and extensions — and applies them to code blocks and diffs. New
  themes show up without a restart.

- **A real PR workflow.** The sidebar splits into Development and Pull Requests
  tabs so reviews stay out of the way of your dev threads. There's a PR picker for
  starting a review, PR-review threads show a live status badge (open / draft /
  merged / closed) pulled from GitHub, and they auto-archive once the PR is merged
  or closed. The review's PR identity is stored server-side, so renaming a thread
  never loses track of which PR it belongs to.

- **Full-text message search.** The command palette searches inside message
  content now, not just thread titles — backed by a SQLite full-text index, so
  it's fast and spans every connected environment. Existing conversations are
  backfilled, so your old chats are searchable too. Matches appear under a "Found
  in messages" group with the hit term highlighted in a snippet, and clicking one
  jumps straight to that message — it scrolls the message into view and briefly
  highlights it.

- **Bookmarking.** Option/Alt+click any thread in the sidebar to bookmark it
  (persisted server-side); Option/Alt+click again to clear it.

- **Page zoom that behaves.** Cmd +/− zooms the whole UI, and I fixed the chrome
  that usually breaks under zoom — native right-click menus open in the right
  place, and the macOS traffic-light spacing stays aligned at any zoom level.

- **One-command setup.** `./setup.sh` gets you running on macOS in a single step.
  It's safe to re-run, and there's a flag to skip Homebrew if you manage your own
  deps (Nix, etc.).

Everything's covered by tests. One caveat worth mentioning: the cost figures are
estimates, not billing — though that matters less on a ChatGPT subscription,
where there's no per-token charge anyway.

## Getting started with my fork

Install and authenticate at least one provider before use:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `cursor-agent login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

Then, from a clone of this fork on macOS, use my custom install script:

```bash
./setup.sh
```

This installs the toolchain (including the `vp` / Vite+ CLI the dev runner needs)
and workspace dependencies. It's idempotent, and if you manage system deps
yourself (Nix, etc.) run `T3_SETUP_NO_BREW=1 ./setup.sh` to verify rather than
install them.

Then start the desktop dev server with:

```bash
vp run dev:desktop
```
