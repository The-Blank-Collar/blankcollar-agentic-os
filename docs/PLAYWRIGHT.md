# Playwright (web.browse skill)

OpenClaw gains a third web skill: **`web.browse`** — a real browser
(headless Chromium) via [Playwright](https://playwright.dev/python/).

Where `web.fetch` does a static HTTP GET (fast, no JavaScript), `web.browse`
runs an actual browser: executes JS, follows redirects through cookies and
auth, waits for the page to settle, and returns rendered text. Use it for
SPAs, paywalled sites, or anything that needs DOM after-render.

## How to call it

Like any OpenClaw skill — through Paperclip dispatch with
`subtask.input.skill = "web.browse"`:

```json
{
  "subtask": {
    "title": "Render the dashboard",
    "agent_kind": "openclaw",
    "input": {
      "skill": "web.browse",
      "url": "https://app.example.com/dashboard",
      "wait_until": "networkidle",
      "screenshot": false
    }
  }
}
```

### Input parameters

| Field | Default | Notes |
|---|---|---|
| `url` | required | Must pass the same safety guard as `web.fetch` (no IP literals on private/loopback/IMDS ranges). |
| `wait_until` | `"networkidle"` | One of `load`, `domcontentloaded`, `networkidle`, `commit`. |
| `screenshot` | `false` | If `true`, capture a PNG (returned base64-encoded in the run output). |

### Output

```json
{
  "agent_kind": "openclaw",
  "skill": "web.browse",
  "url": "https://app.example.com/dashboard",
  "final_url": "https://app.example.com/dashboard",
  "status": 200,
  "title": "My Dashboard",
  "viewport": { "w": 1280, "h": 800 },
  "screenshot_png_b64": null,
  "memory_id": "<uuid>",
  "excerpt_chars": 4321
}
```

The rendered page text is written to `gbrain` as a `document` memory
(metadata includes `skill: "web.browse"`, `url`, `final_url`, `status`,
`viewport`, `had_screenshot`).

## Plan-generator routing

Paperclip's plan generator picks `web.browse` when the goal contains
both a URL **and** a browse-trigger word — `browse`, `render`, `click`,
`interact`, `spa`, `javascript`, `dashboard`. Otherwise it stays on
the lighter `web.fetch`:

| Goal text | Skill |
|---|---|
| `Summarise https://news.ycombinator.com/` | `web.fetch` |
| `Render and analyse https://app.example.com/dashboard` | `web.browse` |
| `Browse https://example.com and tell me about it` | `web.browse` |

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OPENCLAW_BROWSER_TIMEOUT_S` | 30 | `page.goto` timeout (seconds). |
| `OPENCLAW_BROWSER_VIEWPORT_W` | 1280 | Viewport width in px. |
| `OPENCLAW_BROWSER_VIEWPORT_H` | 800 | Viewport height in px. |
| `OPENCLAW_BROWSER_MAX_SCREENSHOT_BYTES` | 2_000_000 | If a screenshot exceeds this, it's dropped to keep payloads sane. |

## Image size

Adding Playwright + Chromium grows the OpenClaw image by roughly **~400 MB**.
First-time build is slower (one-time cost). Subsequent builds use the cached
layer.

## Safety

The same `_is_safe_url()` guard as `web.fetch` rejects:
- non-`http(s)` schemes (no `file://`, `ftp://`, `javascript:`)
- loopback / private / link-local / reserved IP literals (incl. AWS IMDS at
  169.254.169.254)
- malformed URLs

Browser launches with `headless=true` (no GUI), declared user agent, and
a fresh context per call (no cookie/state bleed between runs).

## Tests

Six unit tests cover the safety/argument validation paths
(`apps/openclaw/tests/test_browser.py`). Real Chromium launches happen at
runtime — out of scope for unit tests.

## Deferred to later sessions

- **`web.click`** — given a URL and a CSS selector, click and return the
  resulting page. Trivial extension of `web.browse`.
- **Persistent browser context** — one Chromium instance per OpenClaw
  process, reused across calls. Faster but stateful.
- **Screenshot storage** — currently inline base64 in run output. Could
  push to a blob store for large pages.
