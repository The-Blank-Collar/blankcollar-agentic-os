# Onboarding (for users)

Two onboarding paths, deliberately different. Phase 0 only ships the developer one; the operator one is the design target for Phase 4 and 7.

## Path A — Developer / power-user (today)

You want to read the code, run the stack, and tinker.

1. **Install** Docker Desktop, Git. (See `LOCAL_SETUP.md`.)
2. **Clone**: `git clone https://github.com/The-Blank-Collar/blankcollar-agentic-os.git`
3. **Bootstrap**: `make bootstrap`
4. **Verify**: `make doctor` exits 0.
5. **Read the docs in this order:**
   - `README.md` — orientation
   - `docs/VISION.md` — *why*
   - `docs/ARCHITECTURE.md` — *how*
   - `docs/GOAL_FIRST.md` — the design constraint
   - `docs/ROADMAP.md` — what's next
6. **Pick a phase** to contribute to. Phase 1 (real gbrain) is the unblocker right now.

You're done.

## Path B — Operator (Phase 4+ design target)

You want to run an agent company. You don't want to read about Docker.

This path doesn't exist yet, but here's the pattern we're committing to:

### Step 1 — Sign up (60 seconds)

Land on www.blankcollar.ai → click *"Start your agent company"* → email + password (Supabase) → done.

No card required for the free tier. No 14-step wizard.

### Step 2 — Tell us about you (90 seconds, 4 questions)

| Q                                            | Used for                                                |
|----------------------------------------------|---------------------------------------------------------|
| What kind of company is this?                | Picks a starting template (creator / SaaS / agency / …) |
| What's the *one* thing you want help with first? | Becomes your first goal in `draft`                  |
| Should agents email you a daily / weekly summary? | Sets up the digest job                            |
| What email address do you want to give your agents? | Routes inbound mail through `agent@blankcollar.ai` (or a custom domain) |

The answers are written to the company brain as facts on the spot.

### Step 3 — Meet your first agent (instant)

A pre-configured Hermes is hired into the right department for the template chosen. The user sees:

> *"I'm Hermes. I'll handle your Marketing department.
> Here's the plan I drafted for your goal —
> tell me to start, change it, or scrap it."*

User clicks **Start**.

### Step 4 — Wait

The user closes the tab. The agent works.

### Step 5 — The Friday email

Once a week, the OS emails:

- What got done
- What's still in flight
- The one or two decisions that need a human

Ideally that email is the only contact the user *needs* to have with their company that week.

## What we won't do during onboarding

- Force a payment method.
- Show terminals, prompt fields, model dropdowns.
- Ask the user to "configure" anything they don't already have an opinion about.
- Use words like *agentic*, *LLM*, *embedding*, *vector*, *MCP*, or *RAG* anywhere on screen.

## Sensible defaults the OS picks for the user

| Setting                  | Default                               |
|--------------------------|---------------------------------------|
| Model                    | A balanced production-grade Claude    |
| Embedding model          | `text-embedding-3-small`              |
| Visibility scope on memories | `[owner, department_lead]`        |
| Skill policy             | High-stakes skills require approval   |
| Cost cap per run         | A small, sane number ($0.50)          |
| Daily org cost cap       | The free-tier ceiling                 |
| Digest frequency         | Weekly (Friday morning)                |

A power user can change all of these. A beginner never has to.

## Onboarding *out* — leaving Blank Collar

If you want to leave:

1. **Export.** A single button generates a tarball of your Postgres dump + Qdrant snapshot + a JSON of all goals, runs, agents.
2. **Self-host.** Drop that tarball into a fresh local stack and you're back where you were.
3. **Stripe** subscriptions cancel cleanly; no win-back loops, no dark patterns.

Owning your data is a feature, not a clause in the terms.
