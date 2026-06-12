# Kimi Code

This guide is for people who want to use Kimi Code in T3 Code.

## What is Kimi Code?

Kimi Code is the command-line interface for Moonshot AI's Kimi coding assistant. T3 Code talks to
Kimi Code through its `kimi acp` stdio server, which exposes a small ACP (Agent Communication
Protocol) surface for sessions, models, and modes.

## I Only Use One Kimi Account

Use the default provider.

Log in with Kimi Code normally:

```bash
kimi login
```

In T3 Code Settings, your Kimi Code provider can stay like this:

```text
Display name: Kimi Code
Binary path: kimi
```

An empty or default `Binary path` means T3 Code looks for `kimi` on your PATH.

## I Want Work And Personal Kimi Accounts

Kimi Code stores login state under its own config directory, and T3 Code spawns a fresh `kimi acp`
process for each session. To use multiple accounts, add one Kimi Code provider per account and
configure the environment so each provider's process uses the intended credentials.

The simplest approach is to set account-specific environment variables on each provider instance.
Kimi Code usually respects the standard `KIMI_API_KEY` variable, or you can point each provider at a
separate Kimi config directory.

Example setup:

```text
Display name: Kimi Code Work
Binary path: kimi
Environment variables:
  KIMI_API_KEY  sk-work-...   Sensitive
```

```text
Display name: Kimi Code Personal
Binary path: kimi
Environment variables:
  KIMI_API_KEY  sk-personal-...   Sensitive
```

Mark API keys as sensitive. T3 Code stores the values as server secrets and does not send them back
to the app after saving.

## I Need A Different Binary Or Working Directory

Use the provider's settings in T3 Code:

- `Binary path` — path to the `kimi` executable, or `kimi` to use PATH.
- `Environment variables` — extra variables passed to every `kimi acp` process spawned by this
  provider.

## Picking Models

T3 Code asks `kimi acp` for the list of available models when it probes provider status. The model
picker shows those models. If Kimi Code reports only one model, the picker locks to it.

You can type a model slug directly in the model picker if you know Kimi supports it but does not
advertise it in the current session.

## Modes And Runtime Modes

T3 Code maps T3 runtime modes to Kimi Code ACP modes:

- `full-access` / YOLO mode → `auto` or `yolo`, whichever Kimi advertises
- `approval-required` → `default` or `auto`, whichever Kimi advertises
- `plan` mode → `plan`, if Kimi advertises it

Kimi Code does not implement a separate permissions prompt protocol, so T3 Code treats the selected
mode as the authority for what actions Kimi may take.

## Can I Switch Accounts In An Existing Thread?

Yes, as long as both Kimi Code providers use the same binary and only differ in credentials or
environment variables. T3 Code considers them the same continuation identity for Kimi Code threads.

## Troubleshooting

### Kimi Code is not installed

T3 Code shows `installed: false` for the provider and a message like:

```text
Kimi Code CLI (`kimi`) is not installed or not on PATH.
```

Install Kimi Code and make sure `kimi` is on the PATH used by the T3 Code server, or set the
provider's `Binary path` to the absolute path of the `kimi` executable.

### Not authenticated

T3 Code shows `auth.status: unauthenticated` and a message like:

```text
Kimi Code CLI is not authenticated. Run `kimi login` and try again.
```

Run:

```bash
kimi login
```

If you are using a custom binary path or environment variables, make sure the same binary and
environment can authenticate.

### Model picker is empty

1. Refresh provider status in T3 Code Settings.
2. Check that `kimi acp` reports models by running `kimi acp` manually and sending a
   `session/get_models` request.
3. If Kimi Code does not advertise models through ACP, type a known model slug directly in the
   model picker.

### Changes not taking effect

Provider settings are saved per instance. Make sure you edited the correct Kimi Code provider row,
not a different provider. If you added environment variables, the next new session uses them;
existing sessions keep their original environment.
