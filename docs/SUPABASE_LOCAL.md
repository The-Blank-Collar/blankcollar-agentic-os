# Supabase — local testing

End-to-end walkthrough for getting Supabase auth working against your **local**
stack before you take it to Hostinger. ~15 minutes.

## What you'll have at the end

- A real Supabase project (free tier)
- A user account with email + password sign-in
- That email provisioned as `owner` of the demo org in Postgres
- Paperclip's API verifying your Supabase JWTs and resolving the request scope from your provisioned role
- Optionally: enforcement on (every API call requires a valid JWT)

## Prereq: the local stack is running

```bash
make doctor    # all 14 lines green
```

If not, fix that first.

## 1. Create a Supabase project (5 min)

1. Go to https://supabase.com/dashboard, sign up (free).
2. **New project** → name it `blankcollar-dev`, pick a strong DB password, pick the region closest to you, free tier.
3. Wait ~1 minute for provisioning.

## 2. Copy the credentials

In the Supabase dashboard → **Settings → API**:

| Field | Where it goes in `.env` |
|---|---|
| **Project URL** | `SUPABASE_URL` |
| **anon public** key | `SUPABASE_ANON_KEY` |
| **service_role** key | `SUPABASE_SERVICE_ROLE_KEY` (server-only — never the browser) |
| **JWT Secret** | `SUPABASE_JWT_SECRET` ← **the important one for v0** |

Paste these into your local `.env`:

```bash
nano .env
```

Set:

```env
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=<copy from Settings → API → JWT Secret>
PAPERCLIP_AUTH_ENFORCE=false   # keep soft-mode for now
```

Save, then:

```bash
docker compose restart paperclip
docker compose logs paperclip --tail=20 | grep auth
```

You should see:

```
auth=supabase enforce=false (set PAPERCLIP_AUTH_ENFORCE=true to require tokens)
```

That confirms Paperclip is now in JWT-verify-when-present mode.

## 3. Create your user in Supabase

In the Supabase dashboard → **Authentication → Users → Add user → Create new user**:

- Email: your real email
- Password: anything you'll remember for this dev project
- Click **Create user**.

## 4. Provision yourself in `core.user_account`

Until Phase 6 ships an invitation flow, you do this once via the helper:

```bash
make user-add EMAIL=you@example.com NAME="Your Name"
```

(Defaults to `ROLE=owner`. Override with `ROLE=team_member` etc.)

You should see something like:

```
 user_id  |        email        | display_name |  roles  
----------+---------------------+--------------+--------
 b1a2c3…  | you@example.com     | Your Name    | owner

✅ provisioned you@example.com with role=owner in the demo org
```

Confirm:

```bash
make users
```

## 5. Round-trip a real JWT

Get a token from Supabase. The easiest way for v0:

```bash
curl -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"<your password>"}' \
  | jq -r .access_token
```

(Source the values: `set -a; . .env; set +a` first.)

Save the token:

```bash
TOKEN=$(curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"<your password>"}' | jq -r .access_token)
echo "$TOKEN" | head -c 60   # sanity peek
```

Hit the API:

```bash
curl -sS http://localhost:3000/api/goals \
  -H "Authorization: Bearer $TOKEN" | jq
```

You should get `[]` (no goals yet, but no auth error). Without the header, you also still get `[]` because we're in soft-mode (verify when present, fall back to stub).

## 6. Flip enforcement on (optional)

When you're ready for the API to **require** a JWT on every request:

```bash
# In .env:
PAPERCLIP_AUTH_ENFORCE=true
```

```bash
docker compose restart paperclip
```

Now:

```bash
curl -sS -i http://localhost:3000/api/goals
# HTTP/1.1 401 Unauthorized
```

```bash
curl -sS -i http://localhost:3000/api/goals \
  -H "Authorization: Bearer $TOKEN"
# HTTP/1.1 200 OK
```

## Notes & gotchas

- **The dashboard at `/` is unaffected** — UI routes intentionally don't go through the auth middleware. Phase 6 will add a sign-in page that mints a session cookie. For now, the dashboard quietly uses the demo-org-owner stub.
- **Token expiry**: Supabase tokens expire after 1 hour by default. Re-fetch when needed, or set up the [Supabase JS client](https://supabase.com/docs/reference/javascript) to handle refresh in a real frontend.
- **You can add more users**: just create them in Supabase, then `make user-add EMAIL=… ROLE=team_member`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `auth=stub` in paperclip logs even after restart | `SUPABASE_JWT_SECRET` is empty in `.env` — re-paste it and restart |
| `401 invalid_token` | The JWT secret in `.env` doesn't match the one in Supabase. Settings → API → JWT Secret → re-copy. |
| `403 no_account` (only with enforce on) | Token is valid but the email isn't in `core.user_account`. Run `make user-add EMAIL=…` |
| Token request returns `Invalid login credentials` | Wrong password, or the user isn't confirmed (Supabase sometimes requires email confirmation — disable in Auth → Providers → Email → "Confirm email" off for dev) |
