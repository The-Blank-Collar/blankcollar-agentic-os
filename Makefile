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
