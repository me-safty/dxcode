# Devin

T3 Code runs Devin through the Devin CLI's native ACP (Agent Client Protocol) server
(`devin acp`).

## Setup

Install the Devin CLI and log in once from a terminal:

```bash
devin auth login
```

That's it. T3 Code spawns `devin acp` per thread and reuses the credentials stored by
`devin auth login` (`~/.local/share/devin/credentials.toml`).

In T3 Code Settings, the default provider looks like this:

```text
Display name: Devin
Binary path: devin
```

Leave `Binary path` as `devin` unless the CLI is not on the PATH of the T3 Code server process. In
that case set it to the absolute path from `which devin` (typically `~/.local/bin/devin`).

## Models

Devin's model list is discovered live from the CLI, including `Adaptive` (the default), which
automatically balances quality and cost per task. Pick a specific model from the model picker if
you want to pin one; the selection can be changed mid-thread.

## Headless / API-key Setups

For machines where a browser login is not possible, create an API key in Devin Cloud and put it on
the Devin provider instance in T3 Code Settings under Environment variables:

```text
WINDSURF_API_KEY  <your key>   Sensitive
```

Mark the value as sensitive. `WINDSURF_API_KEY` takes precedence over credentials stored by
`devin auth login`.

Do **not** set `ACP_BACKEND` on the provider instance. When that variable is set, the CLI ignores
its stored credentials and expects the host application to supply them, which T3 Code does not do.

## Checking Auth State

The provider card in Settings shows the account state reported by `devin auth status`. If it shows
"not logged in", run `devin auth login` in a terminal and wait for the next provider refresh (or
restart the server).

## I Want Work And Personal Devin Accounts

The Devin CLI stores credentials globally per machine user, not per directory, so separate
instances of this provider share the same login. To use two accounts, create a second provider
instance and give it a `WINDSURF_API_KEY` environment variable for the second account. Instances
with an explicit API key ignore the shared credentials file.

## Known Limitations

- Devin's ACP modes (Code / Ask / Plan / Bypass) are not yet mapped to T3 Code's interaction mode
  toggle; sessions run in Devin's default mode and permission requests flow through T3 Code's
  normal approval prompts.
- Provider-side rollback of turns is not supported.
