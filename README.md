# MarCode

MarCode is a web GUI for coding agents. On top of a solid foundation, MarCode brings performance optimizations, new integrations, and a refined experience:

- **Claude Code CLI** as the default and primary provider
- **Jira Cloud integration** (OAuth 2.0, sprint browsing, `@PROJ-123` mentions in composer)
- **GitLab support** alongside GitHub (auto-detected from remote origin)
- **Preview diff display** for proposed file changes
- **Incremental state updates** for smooth, non-blocking UI during agent work
- **Additional directories in composer** — add extra directories to agent context per thread
- And much more

## Installation

> [!WARNING]
> MarCode currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Prerequisites

You need at least one of the following coding agent CLIs installed and authorized:

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Codex CLI](https://github.com/openai/codex)

For git host integration:

- **PRs (GitHub):** [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated
- **MRs (GitLab):** [GitLab CLI (`glab`)](https://gitlab.com/gitlab-org/cli) installed and authenticated (Personal Access Token works for self-hosted instances)

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/tyulyukov/marcode/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install tyulyukov.MarCode
```

#### macOS (Homebrew)

```bash
brew install --cask marcode
```

#### Arch Linux (AUR)

```bash
yay -S marcode-bin
```

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
