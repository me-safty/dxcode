# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for T3 Code to work.

```bash
npx t3
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/pingdotgg/t3code/releases)

## Fork Releases

If you want desktop releases and auto-updates from a fork or branch such as `main-xavier`, use the `Release Desktop` GitHub Actions workflow with:

- `target_branch`: the branch you want to release from, for example `main-xavier`
- `publish_cli`: `false` for fork/private desktop-only releases
- `finalize_version_bump`: `false` unless you want the workflow to push the version bump commit back to that branch

The packaged desktop app will target the current GitHub repository for updater assets during CI builds, so fork releases will update from that fork's GitHub Releases.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
