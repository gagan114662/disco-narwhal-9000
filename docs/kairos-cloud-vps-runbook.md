# KAIROS Cloud VPS Runbook

This runbook covers the v1 single-user Docker target shipped by `/kairos cloud`.

## Prerequisites

- A Linux VPS reachable over SSH.
- SSH access with passwordless `sudo` on the target host.
- Either:
  - you are logged into Claude locally with `/login`, or
  - the local machine has a usable `ANTHROPIC_API_KEY` in the environment.
- The target host has accepted your SSH host key locally once already. The deploy command uses `StrictHostKeyChecking=yes`.

## Commands

Deploy a fresh host:

```bash
/kairos cloud deploy \
  --ssh-host root@your-vps.example.com \
  --use-subscription
```

Deploy a fresh host with an API key instead:

```bash
/kairos cloud deploy \
  --ssh-host root@your-vps.example.com \
  --anthropic-api-key-env ANTHROPIC_API_KEY
```

Upgrade an existing host:

```bash
/kairos cloud upgrade
```

Upgrade and rotate the remote secret in the same step:

```bash
/kairos cloud upgrade --anthropic-api-key-env ANTHROPIC_API_KEY
```

Upgrade and re-stage your current Claude subscription OAuth tokens:

```bash
/kairos cloud upgrade --use-subscription
```

Destroy the VPS runtime:

```bash
/kairos cloud destroy --confirm
```

## What Deploy Writes

- Systemd unit: `/etc/systemd/system/kairos-cloud.service`
- Secret env file: `/etc/kairos-cloud/kairos.env`
- Runtime root: `/opt/kairos-cloud` by default
- Docker-managed data: `/opt/kairos-cloud/data`

For API-key mode, the secret env file is written by the remote installer with mode `0600`, owned by `root`, and is created from a local environment variable so the secret never needs to be committed into git.

For subscription mode, the remote runtime stores your OAuth token set in `/opt/kairos-cloud/data/live-config/.credentials.json` with mode `0600` so the VPS can refresh the session without an API key.

## Visual Proof Checklist

Capture these three artifacts on the PR:

1. Deploy:
   - `/kairos cloud deploy ...`
   - `ssh <host> sudo systemctl status kairos-cloud --no-pager`
   - `ssh <host> sudo docker ps --filter name=kairos-cloud`
2. Upgrade:
   - `/kairos cloud upgrade`
   - `ssh <host> sudo docker ps --filter name=kairos-cloud`
   - `ssh <host> sudo docker inspect kairos-cloud --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'`
3. Destroy:
   - `/kairos cloud destroy --confirm`
   - `ssh <host> sudo test ! -e /etc/systemd/system/kairos-cloud.service`
   - `ssh <host> sudo test ! -e /opt/kairos-cloud`

## Credential Revocation On Destroy

`/kairos cloud destroy --confirm` removes the remote secret file and runtime data from the host. That only deletes the copy on the VPS.

After destroy, revoke or rotate the Anthropic API key that was provisioned for that host if:

- the VPS is being decommissioned,
- the key was dedicated to cloud KAIROS usage, or
- you suspect the host was exposed.

If you used subscription mode instead, destroy removes the staged OAuth credentials from the VPS. If you want immediate invalidation beyond host deletion, log out and back in locally to rotate the stored refresh token.
