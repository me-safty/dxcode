# Modal Sandbox Secrets

Task sandboxes receive credentials through named Modal Secrets. Store only the Modal Secret names in
project configuration; never store raw token values in Convex.

Recommended MVP secrets:

| Modal Secret            | Required keys                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `t3-git-auth`           | `GH_TOKEN` or `GITHUB_TOKEN`                                                                                            |
| `t3-codex-subscription` | `T3_CODEX_AUTH_JSON_B64`                                                                                                |
| `t3-opencode-bedrock`   | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; optional `AWS_SESSION_TOKEN`, `T3_OPENCODE_CONFIG_JSON_B64` |
| `t3-execution-bridge`   | `T3_EXECUTION_BRIDGE_SHARED_SECRET`                                                                                     |

Optional keys:

- `T3_CODEX_CONFIG_TOML_B64`: writes `$CODEX_HOME/config.toml`.
- `T3_GH_HOSTS_YML_B64`: writes GitHub CLI `hosts.yml`.
- `AWS_DEFAULT_REGION`: accepted by AWS SDK tooling when `AWS_REGION` is not used.

Base64 helpers:

```sh
base64 < ~/.codex/auth.json | tr -d '\n'
base64 < ~/.codex/config.toml | tr -d '\n'
base64 < ~/.config/gh/hosts.yml | tr -d '\n'
```

Attach the secret names to the Project:

```json
{
  "sandboxProvider": "modal",
  "modalAllowedSecretNamesJson": "[\"t3-git-auth\",\"t3-codex-subscription\",\"t3-opencode-bedrock\",\"t3-execution-bridge\"]"
}
```

The runtime entrypoint decodes file-backed secrets before starting T3, configures `GH_TOKEN` for
`gh`, configures Git credentials for HTTPS pushes, and preserves `OPENCODE_CONFIG_CONTENT` for
OpenCode Bedrock provider configuration.
