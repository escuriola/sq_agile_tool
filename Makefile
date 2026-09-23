SHELL := /bin/bash
COMPOSE := docker compose
STAMP := $(shell date +%Y%m%d-%H%M%S)

# La demo corre como un proyecto de Compose aparte: otros puertos y su propio
# volumen, así que no puede tocar los datos reales.
DEMO_ENV := COMPOSE_PROJECT_NAME=agile-demo WEB_PORT=5190 API_PORT=5191 DB_PORT=5443
DEMO_WEB := http://localhost:5190

.DEFAULT_GOAL := help

## up: build and start everything (data is kept). The everyday command.
up:
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  Web  -> http://localhost:$${WEB_PORT:-5180}"
	@echo "  API  -> http://localhost:$${API_PORT:-5181}/api/health"
	@echo "  DB   -> postgres://$${DB_USER:-agile}@localhost:$${DB_PORT:-5433}/$${DB_NAME:-agile}"

## down: stop the containers. Does NOT delete data.
down:
	$(COMPOSE) down

## restart: restart without rebuilding.
restart:
	$(COMPOSE) restart

## logs: follow the logs of every service.
logs:
	$(COMPOSE) logs -f

## ps: status of the services.
ps:
	$(COMPOSE) ps

## psql: open a SQL console against the database.
psql:
	$(COMPOSE) exec db psql -U $${DB_USER:-agile} -d $${DB_NAME:-agile}

## backup: dump the database to ./backups/agile-<date>.sql
backup:
	@mkdir -p backups
	$(COMPOSE) exec -T db pg_dump -U $${DB_USER:-agile} -d $${DB_NAME:-agile} > backups/agile-$(STAMP).sql
	@echo "-> backups/agile-$(STAMP).sql"

## restore: restore a dump. Usage: make restore FILE=backups/agile-XXXX.sql
restore:
	@test -n "$(FILE)" || (echo "Missing FILE=backups/..."; exit 1)
	$(COMPOSE) exec -T db psql -U $${DB_USER:-agile} -d $${DB_NAME:-agile} < $(FILE)

## demo: start a separate instance with sample data, on ports 5190/5191.
demo:
	$(DEMO_ENV) $(COMPOSE) up -d --build
	@echo "Waiting for the demo API..."
	@for i in $$(seq 1 60); do curl -sf http://localhost:5191/api/health >/dev/null && break; sleep 1; done
	@$(DEMO_ENV) $(COMPOSE) exec -T db psql -v ON_ERROR_STOP=1 -q -U $${DB_USER:-agile} -d $${DB_NAME:-agile} < api/seed/demo.sql
	@echo ""
	@echo "  Demo -> $(DEMO_WEB)"
	@echo "  Three sprints, six people and a sprint in flight. Your own data is untouched."

## demo-down: stop the demo and delete ONLY its data.
demo-down:
	$(DEMO_ENV) $(COMPOSE) down -v

## reset: DESTRUCTIVE. Deletes the data volume and starts from scratch.
reset:
	@read -p "This DELETES all your sprint data. Type 'yes' to continue: " ok; \
	  [ "$$ok" = "yes" ] || { echo "Cancelled."; exit 1; }
	$(COMPOSE) down -v
	$(COMPOSE) up -d --build

## help: this help.
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  make /'

.PHONY: up down restart logs ps psql backup restore demo demo-down reset help
