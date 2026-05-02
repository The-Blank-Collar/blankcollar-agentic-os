# =============================================================================
# Blank Collar — Agentic OS · Makefile
# Ergonomic wrappers around docker compose + the infra scripts.
# Run `make help` to see everything.
# =============================================================================

SHELL := /bin/bash
COMPOSE := docker compose
PG_URL := postgresql://postgres:postgres@localhost:5432/blankcollar

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[1;36m<target>\033[0m\n\nTargets:\n"} \
	     /^[a-zA-Z0-9_.-]+:.*##/ {printf "  \033[1;36m%-12s\033[0m %s\n", $$1, $$2}' \
	     $(MAKEFILE_LIST)
	@echo

.PHONY: bootstrap
bootstrap: ## First-run setup (Docker check, .env, pull, up, healthcheck)
	./infra/scripts/bootstrap.sh

.PHONY: up
up: ## Start the full stack in the background
	$(COMPOSE) up -d

.PHONY: up-tools
up-tools: ## Start the stack including pgAdmin
	$(COMPOSE) --profile tools up -d

.PHONY: down
down: ## Stop the stack (keeps data)
	$(COMPOSE) down

.PHONY: nuke
nuke: ## Stop AND wipe all data (destructive — use ./infra/scripts/reset.sh for a confirmation prompt)
	$(COMPOSE) down -v --remove-orphans

.PHONY: reset
reset: ## Interactive reset (asks for confirmation before wiping)
	./infra/scripts/reset.sh

.PHONY: doctor
doctor: ## Health-check every service
	./infra/scripts/doctor.sh

.PHONY: smoke
smoke: ## End-to-end exercise of the live API (capture, inbox, briefing, self-audit, knowledge, …)
	./infra/scripts/smoke.sh

.PHONY: smoke-local
smoke-local: ## Bring up the stack, wait for doctor, run smoke, tear down
	@$(COMPOSE) up -d
	@echo "→ waiting for stack to be healthy"
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12; do \
	  if ./infra/scripts/doctor.sh >/dev/null 2>&1; then echo "✓ doctor green"; break; fi; \
	  if [ $$i -eq 12 ]; then echo "✗ doctor never went green" >&2; $(COMPOSE) down; exit 1; fi; \
	  sleep 5; \
	done
	@./infra/scripts/smoke.sh; rc=$$?; $(COMPOSE) down; exit $$rc

.PHONY: cli
cli: ## Build + link the bc CLI globally (then `bc help` works)
	@cd packages/cli && npm install --silent && npm run build && npm link

.PHONY: cli-test
cli-test: ## Run the CLI's vitest suite
	@cd packages/cli && npm install --silent && npm test

.PHONY: gates
gates: ## Static gates: typecheck + lint + tests across paperclip + cli
	@echo "→ paperclip"
	@cd apps/paperclip && npm install --silent && npm run typecheck && npm run lint && npm run test -- --reporter=basic
	@echo "→ cli"
	@cd packages/cli && npm install --silent && npm run typecheck && npm run lint && npm run test -- --reporter=basic
	@echo "✓ all gates green"

.PHONY: setup-keys
setup-keys: ## Interactively prompt for each API key → write to .env (hidden, no shell history)
	@./infra/scripts/setup-keys.sh

.PHONY: ps
ps: ## Show running containers
	$(COMPOSE) ps

.PHONY: logs
logs: ## Tail logs for all services (Ctrl-C to exit)
	$(COMPOSE) logs -f --tail=200

.PHONY: psql
psql: ## Open a psql shell to the local Postgres
	@command -v psql >/dev/null || { echo "psql not installed — try: brew install libpq && brew link --force libpq"; exit 1; }
	psql "$(PG_URL)"

.PHONY: qdrant
qdrant: ## Open the Qdrant dashboard in your browser
	@open "http://localhost:6333/dashboard" 2>/dev/null || xdg-open "http://localhost:6333/dashboard" 2>/dev/null || echo "http://localhost:6333/dashboard"

.PHONY: dashboard
dashboard: ## Open the Paperclip dashboard in your browser
	@open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null || echo "http://localhost:3000"

.PHONY: validate
validate: ## Validate docker-compose.yml without starting anything
	$(COMPOSE) config -q && echo "✅ docker-compose.yml valid"

.PHONY: validate-prod
validate-prod: ## Validate base + prod compose files together
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml config -q && echo "✅ base + prod compose valid"

.PHONY: preflight
preflight: ## Pre-deploy gate: rejects default secrets, missing public-facing vars, broken prod compose
	./infra/scripts/preflight.sh

.PHONY: deploy
deploy: ## Deploy to a remote VPS (usage: make deploy TARGET=user@host) or `local` from on-VPS
	@if [ -z "$(TARGET)" ]; then echo "usage: make deploy TARGET=user@host  (or TARGET=local)"; exit 2; fi
	./infra/scripts/deploy.sh $(TARGET)

.PHONY: backup
backup: ## Snapshot all stateful volumes + databases to ./backups/blankcollar-<TS>.tar.gz
	./infra/scripts/backup.sh

.PHONY: restore
restore: ## Restore from a backup tarball (usage: make restore TARBALL=./backups/<file>.tar.gz)
	@if [ -z "$(TARBALL)" ]; then echo "usage: make restore TARBALL=./backups/blankcollar-<TS>.tar.gz"; exit 2; fi
	./infra/scripts/restore.sh $(TARBALL)

# -----------------------------------------------------------------------------
# Native paperclipai runner — see docs/PAPERCLIP_REAL.md for the rationale.
# Runs from $HOME so it doesn't pick up our project's .env (which has Docker-
# only hostnames like postgres:5432 that crash native paperclipai).
# -----------------------------------------------------------------------------
.PHONY: paperclip
paperclip: ## Launch real Paperclip command centre natively at :3100 (Ctrl+C to stop)
	@command -v node >/dev/null || { echo "Node.js not found — install with: brew install node"; exit 1; }
	@echo "→ Starting paperclipai natively. Open http://localhost:3100"
	@echo "→ Ctrl+C to stop. State persists at ~/.paperclip"
	@cd "$$HOME" && exec npx --yes paperclipai@latest run

.PHONY: paperclip-onboard
paperclip-onboard: ## One-time setup for native paperclipai (rarely needed; onboard runs on first start anyway)
	@cd "$$HOME" && npx --yes paperclipai@latest onboard --yes

# -----------------------------------------------------------------------------
# Single-user mode
# -----------------------------------------------------------------------------
.PHONY: personal
personal: ## Land in single-user mode. Usage: make personal NAME="Lior" EMAIL=lior@example.com
	@NAME="$(NAME)" EMAIL="$(EMAIL)" PERSONAL_ORG_SLUG="$(PERSONAL_ORG_SLUG)" ./infra/scripts/personal.sh

# -----------------------------------------------------------------------------
# Supabase local-testing helpers — see docs/SUPABASE_LOCAL.md
# -----------------------------------------------------------------------------
.PHONY: user-add
user-add: ## Provision a user. Usage: make user-add EMAIL=alice@example.com [ROLE=owner] [NAME="Alice"]
	@EMAIL="$(EMAIL)" ROLE="$(ROLE)" NAME="$(NAME)" ./infra/scripts/user-add.sh

.PHONY: users
users: ## List provisioned users + roles
	@docker exec -i bc_postgres psql -U postgres -d blankcollar -c \
	  "SELECT u.email, u.display_name, string_agg(ra.role::text, ',' ORDER BY ra.role) AS roles, u.is_active \
	     FROM core.user_account u LEFT JOIN core.role_assignment ra ON ra.user_id = u.id \
	    GROUP BY u.id ORDER BY u.created_at DESC;"

# -----------------------------------------------------------------------------
# Stripe local-testing helpers — see docs/STRIPE_LOCAL.md
# Requires the Stripe CLI:  brew install stripe/stripe-cli/stripe
# -----------------------------------------------------------------------------
.PHONY: stripe-listen
stripe-listen: ## Forward Stripe test webhooks to local Paperclip (requires `stripe` CLI)
	@command -v stripe >/dev/null || { echo "Install stripe CLI: brew install stripe/stripe-cli/stripe"; exit 1; }
	@echo "Copy the displayed signing secret (whsec_…) into .env as STRIPE_WEBHOOK_SECRET, then restart paperclip."
	stripe listen --forward-to localhost:3000/api/webhooks/stripe

.PHONY: stripe-trigger
stripe-trigger: ## Fire a Stripe test event. Usage: make stripe-trigger EVENT=customer.subscription.created
	@command -v stripe >/dev/null || { echo "Install stripe CLI: brew install stripe/stripe-cli/stripe"; exit 1; }
	@stripe trigger $${EVENT:-customer.created}

.PHONY: stripe-events
stripe-events: ## Show recently received Stripe events (idempotent log)
	@docker exec -i bc_postgres psql -U postgres -d blankcollar -c \
	  "SELECT id, type, processing_state, received_at FROM billing.stripe_event ORDER BY received_at DESC LIMIT 20;" \
	  || echo "billing.stripe_event not yet present — fire a test event with: make stripe-trigger"
