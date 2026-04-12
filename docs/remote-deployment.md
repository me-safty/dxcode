# Remote Deployment Guide

This guide is for running T3 Code headlessly on a remote Linux machine so a desktop client can pair to it and use it as a remote coding environment.

It is intentionally focused on:

- AWS EC2
- DigitalOcean Droplets
- generic Ubuntu VPS hosts

It does **not** cover the desktop app packaging flow. This is the operator runbook for a server-style install.

## Recommended topology

The safest deployment model for T3 Code is:

1. run the server headlessly with `t3 serve`
2. bind it to a private address, not the public internet
3. connect to it over a trusted private network such as Tailscale
4. pair the desktop client using the printed pairing URL

This matches the repo's own remote-access guidance in [REMOTE.md](../REMOTE.md).

Why this is the default recommendation:

- pairing URLs are effectively temporary passwords
- T3 already has a clean remote bootstrap flow built around pairing + bearer sessions
- private-network exposure is much simpler and safer than designing a public edge around an early-stage internal tool

## Playbook map

Follow the guide in order. For the EC2 path, the current live step is Section 1.

1. Shared prerequisites
2. Section 1: Launch the EC2 instance
3. Section 2: SSH in and install host packages
4. Section 3: Install Bun, clone the repo, and build
5. Section 4: Install and authenticate a provider
6. Section 5: Install Tailscale and choose the bind host
7. Section 6: Start T3 headlessly and pair
8. Section 7: Move the server under systemd
9. Section 8: Day-2 operations

## Shared prerequisites

Before the cloud-specific steps, the T3-specific requirements are the same everywhere:

- Bun installed on the server
- the repo checked out on the server
- at least one provider installed and authenticated
- a persistent `T3CODE_HOME`
- a reachable host/IP for `t3 serve --host ...`

Relevant repo references:

- remote access model: [REMOTE.md](../REMOTE.md)
- headless `serve` command: [apps/server/src/cli.ts](../apps/server/src/cli.ts)
- default port and host config: [apps/server/src/config.ts](../apps/server/src/config.ts)
- pairing URL generation: [apps/server/src/startupAccess.ts](../apps/server/src/startupAccess.ts)
- remote client bootstrap flow: [apps/web/src/environments/remote/api.ts](../apps/web/src/environments/remote/api.ts)

## Generic VPS recipe

This is the baseline path that also applies to EC2 and DigitalOcean after instance creation.

### 1. Join the machine to a tailnet

T3's own docs recommend a trusted private network such as Tailscale.

