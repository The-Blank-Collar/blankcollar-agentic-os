# Hetzner deploy — the beginner playbook

> **For absolute beginners.** Every term defined the first time it appears. Every step has the literal commands or button labels you'll need. If you get stuck, scroll to **"When something goes wrong"** at the bottom.

This is the playbook you follow **once** to put your local stack onto a Hetzner Cloud server. After this, you never touch the server directly — you just `git push` and the changes deploy automatically.

---

## What you'll need before starting

- A laptop (Mac, Linux, or Windows with WSL — any modern OS)
- A Hetzner Cloud account *(you have this — [console.hetzner.cloud](https://console.hetzner.cloud/))*
- A web browser, a terminal, and ~60 minutes
- Your Portkey + OpenRouter keys ready *(from `make setup-keys` earlier — they live in your local `.env`)*

You do **not** need:
- A domain name (we'll add one later)
- Prior experience with SSH, Linux, Docker, or any cloud platform
- Anyone else's help

---

## What we're building, in 30 seconds

```
                        Hetzner CPX31 server
                ┌────────────────────────────────┐
   you ───┐     │  ┌─────────┐   ┌────────────┐  │
   git push     │  │ Coolify │ → │ The whole  │  │
       └──→ GitHub  │ (manager)│   │ Blank      │  │ ← you visit
                │  └─────────┘   │ Collar     │  │   this URL
                │                │ stack      │  │   in your
                │                └────────────┘  │   browser
                └────────────────────────────────┘
```

- **Coolify** is a free open-source tool that pulls your code from GitHub, runs Docker for you, and gives you a friendly web UI to manage everything. Think of it as "what I'd build if I had to deploy without learning Kubernetes."
- The **Hetzner CPX31** is the server (think: a computer in Germany you rent for €13/month).
- The **whole Blank Collar stack** = paperclip + the agents + the databases. Same images you run locally; just running on the server instead.

---

## Stage 1 — Generate an SSH key on your laptop *(2 min)*

> **What's an SSH key?** It's a digital house key with two halves. The **private** half stays on your laptop forever (never share it). The **public** half goes on the server. When you connect, your laptop says "I have the matching key" — the server checks, opens the door, no password needed. Much safer than passwords.

You only do this once per laptop. If you've made an SSH key before for any other reason (GitHub, etc.), you can skip this stage and reuse it.

### On Mac or Linux

Open the **Terminal** app. Paste this exact command, replacing the email with yours:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```

When it asks **"Enter file in which to save the key"** — just press Enter (use the default location).
When it asks **"Enter passphrase"** — leave blank and press Enter twice (you can add one later).

You'll see something like:

```
Your public key has been saved in /Users/you/.ssh/id_ed25519.pub
```

Now print your **public key** (the one we put on the server):

```bash
cat ~/.ssh/id_ed25519.pub
```

You'll see one long line starting with `ssh-ed25519 AAAA…` and ending with your email. **Keep this terminal window open** — you'll paste it into Hetzner in Stage 2.

### On Windows

1. Press `Windows + R`, type `cmd`, press Enter to open a terminal.
2. Run:
   ```cmd
   ssh-keygen -t ed25519 -C "your-email@example.com"
   ```
3. Press Enter at every prompt (default path, no passphrase).
4. Print your public key:
   ```cmd
   type %USERPROFILE%\.ssh\id_ed25519.pub
   ```

---

## Stage 2 — Create the server in Hetzner *(10 min)*

> **What's a server?** A computer that's always on, in a data centre, that you rent. Yours will be in Falkenstein, Germany.

1. Go to [console.hetzner.cloud](https://console.hetzner.cloud/) and log in.
2. Click your **project** (the one you already created).
3. Top-right: click the green **`Add Server`** button.

You'll see a "New Server" page. Fill it in like this:

| Field | What to pick |
|---|---|
| **Location** | `Falkenstein, Germany` *(closest to most of Europe; cheapest egress)* |
| **Image** | `Ubuntu 24.04` |
| **Type** | Click the **`Shared vCPU`** tab → choose **`CPX31`** (4 vCPU AMD, 8 GB RAM, 160 GB SSD, ~€13.10/month) |
| **Networking** | Leave the defaults — public IPv4 + IPv6 enabled, no private network needed |
| **SSH keys** | Click **`Add SSH key`** → paste the long line from Stage 1 (`ssh-ed25519 AAAA… your@email`) → give it a name like *"my-laptop"* → click **Add SSH key** |
| **Volumes** | Skip *(leave blank)* |
| **Firewalls** | Skip *(we'll set up `ufw` on the server itself)* |
| **Backups** | **Off** *(save €2.62/month — we'll set up our own off-server backups)* |
| **Placement Groups** | Skip |
| **Labels** | Skip |
| **Cloud config** | Skip |
| **Name** | `blankcollar-prod` *(any name works; this is what you'll see in the Hetzner UI)* |

At the bottom, you'll see a price summary: **~€13.10/month** + a one-line **`Create & Buy now`** button. Click it.

Hetzner spins up the server. After ~30 seconds you'll see it in your project's **Servers** list with status `Running`. Click on it. The page that opens has the **IPv4 address** at the top — looks like `95.216.123.45`. **Copy this somewhere** (a sticky note, a text file). You'll use it three times in the next stages.

> **Tip:** If you forget the IP, just go back to console.hetzner.cloud → your project → Servers → blankcollar-prod. It's always shown there.

---

## Stage 3 — First SSH login + run the bootstrap script *(10 min)*

> **What's SSH?** A way to type commands on the server from your laptop, securely. The "S" stands for "Secure".

In your laptop terminal, replace `<YOUR-IP>` with the IP from Stage 2:

```bash
ssh root@<YOUR-IP>
```

The first time, it'll ask:

```
The authenticity of host '95.216.123.45' can't be established.
Are you sure you want to continue connecting (yes/no)?
```

Type **`yes`** and press Enter. (This is normal — it's saving the server's fingerprint so it can warn you if it ever changes.)

You're now on the server. Your prompt will look like:

```
root@blankcollar-prod:~#
```

Anything you type from here runs **on the server**, not your laptop. Be careful.

### Run the bootstrap script

This installs Docker, the firewall, swap, and Coolify. It takes about 5 minutes.

Paste this exact line and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/The-Blank-Collar/blankcollar-agentic-os/main/infra/scripts/cloud-bootstrap.sh | sudo bash
```

You'll see lots of output as it runs. **Don't interrupt it.** When it finishes, the very last lines print your next URL:

```
✓ Server is bootstrapped.

Open Coolify in your browser:

    http://95.216.123.45:8000
```

Open that URL in a new browser tab. You should see Coolify's first-run page asking you to create an admin account.

### Disconnect for now

```bash
exit
```

This drops you back to your laptop. We'll use the browser from here on.

---

## Stage 4 — Coolify admin setup *(3 min)*

In the browser tab from Stage 3:

1. **Email** — your email (this is just for password resets; doesn't have to match anything else)
2. **Password** — pick a long random one. *Save it in a password manager — you'll need it every time you log into Coolify.*
3. **Confirm Password** — same one
4. Click **`Register`**

You're now in the Coolify dashboard.

> **Browser warning?** Your browser may say "Not Secure" because we're using `http://` (no TLS yet). That's expected for now — we'll add TLS in Phase 3b when you connect a domain. Click through the warning.

---

## Stage 5 — Connect Coolify to GitHub *(5 min)*

Coolify needs permission to read your repo so it can deploy it.

1. In the Coolify left sidebar, click **`Sources`**.
2. Click **`+ Add`** → **`GitHub App`**.
3. Coolify shows a wizard. Pick **`Public repositories only`** is fine for our case — *the repo is public; Coolify just needs to read it and react to webhooks*.

   *(If your repo is private, pick "Private + Public" instead. Coolify will ask you to install a small GitHub App on your account. Follow the prompts — it's clearly marked.)*

4. Once GitHub redirects you back, your source shows up as **GitHub** with a green dot.

---

## Stage 6 — Create the project + first deploy *(15 min)*

### 6a. Create the resource

1. Sidebar → **`Projects`** → **`+ Add`** → name it `blankcollar` → **`Save`**.
2. In the project, click **`+ New Resource`**.
3. Pick **`Public Repository`** (or **`Private`** if your fork is private).
4. **Repository URL**: `https://github.com/The-Blank-Collar/blankcollar-agentic-os` *(or your fork)*
5. **Branch**: `main`
6. **Build Pack**: select **`Docker Compose`**.
7. **Compose file**: `docker-compose.yml`
8. **Compose file (additional)**: `docker-compose.prod.yml`

   *(That second compose file is the production overlay we just shipped — it removes host port mappings on internal services + sets `ENV=production`.)*

9. Click **`Save`** at the bottom.

### 6b. Set environment variables

This is the most important step. Coolify needs every env var your local stack uses.

1. In the resource page, click **`Environment Variables`** in the left sidebar of the resource.
2. For each line in your local `.env` that has a real value (skip empty ones), click **`+ Add`** and copy the name + value.

   The **must-have** vars for a working boot:

   | Name | Where it comes from |
   |---|---|
   | `PORTKEY_API_KEY` | your local `.env` |
   | `PORTKEY_VIRTUAL_KEY_ANTHROPIC` | your local `.env` |
   | `PORTKEY_VIRTUAL_KEY_OPENROUTER` | your local `.env` *(optional)* |
   | `POSTGRES_PASSWORD` | **change this!** Pick a long random string. Don't reuse the local-dev `postgres` value. |
   | `NEO4J_PASSWORD` | **change this too** |
   | `PAPERCLIP_DEFAULT_ORG_SLUG` | `blankcollar-personal` *(or whatever you use locally)* |
   | `BRAND_NAME` | `blankcollar` |
   | `PAPERCLIP_RLS_STRICT` | `true` |
   | `PAPERCLIP_TOOL_PROBE_AT_BOOT` | `true` |

   The **nice-to-have** vars (skip if you don't have them yet):
   - `INBOUND_CAPTURE_WEBHOOK_SECRET`
   - `NANGO_SECRET_KEY`
   - `SUPABASE_JWT_SECRET`
   - `STRIPE_WEBHOOK_SECRET`

3. Coolify saves each one as you click **`Save`**. They are **encrypted at rest** in Coolify's database — never visible in URLs or git.

### 6c. Deploy

Top right of the resource page: click the green **`Deploy`** button.

You'll see a live build log. It'll do roughly:

```
[1/8] Pulling postgres:18-alpine ...
[2/8] Pulling qdrant/qdrant:v1.17.1 ...
[3/8] Pulling neo4j:5.26.2 ...
[4/8] Building paperclip from Dockerfile ...
[5/8] Building hermes from Dockerfile ...
[6/8] Building openclaw from Dockerfile ...
[7/8] Building langgraph from Dockerfile ...
[8/8] Starting all services ...

✓ Deployment finished
```

First deploy takes ~5-10 min (downloading + building). Future deploys (when you `git push`) take ~1-2 min because everything's cached.

### 6d. Verify it works

1. In the resource page, look for the **`Logs`** tab. You should see paperclip's startup logs streaming.
2. The resource page shows a **public URL** at the top — Coolify created one for paperclip. Click it.
3. You should see Blank Collar's htmx dashboard at `http://<random-coolify-url>/`. **It works!**

> **Got the dashboard?** You're done with the cloud-side hard part. The rest is polish.

---

## Stage 7 — Verify, back up, monitor *(15 min)*

### 7a. Confirm the API responds

In your laptop terminal:

```bash
curl http://<YOUR-COOLIFY-URL>/api/health
```

You should get JSON back with `"ok": true`. If yes, the API is live.

### 7b. Test from the CLI

Set the API URL so `bc` talks to the cloud server:

```bash
export BC_API_URL=http://<YOUR-COOLIFY-URL>
bc whoami
bc capture "Hello from the cloud"
bc inbox
```

If you see your captured goal, the round-trip works end-to-end.

### 7c. Set up off-server backups

The repo's existing `infra/scripts/backup.sh` already creates a complete tarball (Postgres + Nango DB + Qdrant + Neo4j volumes + brand). We just need to **schedule it** and **push the tarball off the server** so a server failure doesn't lose data.

**Option 1 — Hetzner Storage Box (recommended; €4/month for 1 TB):**

1. In console.hetzner.cloud, go to **Storage Boxes** in the left nav → **`+ Buy Storage Box`** → pick **`BX11`** (€4/mo, 1 TB).
2. After purchase, click your new Storage Box → note the **username** (`u123456`) and **server** (`u123456.your-storagebox.de`).
3. Set a Storage Box password in the Storage Box settings → **`Set new password`**.
4. SSH back into your Hetzner server (`ssh root@<YOUR-IP>`) and run:

   ```bash
   cd /data/coolify/applications/<your-app-id>/source
   # Or wherever Coolify cloned the repo; check via the Coolify UI → Resource → "Files".
   crontab -e
   ```

   When the editor opens, paste this line at the bottom (one line, no breaks):

   ```
   0 3 * * * cd /data/coolify/applications/<your-app-id>/source && BACKUP_DIR=/var/backups/blankcollar bash ./infra/scripts/backup.sh && rsync -e "ssh -p 23 -o StrictHostKeyChecking=accept-new" /var/backups/blankcollar/blankcollar-*.tar.gz u123456@u123456.your-storagebox.de:./
   ```

   This runs at 03:00 UTC every night. Save and exit (`:wq` in vim, `Ctrl+X` + `Y` in nano).

5. **Test it once:** run the script manually:
   ```bash
   bash ./infra/scripts/backup.sh
   ```
   You should see a tarball appear in `/var/backups/blankcollar/`.

**Option 2 — skip backups for now, set up later.** The system runs without them. Just be aware: if the Hetzner server is destroyed, you lose all data. For a v0 dev environment, that's an acceptable risk. Don't run any real customer data on an unbacked-up box.

### 7d. Monitoring with UptimeRobot (free)

1. Go to [uptimerobot.com](https://uptimerobot.com/) → sign up (free tier).
2. Click **`+ New monitor`**.
3. **Monitor Type**: HTTP(s)
4. **Friendly Name**: `Blank Collar prod`
5. **URL**: `http://<YOUR-COOLIFY-URL>/api/health`
6. **Monitoring Interval**: 5 minutes
7. **Alert Contacts**: tick your email
8. Click **`Create Monitor`**.

If the server ever goes down (or `/api/health` returns non-2xx), you get an email within 5 minutes.

---

## Adding the domain later *(when you're ready, ~15 min)*

When you're comfortable with the IP-based deploy and want a real URL like `app.blankcollar.ai`:

1. Where you bought `blankcollar.ai`, find the DNS settings.
2. Add an **A record**:
   - **Name** / **Host**: `app` *(produces `app.blankcollar.ai`)*
   - **Type**: `A`
   - **Value**: your Hetzner server IP (from Stage 2)
   - **TTL**: 5 min *(default 1 hour is fine too; faster TTL just means propagation is quicker if you change it)*
3. Wait 5 minutes for DNS to propagate. Test from your laptop:
   ```bash
   dig app.blankcollar.ai +short
   ```
   You should get back your Hetzner IP.
4. In Coolify, on the resource page, find the **Domains** field. Replace the random Coolify URL with `app.blankcollar.ai`.
5. Click **`Save`** — Coolify automatically provisions a Let's Encrypt TLS certificate (takes ~30 seconds). The `http://` becomes `https://`.
6. Visit `https://app.blankcollar.ai` — your dashboard, with a real cert.

That's it. Same setup for `coolify.blankcollar.ai` if you want a nicer URL for the Coolify admin (in Coolify Settings → Server → URL).

---

## When something goes wrong

### "I can't `ssh` into the server"

```bash
ssh -v root@<YOUR-IP>
```
The `-v` (verbose) prints what's failing. Common causes:
- **`Permission denied (publickey)`** → the public key in Stage 1 wasn't added to the server. In console.hetzner.cloud → your server → Settings → Rebuild from same image, this time pasting the right key.
- **`Connection refused`** → the server isn't fully booted yet. Wait 60 seconds and retry.
- **`Host key verification failed`** → a previous server with the same IP was on this list. Run `ssh-keygen -R <YOUR-IP>` and try again.

### "The bootstrap script failed halfway through"

Re-run it. The script is idempotent — every step is `if not already done, do it`. Safe to run twice.

### "Coolify says deployment failed"

In Coolify → the resource page → **`Logs`** tab. Read the last 50 lines. The most common causes:

| Symptom in logs | Fix |
|---|---|
| `PORTKEY_API_KEY is required` | You skipped Stage 6b. Add the env var, click **`Restart`**. |
| `connection refused` to postgres | Postgres is still starting. Click **`Restart`** on just paperclip. |
| `npm ERR! 404` on a package | Network blip during build. Click **`Deploy`** again. |
| `ENOSPC: no space left on device` | Run `docker system prune -af` on the server, redeploy. (Long-term: upgrade to CPX41 for more disk.) |

### "I want to start over"

1. In Coolify → resource → top-right menu → **`Delete`**.
2. SSH to the server: `docker system prune -af --volumes`
3. Redo Stage 6.

This wipes everything — Postgres data included. Only do this on a fresh-with-no-real-data deploy.

### "I want to upgrade the server"

In console.hetzner.cloud → your server → **Rescale**. Pick CPX41 (or larger). The IP doesn't change. You'll need to reboot the server (~30 sec downtime). Coolify auto-resumes.

---

## What's next after this playbook

This playbook gets you to: *"Blank Collar runs on a server I own, I can `git push` and it redeploys, I have backups, I get alerts when it's down."*

What's deferred until you ask for it:

| Item | When to add it |
|---|---|
| **Domain + TLS** | When you want a real URL (the section above) |
| **Supabase Postgres** | Phase 6 — when you wire JWT auth |
| **Neo4j Aura** | When self-hosted Neo4j stops being enough |
| **Qdrant Cloud** | When self-hosted Qdrant stops being enough |
| **GPU box (RunPod Spot)** | When you want to fine-tune your own LLM |
| **CDN (Cloudflare)** | When you have public-facing content + traffic |
| **Multi-region / HA** | When you have customers and downtime hurts |

For now: you're done. **Welcome to having a real cloud deploy.**