Tailscale Linux install docs: [tailscale.com/download/linux](https://tailscale.com/download/linux)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4
```

Use the printed Tailscale IPv4 as the host for T3.

### 2. Start T3 headlessly

If you want a manual first run:

```bash
cd /path/to/ai.code/apps/server
T3CODE_HOME=/var/lib/t3code \
node dist/bin.mjs serve \
  --host "$(tailscale ip -4)" \
  --port 3773 \
  /srv/t3-workspaces
```

That prints:

- a connection string
- a pairing token
- a pairing URL
- a QR code

### 3. Pair the desktop client

On the client machine:

- paste the full pairing URL into T3 Code
- or enter the host and pairing code manually

After pairing, the client exchanges the pairing credential for a bearer session and then requests a websocket token. You do not keep using the original pairing token for normal traffic.

### 4. Move the server under systemd

Use a dedicated service so the process survives disconnects and reboots.

Example unit:

```ini
[Unit]
Description=T3 Code Headless Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/ai.code/apps/server
Environment=T3CODE_HOME=/var/lib/t3code
ExecStart=/usr/bin/env bash -lc 'node dist/bin.mjs serve --host "$(tailscale ip -4)" --port 3773 /srv/t3-workspaces'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now t3code
sudo systemctl status t3code
journalctl -u t3code -f
```

### 5. Optional observability

Useful remote env vars:

- `T3CODE_TRACE_FILE`
- `T3CODE_OTLP_TRACES_URL`
- `T3CODE_OTLP_METRICS_URL`
- `T3CODE_LOG_WS_EVENTS`

See [docs/observability.md](./observability.md).

## AWS EC2 playbook

AWS docs for launching and connecting to a Linux instance:

- EC2 launch tutorial: [docs.aws.amazon.com/.../tutorial-launch-a-test-ec2-instance.html](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/tutorial-launch-a-test-ec2-instance.html)
- security group rules: [docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)

Recommended EC2 shape for T3:

- Ubuntu LTS instance
- SSH key pair
- inbound SSH restricted to your IP
- no public `3773` unless you are intentionally exposing the server
- if you are not using Tailscale, add inbound TCP `3773` from your IP only
- Tailscale is optional, not required

Recommended EC2 size for a machine that may run many Codex/Claude sessions and many worktrees:

- default choice: `r7i.2xlarge` on `x86_64` / `amd64`
- spec: 8 vCPU, 64 GiB RAM, EBS-only storage
- why: the machine is more likely to be memory-bound than burst-CPU-bound once multiple sessions and worktrees pile up
- avoid as the default: `t3.*` and `t4g.*` burstable families
- budget fallback: `m7i.2xlarge` on `x86_64` / `amd64` if you want a cheaper 8 vCPU option with 32 GiB RAM
- scale-up option: `r7i.4xlarge` if you expect several active sessions at once and want a lot of headroom
- root volume guidance: use `gp3` and give the instance at least `200 GiB` of disk; use `300-500 GiB` if you expect lots of repos, worktrees, logs, and provider caches

### Section 1: Launch the EC2 instance

If you are starting from scratch on AWS, this is the first thing to do.

1. Go to the EC2 console and launch a new instance.
2. Choose `Ubuntu Server 24.04 LTS (HVM), SSD Volume Type`.
3. Pick the `64-bit (x86)` / `amd64` variant, not Arm, unless you have a specific reason to standardize on Arm.
4. Pick a small general-purpose instance to start only if this is a quick test. For a machine that may run many sessions and worktrees, use `r7i.2xlarge`.
5. Do not choose the Ubuntu Pro, SQL Server, or Deep Learning AMIs for this setup.
6. If 24.04 is not available in your region, use `Ubuntu Server 22.04 LTS (HVM), SSD Volume Type` with the `64-bit (x86)` / `amd64` variant instead.
7. Set the root volume to `gp3` and give it at least `200 GiB`; use `300-500 GiB` if you expect lots of repos, worktrees, logs, and provider caches.
8. Create or select an SSH key pair and keep the `.pem` file safe.
9. Configure the security group to allow inbound SSH (`22`) from your IP only.
10. Leave inbound `3773` closed if you plan to use Tailscale.
11. Launch the instance and note its public IPv4 address for SSH.

### Section 2: SSH in and install host packages

SSH into the instance as soon as it comes up, then install the basic toolchain you will need for Bun, git, and any native module builds.

```bash
ssh -i /path/to/key.pem ubuntu@<ec2-public-ip>
sudo apt-get update
sudo apt-get install -y git curl ca-certificates build-essential unzip
```

### Section 3: Install Bun, clone the repo, and build

Install Bun, clone the repo, install dependencies, and build the server package before you try to start it headlessly.

```bash
curl -fsSL https://bun.com/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
bun --version

git clone <your-fork-url> ai.code
cd ai.code
bun install

cd apps/server
bun run build
```

### Section 4: Install and authenticate a provider

At least one provider must be installed and authenticated on the EC2 machine before the server can do useful work.

- Codex: install Codex CLI and run `codex login`
- Claude: install Claude Code and run `claude auth login`

```bash
codex login
# or
claude auth login
```

### Section 5: Install Tailscale and choose the bind host

Choose one of these network paths.

#### Option A: AWS-only, no extra service

This is the simplest path if you do not want Tailscale.

1. In the EC2 security group, add inbound TCP `3773` from your IP only.
2. Keep inbound SSH (`22`) restricted to your IP only.
3. Do not open `3773` to the whole internet.
4. Start T3 with `--host 0.0.0.0 --port 3773`.
5. In the desktop client, use the EC2 public IPv4 address if the printed pairing URL points at a private address.
6. If needed, enter the host and token separately instead of relying on the printed URL.

#### Option B: Tailscale private network

Use this only if you want a private mesh network and do not mind adding Tailscale.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4
```

Use the printed Tailscale IPv4 as the value for `--host`. Keep port `3773` closed on the public security group when Tailscale is in use.

### Section 6: Start T3 headlessly and pair

Set a persistent `T3CODE_HOME` and start the server in headless mode from `apps/server`.

If you chose the AWS-only path:

```bash
export T3CODE_HOME=/var/lib/t3code
sudo mkdir -p "$T3CODE_HOME"
sudo chown -R "$USER":"$USER" "$T3CODE_HOME"

cd /path/to/ai.code/apps/server
node dist/bin.mjs serve \
  --host 0.0.0.0 \
  --port 3773 \
  /srv/t3-workspaces
```

If you chose Tailscale:

```bash
export T3CODE_HOME=/var/lib/t3code
sudo mkdir -p "$T3CODE_HOME"
sudo chown -R "$USER":"$USER" "$T3CODE_HOME"

cd /path/to/ai.code/apps/server
node dist/bin.mjs serve \
  --host "$(tailscale ip -4)" \
  --port 3773 \
  /srv/t3-workspaces
```

The server prints:

- a connection string
- a pairing token
- a pairing URL
- a QR code

If the printed pairing URL uses a private EC2 address on the AWS-only path, use the desktop client’s manual host + token fields with the EC2 public IPv4 address. After pairing, the client uses a bearer session and websocket token. Do not reuse the pairing token as a long-lived credential.

### Section 7: Move the server under systemd

Once the manual start works, move the same command into a systemd unit so the machine survives disconnects and reboots.

If you chose Tailscale, replace `0.0.0.0` with `$(tailscale ip -4)` in `ExecStart` and keep `3773` closed publicly.

```ini
[Unit]
Description=T3 Code Headless Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/ai.code/apps/server
Environment=T3CODE_HOME=/var/lib/t3code
ExecStart=/usr/bin/env bash -lc 'node dist/bin.mjs serve --host 0.0.0.0 --port 3773 /srv/t3-workspaces'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now t3code
sudo systemctl status t3code
journalctl -u t3code -f
```

### Section 8: Day-2 operations

- Use `t3 auth` to revoke pairing links or sessions you no longer trust.
- Keep `T3CODE_HOME` on persistent storage, not on a disposable home directory.
- If you chose Tailscale, re-check the tailnet IP if the instance reboots or Tailscale reconnects.
- If you chose the AWS-only path, keep `3773` restricted to your IP in the EC2 security group and do not widen it.
- Treat pairing URLs and pairing tokens like passwords.

### EC2 operator notes

- If the instance is restarted, re-check the public IP before reusing the launch command.
- If you want to expose T3 publicly, put HTTPS in front of it with a reverse proxy, restrict inbound IPs if possible, and treat pairing URLs as secrets.

If you must expose T3 publicly:

- put HTTPS in front of it with a reverse proxy
- restrict inbound IPs if possible
- treat pairing URLs as secrets
- prefer short-lived pairing and revoke old sessions with `t3 auth`

## DigitalOcean notes

DigitalOcean docs:

- production-ready Droplet setup: [docs.digitalocean.com/products/droplets/getting-started/recommended-droplet-setup/](https://docs.digitalocean.com/products/droplets/getting-started/recommended-droplet-setup/)
- connect with SSH: [docs.digitalocean.com/products/droplets/how-to/connect-with-ssh/](https://docs.digitalocean.com/products/droplets/how-to/connect-with-ssh/)

Recommended Droplet shape for T3:

- Ubuntu Droplet
- SSH keys, not password auth
- cloud firewall attached to the Droplet tag
- inbound SSH only by default
- Tailscale for the actual T3 connectivity path

Suggested DigitalOcean flow:

1. Create the Droplet with SSH keys enabled.
2. Apply a cloud firewall that allows SSH only.
3. SSH in and perform the generic VPS recipe above.
4. Install Tailscale and bind `t3 serve` to the tailnet IP.
5. Leave public port `3773` closed unless you intentionally want public exposure.

## Public internet exposure

Private-network access is preferred. If you need browser/client access over the public internet:

1. terminate TLS at a reverse proxy
2. forward HTTP and websocket traffic to the T3 server
3. use a stable hostname
4. lock the edge down as much as possible

Minimum concerns if you do this:

- HTTPS is mandatory
- the proxy must support websocket upgrade
- pairing URLs should only be shared over a trusted channel
- `t3 auth` should be part of the operator workflow for revoking leaked or stale sessions

## Operator commands you will actually use

Create a new pairing credential later:

```bash
cd /path/to/ai.code/apps/server
node dist/bin.mjs auth pairing create
```

List active pairing links:

```bash
node dist/bin.mjs auth pairing list
```

Revoke a pairing link:

```bash
node dist/bin.mjs auth pairing revoke --id <pairing-link-id>
```

Tail logs:

```bash
journalctl -u t3code -f
```

## Recommended default

If you want the simplest, safest MVP deployment:

1. launch Ubuntu on EC2 or DigitalOcean
2. install Bun
3. build `apps/server`
4. install/auth Codex or Claude
5. install Tailscale
6. run `node dist/bin.mjs serve --host "$(tailscale ip -4)" --port 3773 /srv/t3-workspaces`
7. move that command into systemd
8. pair from your desktop client using the printed pairing URL

That gives you a stable remote-hosted T3 Code server with the smallest security footprint and the least divergence from the repo's documented remote model.
